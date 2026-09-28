/**
 * Three-way merge of a comic project, for when two systems (the app in a
 * browser, the CLI, another device) changed the same project.json.
 *
 * `base` is the last copy both sides agreed on (what was loaded or last saved),
 * `mine` ("ours") is what this side has now, `theirs` is what is on Drive now.
 * Every page, panel, layer, bubble, character, scene, object and image has an
 * id, so the copies are compared thing by thing and field by field: changes to
 * different things, or to different fields of one thing, combine on their own.
 * Only a real clash is a conflict:
 *
 *   - both sides changed the same field of the same thing, differently;
 *   - one side deleted a thing the other side changed;
 *   - both sides moved the same list (the pages, a stack of layers) differently;
 *   - the panels of a page no longer tile it once both layouts are combined.
 *
 * The merged project keeps *our* side wherever there is a conflict. Each
 * conflict says where it is (for the dots and the footer that show it), how
 * each of the three sides looks, and can switch a project over to any side
 * with `resolve`, so the editor can show what each choice would give.
 */
import type { ComicProject } from '../types/comic';
import { assertValidProject } from './project';

type Rec = Record<string, unknown>;
type Item = Rec & { id: string };

/** Which tab of the editor shows a conflict, and which page and panel it is on. */
export interface Where {
  tab: 'outline' | 'cast' | 'scenes' | 'pages';
  pageId?: string;
  panelId?: string;
}

/** The three copies: the last one both agreed on, this side's, and the other side's. */
export type Side = 'base' | 'ours' | 'theirs';

export interface Conflict {
  kind: 'value' | 'deleted' | 'order' | 'layout';
  /** Where it is, e.g. `Page 2 "Chase" › Panel 1 › Layer "Mara" › prompt`. */
  label: string;
  where: Where;
  /** How each side looks, as short text. */
  text: Record<Side, string>;
  /** Change `project` to this side of the conflict ('ours' is what a merged project already has). */
  resolve: (project: ComicProject, side: Side) => void;
}

export interface MergeResult {
  /** Everything that merged cleanly, with our side wherever there is a conflict. */
  merged: ComicProject;
  conflicts: Conflict[];
}

// ---- how the project is put together --------------------------------------------------

interface Shape {
  /** Names one of these things in messages. */
  name?: (item: Rec, index: number) => string;
  /** Fields that are lists of things with ids. */
  collections?: Record<string, Shape>;
  /** Fields that are one nested record. */
  records?: Record<string, Shape>;
  /** Fields that are derived or bookkeeping: our value is kept and never conflicts. */
  skip?: string[];
}

const quoted = (text: unknown, max = 24) => {
  const value = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return value.length > max ? `"${value.slice(0, max - 1)}…"` : `"${value}"`;
};
const titled = (label: string, item: Rec) =>
  item.title ? `${label} ${quoted(item.title)}` : label;

const LAYER: Shape = { name: (l) => `Layer ${quoted(l.name)}` };
const BUBBLE: Shape = { name: (b) => `Bubble ${quoted(b.text)}` };
const PANEL: Shape = {
  name: (p, i) => titled(`Panel ${i + 1}`, p),
  collections: { layers: LAYER, bubbles: BUBBLE },
};
const PAGE: Shape = {
  name: (p, i) => titled(`Page ${i}`, p),
  collections: { panels: PANEL },
  skip: ['number'],
};
const METADATA: Shape = {
  collections: {
    characters: { name: (c) => `Character ${quoted(c.name)}` },
    scenes: { name: (s) => `Scene ${quoted(s.name)}` },
    objects: { name: (o) => `Object ${quoted(o.name)}` },
    media: { name: (m) => `Image ${quoted(m.name)}` },
  },
};
const PROJECT: Shape = {
  collections: { pages: PAGE },
  records: { metadata: METADATA },
  skip: ['updatedAt', 'savedAt'],
};

/** The editor tab that shows things kept in this list of the project's metadata. */
const metadataTab = (key: string): Where =>
  key === 'characters' || key === 'objects'
    ? { tab: 'cast' }
    : key === 'scenes'
      ? { tab: 'scenes' }
      : { tab: 'outline' };

// ---- helpers ---------------------------------------------------------------------------

const clone = <T>(value: T): T => (value === undefined ? value : structuredClone(value));

/** JSON with sorted keys, so equal things compare equal whatever order their fields are in. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v
  );
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/** Two versions of one thing, ignoring the fields that are only bookkeeping. */
function sameThing(a: Rec, b: Rec, shape: Shape): boolean {
  const strip = (r: Rec) =>
    Object.fromEntries(Object.entries(r).filter(([k]) => !shape.skip?.includes(k)));
  return same(strip(a), strip(b));
}

