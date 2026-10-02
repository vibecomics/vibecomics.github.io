/**
 * What every storage backend (Google Drive, the HTTP storage server) shares: the shape of a project
 * folder, a stored image and a project.json read back, and the two errors a load or save can end in.
 */

export interface ProjectFolder {
  id: string;
  name: string;
  /** Which connection this was listed from, when it came from the aggregated multi-connection list. */
  connectionId?: string;
  /** That connection's label, for display (e.g. a tile's badge). */
  connectionLabel?: string;
}

/** An image file in a project folder. Files are addressed by name, which is unique in a folder. */
export interface StoredFile {
  name: string;
  mimeType: string;
  /** The backend's counter for the file: it goes up on every change. */
  version?: string;
}

/** A project.json as read from storage, with the version it had. */
export interface ProjectFile {
  json: unknown;
  version: string | null;
}

/** Thrown when a folder has no project.json yet. */
export class ProjectFileMissingError extends Error {}

/**
 * Thrown when project.json in storage is no longer the version that was loaded, i.e. somebody
 * else (another browser, the CLI) saved since. Nothing was written.
 */
export class ProjectChangedError extends Error {
  constructor(readonly currentVersion: string | null) {
    super('The project was changed in storage since it was loaded.');
  }
}
