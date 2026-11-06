import type { ComicProject, Layer, StoryEntry } from '../types/comic';
import { artSize, findPanel, requireProject } from './builders';
import type { ComicBuilderDeps } from './deps';
import { isPanelImageDirty } from './panelImage';
import {
  allEntryImageIds,
  buildPanelPromptParts,
  defaultReferenceNote,
  joinPromptParts,
  layerSubject,
} from './prompt';
import type { GenerationReference, PromptPart } from './prompt';

const round = (n: number) => Math.round(n * 10) / 10;

/** Where a layer sits in the panel, in numbers and in words. */
export interface PanelBriefPlacement {
  /** Left edge, top edge, width and height, as percentages of the panel (x and y are the top-left). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees, clockwise, about the layer's center. */
  rotation: number;
  /** True when the layer's image is mirrored left to right. */
  flipX: boolean;
  /** 0-1. */
  opacity: number;
  /** The same box in pixels of the panel image (see panel.size.pixels). */
  pixels: { x: number; y: number; width: number; height: number };
  /** Where the middle of the layer is, as percentages of the panel. */
  center: { x: number; y: number };
  /** The placement in plain words, e.g. "left third, lower half, about 30% of the panel width". */
  description: string;
}

export interface PanelBriefReference {
  /** 1-based, the number to use when telling the generator which image is which. */
  index: number;
  mediaId: string;
  /** "background" and "layer" are the art as placed in the panel; "subject" is a character's/object's/scene's own reference art. */
  role: 'background' | 'layer' | 'subject';
  layerId?: string;
  /** How the generator should use this image. */
  note?: string;
  /** Filled in with the image when images are included. */
  name?: string;
  mimeType?: string;
  /** The image as a data: URL (the API). The CLI saves it to a file and reports `file` instead. */
  dataUrl?: string;
  /** Absolute path of the saved image (set by the CLI). */
  file?: string;
}

export interface PanelBriefLayer {
  /** 1-based position from the bottom of the visible foreground layers: higher is in front. */
  order: number;
  layerId: string;
  name: string;
  subject?: { kind: 'character' | 'object'; id: string; name: string; description: string };
  variation?: { id: string; name: string; prompt: string };
  prompt?: string;
  mediaId?: string;
  hasImage: boolean;
  /** True when the layer's image is out of date with its prompt. */
  dirty: boolean;
  placement: PanelBriefPlacement;
}

export interface PanelBrief {
  version: 1;
  panel: {
    id: string;
    pageId: string;
    page: number;
    number: number;
    title?: string;
    size: ReturnType<typeof artSize>;
  };
  /** The comic's style paragraphs, for reference: the same text as the Style / style-addendum parts. */
  style: { style: string; characterStyle?: string; sceneStyle?: string };
  /** The parts to write the panel's prompt from, in order. Not stitched: see `instructions`. */
  promptParts: PromptPart[];
  background?: {
    layerId: string;
    name: string;
    scene?: { id: string; name: string; description: string };
    variation?: { id: string; name: string; prompt: string };
    prompt?: string;
    mediaId?: string;
    hasImage: boolean;
    dirty: boolean;
    /** A background always fills the whole panel. */
    fills: 'panel';
  };
  /** The visible foreground layers, back to front. */
  layers: PanelBriefLayer[];
  /** Layers left out of the brief, and why. */
  skipped: Array<{ layerId: string; name: string; reason: string }>;
  references: PanelBriefReference[];
  /** The panel's current panel image, if it has one. */
  currentImage?: { mediaId: string; visible: boolean; dirty: boolean };
  /** Things that make the result weaker. Never errors: a panel can be generated from a prompt alone. */
  warnings: string[];
  instructions: string;
}

