import type { Panel, PanelImage } from '../types/comic';
import { MEDIA_HISTORY_LIMIT } from './builders';

const round = (n: number) => Math.round(n * 100) / 100;

/** A small, stable, non-cryptographic string hash (FNV-1a), enough to tell two fingerprints apart. */
function hashString(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * A fingerprint of everything a panel image is made from: the panel prompt and, for each visible
 * layer in stacking order, its image, place, size, rotation, flip and opacity (a background fills
 * the panel, so its place and size are left out). Bubbles are not part of it: they draw above the
 * panel image. Hidden layers are left out, so showing or hiding one changes the fingerprint.
 */
export function panelCompositeBasis(panel: Panel): string {
  const layers = panel.layers
    .filter((layer) => layer.visible)
    .map((layer) =>
      [
        layer.id,
        layer.kind,
        layer.mediaId ?? '',
        layer.kind === 'background' ? '' : [layer.x, layer.y, layer.width].map(round).join(','),
        layer.kind === 'background' ? '' : round(layer.rotation),
        layer.flipX ? 'f' : '',
        round(layer.opacity),
        layer.kind === 'foreground' && layer.aspectRatio ? round(layer.aspectRatio) : '',
      ].join('|')
    );
  return hashString([panel.prompt?.trim() ?? '', ...layers].join('\n'));
}

/**
 * True when the panel has a panel image that no longer matches its layers or prompt, so it needs a
 * new one. False for a panel with no panel image: panel images are opt-in.
 */
export function isPanelImageDirty(panel: Panel): boolean {
  return panel.image !== undefined && panel.image.basis !== panelCompositeBasis(panel);
}

/**
 * The panel image after its image is swapped to `mediaId`: the old one (if any, and different) moves
 * to the front of mediaHistory (removed from there first, so restoring an old one never duplicates
 * it), the image becomes visible, and its fingerprint is taken from the panel as it is now.
 */
export function swapPanelImage(panel: Panel, mediaId: string): PanelImage {
  const current = panel.image;
  const history = (current?.mediaHistory ?? []).filter((id) => id !== mediaId);
  if (current && current.mediaId !== mediaId) history.unshift(current.mediaId);
  return {
    mediaId,
    ...(history.length > 0 && { mediaHistory: history.slice(0, MEDIA_HISTORY_LIMIT) }),
    visible: true,
    basis: panelCompositeBasis(panel),
  };
}
