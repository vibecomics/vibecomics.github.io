export type LayerKind = 'background' | 'foreground';
export type BubbleKind = 'speech' | 'thought' | 'shout' | 'caption';

export interface Layer {
  id: string;
  name: string;
  kind: LayerKind;
  /**
   * Id of the MediaItem this layer's artwork came from, absent while the layer has none yet: a
   * layer can start as just a prompt.
   */
  mediaId?: string;
  /**
   * Previous mediaIds, most-recent-first: kept so regenerating or picking a new image for this
   * layer never discards the old one. Pushed automatically whenever mediaId changes to something
   * different; restoring one (set it back as mediaId) removes it from here again.
   */
  mediaHistory?: string[];
  /** Id of the character or object this layer shows; the media picker lists that subject's art first. */
  subjectId?: string;
  /** Id of the scene a background layer is the setting of; the media picker lists that scene's art first. */
  sceneId?: string;
  /**
   * What this layer's art shows: its own part of the image prompt, or a plain
   * description. The page prompt, the panel prompt and the story bible supply
   * the rest of the prompt an image model is given.
   */
  prompt?: string;
  /**
   * Width / height of the layer's artwork. Shapes a layer that has no image
   * yet and tells whoever generates the art what proportions to use.
   */
  aspectRatio?: number;
  visible: boolean;
  /**
   * Position and width, as percentages of the panel size (height follows the
   * image's aspect ratio). Ignored for a background layer, which always fills
   * the panel.
   */
  x: number;
  y: number;
  width: number;
  rotation: number;
  opacity: number;
  /** Mirrors the layer's image left to right. Absent means not flipped. */
  flipX?: boolean;
  /**
   * True when the prompt (or, for a background, the linked scene; or, for a
   * foreground layer, the linked subject) has changed since this layer's
   * image was made, so the image no longer matches what the prompt asks for.
   * Set automatically: layers.add/update turn it on when the prompt (or
   * scene/subject) changes and off when the image does. Absent or false
   * means the image is up to date, including for a layer with no image yet.
   */
  dirty?: boolean;
}

export interface Bubble {
  id: string;
  kind: BubbleKind;
  text: string;
  /** Top-left corner, width and height, as percentages of the panel. The text is scaled to fit. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Where the pointer's tip aims, as percentages of the panel size. Captions have none. */
  tailX?: number;
  tailY?: number;
}

export interface Panel {
  id: string;
  title?: string;
  /**
   * The intent of the panel: what it shows and why (the moment, the camera, the
   * mood). An LLM stitches it, after the page prompt and before each layer's
   * prompt, into the prompt for the image of every layer in the panel.
   */
  prompt?: string;
  /**
   * Position and size as percentages of the page. Panels tile the page, so a
   * panel's aspect ratio follows from its rectangle and the page size.
   */
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Composited bottom-to-top in array order, so array order is the stacking
   * order. There is no separate background field: the background is the layer
   * whose `kind` is "background".
   */
  layers: Layer[];
  /** Always rendered above all layers. */
  bubbles: Bubble[];
}

export interface ComicPage {
  id: string;
  /** Zero-based page index, displayed as 0, 1, 2, ... */
  number: number;
  title: string;
  /**
   * The intent of the whole page: what happens on it, its mood and pacing. An
   * LLM stitches it, first, into the prompt for the image of every layer on the
   * page, followed by the panel prompt and the layer prompt.
   */
  prompt?: string;
  panels: Panel[];
}

/** One file in the project's media registry (lives in the project's storage folder). */
export interface MediaItem {
  id: string;
  name: string;
  /**
   * The stable, backend-portable name this image is stored under in the project's storage folder
   * (a file name like `ash-sword-reference.png`, unique in the folder), assigned once at upload and never
   * changed. Resolve it to bytes with media.download; it is not a URL.
   */
  fileName: string;
  /** e.g. "image/png" */
  mimeType: string;
  /**
   * The stable name of a small copy of the image (about 256px on its long side) that the UI shows
   * in lists and pickers instead of the full file. Absent when none was made.
   */
  thumbnailFileName?: string;
  /**
   * Id of the character or object this image is art of (not its reference art: that is the
   * entity's `imageIds`). The media picker lists a subject's art first.
   */
  subjectId?: string;
  /** Id of the scene this image is art of (a background), not its reference art. */
  sceneId?: string;
}

/** Shared shape of the story-bible entries: visual description plus reference art. */
export interface StoryEntry {
  id: string;
  name: string;
  /** Appearance and continuity notes an LLM reads to build image-generation prompts. */
  description: string;
  /** MediaItem ids of the reference art. */
  imageIds: string[];
}

export interface Character extends StoryEntry {
  /** Scenes this character appears in. */
  sceneIds: string[];
}

export interface ComicObject extends StoryEntry {
  /** Scenes where the object appears. */
  sceneIds: string[];
}

export interface Scene extends StoryEntry {
  /** Characters that appear in this scene. */
  characterIds: string[];
}

/** Physical page dimensions, chosen when the project is created. */
export interface PageSize {
  /** Preset label, e.g. 'US Comic (6.625" × 10.25")'. */
  label: string;
  widthIn: number;
  heightIn: number;
}

export interface ProjectMetadata {
  /** A short paragraph fixing the visual style (medium, line, palette, lighting, mood): stitched,
   * verbatim, into every image's prompt. Keep it to a few sentences; there is no synopsis field —
   * track story notes elsewhere, since stitching a whole synopsis into every prompt drowns it out. */
  style: string;
  pageSize: PageSize;
  characters: Character[];
  scenes: Scene[];
  objects: ComicObject[];
  media: MediaItem[];
}

export interface ComicProject {
  id: string;
  title: string;
  pages: ComicPage[];
  updatedAt: string;
  /** ISO timestamp of the last successful write to storage. */
  savedAt: string;
  metadata: ProjectMetadata;
}

export const PAGE_SIZE_PRESETS: PageSize[] = [
  { label: 'US Comic (6.625" × 10.25")', widthIn: 6.625, heightIn: 10.25 },
  { label: 'US Trade (6" × 9")', widthIn: 6, heightIn: 9 },
  { label: 'Manga B5 (6.93" × 9.84")', widthIn: 6.93, heightIn: 9.84 },
  { label: 'A4 (8.27" × 11.69")', widthIn: 8.27, heightIn: 11.69 },
  { label: 'Square (8" × 8")', widthIn: 8, heightIn: 8 },
  { label: 'Portrait 4:5 (8" × 10")', widthIn: 8, heightIn: 10 },
  { label: 'Landscape 16:9 (12" × 6.75")', widthIn: 12, heightIn: 6.75 },
];

export const DEFAULT_PAGE_SIZE: PageSize = PAGE_SIZE_PRESETS[0];

export function blankMetadata(pageSize: PageSize = DEFAULT_PAGE_SIZE): ProjectMetadata {
  return {
    style: '',
    pageSize: { ...pageSize },
    characters: [],
    scenes: [],
    objects: [],
    media: [],
  };
}

/** "Page 3 — Title", or just "Page 3" for an untitled page. */
export function formatPageLabel(page: ComicPage): string {
  return page.title ? `Page ${page.number} — ${page.title}` : `Page ${page.number}`;
}
