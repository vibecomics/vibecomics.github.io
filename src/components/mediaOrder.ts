import type { ComicProject, MediaItem } from '../types/comic';
import { mediaKey } from '../utils/mediaKey';
import type { MediaInfo } from './mediaImages';

/** The character or object a layer shows, or the scene a background is set in, and what the project says about its images. */
export interface Subject {
  id: string;
  /** Which tag on an image says it is art of this subject: `subjectId` for a character or object, `sceneId` for a scene. */
  tag: 'subjectId' | 'sceneId';
  name: string;
  /** Ids of the subject's reference images. */
  referenceIds: ReadonlySet<string>;
  /** Ids of the images some layer uses. */
  placedIds: ReadonlySet<string>;
}

/** What the picker is choosing an image for: decides which images are listed first. */
export type MediaShapePreference =
  /** A panel background: opaque images, best those with the panel's aspect ratio (width / height). */
  | { kind: 'background'; aspectRatio?: number }
  /** A layer: transparent images (cut-outs) first. */
  | { kind: 'layer' };

export type MediaPreference = MediaShapePreference & {
  /** What the layer shows: the subject's art is listed before everything else. */
  subject?: Subject;
};

/** Ids of the images that some layer of the project uses. */
export function placedMediaIds(project: ComicProject): Set<string> {
  const placed = new Set<string>();
  for (const page of project.pages) {
    for (const panel of page.panels) {
      for (const layer of panel.layers) {
        if (layer.mediaId) placed.add(layer.mediaId);
      }
    }
  }
  return placed;
}

/** How many places each image is used in: layers showing it, plus story-bible entries listing it
 * as a reference image. Images used nowhere are absent. */
export function mediaUseCounts(project: ComicProject): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (id: string | undefined) => id && counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const page of project.pages) {
    for (const panel of page.panels) panel.layers.forEach((layer) => add(layer.mediaId));
  }
  const { characters, objects, scenes } = project.metadata;
  for (const entry of [...characters, ...objects, ...scenes]) entry.imageIds.forEach(add);
  return counts;
}

/** The character, object or scene with this id, or undefined when there is none (it may have been deleted). */
export function subjectOf(project: ComicProject, id: string | undefined): Subject | undefined {
  if (!id) return undefined;
  const { characters, objects, scenes } = project.metadata;
  const isScene = scenes.some((scene) => scene.id === id);
  const entry = [...characters, ...objects, ...scenes].find((candidate) => candidate.id === id);
  if (!entry) return undefined;
  return {
    id,
    tag: isScene ? 'sceneId' : 'subjectId',
    name: entry.name,
    referenceIds: new Set(entry.imageIds),
    placedIds: placedMediaIds(project),
  };
}

export interface MediaGroup {
  title: string;
  items: MediaItem[];
}

/** How far an image's ratio may differ from the panel's (relative) and still count as fitting. */
const RATIO_TOLERANCE = 0.05;

function fits(info: MediaInfo, aspectRatio?: number): boolean {
  return !!aspectRatio && Math.abs(info.aspect - aspectRatio) / aspectRatio <= RATIO_TOLERANCE;
}

/**
 * Splits the project's media into titled groups, best suggestions first; empty groups are left out.
 * With a subject, its art comes first (not yet used on a layer, then used), then everything else
 * sorted by shape, then the subject's reference images last. `infos` is null while the shapes are
 * not known yet: the rest is then one group.
 */