/** "left third" / "center" / "right third", and likewise for the vertical middle. */
function describePlacement(p: Omit<PanelBriefPlacement, 'description'>): string {
  const horizontal =
    p.center.x < 100 / 3 ? 'left third' : p.center.x > 200 / 3 ? 'right third' : 'center';
  const vertical =
    p.center.y < 100 / 3 ? 'upper part' : p.center.y > 200 / 3 ? 'lower part' : 'middle';
  const words = [`${horizontal}, ${vertical}`, `about ${Math.round(p.width)}% of the panel width`];
  const tall = Math.round(p.height);
  if (tall >= 90) words.push('nearly the full height of the panel');
  else words.push(`about ${tall}% of the panel height`);
  const cropped = [
    p.x < -1 && 'left',
    p.x + p.width > 101 && 'right',
    p.y < -1 && 'top',
    p.y + p.height > 101 && 'bottom',
  ].filter(Boolean);
  if (cropped.length) words.push(`runs off the ${cropped.join(' and ')} edge of the panel`);
  if (p.rotation) words.push(`rotated ${round(p.rotation)} degrees`);
  if (p.flipX) words.push('mirrored left to right');
  if (p.opacity < 1) words.push(`${Math.round(p.opacity * 100)}% opaque`);
  return words.join(', ');
}

function placementOf(
  layer: Layer,
  panelAspect: number,
  pixels: { width: number; height: number }
): PanelBriefPlacement {
  // The layer's height follows its image's aspect ratio, so as a share of the panel's height it is
  // its width share, scaled by how wide the panel is compared with how tall.
  const height = (layer.width * panelAspect) / (layer.aspectRatio ?? 1);
  const base = {
    x: round(layer.x),
    y: round(layer.y),
    width: round(layer.width),
    height: round(height),
    rotation: layer.rotation,
    flipX: Boolean(layer.flipX),
    opacity: layer.opacity,
    pixels: {
      x: Math.round((layer.x / 100) * pixels.width),
      y: Math.round((layer.y / 100) * pixels.height),
      width: Math.round((layer.width / 100) * pixels.width),
      height: Math.round((height / 100) * pixels.height),
    },
    center: { x: round(layer.x + layer.width / 2), y: round(layer.y + height / 2) },
  };
  return { ...base, description: describePlacement(base) };
}

const INSTRUCTIONS =
  'Write ONE image prompt for this panel and generate the whole panel as a single image. ' +
  '1) Build the prompt from `promptParts`, in order: keep the Style and Technical requirements ' +
  'parts as written, then add what is in the panel: the setting (`background.scene`, ' +
  '`background.prompt`), then each entry of `layers` from back to front (first = furthest back): ' +
  'who or what it is (`subject.description`, `variation.prompt`, `prompt`) and where it goes, in ' +
  'the words of `placement.description` (use `placement.x/y/width/height`, percentages of the ' +
  'panel, when you need to be exact). A layer later in the list is in front of an earlier one. ' +
  'Do not invent a stitched prompt from anywhere else; do not draw speech bubbles or text. ' +
  '2) Give the generator the images in `references` in `index` order (or, if it takes fewer, the ' +
  "first ones), tell it which number is which using each `note`, and keep every character's and " +
  "object's design exactly as in its reference. Images with role background/layer are the art as " +
  'placed in the layout; role subject are the clean design references. ' +
  '3) Generate at the aspect ratio in `panel.size` (`panel.size.pixels` if it allows). ' +
  '4) Save it: `media upload <file> --thumbnail <thumbnail file>`, then `panels update <panel.id> --mediaId <media id>`. ' +
  '`warnings` are advice only: a panel with no background or no layers can still be generated from ' +
  'its prompt alone, layers and a background only make the result stronger.';

/** The reference-art image to send for a layer's subject or scene: its pinned variation's first image, else the entry's first. */
function subjectReferenceId(entry: StoryEntry, variationId?: string): string | undefined {
  const variation = variationId ? entry.variations.find((v) => v.id === variationId) : undefined;
  return variation?.imageIds[0] ?? entry.imageIds[0] ?? allEntryImageIds(entry)[0];
}

