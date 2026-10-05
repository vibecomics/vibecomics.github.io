import type { ComicPage, Panel } from '../types/comic';

/** What is highlighted on the page: a panel, and optionally one layer or bubble inside it. */
export interface Selection {
  panelId: string | null;
  layerId?: string;
  bubbleId?: string;
}

/** The panel a stored selection highlights (a page's only panel always is), and the selection narrowed to what it holds. */
export function resolveSelection(
  page: ComicPage | undefined,
  selection: Selection
): { panel?: Panel; current: Selection } {
  const panels = page?.panels ?? [];
  const panel =
    panels.find((p) => p.id === selection.panelId) ?? (panels.length === 1 ? panels[0] : undefined);
  const current: Selection = {
    panelId: panel?.id ?? null,
    layerId: panel?.layers.some((l) => l.id === selection.layerId) ? selection.layerId : undefined,
    bubbleId: panel?.bubbles.some((b) => b.id === selection.bubbleId)
      ? selection.bubbleId
      : undefined,
  };
  return { panel, current };
}