export function groupMedia(
  media: MediaItem[],
  infos: Map<string, MediaInfo | undefined> | null,
  prefer: MediaPreference
): MediaGroup[] {
  const { subject } = prefer;
  const subjectGroups: MediaGroup[] = subject
    ? [
        { title: `Art of ${subject.name}, not used yet`, items: [] },
        { title: `Art of ${subject.name}, in use`, items: [] },
      ]
    : [];
  const referenceGroup: MediaGroup = {
    title: `Reference images of ${subject?.name ?? ''}`,
    items: [],
  };
  const shapeGroups: MediaGroup[] = !infos
    ? [{ title: subject ? 'Other images' : 'Images', items: [] }]
    : prefer.kind === 'background'
      ? [
          { title: 'Fits this panel', items: [] },
          { title: 'Other backgrounds', items: [] },
          { title: 'Other images', items: [] },
        ]
      : [
          { title: 'Transparent images', items: [] },
          { title: 'Other images', items: [] },
        ];

  for (const item of media) {
    if (subject && item[subject.tag] === subject.id) {
      subjectGroups[subject.placedIds.has(item.id) ? 1 : 0].items.push(item);
    } else if (subject?.referenceIds.has(item.id)) {
      referenceGroup.items.push(item);
    } else if (!infos) {
      shapeGroups[0].items.push(item);
    } else {
      const info = infos.get(mediaKey(item));
      let rank: number;
      if (prefer.kind === 'background') {
        rank = !info || info.transparent ? 2 : fits(info, prefer.aspectRatio) ? 0 : 1;
      } else {
        rank = info?.transparent ? 0 : 1;
      }
      shapeGroups[rank].items.push(item);
    }
  }
  return [...subjectGroups, ...shapeGroups, referenceGroup].filter(
    (group) => group.items.length > 0
  );
}

/** Lower case, without accents, single spaces: what searching compares. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const DEFAULT_LAYER_NAMES = new Set(['layer', 'background']);

/**
 * What a search for images looks in: the image's own name, the characters, objects and scenes it is
 * reference art or art of, and the layers that use it (unless the layer still has its default name).
 */
export function searchTextByMedia(project: ComicProject): Map<string, string> {
  const text = new Map<string, string[]>(
    project.metadata.media.map((item) => [item.id, [item.name]])
  );
  const add = (id: string | undefined, name: string) => id && text.get(id)?.push(name);
  const { characters, objects, scenes } = project.metadata;
  const entries = [...characters, ...objects, ...scenes];
  for (const entry of entries) {
    for (const id of entry.imageIds) add(id, entry.name);
  }
  for (const item of project.metadata.media) {
    for (const id of [item.subjectId, item.sceneId]) {
      const owner = entries.find((entry) => entry.id === id);
      if (owner) add(item.id, owner.name);
    }
  }
  for (const page of project.pages) {
    for (const panel of page.panels) {
      for (const layer of panel.layers) {
        if (DEFAULT_LAYER_NAMES.has(normalizeText(layer.name))) continue;
        add(layer.mediaId, layer.name);
      }
    }
  }
  return new Map([...text].map(([id, names]) => [id, normalizeText(names.join(' '))]));
}

/** The images whose search text holds every word of the query; all of them for an empty query. */
export function searchMedia(
  media: MediaItem[],
  searchText: Map<string, string>,
  query: string
): MediaItem[] {
  const words = normalizeText(query).split(' ').filter(Boolean);
  if (words.length === 0) return media;
  return media.filter((item) => {
    const text = searchText.get(item.id) ?? normalizeText(item.name);
    return words.every((word) => text.includes(word));
  });
}

/** Images the picker shows at first, and how many more each scroll to the bottom adds. */
export const MEDIA_BATCH_SIZE = 24;

/** The first `count` images of the grouped list, in order; groups left with none are dropped. */
export function firstOfGroups(groups: MediaGroup[], count: number): MediaGroup[] {
  const shown: MediaGroup[] = [];
  let left = count;
  for (const group of groups) {
    if (left <= 0) break;
    shown.push({ title: group.title, items: group.items.slice(0, left) });
    left -= group.items.length;
  }
  return shown;
}

/**
 * How many images to show at first: a whole number of batches, enough to include the item, so an
 * image in use is on screen when the picker opens. A missing item counts as the first.
 */
export function initialCount(
  groups: MediaGroup[],
  id: string | undefined,
  batch = MEDIA_BATCH_SIZE
): number {
  const index = groups.flatMap((group) => group.items).findIndex((item) => item.id === id);
  return (Math.floor(Math.max(index, 0) / batch) + 1) * batch;
}
