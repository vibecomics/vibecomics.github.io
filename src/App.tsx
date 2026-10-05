import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { installComicBuilder, uninstallComicBuilder } from './ai/actions';
import { pageIndexOfPanel } from './ai/builders';
import type { ActionResult, ComicBuilderDeps } from './ai/deps';
import type { GenerationTarget } from './ai/generation';
import { createMediaDeps, createOrOpenProject } from './ai/storageDeps';
import ConflictBar from './components/ConflictBar';
import EditorScreen from './components/EditorScreen';
import type { EditorTab } from './components/editorTabs';
import type { Selection } from './components/selection';
import { clearMediaCache } from './components/mediaImages';
import PreviewScreen from './components/PreviewScreen';
import ProjectTiles from './components/ProjectTiles';
import StatusToast from './components/StatusToast';
import type { Status } from './components/StatusToast';
import { awaitDeviceAccess, isDriveConfigured, requestDeviceAccess } from './drive/driveClient';
import type { DeviceCodeInfo } from './drive/driveClient';
import { readGeneratorConfig, writeGeneratorConfig } from './generators/browserConfigStore';
import { removeWhiteBackground } from './utils/removeWhiteBackground';
import {
  connectDriveConnection,
  connectServerConnection,
  disconnectConnection,
  listAllProjects,
  listConnectionInfo,
  listConnections,
  reconnectRememberedServers,
} from './storage/connections';
import {
  backendLabel,
  downloadFile,
  ensureProjectFolder,
  findFileByName,
  getActiveBackend,
  loadProjectFile,
  saveProjectJson,
  setActiveBackend,
  setCurrentFolderId,
  trashFile,
  uploadImage,
} from './storage/activeBackend';
import { loadProject } from './storage/projectStore';
import {
  formatHash,
  parseHash,
  placeHash,
  routeOf,
  startView,
  viewFromRoute,
  WELCOME_HASH,
} from './navigation/hashRoute';
import type { ComicRoute, Route, View } from './navigation/hashRoute';
import type { ProjectFolder } from './storage/types';
import type { Conflict } from './state/merge';
import { useProjectSaver } from './state/useProjectSaver';
import type { ComicProject } from './types/comic';
import { errorMessage } from './utils/errors';
import { makeThumbnail } from './utils/thumbnail';

type Screen = 'tiles' | 'editor';

/** The storage calls the ComicBuilder deps make: whichever backend is active. */
const storage = {
  uploadImage,
  trashFile,
  downloadFile,
  findFileByName,
  ensureProjectFolder,
  loadProjectFile,
  saveProjectJson,
};

