import type { MediaRemoval } from '../state/media';
import type { DeviceCodeInfo } from '../drive/deviceOAuth';
import type { ProjectFolder } from '../drive/driveRest';
import type { Bubble, ComicProject, Layer, MediaItem, PageSize } from '../types/comic';

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
  connectStorageWithDevice(): Promise<DeviceCodeInfo>;
  connectStorageWithServer(url: string): Promise<void>;
  disconnectStorage(): Promise<void>;
  getStorageStatus(): { connected: boolean; configured: boolean };
  listStorageProjects(): Promise<ProjectFolder[]>;
  createStorageProject(name: string, pageSize?: PageSize): Promise<ProjectFolder>;
  openStorageProject(folder: ProjectFolder): Promise<ActionResult>;
  /** Save unsaved changes, then close the project (it stays open if saving fails). */
  closeStorageProject(): Promise<void>;
  /** Refresh the tiles list and show the tiles screen (keeps the project open). */
  showProjectTiles(): Promise<ProjectFolder[]>;
  /** Save now if there are unsaved changes. */
  flushStorageSave(): Promise<ActionResult>;
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
}

/** Input for layers.add(). Geometry is in % of panel size; the image is a mediaId or a Drive URL src, or omitted for a layer that is only a prompt so far. */
export type LayerInput = Partial<Omit<Layer, 'id'>>;
/** Patch for layers.update(). Only the given fields change. */
export type LayerPatch = Partial<Omit<Layer, 'id'>>;
/** A LayerPatch as the API takes it: `subjectId` or `sceneId` set to null clears it. */
export type LayerUpdate = Omit<LayerPatch, 'subjectId' | 'sceneId'> & {
  subjectId?: string | null;
  sceneId?: string | null;
};
/** Input for bubbles.add(). Position and size are in % of panel size. */
export type BubbleInput = Partial<Omit<Bubble, 'id'>> & { text: string };
/** Patch for bubbles.update(). Only the given fields change. */
export type BubblePatch = Partial<Omit<Bubble, 'id'>>;

/** Input for characters/scenes/objects.create(). */
export interface StoryEntryInput {
  name: string;
  description?: string;
  /** MediaItem ids (reference art). */
  imageIds?: string[];
  /** Linked entry ids: sceneIds for characters/objects, characterIds for scenes. */
  linkIds?: string[];
}

/** Patch for characters/scenes/objects.update(). Only the given fields change. */
export type StoryEntryPatch = Partial<StoryEntryInput>;
