/**
 * Which connection backs the currently *open* project, and the storage calls that dispatch to it.
 * App.tsx and the pieces that read or write project data (useProjectSaver, mediaImages) go through
 * here instead of importing a backend directly, so they work the same regardless of which
 * connection the open project came from.
 *
 * The connections themselves (Google Drive, any number of HTTP storage servers) are owned by
 * storage/connections.ts; this module just tracks which one's id is "active" right now and
 * resolves it to a backend on every call, so a project selector refresh in the background never
 * disturbs whichever connection is serving the open project.
 */
import { getConnection } from './connections';
import type { ProjectFile, ProjectFolder, StoredFile } from './types';
import type { StorageBackendImpl } from './backend';

let active: string | null = null;
/** The open project's folder id, so code with no access to it (mediaImages.ts) can still resolve a file by name. */
let currentFolderId: string | null = null;

export function getActiveBackend(): string | null {
  return active;
}

export function setActiveBackend(connectionId: string | null): void {
  active = connectionId;
}

export function getCurrentFolderId(): string | null {
  return currentFolderId;
}

export function setCurrentFolderId(folderId: string | null): void {
  currentFolderId = folderId;
}

function current(): StorageBackendImpl {
  const connection = active ? getConnection(active) : undefined;
  if (!connection) throw new Error('No storage backend is connected.');
  return connection.backend;
}

/** True when the connection backing the open project still has a live connection. */
export function hasStorageAccess(): boolean {
  const connection = active ? getConnection(active) : undefined;
  return connection ? connection.backend.hasAccess() : false;
}

/** Which kind of storage backs the open project, for icon choices (a Drive project vs. a server one). */
export function getActiveBackendKind(): 'drive' | 'server' | null {
  const connection = active ? getConnection(active) : undefined;
  return connection ? connection.kind : null;
}

export const listProjectFolders = (): Promise<ProjectFolder[]> => current().listProjectFolders();

export const ensureProjectFolder = (name: string): Promise<ProjectFolder> =>
  current().ensureProjectFolder(name);

export const uploadImage = (folderId: string, file: File, name?: string): Promise<StoredFile> =>
  current().uploadImage(folderId, file, name);

export const trashFile = (folderId: string, fileName: string): Promise<void> =>
  current().trashFile(folderId, fileName);

export const downloadFile = (folderId: string, fileName: string): Promise<Blob> =>
  current().downloadFile(folderId, fileName);

export const findFileByName = (folderId: string, name: string): Promise<StoredFile | undefined> =>
  current().findFileByName(folderId, name);

export const saveProjectJson = (
  folderId: string,
  project: unknown,
  expectVersion?: string | null
): Promise<string | null> => current().saveProjectJson(folderId, project, expectVersion);

export const loadProjectFile = (folderId: string): Promise<ProjectFile> =>
  current().loadProjectFile(folderId);

/** A human label for status messages ("Saved to Google Drive.", "Refresh from http://localhost:8081"). */
export const backendLabel = (connectionId: string | null = active): string => {
  const connection = connectionId ? getConnection(connectionId) : undefined;
  return connection ? connection.backend.label : 'storage';
};
