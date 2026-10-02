/**
 * The CLI's counterpart of App.tsx: the ComicBuilderDeps for one command run in
 * Node. The project is loaded from its storage connection before the command
 * (when one is open), changed in memory by the API, and written back after it.
 * The Google login, any connected HTTP storage servers, and the open project
 * (and which connection it came from) persist in the state file between runs.
 * The Drive and server REST calls, the media and project-folder logic are the
 * same code the page uses (driveRest.ts, serverRest.ts, storageDeps.ts).
 */
import type { ComicBuilderDeps } from '../ai/deps';
import { createMediaDeps, createOrOpenProject, parseProject } from '../ai/storageDeps';
import {
  pollDeviceOnce,
  refreshAccessToken,
  revokeToken,
  startDeviceFlow,
} from '../drive/deviceOAuth';
import type { DeviceClient, DeviceCodeInfo } from '../drive/deviceOAuth';
import { createDriveRest } from '../drive/driveRest';
import { checkServerHealth, normalizeServerUrl } from '../server/serverClient';
import { createServerRest } from '../server/serverRest';
import type { StorageConnectionInfo } from '../storage/connections';
import { ProjectChangedError } from '../storage/types';
import type { ProjectFolder } from '../storage/types';
import { mergeProjects } from '../state/merge';
import type { Conflict } from '../state/merge';
import type { ComicProject } from '../types/comic';
import { errorMessage } from '../utils/errors';
import { StateStore } from './state';

const TOKEN_EXPIRY_MARGIN_MS = 60_000;
const DRIVE_CONNECTION_ID = 'drive';
/** Matches storage/connections.ts's id scheme for a server connection, so ids read the same in both. */
const serverConnectionId = (url: string): string => `server:${url}`;

