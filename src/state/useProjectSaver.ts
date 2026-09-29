import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { parseProject } from '../ai/storageDeps';
import { hasStorageAccess, loadProjectFile, saveProjectJson } from '../storage/activeBackend';
import { ProjectChangedError } from '../storage/types';
import type { ComicProject } from '../types/comic';
import { errorMessage } from '../utils/errors';
import { mergeProjects } from './merge';
import type { Conflict, Side } from './merge';

const AUTOSAVE_INTERVAL_MS = 60_000;
/** How many times a save merges in somebody else's newer save before giving up. */
const MAX_MERGES = 3;

export type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

interface Options {
  /** True while a project is open. */
  active: boolean;
  projectRef: MutableRefObject<ComicProject | null>;
  folderIdRef: MutableRefObject<string | null>;
  setProject: (project: ComicProject) => void;
  /** Replace the open project with a merged one, keeping the page on screen where it can. */
  replaceProject: (project: ComicProject) => void;
  /** Change the open project the way every edit does (it is then unsaved). */
  updateProject: (mutation: (project: ComicProject) => void) => void;
  onError: (message: string) => void;
}

/**
 * Tracks unsaved changes and writes project.json to storage: every minute while a
 * project is open, but only when something changed, plus on demand via save().
 *
 * It also guards against overwriting somebody else's save (another browser, the
 * CLI). It remembers the copy it last loaded or saved (the "base") and the storage
 * version of it. Before it writes, storage is asked to refuse if the file has a
 * newer version; then the newer copy is pulled and merged with ours (see
 * merge.ts) and, when nothing clashes, the merged project is what gets written.
 * Real clashes are not written: they wait in `conflicts`, for the editor to show
 * and for the user to settle one by one with `resolve`, after which the save goes
 * through by itself.
 */
export function useProjectSaver({
  active,
  projectRef,
  folderIdRef,
  setProject,
  replaceProject,
  updateProject,
  onError,
}: Options) {
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const dirtyRef = useRef(false);
  const changeCountRef = useRef(0);
  const inFlightRef = useRef<Promise<unknown> | null>(null);
  const conflictsRef = useRef<Conflict[]>([]);
  const syncRef = useRef<{ base: ComicProject; version: string | null } | null>(null);

  function markDirty() {
    changeCountRef.current++;
    dirtyRef.current = true;
    setDirty(true);
  }

  function setConflictList(list: Conflict[]) {
    conflictsRef.current = list;
    setConflicts(list);
  }

  /**
   * Forget unsaved changes, conflicts and the last save result (a project was opened or closed).
   * When a project was opened, pass it with its storage version: they are what the next save is
   * checked against and merged from.
   */
  function reset(opened?: { project: ComicProject; version: string | null }) {
    syncRef.current = opened
      ? { base: structuredClone(opened.project), version: opened.version }
      : null;
    setConflictList([]);
    dirtyRef.current = false;
    setDirty(false);
    setSaveState('idle');
  }

  /**
   * Write the open project. If storage has a newer version, pull it, merge it into ours and write the
   * merged project instead. Resolves to what was written, or to null when the two clash (the
   * conflicts are then in `conflicts` and the merged project, with our side for each, is open).
   */
  async function writeMerged(folderId: string) {
    for (let merges = 0; ; merges++) {
      const project = projectRef.current!;
      const savedAt = new Date().toISOString();
      const written = { ...project, savedAt, updatedAt: savedAt };
      const changeCount = changeCountRef.current;
      try {
        const version = await saveProjectJson(folderId, written, syncRef.current?.version);
        return { written, version, changeCount };
      } catch (e) {
        const sync = syncRef.current;
        if (!(e instanceof ProjectChangedError) || !sync || merges >= MAX_MERGES) throw e;
        const file = await loadProjectFile(folderId);
        const theirs = parseProject(file.json);
        // Edits may have been made while the newer copy was being fetched: merge what is open now.
        const { merged, conflicts: found } = mergeProjects(sync.base, projectRef.current!, theirs);
        syncRef.current = { base: theirs, version: file.version };
        changeCountRef.current++;
        replaceProject(merged);
        if (found.length > 0) {
          setConflictList(found);
          return null;
        }
      }
    }
  }

  /** Save if there are unsaved changes. Resolves true when nothing is left unsaved. */
  async function save(): Promise<boolean> {
    while (inFlightRef.current) await inFlightRef.current.catch(() => undefined);

    const folderId = folderIdRef.current;
    if (!projectRef.current || !folderId) return false;
    if (conflictsRef.current.length > 0) {
      setSaveState('conflict');
      return false;
    }
    if (!dirtyRef.current) return true;
    if (!hasStorageAccess()) {
      onError('Could not save: not connected to storage.');
      return false;
    }

    const write = writeMerged(folderId);
    inFlightRef.current = write;
    setSaveState('saving');
    try {
      const result = await write;
      if (folderIdRef.current !== folderId || !projectRef.current) return true;
      if (result === null) {
        setSaveState('conflict');
        onError(
          'This project was changed elsewhere and some changes clash with yours. Choose which to keep at the bottom of the editor.'
        );
        return false;
      }
      syncRef.current = { base: structuredClone(result.written), version: result.version };
      const current = { ...projectRef.current, savedAt: result.written.savedAt };
      projectRef.current = current;
      setProject(current);
      // Edits made while the write was in flight stay unsaved for the next round.
      if (changeCountRef.current === result.changeCount) {
        dirtyRef.current = false;
        setDirty(false);
      }
      setSaveState('saved');
      return true;
    } catch (e) {
      setSaveState('error');
      onError(`Save failed: ${errorMessage(e)}`);
      return false;
    } finally {
      inFlightRef.current = null;
    }
  }

  /** Settle one conflict the given way. When the last one is settled, the project is saved. */
  function resolve(conflict: Conflict, side: Side) {
    updateProject((project) => {
      conflict.resolve(project, side);
      project.pages.forEach((page, index) => {
        page.number = index;
      });
    });
    const rest = conflictsRef.current.filter((c) => c !== conflict);
    setConflictList(rest);
    if (rest.length === 0) {
      setSaveState('idle');
      void saveRef.current();
    }
  }

  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (dirtyRef.current && conflictsRef.current.length === 0) void saveRef.current();
    }, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  return {
    dirty,
    saveState,
    save,
    markDirty,
    reset,
    /** Clashes with somebody else's newer save, waiting for the user to choose. */
    conflicts,
    /** The same list, always current (for code that outlives a render). */
    pendingConflicts: () => conflictsRef.current,
    resolve,
  };
}