/**
 * The panel brief, without any image data: the parts to write the prompt from, every visible layer
 * with its place in the panel, the numbered reference images (ids only), and warnings. See
 * generate.inspect("panel:<panelId>") for the version that also fetches the images.
 */
export function buildPanelBrief(project: ComicProject, panelId: string): PanelBrief {
  const panel = findPanel(project, panelId);
  if (!panel) throw new Error(`Panel "${panelId}" not found.`);
  const pageIndex = project.pages.findIndex((page) => page.panels.some((p) => p.id === panelId));
  const page = project.pages[pageIndex];
  const { widthIn, heightIn } = project.metadata.pageSize;
  const panelWidthIn = (widthIn * panel.width) / 100;
  const panelHeightIn = (heightIn * panel.height) / 100;
  const size = artSize(panelWidthIn, panelHeightIn);
  const panelAspect = panelWidthIn / panelHeightIn;
  const mediaIds = new Set(project.metadata.media.map((m) => m.id));
  const hasMedia = (id?: string): id is string => Boolean(id) && mediaIds.has(id as string);

  const warnings: string[] = [];
  const skipped: PanelBrief['skipped'] = [];
  const references: PanelBriefReference[] = [];
  const addReference = (ref: Omit<PanelBriefReference, 'index'>) => {
    if (references.some((r) => r.mediaId === ref.mediaId)) return;
    references.push({ index: references.length + 1, ...ref });
  };

  const entryOf = (layer: Layer) => layerSubject(project, layer);
  const variationOf = (layer: Layer, entry: StoryEntry | undefined) => {
    const v = entry?.variations.find((x) => x.id === layer.variationId);
    return v ? { id: v.id, name: v.name, prompt: v.prompt } : undefined;
  };
  const layerLabel = (layer: Layer) => `"${layer.name || layer.id}"`;

  // ---- background -------------------------------------------------------------------
  const backgroundLayer = panel.layers.find((l) => l.kind === 'background' && l.visible);
  for (const layer of panel.layers.filter((l) => l.kind === 'background' && !l.visible)) {
    skipped.push({ layerId: layer.id, name: layer.name, reason: 'hidden' });
  }
  let background: PanelBrief['background'];
  if (backgroundLayer) {
    const scene = entryOf(backgroundLayer);
    background = {
      layerId: backgroundLayer.id,
      name: backgroundLayer.name,
      ...(scene && { scene: { id: scene.id, name: scene.name, description: scene.description } }),
      ...(variationOf(backgroundLayer, scene) && {
        variation: variationOf(backgroundLayer, scene),
      }),
      ...(backgroundLayer.prompt && { prompt: backgroundLayer.prompt }),
      ...(hasMedia(backgroundLayer.mediaId) && { mediaId: backgroundLayer.mediaId }),
      hasImage: hasMedia(backgroundLayer.mediaId),
      dirty: Boolean(backgroundLayer.dirty),
      fills: 'panel',
    };
    if (hasMedia(backgroundLayer.mediaId)) {
      addReference({
        mediaId: backgroundLayer.mediaId,
        role: 'background',
        layerId: backgroundLayer.id,
        note: 'The background of this panel as placed: it fills the whole panel. Keep the setting, composition and lighting direction.',
      });
    } else {
      warnings.push(
        `The background ${layerLabel(backgroundLayer)} has no image yet; describe it from its scene and prompt.`
      );
    }
    if (backgroundLayer.dirty) {
      warnings.push(
        `The background ${layerLabel(backgroundLayer)} image is out of date with its prompt.`
      );
    }
  } else {
    warnings.push(
      'This panel has no background layer. The panel can still be generated from its prompt alone; a background (scene) makes the setting stronger and more consistent.'
    );
  }

  // ---- foreground layers ------------------------------------------------------------
  const foreground = panel.layers.filter((l) => l.kind === 'foreground');
  for (const layer of foreground.filter((l) => !l.visible)) {
    skipped.push({ layerId: layer.id, name: layer.name, reason: 'hidden' });
  }
  const layers: PanelBriefLayer[] = foreground
    .filter((l) => l.visible)
    .map((layer, i) => {
      const entry = entryOf(layer);
      const kind = project.metadata.objects.some((o) => o.id === entry?.id)
        ? 'object'
        : 'character';
      const hasImage = hasMedia(layer.mediaId);
      if (!hasImage) {
        warnings.push(
          `The layer ${layerLabel(layer)} has no image yet; describe it from its subject and prompt.`
        );
      }
      if (layer.dirty) {
        warnings.push(`The layer ${layerLabel(layer)} image is out of date with its prompt.`);
      }
      return {
        order: i + 1,
        layerId: layer.id,
        name: layer.name,
        ...(entry && {
          subject: { kind, id: entry.id, name: entry.name, description: entry.description },
        }),
        ...(variationOf(layer, entry) && { variation: variationOf(layer, entry) }),
        ...(layer.prompt && { prompt: layer.prompt }),
        ...(hasImage && { mediaId: layer.mediaId }),
        hasImage,
        dirty: Boolean(layer.dirty),
        placement: placementOf(layer, panelAspect, size.pixels),
      };
    });
  if (layers.length === 0) {
    warnings.push(
      'This panel has no visible foreground layers. The panel can still be generated from its prompt alone; layers (characters, props) with places make the result stronger.'
    );
  }

  // The art as placed, back to front, then each subject's clean design reference.
  for (const layer of foreground.filter((l) => l.visible && hasMedia(l.mediaId))) {
    addReference({
      mediaId: layer.mediaId as string,
      role: 'layer',
      layerId: layer.id,
      note: `${layer.name || 'This layer'}, as placed in the layout (see its placement). Keep its design and pose.`,
    });
  }
  for (const layer of foreground.filter((l) => l.visible)) {
    const entry = entryOf(layer);
    const id = entry && subjectReferenceId(entry, layer.variationId);
    if (entry && hasMedia(id)) {
      addReference({
        mediaId: id,
        role: 'subject',
        layerId: layer.id,
        note: defaultReferenceNote(project, id, undefined),
      });
    }
  }
  const sceneEntry = backgroundLayer && entryOf(backgroundLayer);
  const sceneRef = sceneEntry && subjectReferenceId(sceneEntry, backgroundLayer?.variationId);
  if (sceneEntry && hasMedia(sceneRef)) {
    addReference({
      mediaId: sceneRef,
      role: 'subject',
      layerId: backgroundLayer?.id,
      note: defaultReferenceNote(project, sceneRef, undefined),
    });
  }

  if (!backgroundLayer && layers.length === 0 && !panel.prompt?.trim()) {
    warnings.push(
      'There is nothing to describe this panel from: no panel prompt, no background and no layers. Add a prompt (panels update) or some layers first.'
    );
  }

  return {
    version: 1,
    panel: {
      id: panel.id,
      pageId: page.id,
      page: page.number,
      number: page.panels.findIndex((p) => p.id === panelId) + 1,
      ...(panel.title && { title: panel.title }),
      size,
    },
    style: {
      style: project.metadata.style,
      ...(project.metadata.characterStyle && { characterStyle: project.metadata.characterStyle }),
      ...(project.metadata.sceneStyle && { sceneStyle: project.metadata.sceneStyle }),
    },
    promptParts: buildPanelPromptParts(project, panelId),
    ...(background && { background }),
    layers,
    skipped,
    references,
    ...(panel.image && {
      currentImage: {
        mediaId: panel.image.mediaId,
        visible: panel.image.visible,
        dirty: isPanelImageDirty(panel),
      },
    }),
    warnings,
    instructions: INSTRUCTIONS,
  };
}

