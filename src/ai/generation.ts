/**
 * Orchestrates image generation for a layer, the whole project's dirty layers, or a story-bible
 * entry's reference art: stitches the prompt, gathers reference images, calls the configured
 * ImageProvider, and uploads the result. Knows nothing about any specific provider (see ../generators).
 * Every generation call is serialized through one labeled queue (see enqueue/getQueue), so only one
 * request runs at a time and its progress is visible regardless of which entry point started it.
 *
 * A single layer or reference-image generation only registers the result (like media.upload) — it
 * does not set it as the layer's image or add it to a story-bible entry's imageIds. The caller
 * previews it and commits with layers.update(..., { mediaId }) or characters.update(..., { imageIds }).
 * The dirty-batch path is the exception: it has no one to show a preview to, so it commits each result
 * itself as it goes.
 */
import { createProvider } from '../generators/types';
import type { ImageProvider } from '../generators/types';
import type { ComicProject, Layer, MediaItem } from '../types/comic';
import { errorMessage } from '../utils/errors';
import { pngDimensions } from '../utils/image';
import { dirtyLayerRefs, findPanel, layerArtSize, requireProject } from './builders';
import type { LayerRef } from './builders';
import type { ComicBuilderDeps } from './deps';
import {
  appendReferenceNotes,
  buildLayerPrompt,
  buildReferencePrompt,
  defaultReferenceNote,
  layerSubject,
} from './prompt';
import type { GenerationReference, ReferenceKind } from './prompt';

export type { GenerationReference, ReferenceKind };

export interface GenerationOutcome extends LayerRef {
  ok: boolean;
  error?: string;
}

/** A freshly generated, registered image: usable directly as a MediaItem to preview. */
export interface GeneratedImage extends MediaItem {
  aspectRatio?: number;
}

type CommitLayerImage = (
  panelId: string,
  layerId: string,
  mediaId: string,
  aspectRatio?: number
) => Layer;

/** Whether a layer's or entry's generation request is waiting its turn behind another one, or
 * actively running right now. Undefined means neither: nothing outstanding for it. */
export type GenerationStatus = 'queued' | 'running' | undefined;

// Which layer or story-bible entry has a generation queued or running, so any component showing it
// can reflect that, even one that mounted after the request started (see useGenerationStatus). A key
// is set the instant its request is made (queued, before the shared queue reaches its turn — see
// trackedGeneration) and cleared only once that request finishes, whether it errored or not.
const statusByKey = new Map<string, 'queued' | 'running'>();
const generatingListeners = new Set<() => void>();
const layerKey = (panelId: string, layerId: string) => `layer:${panelId}:${layerId}`;
const referenceKey = (kind: ReferenceKind, id: string) => `ref:${kind}:${id}`;

export function layerGenerationStatus(panelId: string, layerId: string): GenerationStatus {
  return statusByKey.get(layerKey(panelId, layerId));
}

export function referenceGenerationStatus(kind: ReferenceKind, id: string): GenerationStatus {
  return statusByKey.get(referenceKey(kind, id));
}

export function subscribeGenerating(listener: () => void): () => void {
  generatingListeners.add(listener);
  return () => generatingListeners.delete(listener);
}

function setGenerationStatus(key: string, status: 'queued' | 'running' | undefined): void {
  if (status) statusByKey.set(key, status);
  else statusByKey.delete(key);
  generatingListeners.forEach((listener) => listener());
}

/** One request in the generation queue: what it's for, and whether it's running yet or still waiting. */
export interface QueueItem {
  id: string;
  label: string;
  status: 'queued' | 'running';
}

let nextQueueItemId = 1;
let queueItems: QueueItem[] = [];
const queueListeners = new Set<() => void>();

/** The generation queue right now: running (if any) first, then queued, in the order they'll run. */
export function getQueue(): QueueItem[] {
  return queueItems;
}

export function subscribeQueue(listener: () => void): () => void {
  queueListeners.add(listener);
  return () => queueListeners.delete(listener);
}

function notifyQueue(): void {
  queueListeners.forEach((listener) => listener());
}

// One request at a time, even across overlapping layer()/dirty()/reference-image calls. Items are
// tracked and removed by their stable string id (not object identity, which changes on each status
// update) so a finished item is reliably taken out of the queue.
let queueTail: Promise<unknown> = Promise.resolve();
function enqueue<T>(label: string, task: () => Promise<T>): Promise<T> {
  const id = String(nextQueueItemId++);
  queueItems = [...queueItems, { id, label, status: 'queued' }];
  notifyQueue();

  const runTask = async (): Promise<T> => {
    queueItems = queueItems.map((i) => (i.id === id ? { ...i, status: 'running' } : i));
    notifyQueue();
    try {
      return await task();
    } finally {
      queueItems = queueItems.filter((i) => i.id !== id);
      notifyQueue();
    }
  };
  const run = queueTail.then(runTask, runTask);
  queueTail = run.catch(() => undefined);
  return run;
}