export default function App() {
  const [screen, setScreen] = useState<Screen>('tiles');
  const [preview, setPreview] = useState(false);
  const [project, setProject] = useState<ComicProject | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [selection, setSelection] = useState<Selection>({ panelId: null });
  const [comic, setComic] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [projects, setProjects] = useState<ProjectFolder[]>([]);
  const [status, setStatusState] = useState<Status | null>(null);
  const [deviceCode, setDeviceCode] = useState<DeviceCodeInfo | null>(null);
  const [tab, setTab] = useState<EditorTab>('pages');
  // What the generation queue last asked to show; the tab it lands on applies it, then clears it.
  const [focus, setFocus] = useState<GenerationTarget | null>(null);
  const clearFocus = useCallback(() => setFocus(null), []);

  // Refs mirror state so the ComicBuilder deps, installed once, always see the latest values.
  const projectRef = useRef<ComicProject | null>(null);
  const pageIndexRef = useRef(0);
  const folderIdRef = useRef<string | null>(null);
  const comicRef = useRef<string | null>(null);
  const navigationRef = useRef(0);
  const lastRouteRef = useRef<Route | null>(null);
  const startHashRef = useRef(window.location.hash);
  const startedRef = useRef(false);

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

  /** Go to what a generation was for: its layer on the Pages tab, or its entry on Cast or Scenes. */
  function showGeneration(target: GenerationTarget) {
    const current = projectRef.current;
    if (!current) return;
    if (target.type === 'layer') {
      const index = pageIndexOfPanel(current, target.panelId);
      if (index < 0) {
        setStatus('That panel no longer exists.', true);
        return;
      }
      selectPage(index);
      setTab('pages');
      setSelection({ panelId: target.panelId, layerId: target.layerId });
      return;
    }
    if (!current.metadata[target.kind].some((entry) => entry.id === target.entryId)) {
      setStatus('That entry no longer exists.', true);
      return;
    }
    setTab(target.kind === 'scenes' ? 'scenes' : 'cast');
    setFocus(target);
  }

  function applyView(view: View) {
    selectPage(view.pageIndex);
    setTab(view.tab);
    setSelection(view.selection);
    setPreview(false);
  }

  function showProject(
    opened: ComicProject,
    folder: ProjectFolder,
    version: string | null,
    view: View
  ) {
    folderIdRef.current = folder.id;
    comicRef.current = folder.name;
    setComic(folder.name);
    setCurrentFolderId(folder.id);
    setCurrentProject(opened);
    applyView(view);
    saver.reset({ project: opened, version });
    setScreen('editor');
  }

  function dropProject() {
    folderIdRef.current = null;
    comicRef.current = null;
    setComic(null);
    setCurrentFolderId(null);
    setActiveBackend(null);
    setCurrentProject(null);
    selectPage(0);
    setSelection({ panelId: null });
    setPreview(false);
    setTab('pages');
    saver.reset();
  }

  async function refreshTiles(): Promise<ProjectFolder[]> {
    try {
      const list = await listAllProjects();
      setProjects(list);
      return list;
    } catch (e) {
      setStatus(`Could not list project folders: ${errorMessage(e)}`, true);
      return [];
    }
  }

  async function showTiles(): Promise<ProjectFolder[]> {
    const list = await refreshTiles();
    setScreen('tiles');
    return list;
  }

  /** Which connection a newly created project goes in, when the caller did not pick one. */
  function defaultConnectionId(): string | null {
    const live = listConnections();
    return live.length === 1 ? live[0].id : null;
  }

  /** Open a folder on the view a URL names (or the starting view). Nothing is shown if `isCurrent` says it was overtaken. */
  async function openFolder(
    folder: ProjectFolder,
    route?: ComicRoute,
    isCurrent: () => boolean = () => true
  ): Promise<ActionResult> {
    const connectionId = folder.connectionId ?? getActiveBackend() ?? listConnections()[0]?.id;
    if (!connectionId) {
      const error = 'No storage connection is available.';
      setStatus(error, true);
      return { ok: false, error };
    }
    setActiveBackend(connectionId);
    setStatus('Loading project…');
    try {
      const { project: opened, version } = await loadProject(folder.id);
      if (!isCurrent()) return { ok: false, error: 'Superseded by another navigation.' };
      const view = route ? viewFromRoute(opened, route) : startView(opened);
      if (!view) {
        const error = `"${folder.name}" has no such page, panel or layer.`;
        setStatus(error, true);
        return { ok: false, error };
      }
      showProject(opened, folder, version, view);
      setStatus(`Opened "${opened.title}".`);
      return { ok: true };
    } catch (e) {
      const error = `Could not open "${folder.name}": ${errorMessage(e)}`;
      setStatus(error, true);
      return { ok: false, error };
    }
  }

  /** Replace the open project with the stored copy, so changes made elsewhere show without a page reload. */
  async function refreshProject() {
    const folderId = folderIdRef.current;
    if (!folderId) return;
    if (
      saver.dirty &&
      !window.confirm(
        `You have unsaved changes. Refreshing from ${backendLabel()} will discard them.`
      )
    ) {
      return;
    }
    setStatus(`Refreshing from ${backendLabel()}…`);
    try {
      const { project: fresh, version } = await loadProject(folderId);
      if (folderIdRef.current !== folderId) return;
      replaceWithMerged(fresh);
      saver.reset({ project: fresh, version });
      setStatus(`Refreshed from ${backendLabel()}.`);
    } catch (e) {
      setStatus(`Could not refresh: ${errorMessage(e)}`, true);
    }
  }

  async function goWelcome() {
    window.history.replaceState(null, '', WELCOME_HASH);
    await showTiles();
  }

  /** Show the place a URL names, opening its project first when it is not the one open. */
  async function applyHash(hash: string) {
    const token = ++navigationRef.current;
    const isCurrent = () => token === navigationRef.current;
    const target = parseHash(hash);
    if (target.screen === 'welcome') {
      await goWelcome();
      return;
    }

    const open = projectRef.current;
    if (comicRef.current === target.comic && open) {
      const view = viewFromRoute(open, target);
      if (!view) {
        setStatus(`"${target.comic}" has no such page, panel or layer.`, true);
        await goWelcome();
        return;
      }
      applyView(view);
      setScreen('editor');
      return;
    }

    setLoading(true);
    try {
      if (open && !(await saver.save())) {
        setStatus('The open project could not be saved, so it stays open.', true);
        if (lastRouteRef.current) {
          window.history.replaceState(null, '', formatHash(lastRouteRef.current));
        }
        return;
      }
      const folder = (await listAllProjects()).find((f) => f.name === target.comic);
      if (!isCurrent()) return;
      if (!folder) {
        setStatus(`No project named "${target.comic}" in the connected storage.`, true);
        await goWelcome();
        return;
      }
      const result = await openFolder(folder, target, isCurrent);
      if (!isCurrent()) return;
      if (!result.ok) await goWelcome();
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }

  // On load: reconnect any remembered HTTP storage servers (no secret, just a health check), then
  // show whatever projects that and any already-live connection turn up, and land on the place the
  // URL names. Drive's token is never persisted, so it always needs a fresh device-flow connect from
  // Settings.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void reconnectRememberedServers()
      .then(() => refreshTiles())
      .then(() => applyHash(startHashRef.current))
      .finally(() => setReady(true));
    // Runs once on mount; these close over state setters and refs that never go stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onHashChange = () => void applyHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
    // Same reasoning as the load effect above: applyHash only uses refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const route: Route =
    screen === 'editor' && project && comic
      ? { screen: 'comic', ...routeOf(comic, project, { tab, pageIndex, selection }) }
      : { screen: 'welcome' };
  const expectedHash = formatHash(route);
  useEffect(() => {
    if (!ready || loading) return;
    const previous = lastRouteRef.current;
    lastRouteRef.current = route;
    if (window.location.hash === expectedHash) return;
    if (previous && placeHash(previous) !== placeHash(route)) {
      window.history.pushState(null, '', expectedHash);
    } else {
      window.history.replaceState(null, '', expectedHash);
    }
    // route is fully determined by expectedHash, which is what the effect keys on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expectedHash, ready, loading]);

  // The ComicBuilder API is installed once; every helper it uses goes through refs and setState.
  // A layout effect, not a plain effect: React runs a child's effects before its parent's, and
  // ProjectTiles (a child, now shown on the very first render) calls cb() from its own mount
  // effect. All layout effects in a commit finish before any passive effect runs, so this must be
  // one too, or that child effect can call cb() before window.ComicBuilder exists and crash render
  // (no error boundary catches it).
  useLayoutEffect(() => {
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
          .then(() => {
            connectDriveConnection();
            return refreshTiles();
          })
          .then(() => setStatusState(null))
          .catch((e) => setStatus(`Could not connect: ${errorMessage(e)}`, true))
          .finally(() => setDeviceCode(null));
        return info;
      },

      connectStorageWithServer: async (url) => {
        try {
          await connectServerConnection(url);
        } catch (e) {
          setStatus(`Could not connect: ${errorMessage(e)}`, true);
          throw e;
        }
        await refreshTiles();
        setStatusState(null);
      },

      disconnectStorage: async () => {
        setDeviceCode(null);
        await saver.save();
        await Promise.all(listConnections().map((c) => disconnectConnection(c.id)));
        await clearMediaCache();
        dropProject();
        setProjects([]);
        setStatus('Disconnected every storage connection.');
      },

      getStorageStatus: () => ({
        connected: listConnections().length > 0,
        configured: isDriveConfigured(),
      }),

      listStorageConnections: async () => listConnectionInfo(),

      disconnectStorageConnection: async (id) => {
        const label = listConnectionInfo().find((c) => c.id === id)?.label ?? 'storage';
        if (getActiveBackend() === id) {
          await saver.save();
          await clearMediaCache();
          dropProject();
        }
        await disconnectConnection(id);
        await refreshTiles();
        setStatus(`Disconnected from ${label}.`);
      },

      listStorageProjects: listAllProjects,

      getGeneratorConfig: readGeneratorConfig,
      setGeneratorConfig: writeGeneratorConfig,
      removeBackground: removeWhiteBackground,

      createStorageProject: async (name, pageSize, connectionId) => {
        const target = connectionId ?? defaultConnectionId();
        if (!target) {
          throw new Error(
            'Pick a storage connection to create this project in (more than one is connected).'
          );
        }
        setActiveBackend(target);
        const {
          folder,
          project: created,
          version,
          existed,
          title,
        } = await createOrOpenProject(storage, name, pageSize);
        showProject(created, folder, version, startView(created));
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
            : 'Save failed. Check that storage is still connected.',
        };
      },

      ...createMediaDeps({
        getProject: () => projectRef.current,
        getFolderId: () => folderIdRef.current,
        updateProject: (mutation) => deps.updateProject(mutation),
        storage,
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
  if (screen === 'tiles') {
    content = <ProjectTiles projects={projects} deviceCode={deviceCode} />;
  } else if (project && preview && currentPage) {
    content = (
      <PreviewScreen project={project} page={currentPage} pageSize={project.metadata.pageSize} />
    );
  } else if (project) {
    content = (
      <EditorScreen
        project={project}
        pageIndex={pageIndex}
        tab={tab}
        onTabChange={setTab}
        selection={selection}
        onSelectionChange={setSelection}
        focus={focus}
        onFocusApplied={clearFocus}
        onShowGeneration={showGeneration}
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