export interface NodeSessionOptions {
  store: StateStore;
  fetch?: typeof fetch;
  /** The Google device OAuth client, or null when this build has none. */
  deviceClient: DeviceClient | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** What `auth status` and `auth login` report. */
export interface AuthReport {
  connected: boolean;
  configured: boolean;
  project: string | null;
  /** Set while a login waits for the user: show them the URL and code. */
  pending?: DeviceCodeInfo & { secondsLeft: number };
  /** Why the login did not complete (denied, expired), if it did not. */
  error?: string;
  next?: string;
}

/** Nothing was saved because the project on Drive changed and the two sets of changes clash. */
export class ConflictError extends Error {
  constructor(readonly conflicts: Conflict[]) {
    const lines = conflicts.flatMap((c) => [
      `  - ${c.label}`,
      `      yours:  ${c.text.ours}`,
      `      theirs: ${c.text.theirs}`,
      `      before: ${c.text.base}`,
    ]);
    super(
      [
        `Nothing was saved: the project was changed in storage since this command read it, and ${
          conflicts.length === 1 ? 'that change conflicts' : 'those changes conflict'
        } with this one:`,
        ...lines,
        'Fetch the project again (the next command does) and apply this change again on top of it.',
      ].join('\n')
    );
  }
}

const LOGIN_HINT = 'Run "vibecomics auth login" and have the user approve it.';

export function createNodeSession(options: NodeSessionOptions) {
  const { store, deviceClient } = options;
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let state = store.read();
  let project: ComicProject | null = null;
  /** The project as it was when loaded or last saved: what a merge starts from. */
  let base: ComicProject | null = null;
  /** The Drive version of project.json that `base` came from. */
  let version: string | null = null;
  let dirty = false;
  let pageIndex = state.pageIndex ?? 0;

  function setState(change: (s: typeof state) => typeof state): void {
    state = store.update(change);
  }

  // ---- access token ---------------------------------------------------------------

  const validToken = (): string | null => {
    const { accessToken, accessTokenExpiresAt = 0 } = state.auth ?? {};
    return accessToken && accessTokenExpiresAt > now() + TOKEN_EXPIRY_MARGIN_MS
      ? accessToken
      : null;
  };

  const drive = createDriveRest({ getToken: validToken, fetch: fetchImpl });
  const driveConnected = (): boolean => Boolean(validToken() || state.auth?.refreshToken);

  /** One connection's REST calls: Drive, or a server built fresh from its remembered URL. */
  function repoFor(connectionId: string) {
    if (connectionId === DRIVE_CONNECTION_ID) return drive;
    if (connectionId.startsWith('server:')) {
      const url = connectionId.slice('server:'.length);
      return createServerRest({ getBaseUrl: () => url, fetch: fetchImpl });
    }
    throw new Error(`Unknown storage connection "${connectionId}".`);
  }

  /** The connection the open project (if any) came from; absent means an older state file, i.e. Drive. */
  const projectConnectionId = (): string => state.project?.connectionId ?? DRIVE_CONNECTION_ID;

  /** Every project folder across Drive (if logged in) and every connected server, tagged with where it came from. */
  async function listAllProjectFolders(): Promise<ProjectFolder[]> {
    if (!driveConnected() && (state.servers?.length ?? 0) === 0) {
      throw new Error(
        'Not connected to any storage. Run "vibecomics auth login" for Google Drive, or ' +
          '"vibecomics storage connectWithServer <url>" for a self-hosted server.'
      );
    }
    const found: ProjectFolder[] = [];
    if (driveConnected()) {
      try {
        const folders = await drive.listProjectFolders();
        found.push(
          ...folders.map((f) => ({
            ...f,
            connectionId: DRIVE_CONNECTION_ID,
            connectionLabel: 'Google Drive',
          }))
        );
      } catch {
        // Drive is logged in but unreachable right now: skip it like a dead server rather than failing the list.
      }
    }
    for (const url of state.servers ?? []) {
      try {
        const folders = await repoFor(serverConnectionId(url)).listProjectFolders();
        found.push(
          ...folders.map((f) => ({
            ...f,
            connectionId: serverConnectionId(url),
            connectionLabel: url,
          }))
        );
      } catch {
        // Remembered but not reachable right now.
      }
    }
    // A project of the same name in more than one connection: the server's copy wins (matches the app).
    const byName = new Map<string, ProjectFolder>();
    for (const f of found) {
      const existing = byName.get(f.name);
      if (!existing || existing.connectionId === DRIVE_CONNECTION_ID) byName.set(f.name, f);
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Make sure there is a fresh access token if the user is logged in at all. */
  async function ensureAccess(): Promise<boolean> {
    if (validToken()) return true;
    const refreshToken = state.auth?.refreshToken;
    if (!refreshToken || !deviceClient) return false;
    try {
      const { accessToken, expiresIn } = await refreshAccessToken(
        deviceClient,
        refreshToken,
        fetchImpl
      );
      setState((s) => ({
        ...s,
        auth: {
          ...s.auth,
          accessToken,
          accessTokenExpiresAt: now() + expiresIn * 1000,
        },
      }));
      return true;
    } catch (e) {
      throw new Error(`${errorMessage(e)} ${LOGIN_HINT}`);
    }
  }

  // ---- login ----------------------------------------------------------------------

  const report = (extra: Partial<AuthReport> = {}): AuthReport => ({
    connected: Boolean(validToken()),
    configured: deviceClient !== null,
    project: state.project?.name ?? null,
    ...extra,
  });

  function requireDeviceClient(): DeviceClient {
    if (!deviceClient) {
      throw new Error(
        'This build of the CLI has no Google device OAuth client (GOOGLE_DEVICE_CLIENT_ID / ' +
          'GOOGLE_DEVICE_CLIENT_SECRET were not set when it was built), so it cannot log in.'
      );
    }
    return deviceClient;
  }

  /** Start a device login: the user opens the URL, enters the code and approves. */
  async function startLogin(): Promise<DeviceCodeInfo> {
    const client = requireDeviceClient();
    const grant = await startDeviceFlow(client.clientId, fetchImpl);
    setState((s) => ({
      ...s,
      auth: {
        ...s.auth,
        pending: {
          deviceCode: grant.deviceCode,
          intervalSeconds: grant.intervalSeconds,
          expiresAt: now() + grant.info.expiresInSeconds * 1000,
          info: grant.info,
        },
      },
    }));
    return grant.info;
  }

  /** Ask Google once whether the pending login was approved, and finish it if so. */
  async function checkPendingLogin(): Promise<AuthReport | null> {
    const pending = state.auth?.pending;
    if (!pending) return null;
    const clearPending = () => setState((s) => ({ ...s, auth: { ...s.auth, pending: undefined } }));

    if (pending.expiresAt <= now()) {
      clearPending();
      return report({
        error: 'The login code expired before it was approved. Run "vibecomics auth login" again.',
      });
    }
    const result = await pollDeviceOnce(requireDeviceClient(), pending.deviceCode, fetchImpl);
    if (result.status === 'granted') {
      setState((s) => ({
        ...s,
        auth: {
          refreshToken: result.refreshToken ?? s.auth?.refreshToken,
          accessToken: result.accessToken,
          accessTokenExpiresAt: now() + result.expiresIn * 1000,
        },
      }));
      return report({
        next: 'Logged in. Run "vibecomics storage listProjects" to see your projects.',
      });
    }
    if (result.status === 'failed') {
      clearPending();
      return report({ error: result.message });
    }
    return report({
      pending: { ...pending.info, secondsLeft: Math.round((pending.expiresAt - now()) / 1000) },
      next: 'Not approved yet. Once the user has entered the code, run "vibecomics auth status" again.',
    });
  }

  const auth = {
    /** Start a login; with `wait`, keep asking Google until the user approves or the code expires. */
    async login(wait: boolean): Promise<AuthReport> {
      const info = await startLogin();
      if (!wait) {
        return report({
          pending: { ...info, secondsLeft: info.expiresInSeconds },
          next:
            `Ask the user to open ${info.url} and enter the code ${info.code}, then run ` +
            '"vibecomics auth status" to finish logging in.',
        });
      }
      const pending = state.auth!.pending!;
      for (;;) {
        await sleep(pending.intervalSeconds * 1000);
        const result = await checkPendingLogin();
        if (!result?.pending) return result ?? report();
      }
    },

    /** Finish a pending login if the user has approved it, and report the connection. */
    async status(): Promise<AuthReport> {
      const finished = await checkPendingLogin();
      if (finished) return finished;
      try {
        const connected = await ensureAccess();
        return report({ connected, ...(!connected && { next: LOGIN_HINT }) });
      } catch (e) {
        // Google refused the saved login (revoked, expired): say so rather than fail.
        return report({ connected: false, error: errorMessage(e), next: LOGIN_HINT });
      }
    },

    /**
     * Revoke the Drive login at Google and forget it on this machine. Leaves any connected
     * servers and the open project alone unless that project came from Drive, in which case it
     * is dropped too (unsaved changes are lost, same as the browser disconnecting Drive).
     */
    async logout(): Promise<AuthReport> {
      const { refreshToken, accessToken } = state.auth ?? {};
      const token = refreshToken ?? accessToken;
      if (token) await revokeToken(token, fetchImpl);
      const wasDriveProject =
        Boolean(state.project) && projectConnectionId() === DRIVE_CONNECTION_ID;
      if (wasDriveProject) {
        dirty = false;
        project = null;
        base = null;
      }
      setState((s) => ({
        ...s,
        auth: undefined,
        ...(wasDriveProject ? { project: undefined, pageIndex: undefined } : {}),
      }));
      return report({
        connected: false,
        project: wasDriveProject ? null : (state.project?.name ?? null),
      });
    },
  };

  // ---- project --------------------------------------------------------------------

  const folderId = (): string | null => state.project?.id ?? null;

  function showProject(
    opened: ComicProject,
    folder: ProjectFolder,
    openedVersion: string | null,
    connectionId: string
  ): void {
    project = opened;
    base = structuredClone(opened);
    version = openedVersion;
    dirty = false;
    pageIndex = 0;
    setState((s) => ({
      ...s,
      project: { id: folder.id, name: folder.name, connectionId },
      pageIndex: 0,
    }));
  }

  function dropProject(): void {
    project = null;
    base = null;
    dirty = false;
    pageIndex = 0;
    setState((s) => ({ ...s, project: undefined, pageIndex: undefined }));
  }

  /**
   * Write the project to its storage connection if the command changed it. If somebody else saved
   * since it was loaded, their changes are merged into ours first; if the two clash, nothing is
   * written.
   */
  async function save(): Promise<void> {
    const id = folderId();
    if (!project || !base || !id || !dirty) return;
    const repo = repoFor(projectConnectionId());
    for (let attempt = 0; ; attempt++) {
      const savedAt = new Date(now()).toISOString();
      try {
        version = await repo.saveProjectJson(
          id,
          { ...project, savedAt, updatedAt: savedAt },
          version
        );
        project = { ...project, savedAt };
        base = structuredClone(project);
        dirty = false;
        return;
      } catch (e) {
        if (!(e instanceof ProjectChangedError) || attempt >= 3) throw e;
        const file = await repo.loadProjectFile(id);
        const theirs = parseProject(file.json);
        const { merged, conflicts } = mergeProjects(base, project, theirs);
        if (conflicts.length > 0) throw new ConflictError(conflicts);
        // Their changes are now part of ours: write the merged project on top of their version.
        project = merged;
        base = theirs;
        version = file.version;
      }
    }
  }

  /** Load the open project from its storage connection, if there is one. */
  async function loadOpenProject(): Promise<void> {
    const id = folderId();
    if (!id || project) return;
    const file = await repoFor(projectConnectionId()).loadProjectFile(id);
    project = parseProject(file.json);
    base = structuredClone(project);
    version = file.version;
  }

  const media = createMediaDeps({
    getProject: () => project,
    getFolderId: folderId,
    updateProject: (mutation) => deps.updateProject(mutation),
    // Resolved per call rather than once, since the open project's connection can change between runs.
    storage: {
      uploadImage: (fid, file, name) => repoFor(projectConnectionId()).uploadImage(fid, file, name),
      trashFile: (fid, fileName) => repoFor(projectConnectionId()).trashFile(fid, fileName),
      downloadFile: (fid, fileName) => repoFor(projectConnectionId()).downloadFile(fid, fileName),
      findFileByName: (fid, name) => repoFor(projectConnectionId()).findFileByName(fid, name),
    },
  });

  const deps: ComicBuilderDeps = {
    getProject: () => project,

    updateProject: (mutation) => {
      if (!project) throw new Error('No project is open.');
      const next = structuredClone(project);
      mutation(next);
      next.updatedAt = new Date(now()).toISOString();
      project = next;
      dirty = true;
    },

    replaceProject: (replacement) => {
      project = replacement;
      pageIndex = 0;
      dirty = true;
    },

    getPageIndex: () => pageIndex,
    setPageIndex: (i) => {
      pageIndex = i;
    },
    setPreview: (open) => {
      if (open) {
        throw new Error(
          'There is no preview in the CLI (it has no screen). To look at an image, use "media download".'
        );
      }
    },
    setStatus: () => undefined,

    connectStorageWithDevice: startLogin,
    connectStorageWithServer: async (url) => {
      const normalized = normalizeServerUrl(url);
      await checkServerHealth(normalized, fetchImpl);
      setState((s) => ({
        ...s,
        servers: (s.servers ?? []).includes(normalized)
          ? s.servers
          : [...(s.servers ?? []), normalized],
      }));
    },
    disconnectStorage: async () => {
      await save();
      const { refreshToken, accessToken } = state.auth ?? {};
      const token = refreshToken ?? accessToken;
      if (token) await revokeToken(token, fetchImpl).catch(() => undefined);
      project = null;
      base = null;
      dirty = false;
      setState(() => ({}));
    },
    getStorageStatus: () => ({
      connected: driveConnected() || (state.servers?.length ?? 0) > 0,
      configured: deviceClient !== null,
    }),
    listStorageConnections: async (): Promise<StorageConnectionInfo[]> => {
      const result: StorageConnectionInfo[] = [
        {
          id: DRIVE_CONNECTION_ID,
          kind: 'drive',
          label: 'Google Drive',
          connected: driveConnected(),
        },
      ];
      for (const url of state.servers ?? []) {
        let connected = true;
        try {
          await checkServerHealth(url, fetchImpl);
        } catch {
          connected = false;
        }
        result.push({ id: serverConnectionId(url), kind: 'server', label: url, connected });
      }
      return result;
    },
    disconnectStorageConnection: async (id) => {
      if (state.project && projectConnectionId() === id) {
        await save();
        dropProject();
      }
      if (id === DRIVE_CONNECTION_ID) {
        await auth.logout();
      } else if (id.startsWith('server:')) {
        const url = id.slice('server:'.length);
        setState((s) => ({ ...s, servers: (s.servers ?? []).filter((u) => u !== url) }));
      }
    },

    listStorageProjects: () => listAllProjectFolders(),

    getGeneratorConfig: () => state.generator ?? null,
    setGeneratorConfig: (config) => setState((s) => ({ ...s, generator: config ?? undefined })),
    generatorFetch: fetchImpl,

    createStorageProject: async (name, pageSize, connectionId) => {
      const resolved =
        connectionId ??
        (() => {
          const live = [
            ...(driveConnected() ? [DRIVE_CONNECTION_ID] : []),
            ...(state.servers ?? []).map(serverConnectionId),
          ];
          if (live.length === 1) return live[0];
          if (live.length === 0) {
            throw new Error(
              `No storage connection is live. ${LOGIN_HINT} or run "storage connectWithServer <url>".`
            );
          }
          throw new Error(
            `More than one storage connection is live (${live.join(', ')}); pass --connectionId.`
          );
        })();
      const repo = repoFor(resolved);
      const created = await createOrOpenProject(repo, name, pageSize);
      showProject(created.project, created.folder, created.version, resolved);
      return created.folder;
    },

    openStorageProject: async (folder) => {
      const connectionId = folder.connectionId ?? DRIVE_CONNECTION_ID;
      try {
        const file = await repoFor(connectionId).loadProjectFile(folder.id);
        showProject(parseProject(file.json), folder, file.version, connectionId);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: `Could not open "${folder.name}": ${errorMessage(e)}` };
      }
    },

    closeStorageProject: async () => {
      await save();
      dropProject();
    },

    showProjectTiles: () => listAllProjectFolders(),

    flushStorageSave: async () => {
      if (!project) return { ok: false, error: 'No project is open.' };
      try {
        await save();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: `Save failed: ${errorMessage(e)}` };
      }
    },

    ...media,
  };

  return {
    deps,
    auth,
    /** Before a command: refresh the login and, when asked, load the open project. */
    async prepare(loadProject: boolean): Promise<void> {
      await ensureAccess();
      if (loadProject) await loadOpenProject();
    },
    /** After a successful command: write back changes and remember the current page. */
    async finish(): Promise<void> {
      await save();
      if (project && state.pageIndex !== pageIndex) setState((s) => ({ ...s, pageIndex }));
    },
  };
}
