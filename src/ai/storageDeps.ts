/**
 * The storage-backed parts of ComicBuilderDeps that do not depend on where the
 * project state lives: media upload, download and delete, and creating or
 * opening a project folder. The page (App.tsx) and the CLI both build their
 * deps from these, so the two behave the same. No browser APIs: the storage
 * calls and the optional thumbnail maker are injected.
 */
import { removeMedia } from '../state/media';
import type { MediaRemoval } from '../state/media';
import { assertValidProject, createBlankProject, normalizeProject } from '../state/project';
import type { StorageBackendImpl } from '../storage/backend';
import { ProjectFileMissingError } from '../storage/types';
import type { ProjectFolder, StoredFile } from '../storage/types';
import type { ComicProject, MediaItem, PageSize } from '../types/comic';
import { DEFAULT_PAGE_SIZE } from '../types/comic';
import { numberedFileName, thumbnailFileNameOf, toFileName } from '../utils/fileName';
import { dataUrlToFile, readFileAsDataUrl } from '../utils/files';
import { newId } from '../utils/id';
import { extensionForMimeType } from '../utils/thumbnail';
import type { ComicBuilderDeps } from './deps';

/** Validate and normalize a project.json read from storage. */
export function parseProject(raw: unknown): ComicProject {
  assertValidProject(raw);
  normalizeProject(raw);
  return raw;
}

export interface MediaHost {
  getProject(): ComicProject | null;
  getFolderId(): string | null;
  updateProject(mut: (p: ComicProject) => void): void;
  storage: Pick<
    StorageBackendImpl,
    'uploadImage' | 'trashFile' | 'downloadFile' | 'findFileByName'
  >;
  /** Makes a thumbnail when the caller gave none; null when it cannot (e.g. no canvas in Node). */
  makeThumbnail?(image: File, name: string): Promise<File | null>;
}

/**
 * Upload `file` under `rawName` reworded to the storage naming rule (lowercase, dashes), refusing
 * to reuse a name the project folder already has. The stored name is on the result.
 */
async function uploadNewFile(
  host: MediaHost,
  folderId: string,
  file: File,
  rawName: string
): Promise<StoredFile> {
  const name = toFileName(rawName, extensionForMimeType(file.type));
  if (await host.storage.findFileByName(folderId, name)) {
    throw new Error(`This project already has a file named "${name}". Rename one of them.`);
  }
  return host.storage.uploadImage(folderId, file, name);
}

/** The stored name for `label`, or that with -2, -3... when the project folder already has it. */
async function freeFileName(
  host: MediaHost,
  folderId: string,
  label: string,
  extension: string
): Promise<string> {
  const base = toFileName(label, extension);
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : numberedFileName(base, n);
    if (!(await host.storage.findFileByName(folderId, candidate))) return candidate;
  }
}

/** Put a thumbnail of `item` in the project folder under its stable name. */
async function storeThumbnail(
  host: MediaHost,
  folderId: string,
  thumbnailFileName: string,
  thumbnail: File
): Promise<StoredFile> {
  return uploadNewFile(host, folderId, thumbnail, thumbnailFileName);
}

export type MediaDeps = Pick<
  ComicBuilderDeps,
  'uploadStorageMedia' | 'uploadStorageThumbnail' | 'deleteStorageMedia' | 'downloadStorageMedia'
>;

