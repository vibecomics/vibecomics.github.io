import {
  absorbPanel,
  artPixels,
  createPanel,
  cutAcross,
  moveEdge,
  rectOf,
  splitEvenly,
  splitRect,
} from '../state/layout';
import type { Axis, Edge, Rect } from '../state/layout';
import type {
  Bubble,
  Character,
  ComicObject,
  ComicPage,
  ComicProject,
  Layer,
  Panel,
  Scene,
  StoryEntry,
  Variation,
} from '../types/comic';
import { newId } from '../utils/id';
import type {
  ComicBuilderDeps,
  StoryEntryInput,
  StoryEntryPatch,
  VariationInput,
  VariationPatch,
} from './deps';

export const LAYER_KINDS = ['background', 'foreground'] as const;
export const BUBBLE_KINDS = ['speech', 'thought', 'shout', 'caption'] as const;
const AXES = ['horizontal', 'vertical'] as const;
const EDGES = ['top', 'bottom', 'left', 'right'] as const;
export const LAYER_MOVES = ['top', 'bottom', 'up', 'down'] as const;

const STORY_KINDS = {
  characters: { idPrefix: 'char', label: 'Character', linkField: 'sceneIds' },
  scenes: { idPrefix: 'scene', label: 'Scene', linkField: 'characterIds' },
  objects: { idPrefix: 'obj', label: 'Object', linkField: 'sceneIds' },
} as const;

interface StoryTypes {
  characters: Character;
  scenes: Scene;
  objects: ComicObject;
}

/** Which story-bible list an entry (or a layer's variationId) belongs to. */
export type StoryKind = keyof StoryTypes;

/** Seeded when a character is created (front/back/side is the one fixed set that always applies);
 * objects and scenes start with none — their variations (a locker's Open/Closed, a scene's Day/
 * Night) are whatever the user adds, so there is no sensible default to guess. */
function defaultVariations(kind: StoryKind): Variation[] {
  if (kind !== 'characters') return [];
  return [
    {
      id: newId('var'),
      name: 'Front view',
      prompt:
        'Front view, facing the camera directly, full body visible, in a relaxed neutral standing pose.',
      imageIds: [],
    },
    {
      id: newId('var'),
      name: 'Back view',
      prompt:
        'Back view, facing directly away from the camera, full body visible, showing only the back of the head and body. No face, eyes, or other front-facing features visible anywhere in the image.',
      imageIds: [],
    },
    {
      id: newId('var'),
      name: 'Side view',
      prompt:
        'Side view (profile), facing fully to the side, full body visible, showing only one side of the face and body in profile.',
      imageIds: [],
    },
  ];
}

function entriesOfKind(project: ComicProject, kind: StoryKind): StoryEntry[] {
  return project.metadata[kind] as unknown as StoryEntry[];
}

/** Whether a variation's stitched prompt (its entry's description, plus its own text) has anything
 * in it to act on — the same test updateLayer uses for a layer's own prompt, applied to a variation's
 * two-part one. Used both when one entry's description changes (storyApi.update) and when the whole
 * project's STYLE does (cascadeStyleDirty). */
function hasEffectivePrompt(description: string, variation: Variation): boolean {
  return Boolean((description || variation.prompt || '').trim());
}

function findEntry(project: ComicProject, kind: StoryKind, entryId: string): StoryEntry {
  const entry = entriesOfKind(project, kind).find((e) => e.id === entryId);
  if (!entry) throw new Error(`"${entryId}" not found in ${kind}.`);
  return entry;
}

/** A layer's variationId must belong to the variations of its linked subject (foreground) or scene
 * (background). */
export function assertVariation(project: ComicProject, ownerId: string, variationId: string): void {
  const owner: StoryEntry | undefined = [
    ...project.metadata.characters,
    ...project.metadata.objects,
    ...project.metadata.scenes,
  ].find((entry) => entry.id === ownerId);
  if (!owner?.variations.some((v) => v.id === variationId)) {
    throw new Error(`Variation "${variationId}" not found on "${ownerId}".`);
  }
}

