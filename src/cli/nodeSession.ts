/**
 * The CLI's counterpart of App.tsx: the ComicBuilderDeps for one command run in
 * Node. The project is loaded from Drive before the command (when one is open),
 * changed in memory by the API, and written back after it. The Google login and
 * the open project persist in the state file between runs. The Drive calls, the
 * media and project-folder logic are the same code the page uses (driveRest.ts,
 * storageDeps.ts).
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
import { ProjectChangedError, createDriveRest } from '../drive/driveRest';
import type { ProjectFolder } from '../drive/driveRest';
import { mergeProjects } from '../state/merge';
import type { Conflict } from '../state/merge';
import type { ComicProject } from '../types/comic';
import { errorMessage } from '../utils/errors';
import { StateStore } from './state';

const TOKEN_EXPIRY_MARGIN_MS = 60_000;

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
        `Nothing was saved: the project was changed on Google Drive since this command read it, and ${
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

    /** Revoke the login at Google and forget it, and the open project, on this machine. */
    async logout(): Promise<AuthReport> {
      const { refreshToken, accessToken } = state.auth ?? {};
      const token = refreshToken ?? accessToken;
      if (token) await revokeToken(token, fetchImpl);
      dirty = false;
      project = null;
      setState(() => ({}));
      return report({ connected: false, project: null });
    },
  };

  // ---- project --------------------------------------------------------------------

  const folderId = (): string | null => state.project?.id ?? null;

  function showProject(
    opened: ComicProject,
    folder: ProjectFolder,
    openedVersion: string | null
  ): void {
    project = opened;
    base = structuredClone(opened);
    version = openedVersion;
    dirty = false;
    pageIndex = 0;
    setState((s) => ({ ...s, project: { id: folder.id, name: folder.name }, pageIndex: 0 }));
  }

  function dropProject(): void {
    project = null;
    base = null;
    dirty = false;
    pageIndex = 0;
    setState((s) => ({ ...s, project: undefined, pageIndex: undefined }));
  }

  /**
   * Write the project to Drive if the command changed it. If somebody else saved since it was
   * loaded, their changes are merged into ours first; if the two clash, nothing is written.
   */
  async function save(): Promise<void> {
    const id = folderId();
    if (!project || !base || !id || !dirty) return;
    for (let attempt = 0; ; attempt++) {
      const savedAt = new Date(now()).toISOString();
      try {
        version = await drive.saveProjectJson(
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
        const file = await drive.loadProjectFile(id);
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

  /** Load the open project from Drive, if there is one. */
  async function loadOpenProject(): Promise<void> {
    const id = folderId();
    if (!id || project) return;
    const file = await drive.loadProjectFile(id);
    project = parseProject(file.json);
    base = structuredClone(project);
    version = file.version;
  }

  const media = createMediaDeps({
    getProject: () => project,
    getFolderId: folderId,
    updateProject: (mutation) => deps.updateProject(mutation),
    drive,
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
    connectStorageWithServer: () => {
      throw new Error(
        'The CLI does not support a storage server yet: it only works against Google Drive. Use ' +
          '"vibecomics auth login".'
      );
    },
    disconnectStorage: async () => {
      await save();
      await auth.logout();
    },
    getStorageStatus: () => ({
      connected: Boolean(validToken() || state.auth?.refreshToken),
      configured: deviceClient !== null,
    }),

    listStorageProjects: () => drive.listProjectFolders(),

    getGeneratorConfig: () => state.generator ?? null,
    setGeneratorConfig: (config) => setState((s) => ({ ...s, generator: config ?? undefined })),
    generatorFetch: fetchImpl,

    createStorageProject: async (name, pageSize) => {
      const created = await createOrOpenProject(drive, name, pageSize);
      showProject(created.project, created.folder, created.version);
      return created.folder;
    },

    openStorageProject: async (folder) => {
      try {
        const file = await drive.loadProjectFile(folder.id);
        showProject(parseProject(file.json), folder, file.version);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: `Could not open "${folder.name}": ${errorMessage(e)}` };
      }
    },

    closeStorageProject: async () => {
      await save();
      dropProject();
    },

    showProjectTiles: () => drive.listProjectFolders(),

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
