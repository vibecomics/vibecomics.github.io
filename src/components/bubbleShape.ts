import type { Point } from '../utils/geometry';

interface Box extends Point {
  width: number;
  height: number;
}

interface PointerShape {
  /** Where the pointer leaves the bubble. */
  edge: Point;
  tip: Point;
  /** The two corners of the wedge where it meets the bubble: pushed a little inside the edge, so the wedge overlaps the bubble's body. */
  joint: [Point, Point];
  /** Unit vector from the bubble's centre toward the tip. */
  direction: Point;
  /** Distance from the edge to the tip. */
  length: number;
}

const BURST_SPIKES = 14;
/** Radii of a shout's burst as shares of half the bubble's size: spike tips, and the notches between them. */
const BURST_OUTER = 0.98;
const BURST_INNER = 0.78;

/** The corners of a shout bubble's burst, in a 100 × 100 box that is stretched to the bubble. */
export function burstPoints(): Point[] {
  return Array.from({ length: BURST_SPIKES * 2 }, (_, i) => {
    const angle = (i * Math.PI) / BURST_SPIKES - Math.PI / 2;
    const radius = 50 * (i % 2 ? BURST_INNER : BURST_OUTER);
    return { x: 50 + radius * Math.cos(angle), y: 50 + radius * Math.sin(angle) };
  });
}

/**
 * The geometry of a bubble's pointer, in pixels: a wedge from the point where
 * the line from the bubble's centre to `tip` crosses its edge (the box's, or
 * for a burst the ellipse through its notches). Null when the tip lies inside
 * the bubble.
 */
export function pointerShape(box: Box, tip: Point, burst = false): PointerShape | null {
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const dx = tip.x - centre.x;
  const dy = tip.y - centre.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return null;

  const direction = { x: dx / distance, y: dy / distance };
  const reach = burst
    ? BURST_INNER / Math.hypot(direction.x / (box.width / 2), direction.y / (box.height / 2))
    : Math.min(
        direction.x ? box.width / 2 / Math.abs(direction.x) : Infinity,
        direction.y ? box.height / 2 / Math.abs(direction.y) : Infinity
      );
  if (reach >= distance) return null;

  const edge = { x: centre.x + direction.x * reach, y: centre.y + direction.y * reach };
  const half = Math.min(16, Math.max(4, Math.min(box.width, box.height) * 0.16));
  const normal = { x: -direction.y, y: direction.x };
  const shifted = (from: Point, along: number, across: number): Point => ({
    x: from.x + direction.x * along + normal.x * across,
    y: from.y + direction.y * along + normal.y * across,
  });

  return {
    edge,
    tip,
    joint: [shifted(edge, -4, half), shifted(edge, -4, -half)],
    direction,
    length: distance - reach,
  };
}