function requireProvider(deps: ComicBuilderDeps): ImageProvider {
  const config = deps.getGeneratorConfig();
  if (!config) throw new Error('No image generator is configured. Set one up first.');
  return createProvider(config, deps.generatorFetch);
}

async function downloadReferences(
  deps: ComicBuilderDeps,
  references: GenerationReference[]
): Promise<string[]> {
  return Promise.all(
    references.map(async (r) => (await deps.downloadStorageMedia(r.mediaId)).dataUrl)
  );
}

/** Runs a generation in the queue, marking `key` as queued the instant it's requested and running
 * once its turn comes, so a button for it can tell "waiting" from "actively generating". */
function trackedGeneration<T>(key: string, label: string, task: () => Promise<T>): Promise<T> {
  setGenerationStatus(key, 'queued');
  return enqueue(label, async () => {
    setGenerationStatus(key, 'running');
    try {
      return await task();
    } finally {
      setGenerationStatus(key, undefined);
    }
  });
}

/** Generates and registers an image for a layer (or background), without setting it as the layer's
 * image. */
async function runLayerGeneration(
  deps: ComicBuilderDeps,
  panelId: string,
  layerId: string,
  promptOverride?: string,
  references?: GenerationReference[]
): Promise<GeneratedImage> {
  const provider = requireProvider(deps);
  const project = requireProject(deps);
  const layer = findPanel(project, panelId)?.layers.find((l) => l.id === layerId);
  if (!layer) throw new Error(`Layer "${layerId}" not found.`);

  const used = (references ?? defaultLayerReferences(deps, panelId, layerId)).slice(
    0,
    provider.maxReferenceImages
  );
  const prompt = appendReferenceNotes(
    promptOverride?.trim() || buildLayerPrompt(project, panelId, layerId),
    used
  );
  const referenceImages = await downloadReferences(deps, used);
  // A background must exactly fill its panel, so it's sized to fit precisely. A foreground subject
  // doesn't need to fill its box tightly (it's a transparent cutout; empty margin is fine), so it's
  // left to the workflow's own default canvas rather than squeezed into whatever shape the layer
  // currently happens to have — the layer's aspect ratio is set from the actual result instead.
  const size = layer.kind === 'background' ? layerArtSize(project, panelId, layerId) : null;
  const rawDataUrl = await provider.generate({
    prompt,
    referenceImages,
    width: size?.pixels.width,
    height: size?.pixels.height,
  });
  // Generators draw the subject on a plain white background rather than real transparency (see the
  // technical requirements line in buildLayerPrompt); cut that background out here, in the browser.
  const dataUrl =
    layer.kind === 'foreground' && deps.removeBackground
      ? await deps.removeBackground(rawDataUrl)
      : rawDataUrl;
  const media = await deps.uploadStorageMedia(
    `${layer.name || 'layer'}.png`,
    dataUrl,
    'image/png',
    undefined,
    {
      subjectId: layer.subjectId,
      sceneId: layer.sceneId,
    }
  );
  const dims = pngDimensions(dataUrl);
  return { ...media, aspectRatio: dims ? dims.width / dims.height : undefined };
}

async function generateReferenceOne(
  deps: ComicBuilderDeps,
  kind: ReferenceKind,
  id: string,
  promptOverride?: string,
  references?: GenerationReference[]
): Promise<MediaItem> {
  const provider = requireProvider(deps);
  const project = requireProject(deps);
  const entry = project.metadata[kind].find((e) => e.id === id);
  if (!entry) throw new Error(`"${id}" not found in ${kind}.`);

  const used = (references ?? defaultEntryReferences(deps, kind, id)).slice(
    0,
    provider.maxReferenceImages
  );
  const prompt = appendReferenceNotes(
    promptOverride?.trim() || buildReferencePrompt(project, kind, id),
    used
  );
  const referenceImages = await downloadReferences(deps, used);
  const rawDataUrl = await provider.generate({ prompt, referenceImages });
  const dataUrl =
    kind !== 'scenes' && deps.removeBackground
      ? await deps.removeBackground(rawDataUrl)
      : rawDataUrl;
  return deps.uploadStorageMedia(`${entry.name} reference.png`, dataUrl, 'image/png');
}

