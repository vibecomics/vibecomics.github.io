import { cb } from '../ai/actions';
import type { MediaItem } from '../types/comic';
import { displayName } from '../utils/fileName';
import { readFileAsDataUrl } from '../utils/files';
import { loadBlobUrl } from './mediaImages';

/** Width / height of a media item's image. */
async function imageAspect(item: MediaItem): Promise<number> {
  const image = new Image();
  image.src = await loadBlobUrl(item);
  await image.decode();
  return Math.round((image.naturalWidth / image.naturalHeight) * 1000) / 1000;
}

/** Upload an image file to the project's media, tagged as art of a subject or scene when given. */
export async function uploadImage(
  file: File,
  links: { subjectId?: string; sceneId?: string } = {}
): Promise<MediaItem> {
  return cb().media.upload(displayName(file.name), await readFileAsDataUrl(file), {
    mimeType: file.type,
    ...links,
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