/** list/get/add/update/delete for the variations (poses/states) of a character, scene or object. */
export function variationsApi(deps: ComicBuilderDeps) {
  return {
    list: (kind: StoryKind, entryId: string): Variation[] =>
      snapshot(findEntry(requireProject(deps), kind, entryId).variations),
    get: (kind: StoryKind, entryId: string, variationId: string): Variation | null => {
      const variation = findEntry(requireProject(deps), kind, entryId).variations.find(
        (v) => v.id === variationId
      );
      return variation ? snapshot(variation) : null;
    },
    add: (kind: StoryKind, entryId: string, input: VariationInput): Variation => {
      const prompt = input.prompt ?? '';
      const imageIds = input.imageIds ?? [];
      const variation: Variation = {
        id: newId('var'),
        name: input.name,
        prompt,
        imageIds,
        // Mirrors layers.add: dirty when there's a prompt and no image yet, unless given explicitly.
        dirty: input.dirty ?? (Boolean(prompt.trim()) && imageIds.length === 0),
      };
      mutate(deps, (p) => {
        findEntry(p, kind, entryId).variations.push(variation);
      });
      return snapshot(variation);
    },
    update: (
      kind: StoryKind,
      entryId: string,
      variationId: string,
      patch: VariationPatch
    ): Variation =>
      snapshot(
        mutate(deps, (p) => {
          const variation = findEntry(p, kind, entryId).variations.find(
            (v) => v.id === variationId
          );
          if (!variation) throw new Error(`Variation "${variationId}" not found.`);
          // Mirrors updateLayer: new images always satisfy whatever prompt asked for them (clears
          // dirty); otherwise, touching this variation's own prompt makes its current art stale
          // (dirty) unless that leaves no prompt at all to act on.
          const swapsImages = patch.imageIds !== undefined;
          const dirty = swapsImages
            ? false
            : patch.prompt !== undefined
              ? Boolean((patch.prompt ?? variation.prompt ?? '').trim())
              : undefined;
          return Object.assign(
            variation,
            definedFields(patch),
            ...(dirty !== undefined ? [{ dirty }] : [])
          );
        })
      ),
    delete: (kind: StoryKind, entryId: string, variationId: string): boolean =>
      mutate(deps, (p) => {
        const entry = findEntry(p, kind, entryId);
        const removed = removeById(entry.variations, variationId);
        if (removed) {
          for (const page of p.pages) {
            for (const panel of page.panels) {
              for (const layer of panel.layers) {
                if (layer.variationId === variationId) delete layer.variationId;
              }
            }
          }
        }
        return removed;
      }),
  };
}

interface PanelItemTypes {
  layers: Layer;
  bubbles: Bubble;
}

export const snapshot = <T>(value: T): T => structuredClone(value);

export function definedFields<T extends object>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined)
  ) as Partial<T>;
}

export function assertKind<T extends string>(
  kind: unknown,
  allowed: readonly T[],
  label: string
): asserts kind is T {
  if (allowed.includes(kind as T)) return;
  const quoted = allowed.map((k) => `"${k}"`);
  const last = quoted.pop();
  throw new Error(
    `${label} must be ${quoted.join(', ')}${quoted.length > 1 ? ',' : ''} or ${last}.`
  );
}

/** A title or prompt must be text: anything else would make the saved project fail to load. */
export function assertOptionalText(value: unknown, label: string): void {
  if (value !== undefined && typeof value !== 'string') throw new Error(`${label} must be text.`);
}

function removeById(list: Array<{ id: string }>, id: string): boolean {
  const index = list.findIndex((item) => item.id === id);
  if (index >= 0) list.splice(index, 1);
  return index >= 0;
}

export function requireProject(deps: ComicBuilderDeps): ComicProject {
  const project = deps.getProject();
  if (!project) throw new Error('No project is open. Open a project first.');
  return project;
}