/**
 * The panel brief (see buildPanelBrief), with every reference image downloaded and attached as a
 * data: URL unless `includeImages` is false. An image that cannot be fetched is kept in the list
 * (so the numbering holds) and reported in `warnings`.
 */
export async function panelBrief(
  deps: ComicBuilderDeps,
  panelId: string,
  includeImages = true
): Promise<PanelBrief> {
  const brief = buildPanelBrief(requireProject(deps), panelId);
  if (!includeImages) return brief;
  await Promise.all(
    brief.references.map(async (ref) => {
      try {
        const { name, mimeType, dataUrl } = await deps.downloadStorageMedia(ref.mediaId);
        Object.assign(ref, { name, mimeType, dataUrl });
      } catch (e) {
        brief.warnings.push(
          `Reference image ${ref.index} (${ref.mediaId}) could not be fetched: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    })
  );
  return brief;
}

/**
 * The panel image's prompt, auto-stitched from its brief into the labeled parts the UI's Generate
 * dialog shows and lets you edit or drop (see GenerateImageModal): Style, the style addenda, the
 * setting, each visible layer back to front with its place in the panel, the panel's own prompt,
 * then technical requirements. This is a mechanical version of what buildPanelBrief's own
 * `instructions` ask an LLM agent to write by hand — good enough for a one-click Generate button;
 * every part stays editable before sending either way.
 */
export function buildPanelImagePromptParts(project: ComicProject, panelId: string): PromptPart[] {
  const brief = buildPanelBrief(project, panelId);
  const parts: PromptPart[] = [{ label: 'Style', text: brief.style.style }];
  if (brief.style.characterStyle) {
    parts.push({ label: 'Character style', text: brief.style.characterStyle });
  }
  if (brief.style.sceneStyle) parts.push({ label: 'Scene style', text: brief.style.sceneStyle });

  if (brief.background) {
    const bg = brief.background;
    const text = [
      bg.scene && `${bg.scene.name}: ${bg.scene.description}`,
      bg.variation?.prompt,
      bg.prompt,
    ]
      .filter(Boolean)
      .join(' ');
    if (text) {
      parts.push({
        label: 'Setting',
        text: `${text} Fills the whole panel; keep it exactly as placed.`,
      });
    }
  }

  for (const layer of brief.layers) {
    const text = [
      layer.subject && `${layer.subject.name}: ${layer.subject.description}`,
      layer.variation?.prompt,
      layer.prompt,
    ]
      .filter(Boolean)
      .join(' ');
    if (text) {
      parts.push({
        label: layer.name || `Layer ${layer.order}`,
        text: `${text} Placed ${layer.placement.description}.`,
      });
    }
  }

  const panelPrompt = brief.promptParts.find((p) => p.label === 'Panel prompt');
  if (panelPrompt) parts.push(panelPrompt);
  const technical = brief.promptParts.find((p) => p.label === 'Technical requirements');
  if (technical) parts.push(technical);
  return parts;
}

/** Stitches buildPanelImagePromptParts into one prompt string (see buildLayerPrompt). */
export function buildPanelImagePrompt(project: ComicProject, panelId: string): string {
  return joinPromptParts(buildPanelImagePromptParts(project, panelId));
}

/**
 * The reference images a panel image's generation sends by default: the same ordered,
 * deduplicated list buildPanelBrief computes for the agent brief (the background and each visible
 * layer as placed, then each subject's/scene's own clean reference art) — see buildPanelBrief's
 * `references`. The generator caps how many it actually uses; this returns them all, in priority
 * order, same as defaultLayerReferences.
 */
export function defaultPanelReferences(
  project: ComicProject,
  panelId: string
): GenerationReference[] {
  return buildPanelBrief(project, panelId).references.map((r) =>
    r.note ? { mediaId: r.mediaId, note: r.note } : { mediaId: r.mediaId }
  );
}
