/**
 * REST calls to a self-hosted HTTP storage server (http-storage/), the plain-HTTP alternative to
 * Google Drive: same shape as driveRest.ts (a project folder, project.json with optimistic-
 * concurrency versioning, media files inside it) so it slots into the same ComicBuilder deps. No
 * browser APIs: the base URL and `fetch` are injected.
 */
import { ProjectChangedError, ProjectFileMissingError } from '../drive/driveRest';
import type { DriveFileMeta, ProjectFile, ProjectFolder } from '../drive/driveRest';

export interface ServerRestOptions {
  /** The server's base URL (no trailing slash), or null when not connected. */
  getBaseUrl: () => string | null;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

export function createServerRest({ getBaseUrl, fetch: fetchImpl = fetch }: ServerRestOptions) {
  function requireBaseUrl(): string {
    const url = getBaseUrl();
    if (!url) throw new Error('Not connected to a storage server.');
    return url;
  }

  async function serverRequest(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetchImpl(`${requireBaseUrl()}${path}`, init);
    if (res.status === 412) {
      const body = await res.json().catch(() => ({}) as { currentVersion?: string | null });
      throw new ProjectChangedError(body.currentVersion ?? null);
    }
    if (res.status === 404 && path.endsWith('/project.json')) {
      throw new ProjectFileMissingError('No project.json found on this server yet.');
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Storage server error ${res.status}: ${body.slice(0, 200)}`);
    }
    return res;
  }

  return {
    /** Every project folder the server knows about. */
    async listProjectFolders(): Promise<ProjectFolder[]> {
      const res = await serverRequest('/projects');
      return (await res.json()) as ProjectFolder[];
    },

    /** Find (or create) the project folder that holds a comic's files. */
    async ensureProjectFolder(name: string): Promise<DriveFileMeta> {
      const res = await serverRequest('/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const folder = (await res.json()) as ProjectFolder;
      return { ...folder, mimeType: 'application/vnd.vibecomics.folder' };
    },

    async uploadImage(folderId: string, file: File, name?: string): Promise<DriveFileMeta> {
      const res = await serverRequest(`/projects/${encodeURIComponent(folderId)}/files`, {
        method: 'POST',
        headers: {
          'X-File-Name': encodeURIComponent(name || file.name),
          'Content-Type': file.type || 'application/octet-stream',
        },
        body: file,
      });
      return (await res.json()) as DriveFileMeta;
    },

    /** Move a file to its project's trash. A file that is already gone counts as trashed. */
    async trashFile(fileId: string): Promise<void> {
      try {
        await serverRequest(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
      } catch (e) {
        if (!(e instanceof Error && e.message.startsWith('Storage server error 404'))) throw e;
      }
    },

    async downloadFile(fileId: string): Promise<Blob> {
      const res = await serverRequest(`/files/${encodeURIComponent(fileId)}`);
      return await res.blob();
    },

    /**
     * Create or overwrite project.json in the project folder and return its new version. When
     * `expectVersion` is given, the write is refused with a ProjectChangedError if project.json has
     * changed since (the server checks this atomically, unlike Drive).
     */
    async saveProjectJson(
      folderId: string,
      project: unknown,
      expectVersion?: string | null
    ): Promise<string | null> {
      const res = await serverRequest(`/projects/${encodeURIComponent(folderId)}/project.json`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(expectVersion != null && { 'If-Match': expectVersion }),
        },
        body: JSON.stringify(project),
      });
      return ((await res.json()) as { version?: string }).version ?? null;
    },

    /** Read project.json from the project folder, with the version it has now. */
    async loadProjectFile(folderId: string): Promise<ProjectFile> {
      const res = await serverRequest(`/projects/${encodeURIComponent(folderId)}/project.json`);
      return (await res.json()) as ProjectFile;
    },
  };
}

export type ServerRest = ReturnType<typeof createServerRest>;