export function findPanel(project: ComicProject, panelId: string): Panel | undefined {
  return project.pages.flatMap((page) => page.panels).find((panel) => panel.id === panelId);
}

export function requirePanel(project: ComicProject, panelId: string): Panel {
  const panel = findPanel(project, panelId);
  if (!panel) throw new Error(`Panel "${panelId}" not found.`);
  return panel;
}

/** Run a mutation through updateProject and return what it produced. */
export function mutate<T>(deps: ComicBuilderDeps, mutation: (p: ComicProject) => T): T {
  let result!: T;
  deps.updateProject((p) => {
    result = mutation(p);
  });
  return result;
}

/** A layer's or image's subject must be an existing character or object. */
export function assertSubject(project: ComicProject, id: string): void {
  const { characters, objects } = project.metadata;
  if (![...characters, ...objects].some((entry) => entry.id === id)) {
    throw new Error(`Subject "${id}" not found: it must be a character or object id.`);
  }
}

/** A background layer's or image's scene must be an existing scene. */
export function assertScene(project: ComicProject, id: string): void {
  if (!project.metadata.scenes.some((scene) => scene.id === id)) {
    throw new Error(`Scene "${id}" not found: it must be a scene id.`);
  }
}

/** Layers and images that showed this character or object, or were set in this scene, lose that link. */
export function clearLinksTo(project: ComicProject, id: string): void {
  for (const item of project.metadata.media) {
    if (item.subjectId === id) delete item.subjectId;
    if (item.sceneId === id) delete item.sceneId;
  }
  for (const page of project.pages) {
    for (const panel of page.panels) {
      for (const layer of panel.layers) {
        if (layer.subjectId === id) {
          delete layer.subjectId;
          delete layer.variationId;
        }
        if (layer.sceneId === id) {
          delete layer.sceneId;
          delete layer.variationId;
        }
      }
    }
  }
}

/** list/get/add/update/delete for the layers or bubbles of a panel. */
export function panelItemsApi<K extends keyof PanelItemTypes>(
  deps: ComicBuilderDeps,
  key: K,
  label: string
) {
  type Item = PanelItemTypes[K];
  const itemsOf = (panel: Panel) => panel[key] as unknown as Item[];
  const readItems = (panelId: string): Item[] | null => {
    const project = deps.getProject();
    const panel = project && findPanel(project, panelId);
    return panel ? itemsOf(panel) : null;
  };

  return {
    list: (panelId: string): Item[] | null => {
      const items = readItems(panelId);
      return items && snapshot(items);
    },
    get: (panelId: string, id: string): Item | null => {
      const item = readItems(panelId)?.find((i) => i.id === id);
      return item ? snapshot(item) : null;
    },
    add: (panelId: string, item: Item, atStart = false): Item => {
      deps.updateProject((p) => {
        const items = itemsOf(requirePanel(p, panelId));
        if (atStart) items.unshift(item);
        else items.push(item);
      });
      return snapshot(item);
    },
    /** `clear` names optional fields to remove from the item, since `undefined` in a patch means "leave alone". */
    update: (panelId: string, id: string, patch: Partial<Item>, clear: string[] = []): Item =>
      snapshot(
        mutate(deps, (p) => {
          const item = itemsOf(requirePanel(p, panelId)).find((i) => i.id === id);
          if (!item) throw new Error(`${label} "${id}" not found.`);
          Object.assign(item, definedFields(patch));
          for (const field of clear) delete (item as unknown as Record<string, unknown>)[field];
          return item;
        })
      ),
    delete: (panelId: string, id: string): boolean =>
      mutate(deps, (p) => removeById(itemsOf(requirePanel(p, panelId)), id)),
  };
}