function show(value: unknown): string {
  if (value === undefined) return '(not set)';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 300 ? `${text.slice(0, 299)}…` : text;
}

/** Where to find a thing in a project: each step is a field, and, for a list, the id of the thing. */
interface Step {
  key: string;
  id?: string;
}

function descend(root: Rec, steps: Step[]): Rec | undefined {
  let current: unknown = root;
  for (const { key, id } of steps) {
    if (!current || typeof current !== 'object') return undefined;
    const next = (current as Rec)[key];
    current =
      id === undefined ? next : (next as Item[] | undefined)?.find((entry) => entry.id === id);
  }
  return current as Rec | undefined;
}

const asRec = (project: ComicProject) => project as unknown as Rec;

/** Put `thing` in the list (replacing the one with its id, or after the nearest neighbour it had in `anchors`); undefined removes it. */
function setThing(
  project: ComicProject,
  steps: Step[],
  key: string,
  id: string,
  thing: Item | undefined,
  anchors: Item[]
): void {
  const holder = descend(asRec(project), steps);
  if (!holder) return;
  const list = ((holder[key] as Item[] | undefined) ??= []);
  const at = list.findIndex((entry) => entry.id === id);
  if (thing === undefined) {
    if (at >= 0) list.splice(at, 1);
    return;
  }
  if (at >= 0) {
    list[at] = clone(thing);
    return;
  }
  const before = anchors
    .slice(
      0,
      Math.max(
        0,
        anchors.findIndex((entry) => entry.id === id)
      )
    )
    .reverse();
  const anchor = before.find((entry) => list.some((other) => other.id === entry.id));
  list.splice(anchor ? list.findIndex((other) => other.id === anchor.id) + 1 : 0, 0, clone(thing));
}

/** Put the things whose ids are in `order` into that order, in the places they already occupy. */
function reorder(list: Item[], order: string[]): void {
  const wanted = new Set(order);
  const byId = new Map(list.map((entry) => [entry.id, entry]));
  const slots = list.flatMap((entry, index) => (wanted.has(entry.id) ? [index] : []));
  order
    .filter((id) => byId.has(id))
    .forEach((id, i) => {
      list[slots[i]] = byId.get(id)!;
    });
}

interface Context {
  steps: Step[];
  /** The names of the things above, e.g. ['Page 2 "Chase"', 'Panel 1']. */
  names: string[];
  where: Where;
}

interface Run {
  conflicts: Conflict[];
}

const idsOf = (list: Item[]) => list.map((entry) => entry.id);
const eq = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

// ---- merging ---------------------------------------------------------------------------

function mergeRecord(
  base: Rec | undefined,
  mine: Rec,
  theirs: Rec,
  shape: Shape,
  ctx: Context,
  run: Run
): Rec {
  const out: Rec = {};
  const keys = new Set([...Object.keys(mine), ...Object.keys(theirs), ...Object.keys(base ?? {})]);
  for (const key of keys) {
    if (shape.skip?.includes(key)) {
      if (mine[key] !== undefined) out[key] = clone(mine[key]);
      continue;
    }
    const collection = shape.collections?.[key];
    if (collection) {
      out[key] = mergeList(
        (base?.[key] as Item[] | undefined) ?? [],
        (mine[key] as Item[] | undefined) ?? [],
        (theirs[key] as Item[] | undefined) ?? [],
        collection,
        key,
        ctx,
        run
      );
      continue;
    }
    const record = shape.records?.[key];
    if (record) {
      const inner: Context = { ...ctx, steps: [...ctx.steps, { key }] };
      out[key] = mergeRecord(
        base?.[key] as Rec | undefined,
        (mine[key] as Rec) ?? {},
        (theirs[key] as Rec) ?? {},
        record,
        inner,
        run
      );
      continue;
    }

    const [b, m, t] = [base?.[key], mine[key], theirs[key]];
    let value = m;
    if (!same(m, t)) {
      if (same(m, b)) value = t;
      else if (!same(t, b)) run.conflicts.push(valueConflict(ctx, key, b, m, t));
    }
    if (value !== undefined) out[key] = clone(value);
  }
  return out;
}

