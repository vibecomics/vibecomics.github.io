import type { MediaRemoval } from '../state/media';
import type { DeviceCodeInfo } from '../drive/deviceOAuth';
import type { StorageConnectionInfo } from '../storage/connections';
import type { ProjectFolder } from '../storage/types';
import type { GeneratorConfig } from '../generators/types';
import type { Bubble, ComicProject, Layer, MediaItem, PageSize, Variation } from '../types/comic';

/** Result of an action that can fail. */
export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Live bindings supplied by App (state lives in React; the API drives it). */
export interface ComicBuilderDeps {
  getProject(): ComicProject | null;
  /** Run a mutator against a clone of the open project; throws when none is open. */
  updateProject(mut: (p: ComicProject) => void): void;
  /** Replace the whole project (already validated). */
  replaceProject(p: ComicProject): void;
  getPageIndex(): number;
  setPageIndex(i: number): void;
  setPreview(open: boolean): void;
  setStatus(msg: string): void;
  /** Connect Google Drive as an additional connection (it does not replace any other). */
  connectStorageWithDevice(): Promise<DeviceCodeInfo>;
  /** Connect an HTTP storage server as an additional connection; several can be connected at once. */
  connectStorageWithServer(url: string): Promise<void>;
  /** Disconnect every live connection (the browser) or log out of Drive (the CLI). */
  disconnectStorage(): Promise<void>;
  /** `connected` is true when at least one connection is live. */
  getStorageStatus(): { connected: boolean; configured: boolean };
  /** Every connection currently live (both the browser and the CLI can have several at once). */
  listStorageConnections?(): Promise<StorageConnectionInfo[]>;
  /** Disconnect one connection by id (see listStorageConnections). */
  disconnectStorageConnection?(id: string): Promise<void>;
  listStorageProjects(): Promise<ProjectFolder[]>;
  /** `connectionId` picks which connection to create it in; required when more than one is live. */
  createStorageProject(
    name: string,
    pageSize?: PageSize,
    connectionId?: string
  ): Promise<ProjectFolder>;
  openStorageProject(folder: ProjectFolder): Promise<ActionResult>;
  /** Save unsaved changes, then close the project (it stays open if saving fails). */
  closeStorageProject(): Promise<void>;
  /** Refresh the tiles list and show the tiles screen (keeps the project open). */
  showProjectTiles(): Promise<ProjectFolder[]>;
  /** Save now if there are unsaved changes. */
  flushStorageSave(): Promise<ActionResult>;
  /** Copy the open project (and its media) to another connection, overwriting a same-named folder there. */
  backupTo?(connectionId: string): Promise<ActionResult>;
  uploadStorageMedia(
    name: string,
    dataUrl: string,
    mimeType: string,
    thumbnailDataUrl?: string,
    links?: { subjectId?: string; sceneId?: string }
  ): Promise<MediaItem>;
  /** Store (or replace) the thumbnail of a registered image. */
  uploadStorageThumbnail(id: string, dataUrl: string): Promise<MediaItem>;
  /** Trash a registered image on Drive and remove it from the project and everything using it. */
  deleteStorageMedia(id: string): Promise<MediaRemoval>;
  /** Fetch a registered image's bytes from Drive as a data URL. */
  downloadStorageMedia(id: string): Promise<{ name: string; mimeType: string; dataUrl: string }>;
  /** The image generator config: per-machine, not part of the project. */
  getGeneratorConfig(): GeneratorConfig | null;
  setGeneratorConfig(config: GeneratorConfig | null): void;
  /** Network fetch for the configured image generator. Defaults to the global fetch. */
  generatorFetch?: typeof fetch;
  /** Best-effort background removal for a generated foreground image; absent in the CLI (no canvas), same as thumbnail generation. */
  removeBackground?: (dataUrl: string) => Promise<string>;
}

/** Input for layers.add(). Geometry is in % of panel size; the image is a mediaId, or omitted for a layer that is only a prompt so far. */
export type LayerInput = Partial<Omit<Layer, 'id'>>;
/** Patch for layers.update(). Only the given fields change. */
export type LayerPatch = Partial<Omit<Layer, 'id'>>;
/** A LayerPatch as the API takes it: `subjectId`, `sceneId` or `variationId` set to null clears it.
 * `mediaId` set to null unlinks the layer's current image — it's no longer this layer's in any way,
 * not even its history — without touching the project's media registry, unlike media.delete, which
 * removes the image everywhere it's used. */
export type LayerUpdate = Omit<LayerPatch, 'subjectId' | 'sceneId' | 'variationId' | 'mediaId'> & {
  subjectId?: string | null;
  sceneId?: string | null;
  variationId?: string | null;
  mediaId?: string | null;
};
/** Input for bubbles.add(). Position and size are in % of panel size. */
export type BubbleInput = Partial<Omit<Bubble, 'id'>> & { text: string };
/** Patch for bubbles.update(). Only the given fields change. */
export type BubblePatch = Partial<Omit<Bubble, 'id'>>;

/** Input for characters/scenes/objects.create(). */
export interface StoryEntryInput {
  name: string;
  description?: string;
  /** MediaItem ids (reference art not tied to any particular variation). */
  imageIds?: string[];
  /** Linked entry ids: sceneIds for characters/objects, characterIds for scenes. */
  linkIds?: string[];
  /** Poses/states (see Variation). Full replace, not appended to; a character defaults to Front/Back/
   * Side view when left out, objects and scenes default to none. Any item missing an `id` gets one
   * generated. */
  variations?: Variation[];
}

/** Patch for characters/scenes/objects.update(). Only the given fields change. */
export type StoryEntryPatch = Partial<StoryEntryInput>;

/** Input for variations.add(). */
export interface VariationInput {
  name: string;
  /** This variation's own part of the image prompt, stitched in after the entry's description. */
  prompt?: string;
  /** MediaItem ids of this variation's reference art. */
  imageIds?: string[];
  /** Set automatically (true when there's a prompt and no image yet) unless given explicitly. */
  dirty?: boolean;
}

/** Patch for variations.update(). Only the given fields change; imageIds replaces the list. */
export type VariationPatch = Partial<VariationInput>;
