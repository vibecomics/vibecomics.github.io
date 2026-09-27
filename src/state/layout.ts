import type { Panel } from '../types/comic';
import { newId } from '../utils/id';

/** A rectangle as percentages of the page. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 'horizontal' cuts a rectangle into top and bottom parts; 'vertical' into left and right. */
export type Axis = 'horizontal' | 'vertical';
export type Edge = 'top' | 'bottom' | 'left' | 'right';

const FULL_PAGE: Rect = { x: 0, y: 0, width: 100, height: 100 };

/** Smallest panel side, as a percentage of the page. */
const MIN_PANEL_SIZE = 5;

/** A dividing line between panels; dragging it resizes every panel that touches it. */
export interface Divider {
  /** 'vertical' lines separate left from right panels. */
  orientation: 'vertical' | 'horizontal';
  /** Position across the page, in percent. */
  coordinate: number;
  /** Extent along the page, in percent. */
  start: number;
  end: number;
  /** A panel touching the line and which of its edges lies on it. */
  panelIndex: number;
  edge: Edge;
}

const EPS = 0.01;
const round = (n: number) => Math.round(n * 1000) / 1000;
const near = (a: number, b: number) => Math.abs(a - b) < EPS;

const right = (r: Rect) => r.x + r.width;
const bottom = (r: Rect) => r.y + r.height;
const isVertical = (edge: Edge) => edge === 'left' || edge === 'right';
const isLowSide = (edge: Edge) => edge === 'right' || edge === 'bottom';
const OPPOSITE: Record<Edge, Edge> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };

export const rectOf = ({ x, y, width, height }: Rect): Rect => ({ x, y, width, height });

/** Where a new speech, thought or shout bubble's pointer aims: below the bubble, in percent of its panel. */
export function defaultPointer(bubble: { x: number; y: number; width: number; height: number }) {
  return { tailX: bubble.x + bubble.width / 2, tailY: Math.min(95, bubble.y + bubble.height + 12) };
}

const ART_DPI = 150;
const ART_MAX_SIDE = 2048;

/** The pixel size to generate art at for a physical size: 150 dpi, longest side at most 2048. */
export function artPixels(widthIn: number, heightIn: number) {
  const scale = Math.min(ART_DPI, ART_MAX_SIDE / Math.max(widthIn, heightIn));
  return { width: Math.round(widthIn * scale), height: Math.round(heightIn * scale) };
}

export function createPanel(rect: Rect = FULL_PAGE): Panel {
  return { id: newId('panel'), layers: [], bubbles: [], ...rectOf(rect) };
}

function coordinate(r: Rect, edge: Edge): number {
  return { left: r.x, right: right(r), top: r.y, bottom: bottom(r) }[edge];
}

/** The extent of a rectangle along a line of the given orientation. */
function extent(r: Rect, vertical: boolean): [number, number] {
  return vertical ? [r.y, bottom(r)] : [r.x, right(r)];
}

const overlaps = (a: [number, number], b: [number, number]) =>
  Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > EPS;

function withEdge(r: Rect, edge: Edge, value: number): Rect {
  const v = round(value);
  switch (edge) {
    case 'left':
      return { ...r, x: v, width: round(right(r) - v) };
    case 'right':
      return { ...r, width: round(v - r.x) };
    case 'top':
      return { ...r, y: v, height: round(bottom(r) - v) };
    case 'bottom':
      return { ...r, height: round(v - r.y) };
  }
}

function cut(rect: Rect, axis: Axis, positions: number[]): Rect[] {
  const horizontal = axis === 'horizontal';
  const start = horizontal ? rect.y : rect.x;
  const length = horizontal ? rect.height : rect.width;
  if (positions.some((p) => !(p > 0 && p < 100))) {
    throw new Error('position must be greater than 0 and less than 100.');
  }
  const bounds = [start, ...positions.map((p) => start + (length * p) / 100), start + length].map(
    round
  );
  return bounds.slice(0, -1).map((from, i) => {
    const size = round(bounds[i + 1] - from);
    if (size < MIN_PANEL_SIZE) {
      throw new Error(
        `Panels must be at least ${MIN_PANEL_SIZE}% of the page; that split leaves one too small.`
      );
    }
    return horizontal ? { ...rect, y: from, height: size } : { ...rect, x: from, width: size };
  });
}

/** Cut a rectangle in two; position is a percentage of its height (horizontal) or width (vertical). */
export function splitRect(rect: Rect, axis: Axis, position: number): [Rect, Rect] {
  return cut(rect, axis, [position]) as [Rect, Rect];
}

/**
 * The cuts a straight line across the whole page makes: for each panel it
 * crosses, that panel's new rectangles in reading order. Panels the line misses,
 * touches only at an edge, or would leave a part too small are left alone.
 * Throws when it cuts nothing.
 */
export function cutAcross(rects: Rect[], axis: Axis, position: number): Map<number, Rect[]> {
  if (!(position > 0 && position < 100)) {
    throw new Error('position must be greater than 0 and less than 100.');
  }
  const horizontal = axis === 'horizontal';
  const cuts = new Map<number, Rect[]>();
  rects.forEach((rect, index) => {
    const start = horizontal ? rect.y : rect.x;
    const length = horizontal ? rect.height : rect.width;
    if (position <= start + EPS || position >= start + length - EPS) return;
    try {
      cuts.set(index, splitRect(rect, axis, ((position - start) / length) * 100));
    } catch {
      // one part would be too small: leave this panel uncut
    }
  });
  if (cuts.size === 0) {
    throw new Error('That line does not cut any panel: it is on an edge or too close to one.');
  }
  return cuts;
}

