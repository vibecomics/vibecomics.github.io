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
} from '../types/comic';
import { newId } from '../utils/id';
import type { ComicBuilderDeps, StoryEntryInput, StoryEntryPatch } from './deps';

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
        if (layer.subjectId === id) delete layer.subjectId;
        if (layer.sceneId === id) delete layer.sceneId;
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
        [linkField]: input.linkIds ?? [],
      } as unknown as Entry;
      deps.updateProject((p) => {
        entriesOf(p).push(entry);
      });
      return snapshot(entry);
    },
    update: (id: string, patch: StoryEntryPatch): Entry => {
      const { linkIds, ...fields } = patch;
      return snapshot(
        mutate(deps, (p) => {
          const entry = entriesOf(p).find((e) => e.id === id);
          if (!entry) throw new Error(`${label} "${id}" not found.`);
          return Object.assign(
            entry,
            definedFields(fields),
            linkIds === undefined ? {} : { [linkField]: linkIds }
          );
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
