import { useCallback, useEffect, useRef, useState } from 'react';
import { installComicBuilder, uninstallComicBuilder } from './ai/actions';
import type { ActionResult, ComicBuilderDeps } from './ai/deps';
import { createMediaDeps, createOrOpenProject } from './ai/storageDeps';
import ConflictBar from './components/ConflictBar';
import EditorScreen from './components/EditorScreen';
import { initialTab } from './components/editorTabs';
import type { EditorTab } from './components/editorTabs';
import PreviewScreen from './components/PreviewScreen';
import ProjectTiles from './components/ProjectTiles';
import SplashScreen from './components/SplashScreen';
import StatusToast from './components/StatusToast';
import type { Status } from './components/StatusToast';
import { getGoogleClientId } from './config';
import {
  awaitDeviceAccess,
  downloadFile,
  disconnectDrive,
  ensureProjectFolder,
  hasDriveAccess,
  listProjectFolders,
  loadProjectFile,
  requestDeviceAccess,
  requestDriveAccess,
  saveProjectJson,
  trashFile,
  uploadImage,
} from './drive/driveClient';
import type { DeviceCodeInfo, ProjectFolder } from './drive/driveClient';
import { loadProject } from './drive/projectStore';
import type { Conflict } from './state/merge';
import { useProjectSaver } from './state/useProjectSaver';
import type { ComicProject } from './types/comic';
import { errorMessage } from './utils/errors';
import { makeThumbnail } from './utils/thumbnail';

type Screen = 'splash' | 'tiles' | 'editor';

/** The Drive calls the ComicBuilder deps make: the page's own token and fetch. */
const drive = {
  uploadImage,
  trashFile,
  downloadFile,
  ensureProjectFolder,
  loadProjectFile,
  saveProjectJson,
};