export function splitEvenly(rect: Rect, axis: Axis, count: number): Rect[] {
  if (!Number.isInteger(count) || count < 2)
    throw new Error('count must be an integer of at least 2.');
  return cut(
    rect,
    axis,
    Array.from({ length: count - 1 }, (_, i) => (100 * (i + 1)) / count)
  );
}

interface Member {
  index: number;
  edge: Edge;
}

/**
 * Every panel edge on the same dividing line as one panel's edge, joined end to
 * end. Where two collinear segments merely touch, as at a crossing, horizontal
 * lines join (a tier divider spans the page) but vertical lines stay separate
 * (each tier has its own columns).
 */
function dividerMembers(rects: Rect[], index: number, edge: Edge): Member[] {
  const vertical = isVertical(edge);
  const line = coordinate(rects[index], edge);
  const sides: Edge[] = vertical ? ['left', 'right'] : ['top', 'bottom'];
  const onLine = rects.flatMap((r, i) =>
    sides
      .filter((side) => near(coordinate(r, side), line))
      .map((side) => ({ index: i, edge: side }))
  );
  const joined = (a: [number, number], b: [number, number]) =>
    Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > (vertical ? EPS : -EPS);

  const members: Member[] = [{ index, edge }];
  const rest = onLine.filter((m) => !(m.index === index && m.edge === edge));
  for (const member of members) {
    const reach = extent(rects[member.index], vertical);
    for (let i = rest.length - 1; i >= 0; i--) {
      if (joined(reach, extent(rects[rest[i].index], vertical))) members.push(...rest.splice(i, 1));
    }
  }
  return members;
}

const isPageBorder = (line: number) => near(line, 0) || near(line, 100);

/**
 * Move one panel edge to `value` (percent of the page). Every panel on the same
 * dividing line moves with it so the panels keep tiling the page; the edge stops
 * at the minimum panel size.
 */
export function moveEdge(rects: Rect[], index: number, edge: Edge, value: number): Rect[] {
  if (isPageBorder(coordinate(rects[index], edge))) {
    throw new Error('The outer edges of the page cannot be moved.');
  }
  const vertical = isVertical(edge);
  const members = dividerMembers(rects, index, edge);

  let min = MIN_PANEL_SIZE;
  let max = 100 - MIN_PANEL_SIZE;
  for (const member of members) {
    const [from, to] = extent(rects[member.index], !vertical);
    if (isLowSide(member.edge)) min = Math.max(min, from + MIN_PANEL_SIZE);
    else max = Math.min(max, to - MIN_PANEL_SIZE);
  }
  if (min > max) return rects;

  const target = Math.min(max, Math.max(min, value));
  return rects.map((r, i) => {
    const member = members.find((m) => m.index === i);
    return member ? withEdge(r, member.edge, target) : r;
  });
}

export function findDividers(rects: Rect[]): Divider[] {
  const seen = new Set<string>();
  const dividers: Divider[] = [];
  rects.forEach((rect, panelIndex) => {
    for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
      const line = coordinate(rect, edge);
      if (isPageBorder(line)) continue;
      const members = dividerMembers(rects, panelIndex, edge);
      const key = members
        .map((m) => `${m.index}${m.edge}`)
        .sort()
        .join();
      if (seen.has(key)) continue;
      seen.add(key);

      const vertical = isVertical(edge);
      const extents = members.map((m) => extent(rects[m.index], vertical));
      dividers.push({
        orientation: vertical ? 'vertical' : 'horizontal',
        coordinate: line,
        start: Math.min(...extents.map(([from]) => from)),
        end: Math.max(...extents.map(([, to]) => to)),
        panelIndex,
        edge,
      });
    }
  });
  return dividers;
}

/**
 * The rectangles of the remaining panels after deleting one, with the
 * neighbours on one side stretched over its space. Null when no side has
 * neighbours that exactly cover the deleted panel's edge.
 */
export function absorbPanel(rects: Rect[], index: number): Rect[] | null {
  const deleted = rects[index];
  const options: Array<{ neighbors: number[]; facing: Edge; target: number }> = [];

  for (const side of ['right', 'bottom', 'left', 'top'] as const) {
    const vertical = isVertical(side);
    const facing = OPPOSITE[side];
    const line = coordinate(deleted, side);
    const [from, to] = extent(deleted, vertical);
    const neighbors = rects
      .map((_, i) => i)
      .filter(
        (i) =>
          i !== index &&
          near(coordinate(rects[i], facing), line) &&
          overlaps(extent(rects[i], vertical), [from, to])
      );
    const spans = neighbors.map((i) => extent(rects[i], vertical)).sort((a, b) => a[0] - b[0]);
    const coversEdge =
      spans.length > 0 &&
      near(spans[0][0], from) &&
      near(spans[spans.length - 1][1], to) &&
      spans.every(([, end], i) => i === spans.length - 1 || near(end, spans[i + 1][0]));
    if (coversEdge)
      options.push({ neighbors, facing, target: coordinate(deleted, OPPOSITE[side]) });
  }

  if (options.length === 0) return null;
  const best = options.reduce((a, b) => (b.neighbors.length < a.neighbors.length ? b : a));
  return rects
    .map((r, i) => (best.neighbors.includes(i) ? withEdge(r, best.facing, best.target) : r))
    .filter((_, i) => i !== index);
}

/** Give every page at least one panel and every panel a rectangle (older projects have neither). */
export function normalizePagePanels(panels: Panel[]): void {
  if (panels.length === 0) {
    panels.push(createPanel());
    return;
  }
  const hasRect = (p: Partial<Rect>) =>
    [p.x, p.y, p.width, p.height].every((v) => typeof v === 'number');
  if (panels.every(hasRect)) return;

  const height = round(100 / panels.length);
  panels.forEach((panel, i) =>
    Object.assign(panel, { x: 0, y: round(i * height), width: 100, height })
  );
}