function valueConflict(
  ctx: Context,
  key: string,
  base: unknown,
  mine: unknown,
  theirs: unknown
): Conflict {
  const steps = ctx.steps;
  const inMetadata = steps.length === 1 && steps[0].key === 'metadata';
  const field =
    steps.length === 0 && key === 'title'
      ? 'Project title'
      : inMetadata
        ? key === 'style'
          ? 'Style'
          : key === 'pageSize'
            ? 'Page size'
            : key
        : key;
  return {
    kind: 'value',
    label: inMetadata || steps.length === 0 ? field : [...ctx.names, field].join(' › '),
    where: ctx.where,
    text: { base: show(base), ours: show(mine), theirs: show(theirs) },
    resolve: (project, side) => {
      if (side === 'ours') return;
      const holder = descend(asRec(project), steps);
      if (!holder) return;
      const value = side === 'base' ? base : theirs;
      if (value === undefined) delete holder[key];
      else holder[key] = clone(value);
    },
  };
}

function mergeList(
  baseList: Item[],
  mineList: Item[],
  theirsList: Item[],
  shape: Shape,
  key: string,
  ctx: Context,
  run: Run
): Item[] {
  const byId = (list: Item[]) => new Map(list.map((entry) => [entry.id, entry]));
  const [bm, mm, tm] = [byId(baseList), byId(mineList), byId(theirsList)];
  const parent = ctx.steps;
  const inMetadata = parent[0]?.key === 'metadata';
  /** The tab, page and panel a thing in this list belongs to. */
  const whereOf = (id?: string): Where =>
    key === 'pages'
      ? { tab: 'pages', ...(id ? { pageId: id } : {}) }
      : key === 'panels'
        ? { ...ctx.where, ...(id ? { panelId: id } : {}) }
        : inMetadata
          ? metadataTab(key)
          : ctx.where;
  const nameOf = (id: string): string => {
    for (const list of [mineList, theirsList, baseList]) {
      const index = list.findIndex((entry) => entry.id === id);
      if (index >= 0) return shape.name ? shape.name(list[index], index) : id;
    }
    return id;
  };
  const child = (id: string): Context => ({
    steps: [...parent, { key, id }],
    names: [...ctx.names, nameOf(id)],
    where: whereOf(id),
  });
  const merged = new Map<string, Item>();

  const ids = [...new Set([...idsOf(mineList), ...idsOf(theirsList), ...idsOf(baseList)])];
  for (const id of ids) {
    const [b, m, t] = [bm.get(id), mm.get(id), tm.get(id)];
    if (m && t) {
      merged.set(id, mergeRecord(b, m, t, shape, child(id), run) as Item);
    } else if (m && !t) {
      if (!b)
        merged.set(id, clone(m)); // added here
      else if (sameThing(m, b, shape))
        continue; // deleted there, untouched here
      else {
        // Deleted there, changed here: keep it, and let the user delete it after all.
        merged.set(id, clone(m));
        run.conflicts.push({
          kind: 'deleted',
          label: nameOf(id),
          where: whereOf(id),
          text: { base: 'as it was', ours: 'changed here', theirs: 'deleted there' },
          resolve: (project, side) => {
            if (side === 'theirs') setThing(project, parent, key, id, undefined, []);
            if (side === 'base') setThing(project, parent, key, id, b, baseList);
          },
        });
      }
    } else if (!m && t) {
      if (!b)
        merged.set(id, clone(t)); // added there
      else if (sameThing(t, b, shape))
        continue; // deleted here, untouched there
      else {
        // Deleted here, changed there: stay deleted, and let the user bring it back.
        run.conflicts.push({
          kind: 'deleted',
          label: nameOf(id),
          where: whereOf(id),
          text: { base: 'as it was', ours: 'deleted here', theirs: 'changed there' },
          resolve: (project, side) => {
            if (side === 'theirs') setThing(project, parent, key, id, t, theirsList);
            if (side === 'base') setThing(project, parent, key, id, b, baseList);
          },
        });
      }
    }
  }

  // Order: the things every side still has keep the order one side gave them; if both sides moved
  // them, differently, that is a conflict (ours wins until the user chooses).
  const everywhere = new Set(idsOf(baseList).filter((id) => mm.has(id) && tm.has(id)));
  const [seqBase, seqMine, seqTheirs] = [baseList, mineList, theirsList].map((list) =>
    idsOf(list).filter((id) => everywhere.has(id))
  );
  const mineMoved = !eq(seqBase, seqMine);
  const theirsMoved = !eq(seqBase, seqTheirs);
  if (mineMoved && theirsMoved && !eq(seqMine, seqTheirs)) {
    const names = (seq: string[]) => seq.map(nameOf).join(', ');
    run.conflicts.push({
      kind: 'order',
      label: [...ctx.names, `order of the ${key}`].join(' › '),
      where: whereOf(),
      text: { base: names(seqBase), ours: names(seqMine), theirs: names(seqTheirs) },
      resolve: (project, side) => {
        if (side === 'ours') return;
        const list = descend(asRec(project), parent)?.[key] as Item[] | undefined;
        if (list) reorder(list, side === 'base' ? seqBase : seqTheirs);
      },
    });
  }

  // Lay the survivors out in that order; anything else goes after the thing that came before it in
  // the list it came from (ours first).
  const order = (mineMoved ? seqMine : theirsMoved ? seqTheirs : seqBase).filter((id) =>
    merged.has(id)
  );
  for (const list of [mineList, theirsList]) {
    let previous: string | undefined;
    for (const { id } of list) {
      if (!merged.has(id)) continue;
      if (!order.includes(id)) {
        order.splice(previous === undefined ? 0 : order.indexOf(previous) + 1, 0, id);
      }
      previous = id;
    }
  }
  return order.map((id) => merged.get(id)!);
}