export default function App() {
  const [screen, setScreen] = useState<Screen>('splash');
  const [preview, setPreview] = useState(false);
  const [project, setProject] = useState<ComicProject | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [folders, setFolders] = useState<ProjectFolder[]>([]);
  const [status, setStatusState] = useState<Status | null>(null);
  const [deviceCode, setDeviceCode] = useState<DeviceCodeInfo | null>(null);
  const [tab, setTab] = useState<EditorTab>('pages');

  // Refs mirror state so the ComicBuilder deps, installed once, always see the latest values.
  const projectRef = useRef<ComicProject | null>(null);
  const pageIndexRef = useRef(0);
  const folderIdRef = useRef<string | null>(null);

  const clearStatus = useCallback(() => setStatusState(null), []);
  const setStatus = (text: string, error = false) => setStatusState({ text, error });

  const saver = useProjectSaver({
    active: project !== null,
    projectRef,
    folderIdRef,
    setProject,
    replaceProject: replaceWithMerged,
    updateProject: (mutation) => updateProject(mutation),
    onError: (message) => setStatus(message, true),
  });

  function setCurrentProject(next: ComicProject | null) {
    projectRef.current = next;
    setProject(next);
  }

  function selectPage(index: number) {
    pageIndexRef.current = index;
    setPageIndex(index);
  }

  /** Change the open project (a copy is edited, then swapped in); it is then unsaved. */
  function updateProject(mutation: (project: ComicProject) => void) {
    const current = projectRef.current;
    if (!current) throw new Error('No project is open.');
    const next = structuredClone(current);
    mutation(next);
    next.updatedAt = new Date().toISOString();
    setCurrentProject(next);
    saver.markDirty();
  }

  /** Swap in a project merged with somebody else's save, staying on the same page if it still exists. */
  function replaceWithMerged(merged: ComicProject) {
    const shownId = projectRef.current?.pages[pageIndexRef.current]?.id;
    setCurrentProject(merged);
    const at = merged.pages.findIndex((page) => page.id === shownId);
    selectPage(at >= 0 ? at : Math.min(pageIndexRef.current, merged.pages.length - 1));
  }

  /** Go to where a conflict is: its tab and page. */
  function showConflict(conflict: Conflict) {
    setTab(conflict.where.tab);
    const { pageId } = conflict.where;
    const index = pageId ? (projectRef.current?.pages.findIndex((p) => p.id === pageId) ?? -1) : -1;
    if (index >= 0) selectPage(index);
  }

  function showProject(opened: ComicProject, folderId: string, version: string | null) {
    folderIdRef.current = folderId;
    setCurrentProject(opened);
    selectPage(0);
    setPreview(false);
    setTab(initialTab(opened));
    saver.reset({ project: opened, version });
    setScreen('editor');
  }

  function dropProject() {
    folderIdRef.current = null;
    setCurrentProject(null);
    selectPage(0);
    setPreview(false);
    setTab('pages');
    saver.reset();
  }

  async function refreshTiles(): Promise<ProjectFolder[]> {
    try {
      const list = await listProjectFolders();
      setFolders(list);
      return list;
    } catch (e) {
      setStatus(`Could not list Drive folders: ${errorMessage(e)}`, true);
      return [];
    }
  }

  async function showTiles(): Promise<ProjectFolder[]> {
    const list = await refreshTiles();
    setScreen('tiles');
    return list;
  }

  async function openFolder(folder: ProjectFolder): Promise<ActionResult> {
    setStatus('Loading project…');
    try {
      const { project: opened, version } = await loadProject(folder.id);
      showProject(opened, folder.id, version);
      setStatus(`Opened "${opened.title}".`);
      return { ok: true };
    } catch (e) {
      const error = `Could not open "${folder.name}": ${errorMessage(e)}`;
      setStatus(error, true);
      return { ok: false, error };
    }
  }

  /** Replace the open project with the copy on Drive, so changes made elsewhere show without a page reload. */
  async function refreshProject() {
    const folderId = folderIdRef.current;
    if (!folderId) return;
    if (
      saver.dirty &&
      !window.confirm('You have unsaved changes. Refreshing from Google Drive will discard them.')
    ) {
      return;
    }
    setStatus('Refreshing from Google Drive…');
    try {
      const { project: fresh, version } = await loadProject(folderId);
      if (folderIdRef.current !== folderId) return;
      replaceWithMerged(fresh);
      saver.reset({ project: fresh, version });
      setStatus('Refreshed from Google Drive.');
    } catch (e) {
      setStatus(`Could not refresh: ${errorMessage(e)}`, true);
    }
  }

  // The ComicBuilder API is installed once; every helper it uses goes through refs and setState.
  useEffect(() => {
    const deps: ComicBuilderDeps = {
      getProject: () => projectRef.current,

      updateProject,

      replaceProject: (replacement) => {
        setCurrentProject(replacement);
        selectPage(0);
        setPreview(false);
        saver.markDirty();
      },

      getPageIndex: () => pageIndexRef.current,
      setPageIndex: selectPage,
      setPreview,
      setStatus: (message) => setStatus(message),

      connectStorage: async () => {
        try {
          await requestDriveAccess();
          await showTiles();
          setStatusState(null);
        } catch (e) {
          setStatus(`Could not connect: ${errorMessage(e)}`, true);
        }
      },

      connectStorageWithDevice: async () => {
        let info: DeviceCodeInfo;
        try {
          info = await requestDeviceAccess();
        } catch (e) {
          setStatus(`Could not connect: ${errorMessage(e)}`, true);
          throw e;
        }
        setDeviceCode(info);
        awaitDeviceAccess()
          .then(showTiles)
          .then(() => setStatusState(null))
          .catch((e) => setStatus(`Could not connect: ${errorMessage(e)}`, true))
          .finally(() => setDeviceCode(null));
        return info;
      },

      disconnectStorage: async () => {
        setDeviceCode(null);
        await saver.save();
        await disconnectDrive();
        dropProject();
        setFolders([]);
        setScreen('splash');
        setStatus('Disconnected from Google Drive.');
      },

      getStorageStatus: () => ({
        connected: hasDriveAccess(),
        configured: getGoogleClientId() !== null,
      }),

      listStorageProjects: listProjectFolders,

      createStorageProject: async (name, pageSize) => {
        const {
          folder,
          project: created,
          version,
          existed,
          title,
        } = await createOrOpenProject(drive, name, pageSize);
        showProject(created, folder.id, version);
        setStatus(`${existed ? 'Opened' : 'Created'} "${title}".`);
        return folder;
      },

      openStorageProject: openFolder,

      closeStorageProject: async () => {
        if (!(await saver.save())) return;
        dropProject();
        setScreen('tiles');
        setStatus('Project closed.');
        void refreshTiles();
      },

      showProjectTiles: showTiles,

      flushStorageSave: async () => {
        if (!projectRef.current) return { ok: false, error: 'No project is open.' };
        if (await saver.save()) return { ok: true };
        const clashes = saver.pendingConflicts();
        return {
          ok: false,
          error: clashes.length
            ? `Not saved: the project was changed elsewhere and ${clashes.length} change${clashes.length === 1 ? '' : 's'} clash${clashes.length === 1 ? 'es' : ''} with yours (${clashes.map((c) => c.label).join('; ')}). Choose which to keep at the bottom of the editor.`
            : 'Save failed. Check that Drive is still connected.',
        };
      },

      ...createMediaDeps({
        getProject: () => projectRef.current,
        getFolderId: () => folderIdRef.current,
        updateProject: (mutation) => deps.updateProject(mutation),
        drive,
        makeThumbnail,
      }),
    };

    installComicBuilder(deps);
    return uninstallComicBuilder;
    // Installed once: the deps only use refs and state setters, so they never go stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentPage = project?.pages[pageIndex];
  let content = null;
  if (screen === 'splash') {
    content = <SplashScreen deviceCode={deviceCode} />;
  } else if (screen === 'tiles') {
    content = <ProjectTiles folders={folders} />;
  } else if (project && preview && currentPage) {
    content = <PreviewScreen page={currentPage} pageSize={project.metadata.pageSize} />;
  } else if (project) {
    content = (
      <EditorScreen
        project={project}
        pageIndex={pageIndex}
        tab={tab}
        onTabChange={setTab}
        saveState={saver.saveState}
        dirty={saver.dirty}
        onRefresh={refreshProject}
        conflictTabs={new Set(saver.conflicts.map((c) => c.where.tab))}
        conflictPageIds={new Set(saver.conflicts.flatMap((c) => c.where.pageId ?? []))}
        conflictBar={
          saver.conflicts.length > 0 && (
            <ConflictBar
              project={project}
              conflicts={saver.conflicts}
              onShow={showConflict}
              onResolve={saver.resolve}
            />
          )
        }
      />
    );
  }

  return (
    <>
      {content}
      <StatusToast status={status} onClose={clearStatus} />
    </>
  );
}
