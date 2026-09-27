/**
 * The storage-backed parts of ComicBuilderDeps that do not depend on where the
 * project state lives: media upload, download and delete, and creating or
 * opening a project folder. The page (App.tsx) and the CLI both build their
 * deps from these, so the two behave the same. No browser APIs: the storage
 * calls and the optional thumbnail maker are injected.
 */
import type { DriveRest, ProjectFolder } from '../drive/driveRest';
import { ProjectFileMissingError } from '../drive/driveRest';
import { removeMedia } from '../state/media';
import type { MediaRemoval } from '../state/media';
import { assertValidProject, createBlankProject, normalizeProject } from '../state/project';
import type { ComicProject, MediaItem, PageSize } from '../types/comic';
import { DEFAULT_PAGE_SIZE } from '../types/comic';
import { dataUrlToFile, readFileAsDataUrl } from '../utils/files';
import { driveFileUrl } from '../utils/driveUrl';
import { newId } from '../utils/id';
import { thumbnailName } from '../utils/thumbnail';
import type { ComicBuilderDeps } from './deps';

/** Validate and normalize a project.json read from Drive. */
export function parseProject(raw: unknown): ComicProject {
  assertValidProject(raw);
  normalizeProject(raw);
  return raw;
}

export interface MediaHost {
  getProject(): ComicProject | null;
  getFolderId(): string | null;
  updateProject(mut: (p: ComicProject) => void): void;
  drive: Pick<DriveRest, 'uploadImage' | 'trashFile' | 'downloadFile'>;
  fileUrl?(fileId: string): string;
  /** Makes a thumbnail when the caller gave none; null when it cannot (e.g. no canvas in Node). */
  makeThumbnail?(image: File, name: string): Promise<File | null>;
}

/** Put a thumbnail of `item` in the project folder; returns its Drive file id. */
async function storeThumbnail(
  host: MediaHost,
  folderId: string,
  item: MediaItem,
  thumbnail: File
): Promise<string> {
  const name = thumbnailName(item.name, thumbnail.type);
  return (await host.drive.uploadImage(folderId, thumbnail, name)).id;
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
      const dataUrl = await readFileAsDataUrl(await host.drive.downloadFile(item.driveFileId));
      return { name: item.name, mimeType: item.mimeType, dataUrl };
    },

    uploadStorageMedia: async (name, dataUrl, mimeType, thumbnailDataUrl, links) => {
      const folderId = requireFolder();
      const file = dataUrlToFile(dataUrl, name, mimeType);
      const given = thumbnailDataUrl
        ? dataUrlToFile(thumbnailDataUrl, name, 'image/png')
        : undefined;
      const uploaded = await host.drive.uploadImage(folderId, file, name);
      const item: MediaItem = {
        id: newId('media'),
        name: uploaded.name,
        driveFileId: uploaded.id,
        url: (host.fileUrl ?? driveFileUrl)(uploaded.id),
        mimeType: uploaded.mimeType || mimeType,
        ...(links?.subjectId && { subjectId: links.subjectId }),
        ...(links?.sceneId && { sceneId: links.sceneId }),
      };
      try {
        const thumbnail = given ?? (await host.makeThumbnail?.(file, name)) ?? undefined;
        if (thumbnail) {
          item.thumbnailDriveFileId = await storeThumbnail(host, folderId, item, thumbnail);
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
      const previous = item.thumbnailDriveFileId;
      const thumbnailDriveFileId = await storeThumbnail(host, folderId, item, thumbnail);
      host.updateProject((p) => {
        const target = p.metadata.media.find((m) => m.id === id);
        if (target) target.thumbnailDriveFileId = thumbnailDriveFileId;
      });
      if (previous) await host.drive.trashFile(previous).catch(() => undefined);
      return structuredClone({ ...item, thumbnailDriveFileId });
    },

    deleteStorageMedia: async (id) => {
      const item = findItem(id);
      // Trash first: if Drive refuses, the project is left as it was.
      await host.drive.trashFile(item.driveFileId);
      if (item.thumbnailDriveFileId) {
        await host.drive.trashFile(item.thumbnailDriveFileId).catch(() => undefined);
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
  drive: Pick<DriveRest, 'ensureProjectFolder' | 'loadProjectFile' | 'saveProjectJson'>,
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
  const folder = await drive.ensureProjectFolder(title);

  let existing: { project: ComicProject; version: string | null } | null = null;
  try {
    const file = await drive.loadProjectFile(folder.id);
    existing = { project: parseProject(file.json), version: file.version };
  } catch (e) {
    if (!(e instanceof ProjectFileMissingError)) throw e;
  }
  const project = existing?.project ?? createBlankProject(title, pageSize ?? DEFAULT_PAGE_SIZE);
  const version = existing ? existing.version : await drive.saveProjectJson(folder.id, project);
  return {
    folder: { id: folder.id, name: folder.name },
    project,
    version,
    existed: existing !== null,
    title,
  };
}
