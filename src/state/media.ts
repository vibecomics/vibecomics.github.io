import type { ComicProject } from '../types/comic';

/** What removing an image from the project touched. */
export interface MediaRemoval {
  /** Layers that lost their image (they stay, as prompt-only layers). */
  layers: number;
  /** Characters, scenes and objects that lost a reference image. */
  entries: number;
}

/**
 * Take a media item out of the registry and out of everything that uses it: layers showing it
 * are left without an image, and story-bible entries drop it from their reference images.
 * Throws when the id is not registered.
 */
export function removeMedia(project: ComicProject, id: string): MediaRemoval {
  const { metadata } = project;
  const item = metadata.media.find((m) => m.id === id);
  if (!item) throw new Error(`Media "${id}" not found.`);
  metadata.media = metadata.media.filter((m) => m !== item);

  const removal: MediaRemoval = { layers: 0, entries: 0 };
  for (const entry of [...metadata.characters, ...metadata.scenes, ...metadata.objects]) {
    if (!entry.imageIds.includes(id)) continue;
    entry.imageIds = entry.imageIds.filter((imageId) => imageId !== id);
    removal.entries++;
  }
  for (const page of project.pages) {
    for (const panel of page.panels) {
      for (const layer of panel.layers) {
        if (layer.mediaHistory?.includes(id)) {
          layer.mediaHistory = layer.mediaHistory.filter((h) => h !== id);
          if (layer.mediaHistory.length === 0) delete layer.mediaHistory;
        }
        if (layer.mediaId !== id) continue;
        delete layer.mediaId;
        removal.layers++;
      }
    }
  }
  return removal;
}