// ---- layout ----------------------------------------------------------------------------

const boxes = (panels: Rec[]) =>
  panels.map((p) => ({
    x: Number(p.x),
    y: Number(p.y),
    width: Number(p.width),
    height: Number(p.height),
  }));

/** True when the panels cover the whole page exactly once (a small tolerance for rounding). */
function tiles(panels: Rec[]): boolean {
  const list = boxes(panels);
  if (list.some((b) => ![b.x, b.y, b.width, b.height].every(Number.isFinite))) return true; // no layout to check
  const area = list.reduce((sum, b) => sum + b.width * b.height, 0);
  if (Math.abs(area - 10000) > 1) return false;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const [a, b] = [list[i], list[j]];
      const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (w > 0.01 && h > 0.01 && w * h > 0.5) return false;
    }
  }
  return true;
}

/**
 * Combining two layouts field by field can give panels that overlap or leave gaps, even though each
 * side's own layout is fine. If that happens to a page, fall back to our layout for it and report a
 * conflict; choosing a side swaps in that side's whole set of panels for the page.
 */
function checkLayouts(
  merged: ComicProject,
  base: ComicProject,
  mine: ComicProject,
  theirs: ComicProject,
  run: Run
): void {
  for (const page of merged.pages) {
    const [b, m, t] = [base, mine, theirs].map((project) =>
      project.pages.find((p) => p.id === page.id)
    );
    if (!m || !t) continue;
    const signature = (panels: Rec[]) => canonical(boxes(panels));
    const combined = signature(page.panels as unknown as Rec[]);
    if (
      combined === signature(m.panels as unknown as Rec[]) ||
      combined === signature(t.panels as unknown as Rec[]) ||
      tiles(page.panels as unknown as Rec[])
    ) {
      continue;
    }
    const index = merged.pages.indexOf(page);
    page.panels = clone(m.panels);
    run.conflicts.push({
      kind: 'layout',
      label: `${PAGE.name!(page as unknown as Rec, index)} › panel layout`,
      where: { tab: 'pages', pageId: page.id },
      text: {
        base: b ? `${b.panels.length} panels` : '(new page)',
        ours: `${m.panels.length} panels`,
        theirs: `${t.panels.length} panels`,
      },
      resolve: (project, side) => {
        const target = project.pages.find((p) => p.id === page.id);
        const source = side === 'theirs' ? t : side === 'base' ? b : undefined;
        if (target && source) target.panels = clone(source.panels);
      },
    });
  }
}

/** Merge `mine` and `theirs`, which both grew from `base`. Throws if the result is not a valid project. */
export function mergeProjects(
  base: ComicProject,
  mine: ComicProject,
  theirs: ComicProject
): MergeResult {
  const run: Run = { conflicts: [] };
  const merged = mergeRecord(
    asRec(base),
    asRec(mine),
    asRec(theirs),
    PROJECT,
    { steps: [], names: [], where: { tab: 'outline' } },
    run
  ) as unknown as ComicProject;
  merged.pages.forEach((page, index) => {
    page.number = index;
  });
  checkLayouts(merged, base, mine, theirs, run);
  assertValidProject(merged);
  return { merged, conflicts: run.conflicts };
}

/** A copy of `project` with one conflict settled the given way ('ours' changes nothing). */
export function settled(project: ComicProject, conflict: Conflict, side: Side): ComicProject {
  const copy = structuredClone(project);
  conflict.resolve(copy, side);
  copy.pages.forEach((page, index) => {
    page.number = index;
  });
  return copy;
}

/** Settle every conflict: `choices[i]` is the side chosen for `conflicts[i]`. The result is checked to be a valid project. */
export function resolveAll(
  merged: ComicProject,
  conflicts: Conflict[],
  choices: Side[]
): ComicProject {
  const result = conflicts.reduce(
    (project, conflict, i) => settled(project, conflict, choices[i]),
    merged
  );
  assertValidProject(result);
  return result;
}
