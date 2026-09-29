import type { DriveFileMeta, ProjectFile, ProjectFolder } from '../drive/driveRest';

/**
 * The storage operations any project store must implement: Google Drive, a self-hosted HTTP server
 * (http-storage/), or a future one. `activeBackend.ts` holds one of these per connected session and
 * dispatches every call through it, so adding a backend never touches the dispatch code - implement
 * this shape, add it to the registry there, and give the splash screen a way to connect it.
 */
export interface StorageBackendImpl {
  /** Shown in status messages ("Saved to X.", "Refresh from X"). */
  label: string;
  listProjectFolders(): Promise<ProjectFolder[]>;
  ensureProjectFolder(name: string): Promise<DriveFileMeta>;
  uploadImage(folderId: string, file: File, name?: string): Promise<DriveFileMeta>;
  /** Files are addressed by project folder and name; a name is unique within a folder. */
  trashFile(folderId: string, fileName: string): Promise<void>;
  downloadFile(folderId: string, fileName: string): Promise<Blob>;
  /** The file named `name` directly inside the project folder, or undefined when there is none. */
  findFileByName(folderId: string, name: string): Promise<DriveFileMeta | undefined>;
  saveProjectJson(
    folderId: string,
    project: unknown,
    expectVersion?: string | null
  ): Promise<string | null>;
  loadProjectFile(folderId: string): Promise<ProjectFile>;
  /** True while this backend has a live connection. */
  hasAccess(): boolean;
  /** Drop the connection (revoking it, if the backend has something to revoke). */
  disconnect(): Promise<void> | void;
}