/** list/get/create/update/delete for characters, scenes or objects. */
export function storyApi<K extends keyof StoryTypes>(deps: ComicBuilderDeps, key: K) {
  type Entry = StoryTypes[K];
  const { idPrefix, label, linkField } = STORY_KINDS[key];
  const entriesOf = (p: ComicProject) => p.metadata[key] as unknown as Entry[];

  return {
    list: (): Array<{ id: string; name: string }> =>
      entriesOf(requireProject(deps)).map(({ id, name }) => ({ id, name })),
    get: (id: string): Entry | null => {
      const entry = entriesOf(requireProject(deps)).find((e) => e.id === id);
      return entry ? snapshot(entry) : null;
    },
    create: (input: StoryEntryInput): Entry => {
      const entry = {
        id: newId(idPrefix),
        name: input.name,
        description: input.description ?? '',
        imageIds: input.imageIds ?? [],
        variations: input.variations ?? defaultVariations(key),
        [linkField]: input.linkIds ?? [],
      } as unknown as Entry;
      deps.updateProject((p) => {
        entriesOf(p).push(entry);
      });
      return snapshot(entry);
    },
    update: (id: string, patch: StoryEntryPatch): Entry => {
      const { linkIds, variations, ...fields } = patch;
      return snapshot(
        mutate(deps, (p) => {
          const entry = entriesOf(p).find((e) => e.id === id);
          if (!entry) throw new Error(`${label} "${id}" not found.`);
          Object.assign(
            entry,
            definedFields(fields),
            linkIds === undefined ? {} : { [linkField]: linkIds },
            variations === undefined ? {} : { variations }
          );
          // The description is the shared prefix of every variation's stitched prompt (entry
          // description + the variation's own text), so changing it makes every variation's current
          // art stale — unless this same call also replaced `variations` outright (new art plan).
          if (fields.description !== undefined && variations === undefined) {
            for (const v of entry.variations) v.dirty = hasEffectivePrompt(entry.description, v);
          }
          return entry;
        })
      );
    },
    delete: (id: string): boolean =>
      mutate(deps, (p) => {
        const removed = removeById(entriesOf(p), id);
        if (removed) clearLinksTo(p, id);
        return removed;
      }),
  };
}

