import { clamp } from '../utils/geometry';
import type { Rect } from '../state/layout';

/** How far the page is zoomed and panned, as a scale and a translate in the sheet's own pixels. */
export interface PageView {
  scale: number;
  tx: number;
  ty: number;
}

export const FIT_VIEW: PageView = { scale: 1, tx: 0, ty: 0 };
export const MIN_SCALE = 1;
export const MAX_SCALE = 4;
export const ZOOM_STEP = 0.5;
export const PANEL_ZOOM_SCALE = 2.5;

/** Keeps the scale within its limits and the pan from carrying the page off screen. */
export function clampView(view: PageView, width: number, height: number): PageView {
  const scale = clamp(view.scale, MIN_SCALE, MAX_SCALE);
  const maxX = ((scale - 1) * width) / 2;
  const maxY = ((scale - 1) * height) / 2;
  return { scale, tx: clamp(view.tx, -maxX, maxX), ty: clamp(view.ty, -maxY, maxY) };
}

/** The view that centers a rect (in the sheet's own percent coordinates) at a given zoom. */
export function viewForRect(r: Rect, scale: number, width: number, height: number): PageView {
  const dx = ((r.x + r.width / 2) / 100) * width - width / 2;
  const dy = ((r.y + r.height / 2) / 100) * height - height / 2;
  return clampView({ scale, tx: -scale * dx, ty: -scale * dy }, width, height);
}
