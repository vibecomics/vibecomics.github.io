/**
 * Which project store is active this session, and the storage calls that dispatch to it. App.tsx and
 * the pieces that read or write project data (useProjectSaver, mediaImages) go through here instead
 * of importing a backend directly, so they work the same regardless of which one the user picked on
 * the splash screen.
 *
 * Adding a backend: implement `StorageBackendImpl` (backend.ts) in its own module - see
 * drive/driveClient.ts's `driveBackend` and server/serverClient.ts's `serverBackend` - add it to the
 * `REGISTRY` below and to the `StorageBackend` union, and give the splash screen a way to connect it.
 * Nothing else here changes.
 */
import { driveBackend } from '../drive/driveClient';
import { serverBackend } from '../server/serverClient';
import type { DriveFileMeta, ProjectFile, ProjectFolder } from '../drive/driveRest';
import type { StorageBackendImpl } from './backend';

export type StorageBackend = 'drive' | 'server';

const REGISTRY: Record<StorageBackend, StorageBackendImpl> = {
  drive: driveBackend,
  server: serverBackend,
};

let active: StorageBackend | null = null;
/** The open project's folder id, so code with no access to it (mediaImages.ts) can still resolve a file by name. */
let currentFolderId: string | null = null;

export function getActiveBackend(): StorageBackend | null {
  return active;
}

export function setActiveBackend(kind: StorageBackend | null): void {
  active = kind;
}

export function getCurrentFolderId(): string | null {
  return currentFolderId;
}

export function setCurrentFolderId(folderId: string | null): void {
  currentFolderId = folderId;
}

function current(): StorageBackendImpl {
  if (!active) throw new Error('No storage backend is connected.');
  return REGISTRY[active];
}

/** True when the currently active backend has a live connection. */
export function hasStorageAccess(): boolean {
  return active !== null && REGISTRY[active].hasAccess();
}

/** Disconnect whichever backend is active, and clear it. */
export async function disconnectActiveBackend(): Promise<void> {
  if (active) await REGISTRY[active].disconnect();
  active = null;
}

export const listProjectFolders = (): Promise<ProjectFolder[]> => current().listProjectFolders();

export const ensureProjectFolder = (name: string): Promise<DriveFileMeta> =>
  current().ensureProjectFolder(name);

export const uploadImage = (folderId: string, file: File, name?: string): Promise<DriveFileMeta> =>
  current().uploadImage(folderId, file, name);

export const trashFile = (folderId: string, fileName: string): Promise<void> =>
  current().trashFile(folderId, fileName);

export const downloadFile = (folderId: string, fileName: string): Promise<Blob> =>
  current().downloadFile(folderId, fileName);

export const findFileByName = (
  folderId: string,
  name: string
): Promise<DriveFileMeta | undefined> => current().findFileByName(folderId, name);

export const saveProjectJson = (
  folderId: string,
  project: unknown,
  expectVersion?: string | null
): Promise<string | null> => current().saveProjectJson(folderId, project, expectVersion);

export const loadProjectFile = (folderId: string): Promise<ProjectFile> =>
  current().loadProjectFile(folderId);

/** A human label for status messages ("Saved to Google Drive.", "Refresh from the storage server"). */
export const backendLabel = (kind: StorageBackend | null = active): string =>
  kind ? REGISTRY[kind].label : 'storage';