/** Validate a layer's image: mediaId must name a registered MediaItem, or be omitted for none yet. */
export function resolveLayerImage(
  project: ComicProject,
  { mediaId }: { mediaId?: string }
): { mediaId?: string } {
  if (mediaId === undefined) return {};
  const item = project.metadata.media.find((m) => m.id === mediaId);
  if (!item)
    throw new Error(`Media "${mediaId}" not found. Upload the image with media.upload first.`);
  return { mediaId };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** The physical size of some artwork, plus the pixel size to generate it at. */
export function artSize(widthIn: number, heightIn: number) {
  return {
    widthIn: round(widthIn),
    heightIn: round(heightIn),
    aspectRatio: round(widthIn / heightIn),
    pixels: artPixels(widthIn, heightIn),
  };
}

/** The size a layer's art should be generated at (see layers.size). */
export function layerArtSize(project: ComicProject, panelId: string, layerId: string) {
  const panel = findPanel(project, panelId);
  const layer = panel?.layers.find((l) => l.id === layerId);
  if (!panel || !layer) return null;
  const { widthIn, heightIn } = project.metadata.pageSize;
  const panelWidth = (widthIn * panel.width) / 100;
  if (layer.kind === 'background') return artSize(panelWidth, (heightIn * panel.height) / 100);
  const width = (panelWidth * layer.width) / 100;
  return artSize(width, width / (layer.aspectRatio ?? 1));
}

export const MEDIA_HISTORY_LIMIT = 20;

/**
 * What changes on a layer when its image is swapped: the old mediaId (if any, and different) moves
 * to the front of mediaHistory (removed from there first, so restoring an old one never duplicates
 * it), and the image is no longer dirty.
 */
export function imageSwapPatch(
  current: Layer,
  mediaId: string
): Pick<Layer, 'mediaId' | 'mediaHistory' | 'dirty'> {
  const history = (current.mediaHistory ?? []).filter((id) => id !== mediaId);
  if (current.mediaId && current.mediaId !== mediaId) history.unshift(current.mediaId);
  return {
    mediaId,
    ...(history.length > 0 && { mediaHistory: history.slice(0, MEDIA_HISTORY_LIMIT) }),
    dirty: false,
  };
}

/**
 * What changes on a layer when its current image is unlinked (not deleted from the project, unlike
 * media.delete): just dirty, recomputed the same way as any other layer left with no image. mediaId
 * itself is cleared separately (updateLayer passes 'mediaId' in layers.update's `clear` list), and
 * nothing moves into mediaHistory — unlinking means this image is no longer part of the layer at
 * all, not "set aside to restore later" (that's what a swap's history push is for).
 */
export function imageUnlinkPatch(current: Layer): Pick<Layer, 'dirty'> {
  return { dirty: Boolean((current.prompt ?? '').trim()) };
}

/**
 * Adds an image to a layer's history without making it the active image: used the instant a
 * generation succeeds (see GenerateImageModal), so the image — already registered in the project's
 * media — is attached to the layer right away rather than waiting on a later "Use this image" click
 * that the user might never get to.
 */
export function addToHistoryPatch(current: Layer, mediaId: string): Pick<Layer, 'mediaHistory'> {
  const history = (current.mediaHistory ?? []).filter((id) => id !== mediaId);
  history.unshift(mediaId);
  return { mediaHistory: history.slice(0, MEDIA_HISTORY_LIMIT) };
}

export interface LayerRef {
  pageId: string;
  panelId: string;
  layerId: string;
}

/** Every layer (or background) across the whole project whose image no longer matches its prompt. */
export function dirtyLayerRefs(project: ComicProject): LayerRef[] {
  const refs: LayerRef[] = [];
  for (const page of project.pages) {
    for (const panel of page.panels) {
      for (const layer of panel.layers) {
        if (layer.dirty) refs.push({ pageId: page.id, panelId: panel.id, layerId: layer.id });
      }
    }
  }
  return refs;
}

export interface VariationRef {
  kind: StoryKind;
  entryId: string;
  variationId: string;
}

/** Every variation (reference art for a character, object or scene), across the whole story bible,
 * whose art no longer matches its prompt. Mirrors dirtyLayerRefs for layers. */
export function dirtyVariationRefs(project: ComicProject): VariationRef[] {
  const refs: VariationRef[] = [];
  for (const kind of Object.keys(STORY_KINDS) as StoryKind[]) {
    for (const entry of entriesOfKind(project, kind)) {
      for (const variation of entry.variations) {
        if (variation.dirty) refs.push({ kind, entryId: entry.id, variationId: variation.id });
      }
    }
  }
  return refs;
}

type StyleScope = 'all' | 'characters' | 'scenes';

/** Whether a layer's prompt includes the given style field: style ('all') is in every prompt; a
 * background's prompt includes sceneStyle; a foreground layer whose subject is a character (not an
 * object — objects get no style addendum) includes characterStyle. Mirrors how buildLayerPromptParts
 * (src/ai/prompt.ts) decides which style addendum to stitch in. */
function layerInStyleScope(project: ComicProject, layer: Layer, scope: StyleScope): boolean {
  if (scope === 'all') return true;
  if (layer.kind === 'background') return scope === 'scenes';
  return scope === 'characters' && !project.metadata.objects.some((o) => o.id === layer.subjectId);
}

/**
 * Marks every layer and story-bible variation whose stitched prompt includes the given style field,
 * and currently has a prompt to act on, as dirty: used when that field changes, since changing it
 * makes every image generated under the old wording stale, the same way changing one layer's own
 * prompt makes that one layer stale. 'all' (the shared STYLE paragraph) reaches every layer and
 * variation; 'characters'/'scenes' (the kind-specific style addenda) reach only that kind's.
 */
function cascadeDirty(project: ComicProject, scope: StyleScope): void {
  for (const page of project.pages) {
    for (const panel of page.panels) {
      for (const layer of panel.layers) {
        if ((layer.prompt ?? '').trim() && layerInStyleScope(project, layer, scope))
          layer.dirty = true;
      }
    }
  }
  const kinds: StoryKind[] = scope === 'all' ? (Object.keys(STORY_KINDS) as StoryKind[]) : [scope];
  for (const kind of kinds) {
    for (const entry of entriesOfKind(project, kind)) {
      for (const variation of entry.variations) {
        if (hasEffectivePrompt(entry.description, variation)) variation.dirty = true;
      }
    }
  }
}

/** See cascadeDirty: dirties everything, since the shared STYLE paragraph is in every prompt. */
export function cascadeStyleDirty(project: ComicProject): void {
  cascadeDirty(project, 'all');
}

/** See cascadeDirty: dirties only character layers and character variations. */
export function cascadeCharacterStyleDirty(project: ComicProject): void {
  cascadeDirty(project, 'characters');
}

/** See cascadeDirty: dirties only background layers and scene variations. */
export function cascadeSceneStyleDirty(project: ComicProject): void {
  cascadeDirty(project, 'scenes');
}

export interface PendingGeneration extends LayerRef {
  /** Zero-based page number, as shown in the UI. */
  page: number;
  panelTitle?: string;
  /** 1-based position of the panel on its page. */
  panelNumber: number;
  name: string;
  kind: 'background' | 'foreground';
  prompt?: string;
  /** False when the layer has no image yet; true when its prompt changed since the image was made. */
  hasImage: boolean;
}

/** What generate.dirty() would generate, described: dirtyLayerRefs plus where each layer sits and its prompt. */
export function pendingGenerations(project: ComicProject): PendingGeneration[] {
  return project.pages.flatMap((page) =>
    page.panels.flatMap((panel, i) =>
      panel.layers
        .filter((layer) => layer.dirty)
        .map((layer) => ({
          pageId: page.id,
          panelId: panel.id,
          layerId: layer.id,
          page: page.number,
          panelTitle: panel.title,
          panelNumber: i + 1,
          name: layer.name || layer.id,
          kind: layer.kind,
          prompt: layer.prompt,
          hasImage: Boolean(layer.mediaId),
        }))
    )
  );
}

export interface PendingReference extends VariationRef {
  entryName: string;
  variationName: string;
  prompt?: string;
  /** False when the variation has no reference art yet; true when its prompt changed since it was made. */
  hasImage: boolean;
}

/** What generate.dirtyReferences() would generate, described: dirtyVariationRefs plus the entry's and
 * variation's names and prompt. Mirrors pendingGenerations for layers. */
export function pendingReferenceGenerations(project: ComicProject): PendingReference[] {
  return (Object.keys(STORY_KINDS) as StoryKind[]).flatMap((kind) =>
    entriesOfKind(project, kind).flatMap((entry) =>
      entry.variations
        .filter((v) => v.dirty)
        .map((v) => ({
          kind,
          entryId: entry.id,
          variationId: v.id,
          entryName: entry.name || entry.id,
          variationName: v.name || v.id,
          prompt: v.prompt,
          hasImage: v.imageIds.length > 0,
        }))
    )
  );
}

/** Panel layout operations. The panels of a page always tile it (see state/layout.ts). */
export function panelsApi(deps: ComicBuilderDeps) {
  const pageAt = (project: ComicProject, pageIndex = deps.getPageIndex()): ComicPage => {
    const page = project.pages[pageIndex];
    if (!page) throw new Error(`Page ${pageIndex} not found.`);
    return page;
  };
  const pageOfPanel = (project: ComicProject, panelId: string) =>
    project.pages.find((page) => page.panels.some((panel) => panel.id === panelId));
  const locate = (project: ComicProject, panelId: string) => {
    const page = pageOfPanel(project, panelId);
    if (!page) throw new Error(`Panel "${panelId}" not found.`);
    return { page, index: page.panels.findIndex((panel) => panel.id === panelId) };
  };
  const applyRects = (panels: Panel[], rects: Rect[]) =>
    panels.forEach((panel, i) => Object.assign(panel, rectOf(rects[i])));

  /** Shrink each cut panel to its first part and insert new empty panels for the rest, right after it. */
  const applyCuts = (page: ComicPage, cuts: Map<number, Rect[]>) => {
    for (const index of [...cuts.keys()].sort((a, b) => b - a)) {
      const [first, ...rest] = cuts.get(index)!;
      Object.assign(page.panels[index], rectOf(first));
      page.panels.splice(index + 1, 0, ...rest.map((rect) => createPanel(rect)));
    }
  };

  const cutPanel = (panelId: string, cutRect: (rect: Rect) => Rect[]): Panel[] =>
    snapshot(
      mutate(deps, (p) => {
        const { page, index } = locate(p, panelId);
        const parts = cutRect(page.panels[index]);
        applyCuts(page, new Map([[index, parts]]));
        return page.panels.slice(index, index + parts.length);
      })
    );

  return {
    list: (pageIndex?: number): Panel[] => snapshot(pageAt(requireProject(deps), pageIndex).panels),
    get: (panelId: string): Panel | null => {
      const panel = findPanel(requireProject(deps), panelId);
      return panel ? snapshot(panel) : null;
    },
    size: (panelId: string) => {
      const project = requireProject(deps);
      const panel = findPanel(project, panelId);
      if (!panel) return null;
      const { widthIn, heightIn } = project.metadata.pageSize;
      return artSize((widthIn * panel.width) / 100, (heightIn * panel.height) / 100);
    },
    split: (panelId: string, axis: Axis, position = 50): Panel[] => {
      assertKind(axis, AXES, 'Axis');
      return cutPanel(panelId, (rect) => splitRect(rect, axis, position));
    },
    splitAcross: (axis: Axis, position: number, pageIndex?: number): Panel[] => {
      assertKind(axis, AXES, 'Axis');
      return snapshot(
        mutate(deps, (p) => {
          const page = pageAt(p, pageIndex);
          applyCuts(page, cutAcross(page.panels.map(rectOf), axis, position));
          return page.panels;
        })
      );
    },
    splitEvenly: (panelId: string, axis: Axis, count: number): Panel[] => {
      assertKind(axis, AXES, 'Axis');
      return cutPanel(panelId, (rect) => splitEvenly(rect, axis, count));
    },
    resize: (panelId: string, edge: Edge, position: number): Panel[] => {
      assertKind(edge, EDGES, 'Edge');
      if (!Number.isFinite(position)) throw new Error('position must be a number.');
      return snapshot(
        mutate(deps, (p) => {
          const { page, index } = locate(p, panelId);
          applyRects(page.panels, moveEdge(page.panels.map(rectOf), index, edge, position));
          return page.panels;
        })
      );
    },
    update: (panelId: string, patch: { title?: string; prompt?: string }): Panel => {
      assertOptionalText(patch.title, 'title');
      assertOptionalText(patch.prompt, 'prompt');
      return snapshot(
        mutate(deps, (p) =>
          Object.assign(
            requirePanel(p, panelId),
            definedFields({ title: patch.title, prompt: patch.prompt })
          )
        )
      );
    },
    delete: (panelId: string): boolean =>
      mutate(deps, (p) => {
        const page = pageOfPanel(p, panelId);
        if (!page) return false;
        if (page.panels.length === 1) throw new Error('A page needs at least one panel.');
        const index = page.panels.findIndex((panel) => panel.id === panelId);
        const absorbed = absorbPanel(page.panels.map(rectOf), index);
        page.panels.splice(index, 1);
        if (absorbed) applyRects(page.panels, absorbed);
        return true;
      }),
  };
}
