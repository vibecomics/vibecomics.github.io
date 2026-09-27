import { cb } from '../ai/actions';
import type { LayerKind, MediaItem } from '../types/comic';
import { readFileAsDataUrl } from '../utils/files';
import { loadBlobUrl } from './mediaImages';

/** Width / height of a media item's image. */
async function imageAspect(item: MediaItem): Promise<number> {
  const image = new Image();
  image.src = await loadBlobUrl(item.driveFileId);
  await image.decode();
  return Math.round((image.naturalWidth / image.naturalHeight) * 1000) / 1000;
}

/** Upload an image file to the project's media (on Drive), tagged as art of a subject or scene when given. */
export async function uploadImage(
  file: File,
  links: { subjectId?: string; sceneId?: string } = {}
): Promise<MediaItem> {
  return cb().media.upload(file.name, await readFileAsDataUrl(file), {
    mimeType: file.type,
    ...links,
  });
}

/** Add a media item to a panel as a new layer; a new foreground layer starts centred at half the panel's width. */
export async function addMediaLayer(
  panelId: string,
  item: MediaItem,
  kind: LayerKind
): Promise<void> {
  const aspectRatio = await imageAspect(item);
  cb().layers.add(panelId, {
    kind,
    mediaId: item.id,
    aspectRatio,
    ...(kind === 'foreground' && { x: 25, y: 25, width: 50 }),
  });
}

/** Put a media item's image on an existing layer. */
export async function setLayerMedia(
  panelId: string,
  layerId: string,
  item: MediaItem
): Promise<void> {
  cb().layers.update(panelId, layerId, { mediaId: item.id, aspectRatio: await imageAspect(item) });
}