/** Generates and registers a new image for a layer (or background); does not set it as the layer's
 * image (see the module doc) — commit it yourself with layers.update(..., { mediaId, aspectRatio }). */
export function generateLayerImage(
  deps: ComicBuilderDeps,
  panelId: string,
  layerId: string,
  prompt?: string,
  references?: GenerationReference[]
): Promise<GeneratedImage> {
  return trackedGeneration(layerKey(panelId, layerId), describeLayer(deps, panelId, layerId), () =>
    runLayerGeneration(deps, panelId, layerId, prompt, references)
  );
}

export function generateReferenceImage(
  deps: ComicBuilderDeps,
  kind: ReferenceKind,
  id: string,
  prompt?: string,
  references?: GenerationReference[]
): Promise<MediaItem> {
  return trackedGeneration(referenceKey(kind, id), describeReference(deps, kind, id), () =>
    generateReferenceOne(deps, kind, id, prompt, references)
  );
}

/** A reference to `mediaId`, with a ready-made note when it's known art of a character, object or
 * scene (see defaultReferenceNote). */
function referenceTo(project: ComicProject, mediaId: string): GenerationReference {
  const note = defaultReferenceNote(project, mediaId);
  return note ? { mediaId, note } : { mediaId };
}

/** The images a layer's generation sends by default: those of the character/object (foreground) or
 * scene (background) it shows. */
export function defaultLayerReferences(
  deps: ComicBuilderDeps,
  panelId: string,
  layerId: string
): GenerationReference[] {
  const project = requireProject(deps);
  const layer = findPanel(project, panelId)?.layers.find((l) => l.id === layerId);
  if (!layer) throw new Error(`Layer "${layerId}" not found.`);
  return (layerSubject(project, layer)?.imageIds ?? []).map((mediaId) =>
    referenceTo(project, mediaId)
  );
}

/** The images a story-bible entry's reference generation sends by default: its existing ones. */
export function defaultEntryReferences(
  deps: ComicBuilderDeps,
  kind: ReferenceKind,
  id: string
): GenerationReference[] {
  const project = requireProject(deps);
  const entry = project.metadata[kind].find((e) => e.id === id);
  return (entry?.imageIds ?? []).map((mediaId) => referenceTo(project, mediaId));
}

/** How many reference images the configured generator uses (0 when none is configured). */
export function maxReferenceImages(deps: ComicBuilderDeps): number {
  const config = deps.getGeneratorConfig();
  return config ? createProvider(config, deps.generatorFetch).maxReferenceImages : 0;
}

function describeLayer(deps: ComicBuilderDeps, panelId: string, layerId: string): string {
  try {
    const layer = findPanel(requireProject(deps), panelId)?.layers.find((l) => l.id === layerId);
    return `Layer: ${layer?.name || layerId}`;
  } catch {
    return `Layer: ${layerId}`;
  }
}

function describeReference(deps: ComicBuilderDeps, kind: ReferenceKind, id: string): string {
  try {
    const entry = requireProject(deps).metadata[kind].find((e) => e.id === id);
    return `Reference: ${entry?.name || id}`;
  } catch {
    return `Reference: ${id}`;
  }
}

export async function generateAllDirty(
  deps: ComicBuilderDeps,
  commit: CommitLayerImage
): Promise<GenerationOutcome[]> {
  const refs = dirtyLayerRefs(requireProject(deps));
  const outcomes: GenerationOutcome[] = [];
  for (const ref of refs) {
    deps.setStatus(`Generating image ${outcomes.length + 1} of ${refs.length}…`);
    const key = layerKey(ref.panelId, ref.layerId);
    const label = describeLayer(deps, ref.panelId, ref.layerId);
    try {
      await trackedGeneration(key, label, async () => {
        const image = await runLayerGeneration(deps, ref.panelId, ref.layerId);
        commit(ref.panelId, ref.layerId, image.id, image.aspectRatio);
      });
      outcomes.push({ ...ref, ok: true });
    } catch (e) {
      outcomes.push({ ...ref, ok: false, error: errorMessage(e) });
    }
  }
  const failed = outcomes.filter((o) => !o.ok).length;
  deps.setStatus(
    failed
      ? `Generated ${outcomes.length - failed} of ${outcomes.length}; ${failed} failed.`
      : `Generated ${outcomes.length} image${outcomes.length === 1 ? '' : 's'}.`
  );
  return outcomes;
}
