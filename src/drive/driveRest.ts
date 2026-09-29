/**
 * The Google Drive REST calls the app makes, with no browser APIs: the access
 * token and `fetch` are injected, so the same code runs in the page (with the
 * token from driveClient.ts) and in Node (the CLI). Scope is `drive.file`, so
 * only files and folders this app created are visible.
 */

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const PROJECT_FILE_NAME = 'project.json';

/** Thrown when a Drive folder has no project.json yet. */
export class ProjectFileMissingError extends Error {}

export interface ProjectFolder {
  id: string;
  name: string;
}

export interface DriveFileMeta extends ProjectFolder {
  mimeType: string;
  /** Drive's counter for the file: it goes up on every change, so it tells whether a file changed. */
  version?: string;
}

/**
 * Thrown when project.json on Drive is no longer the version that was loaded, i.e. somebody else
 * (another browser, the CLI) saved since. Nothing was written.
 */
export class ProjectChangedError extends Error {
  constructor(readonly currentVersion: string | null) {
    super('The project was changed on Google Drive since it was loaded.');
  }
}

/** A project.json as read from Drive, with the Drive version it had. */
export interface ProjectFile {
  json: unknown;
  version: string | null;
}

export interface DriveRestOptions {
  /** The current access token, or null when there is none (or it is about to expire). */
  getToken: () => string | null;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

export function createDriveRest({ getToken, fetch: fetchImpl = fetch }: DriveRestOptions) {
  async function driveRequest(url: string, init: RequestInit = {}): Promise<Response> {
    const accessToken = getToken();
    if (!accessToken) throw new Error('Not connected to Google Drive.');
    const res = await fetchImpl(url, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}`, ...init.headers },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Drive API error ${res.status}: ${body.slice(0, 200)}`);
    }
    return res;
  }

  async function queryFiles<T>(query: string, fields: string, params = ''): Promise<T[]> {
    const res = await driveRequest(
      `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(${fields})${params}`
    );
    return ((await res.json()).files ?? []) as T[];
  }

  async function createFile(
    metadata: object,
    content: Blob | string,
    contentType: string
  ): Promise<DriveFileMeta> {
    const boundary = `cb-${Date.now()}`;
    const body = new Blob(
      [
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
        JSON.stringify(metadata),
        `\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
        content,
        `\r\n--${boundary}--`,
      ],
      { type: `multipart/related; boundary=${boundary}` }
    );
    const res = await driveRequest(
      `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,version`,
      { method: 'POST', body }
    );
    return (await res.json()) as DriveFileMeta;
  }

  async function findProjectFile(
    folderId: string
  ): Promise<{ id: string; version?: string } | undefined> {
    const [file] = await queryFiles<{ id: string; version?: string }>(
      `'${folderId}' in parents and name='${PROJECT_FILE_NAME}' and trashed=false`,
      'id,version',
      '&pageSize=1'
    );
    return file;
  }

  /** The file named `name` directly inside `folderId`, or undefined when there is none. */
  async function findFileByName(
    folderId: string,
    name: string
  ): Promise<DriveFileMeta | undefined> {
    const escaped = name.replace(/'/g, "\\'");
    const [found] = await queryFiles<DriveFileMeta>(
      `'${folderId}' in parents and name='${escaped}' and trashed=false`,
      'id,name,mimeType',
      '&pageSize=1'
    );
    return found;
  }

  return {
    /** Folders this app created (the `drive.file` scope hides everything else). */
    listProjectFolders(): Promise<ProjectFolder[]> {
      return queryFiles<ProjectFolder>(
        `mimeType='${FOLDER_MIME_TYPE}' and trashed=false`,
        'id,name',
        '&orderBy=name&pageSize=100'
      );
    },

    /** Find (or create) the folder that holds a comic's files. */
    async ensureProjectFolder(name: string): Promise<DriveFileMeta> {
      const escaped = name.replace(/'/g, "\\'");
      const [existing] = await queryFiles<DriveFileMeta>(
        `mimeType='${FOLDER_MIME_TYPE}' and name='${escaped}' and trashed=false`,
        'id,name,mimeType',
        '&pageSize=1'
      );
      if (existing) return existing;

      const res = await driveRequest(`${DRIVE_API}/files?fields=id,name,mimeType`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME_TYPE }),
      });
      return (await res.json()) as DriveFileMeta;
    },

    uploadImage(folderId: string, file: File, name?: string): Promise<DriveFileMeta> {
      return createFile(
        { name: name || file.name, parents: [folderId] },
        file,
        file.type || 'image/png'
      );
    },

    findFileByName,

    /** Move a file to the Drive trash (recoverable there). A file that is already gone counts as trashed. */
    async trashFile(folderId: string, fileName: string): Promise<void> {
      const found = await findFileByName(folderId, fileName);
      if (!found) return;
      try {
        await driveRequest(`${DRIVE_API}/files/${found.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trashed: true }),
        });
      } catch (e) {
        if (!(e instanceof Error && e.message.startsWith('Drive API error 404'))) throw e;
      }
    },

    async downloadFile(folderId: string, fileName: string): Promise<Blob> {
      const found = await findFileByName(folderId, fileName);
      if (!found) throw new Error(`No file named "${fileName}" in this project.`);
      const res = await driveRequest(`${DRIVE_API}/files/${found.id}?alt=media`);
      return await res.blob();
    },

    /**
     * Create or overwrite project.json in the project folder and return its new Drive version.
     * When `expectVersion` is given (the version this copy was loaded from), the write is refused
     * with a ProjectChangedError if the file has changed since. Drive cannot make the check and the
     * write one step, so a save landing in the few milliseconds between them can still slip through.
     */
    async saveProjectJson(
      folderId: string,
      project: unknown,
      expectVersion?: string | null
    ): Promise<string | null> {
      const json = JSON.stringify(project, null, 2);
      const existing = await findProjectFile(folderId);
      if (existing) {
        if (expectVersion && existing.version && existing.version !== expectVersion) {
          throw new ProjectChangedError(existing.version);
        }
        const res = await driveRequest(
          `${DRIVE_UPLOAD_API}/files/${existing.id}?uploadType=media&fields=id,version`,
          { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: json }
        );
        return ((await res.json()) as { version?: string }).version ?? null;
      }
      const created = await createFile(
        { name: PROJECT_FILE_NAME, parents: [folderId] },
        json,
        'application/json'
      );
      return created.version ?? null;
    },

    /** Read project.json from the project folder, with the Drive version it has now. */
    async loadProjectFile(folderId: string): Promise<ProjectFile> {
      const file = await findProjectFile(folderId);
      if (!file) throw new ProjectFileMissingError('No project.json found in this Drive folder.');
      const res = await driveRequest(`${DRIVE_API}/files/${file.id}?alt=media`);
      return { json: await res.json(), version: file.version ?? null };
    },
  };
}

export type DriveRest = ReturnType<typeof createDriveRest>;