export function createMediaDeps(host: MediaHost): MediaDeps {
  const findItem = (id: string): MediaItem => {
    const item = host.getProject()?.metadata.media.find((m) => m.id === id);
    if (!item) throw new Error(`Media "${id}" not found.`);
    return item;
  };
  const requireFolder = (): string => {
    const folderId = host.getFolderId();
    if (!folderId) throw new Error('No project folder is open.');
    return folderId;
  };

  return {
    downloadStorageMedia: async (id) => {
      const item = findItem(id);
      const dataUrl = await readFileAsDataUrl(
        await host.storage.downloadFile(requireFolder(), item.fileName)
      );
      return { name: item.name, mimeType: item.mimeType, dataUrl };
    },

    uploadStorageMedia: async (name, dataUrl, mimeType, thumbnailDataUrl, links) => {
      const folderId = requireFolder();
      const id = newId('media');
      const fileName = await freeFileName(host, folderId, name, extensionForMimeType(mimeType));
      const file = dataUrlToFile(dataUrl, fileName, mimeType);
      const given = thumbnailDataUrl
        ? dataUrlToFile(thumbnailDataUrl, name, 'image/png')
        : undefined;
      const uploaded = await host.storage.uploadImage(folderId, file, fileName);
      const item: MediaItem = {
        id,
        name,
        fileName: uploaded.name,
        mimeType: uploaded.mimeType || mimeType,
        ...(links?.subjectId && { subjectId: links.subjectId }),
        ...(links?.sceneId && { sceneId: links.sceneId }),
      };
      try {
        const thumbnail = given ?? (await host.makeThumbnail?.(file, name)) ?? undefined;
        if (thumbnail) {
          const thumbnailFileName = thumbnailFileNameOf(
            item.fileName,
            extensionForMimeType(thumbnail.type)
          );
          await storeThumbnail(host, folderId, thumbnailFileName, thumbnail);
          item.thumbnailFileName = thumbnailFileName;
        }
      } catch {
        // The image is safe; without a thumbnail the UI shows the full file (media.uploadThumbnail can add one).
      }
      host.updateProject((p) => {
        p.metadata.media.push(item);
      });
      return structuredClone(item);
    },

    uploadStorageThumbnail: async (id, dataUrl) => {
      const folderId = requireFolder();
      const item = findItem(id);
      const thumbnail = dataUrlToFile(dataUrl, item.name, 'image/png');
      const thumbnailFileName = thumbnailFileNameOf(
        item.fileName,
        extensionForMimeType(thumbnail.type)
      );
      const previous = item.thumbnailFileName;
      // The new thumbnail may take the old one's name, so that name must be free first.
      if (previous === thumbnailFileName) await host.storage.trashFile(folderId, previous);
      await storeThumbnail(host, folderId, thumbnailFileName, thumbnail);
      host.updateProject((p) => {
        const target = p.metadata.media.find((m) => m.id === id);
        if (target) target.thumbnailFileName = thumbnailFileName;
      });
      if (previous && previous !== thumbnailFileName) {
        await host.storage.trashFile(folderId, previous).catch(() => undefined);
      }
      return structuredClone(findItem(id));
    },

    deleteStorageMedia: async (id) => {
      const item = findItem(id);
      const folderId = requireFolder();
      // Trash first: if storage refuses, the project is left as it was.
      await host.storage.trashFile(folderId, item.fileName);
      if (item.thumbnailFileName) {
        await host.storage.trashFile(folderId, item.thumbnailFileName).catch(() => undefined);
      }
      let removal: MediaRemoval = { layers: 0, entries: 0 };
      host.updateProject((p) => {
        removal = removeMedia(p, id);
      });
      return removal;
    },
  };
}

/**
 * Find or create the Drive folder for a project and its project.json. A
 * folder that already has a project is opened as it is; only a folder with no
 * project.json gets a fresh one, and no other error ever overwrites anything.
 */
export async function createOrOpenProject(
  storage: Pick<StorageBackendImpl, 'ensureProjectFolder' | 'loadProjectFile' | 'saveProjectJson'>,
  name: string,
  pageSize?: PageSize
): Promise<{
  folder: ProjectFolder;
  project: ComicProject;
  /** The Drive version of project.json, to detect later changes by somebody else. */
  version: string | null;
  existed: boolean;
  title: string;
}> {
  const title = name.trim();
  if (!title) throw new Error('Project name is required.');
  const folder = await storage.ensureProjectFolder(title);

  let existing: { project: ComicProject; version: string | null } | null = null;
  try {
    const file = await storage.loadProjectFile(folder.id);
    existing = { project: parseProject(file.json), version: file.version };
  } catch (e) {
    if (!(e instanceof ProjectFileMissingError)) throw e;
  }
  const project = existing?.project ?? createBlankProject(title, pageSize ?? DEFAULT_PAGE_SIZE);
  const version = existing ? existing.version : await storage.saveProjectJson(folder.id, project);
  return {
    folder: { id: folder.id, name: folder.name },
    project,
    version,
    existed: existing !== null,
    title,
  };
}
