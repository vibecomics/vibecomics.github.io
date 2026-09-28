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
import type { Layer, MediaItem } from '../types/comic';
import { errorMessage } from '../utils/errors';
import { pngDimensions } from '../utils/image';
import { dirtyLayerRefs, findPanel, layerArtSize, requireProject } from './builders';
import type { LayerRef } from './builders';
import type { ComicBuilderDeps } from './deps';
import { appendReferenceNotes, buildLayerPrompt, buildReferencePrompt } from './prompt';
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

// Which layer or story-bible entry is currently generating, so any component showing it can reflect
// that, even one that mounted after the request started (see useIsGenerating).
const inProgress = new Set<string>();
const generatingListeners = new Set<() => void>();
const layerKey = (panelId: string, layerId: string) => `layer:${panelId}:${layerId}`;
const referenceKey = (kind: ReferenceKind, id: string) => `ref:${kind}:${id}`;

export function isGeneratingLayer(panelId: string, layerId: string): boolean {
  return inProgress.has(layerKey(panelId, layerId));
}

export function isGeneratingReference(kind: ReferenceKind, id: string): boolean {
  return inProgress.has(referenceKey(kind, id));
}

export function subscribeGenerating(listener: () => void): () => void {
  generatingListeners.add(listener);
  return () => generatingListeners.delete(listener);
}

function markGenerating(key: string, value: boolean): void {
  if (value) inProgress.add(key);
  else inProgress.delete(key);
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

/** Generates and registers an image for a layer (or background), without setting it as the layer's
 * image. */
async function runLayerGeneration(
  deps: ComicBuilderDeps,
  panelId: string,
  layerId: string,
  promptOverride?: string,
  references?: GenerationReference[]
): Promise<GeneratedImage> {
  const config = deps.getGeneratorConfig();
  if (!config) throw new Error('No image generator is configured. Set one up first.');
  const project = requireProject(deps);
  const panel = findPanel(project, panelId);
  const layer = panel?.layers.find((l) => l.id === layerId);
  if (!panel || !layer) throw new Error(`Layer "${layerId}" not found.`);

  const provider = createProvider(config, deps.generatorFetch);
  const used = (references ?? defaultLayerReferences(deps, panelId, layerId)).slice(
    0,
    provider.maxReferenceImages
  );
  const prompt = appendReferenceNotes(
    promptOverride?.trim() || buildLayerPrompt(project, panelId, layerId),
    used
  );
  const referenceImages = await Promise.all(
    used.map(async (r) => (await deps.downloadStorageMedia(r.mediaId)).dataUrl)
  );
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
  const config = deps.getGeneratorConfig();
  if (!config) throw new Error('No image generator is configured. Set one up first.');
  const project = requireProject(deps);
  const entry = project.metadata[kind].find((e) => e.id === id);
  if (!entry) throw new Error(`"${id}" not found in ${kind}.`);

  const provider = createProvider(config, deps.generatorFetch);
  const used = (references ?? entry.imageIds.map((mediaId) => ({ mediaId }))).slice(
    0,
    provider.maxReferenceImages
  );
  const prompt = appendReferenceNotes(
    promptOverride?.trim() || buildReferencePrompt(project, kind, id),
    used
  );
  const referenceImages = await Promise.all(
    used.map(async (r) => (await deps.downloadStorageMedia(r.mediaId)).dataUrl)
  );
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
  const key = layerKey(panelId, layerId);
  const label = describeLayer(deps, panelId, layerId);
  return enqueue(label, async () => {
    markGenerating(key, true);
    try {
      return await runLayerGeneration(deps, panelId, layerId, prompt, references);
    } finally {
      markGenerating(key, false);
    }
  });
}

export function generateReferenceImage(
  deps: ComicBuilderDeps,
  kind: ReferenceKind,
  id: string,
  prompt?: string,
  references?: GenerationReference[]
): Promise<MediaItem> {
  const key = referenceKey(kind, id);
  const label = describeReference(deps, kind, id);
  return enqueue(label, async () => {
    markGenerating(key, true);
    try {
      return await generateReferenceOne(deps, kind, id, prompt, references);
    } finally {
      markGenerating(key, false);
    }
  });
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
  const linked =
    layer.kind === 'background'
      ? project.metadata.scenes.find((s) => s.id === layer.sceneId)
      : [...project.metadata.characters, ...project.metadata.objects].find(
          (e) => e.id === layer.subjectId
        );
  return (linked?.imageIds ?? []).map((mediaId) => ({ mediaId }));
}

/** The images a story-bible entry's reference generation sends by default: its existing ones. */
export function defaultEntryReferences(
  deps: ComicBuilderDeps,
  kind: ReferenceKind,
  id: string
): GenerationReference[] {
  const entry = requireProject(deps).metadata[kind].find((e) => e.id === id);
  return (entry?.imageIds ?? []).map((mediaId) => ({ mediaId }));
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
      await enqueue(label, async () => {
        markGenerating(key, true);
        try {
          const image = await runLayerGeneration(deps, ref.panelId, ref.layerId);
          commit(ref.panelId, ref.layerId, image.id, image.aspectRatio);
        } finally {
          markGenerating(key, false);
        }
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
