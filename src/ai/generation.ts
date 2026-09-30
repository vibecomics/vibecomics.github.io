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
import { createProvider, GenerationCancelledError } from '../generators/types';
import type { ImageProvider } from '../generators/types';
import type { ComicProject, Layer, MediaItem } from '../types/comic';
import { errorMessage } from '../utils/errors';
import { pngDimensions } from '../utils/image';
import { dirtyLayerRefs, findPanel, layerArtSize, requireProject } from './builders';
import type { LayerRef } from './builders';
import type { ComicBuilderDeps } from './deps';
import {
  allEntryImageIds,
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
const variationKey = (kind: ReferenceKind, id: string, variationId: string) =>
  `ref:${kind}:${id}:${variationId}`;

export function layerGenerationStatus(panelId: string, layerId: string): GenerationStatus {
  return statusByKey.get(layerKey(panelId, layerId));
}

export function referenceGenerationStatus(kind: ReferenceKind, id: string): GenerationStatus {
  return statusByKey.get(referenceKey(kind, id));
}

export function variationGenerationStatus(
  kind: ReferenceKind,
  id: string,
  variationId: string
): GenerationStatus {
  return statusByKey.get(variationKey(kind, id, variationId));
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

// One AbortController per outstanding request, from the moment it's queued (so cancelling a queued
// item skips it entirely once its turn comes) until it finishes, succeeds, fails or is cancelled.
const abortControllers = new Map<string, AbortController>();

/** Cancels the layer's/entry's/queue item's outstanding generation request, if any: a queued one is
 * skipped when its turn comes, a running one has its network request aborted (see comfy.ts). Returns
 * false when there was nothing outstanding for `key` to cancel. */
function cancelGeneration(key: string): boolean {
  const controller = abortControllers.get(key);
  if (!controller) return false;
  controller.abort();
  return true;
}

/** Cancels a layer's (or background's) outstanding generation request, if any. */
export function cancelLayerGeneration(panelId: string, layerId: string): boolean {
  return cancelGeneration(layerKey(panelId, layerId));
}

/** Cancels a story-bible entry's outstanding reference-image generation request, if any. */
export function cancelReferenceGeneration(kind: ReferenceKind, id: string): boolean {
  return cancelGeneration(referenceKey(kind, id));
}

/** Cancels a variation's outstanding generation request, if any. */
export function cancelVariationGeneration(
  kind: ReferenceKind,
  id: string,
  variationId: string
): boolean {
  return cancelGeneration(variationKey(kind, id, variationId));
}

/** Cancels an item straight from generate.queue()'s list, by its `id` (the same key layerKey/
 * referenceKey builds — opaque to callers, just round-trip whatever queue() gave you). */
export function cancelQueueItem(id: string): boolean {
  return cancelGeneration(id);
}

/** One request in the generation queue: what it's for, and whether it's running yet or still waiting. */
export interface QueueItem {
  id: string;
  label: string;
  status: 'queued' | 'running';
}

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
// tracked and removed by their stable string id (the same layerKey/referenceKey trackedGeneration
// tracks status and the abort controller under, not object identity, which changes on each status
// update) so a finished item is reliably taken out of the queue, and cancelGeneration(id) can cancel
// straight from a queue() listing.
let queueTail: Promise<unknown> = Promise.resolve();
function enqueue<T>(id: string, label: string, task: () => Promise<T>): Promise<T> {
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
 * once its turn comes, so a button for it can tell "waiting" from "actively generating". Also tracks
 * an AbortController for `key` for the same span, so cancelGeneration(key) can either skip it (still
 * queued) or abort its request (already running) — `task` gets the controller's signal to pass on to
 * whatever it awaits. */
function trackedGeneration<T>(
  key: string,
  label: string,
  task: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  abortControllers.set(key, controller);
  setGenerationStatus(key, 'queued');
  return enqueue(key, label, async () => {
    try {
      if (controller.signal.aborted) throw new GenerationCancelledError();
      setGenerationStatus(key, 'running');
      return await task(controller.signal);
    } finally {
      setGenerationStatus(key, undefined);
      abortControllers.delete(key);
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
  references?: GenerationReference[],
  signal?: AbortSignal
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
    signal,
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

/** Generates one reference image from an already-final prompt string (no further building): gathers
 * reference images (variation-aware when `variationId` is given), calls the provider, strips the
 * background for a character/object, and registers the result. Shared by generateReferenceOne (a
 * single entry or variation) and generateAllVariations (which builds each variation's own final
 * prompt itself, on top of one shared, possibly user-edited base). */
async function runReferenceGeneration(
  deps: ComicBuilderDeps,
  kind: ReferenceKind,
  id: string,
  variationId: string | undefined,
  prompt: string,
  references: GenerationReference[] | undefined,
  signal?: AbortSignal
): Promise<MediaItem> {
  const provider = requireProvider(deps);
  const project = requireProject(deps);
  const entry = project.metadata[kind].find((e) => e.id === id);
  if (!entry) throw new Error(`"${id}" not found in ${kind}.`);

  const used = (references ?? defaultEntryReferences(deps, kind, id, variationId)).slice(
    0,
    provider.maxReferenceImages
  );
  const finalPrompt = appendReferenceNotes(prompt, used);
  const referenceImages = await downloadReferences(deps, used);
  const rawDataUrl = await provider.generate({ prompt: finalPrompt, referenceImages, signal });
  const dataUrl =
    kind !== 'scenes' && deps.removeBackground
      ? await deps.removeBackground(rawDataUrl)
      : rawDataUrl;
  return deps.uploadStorageMedia(`${entry.name} reference.png`, dataUrl, 'image/png');
}

async function generateReferenceOne(
  deps: ComicBuilderDeps,
  kind: ReferenceKind,
  id: string,
  variationId: string | undefined,
  promptOverride?: string,
  references?: GenerationReference[],
  signal?: AbortSignal
): Promise<MediaItem> {
  const project = requireProject(deps);
  const prompt = promptOverride?.trim() || buildReferencePrompt(project, kind, id, variationId);
  return runReferenceGeneration(deps, kind, id, variationId, prompt, references, signal);
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
  return trackedGeneration(
    layerKey(panelId, layerId),
    describeLayer(deps, panelId, layerId),
    (signal) => runLayerGeneration(deps, panelId, layerId, prompt, references, signal)
  );
}

export function generateReferenceImage(
  deps: ComicBuilderDeps,
  kind: ReferenceKind,
  id: string,
  prompt?: string,
  references?: GenerationReference[]
): Promise<MediaItem> {
  return trackedGeneration(referenceKey(kind, id), describeReference(deps, kind, id), (signal) =>
    generateReferenceOne(deps, kind, id, undefined, prompt, references, signal)
  );
}

/** Generates and registers a new image for one variation (pose/state) of a story-bible entry; does
 * not add it to the variation's imageIds (see the module doc) — commit it yourself with
 * variations.update(kind, id, variationId, { imageIds }). */
export function generateVariationImage(
  deps: ComicBuilderDeps,
  kind: ReferenceKind,
  id: string,
  variationId: string,
  prompt?: string,
  references?: GenerationReference[]
): Promise<MediaItem> {
  return trackedGeneration(
    variationKey(kind, id, variationId),
    describeVariation(deps, kind, id, variationId),
    (signal) => generateReferenceOne(deps, kind, id, variationId, prompt, references, signal)
  );
}

/** One variation's outcome from generateAllVariations: whether it generated ok, and its error if not. */
export interface VariationOutcome {
  variationId: string;
  ok: boolean;
  error?: string;
}

function commitVariationImage(
  deps: ComicBuilderDeps,
  kind: ReferenceKind,
  id: string,
  variationId: string,
  mediaId: string
): void {
  deps.updateProject((p) => {
    const entry = p.metadata[kind].find((e) => e.id === id);
    const variation = entry?.variations.find((v) => v.id === variationId);
    if (variation && !variation.imageIds.includes(mediaId)) variation.imageIds.push(mediaId);
  });
}

/** Generates one image for every variation of a story-bible entry, one request at a time, committing
 * each result into that variation's imageIds as it goes (like generateAllDirty, there's no one to
 * preview a batch for). `promptOverride`, when given, replaces the shared Style/description/technical
 * base that's normally built from the entry alone (see buildReferencePrompt with no variationId) —
 * each variation's own prompt is still appended on top of it, last, so the batch still draws a
 * different pose/state per image even when the shared prompt was edited. A failure on one variation
 * does not stop the rest. */
export async function generateAllVariations(
  deps: ComicBuilderDeps,
  kind: ReferenceKind,
  id: string,
  promptOverride?: string,
  references?: GenerationReference[]
): Promise<VariationOutcome[]> {
  const project = requireProject(deps);
  const entry = project.metadata[kind].find((e) => e.id === id);
  if (!entry) throw new Error(`"${id}" not found in ${kind}.`);
  const basePrompt = promptOverride?.trim() || buildReferencePrompt(project, kind, id);

  // Queue every variation's generation up front, not one at a time as each finishes: trackedGeneration
  // marks its key "queued" the instant it's called, so every variation's own Generate button reflects
  // its place in the queue right away, rather than only the one currently running. The shared queue
  // (see enqueue/queueTail) still runs them one request at a time, in this same order.
  const runs = entry.variations.map((variation) => {
    const key = variationKey(kind, id, variation.id);
    const label = describeVariation(deps, kind, id, variation.id);
    const prompt = variation.prompt.trim()
      ? `${basePrompt}\n\nVariation: ${variation.prompt.trim()}`
      : basePrompt;
    const run = trackedGeneration(key, label, async (signal) => {
      const media = await runReferenceGeneration(
        deps,
        kind,
        id,
        variation.id,
        prompt,
        references,
        signal
      );
      commitVariationImage(deps, kind, id, variation.id, media.id);
    });
    return { variationId: variation.id, run };
  });

  const outcomes: VariationOutcome[] = [];
  for (const { variationId, run } of runs) {
    try {
      await run;
      outcomes.push({ variationId, ok: true });
    } catch (e) {
      outcomes.push({ variationId, ok: false, error: errorMessage(e) });
    }
  }
  return outcomes;
}

/** A reference to `mediaId`, with a ready-made note when it's known art of a character, object or
 * scene (see defaultReferenceNote). `currentEntryId` is the entry this generation is of, if any, so
 * the note only names the entry when it's a *different* one. */
function referenceTo(
  project: ComicProject,
  mediaId: string,
  currentEntryId?: string
): GenerationReference {
  const note = defaultReferenceNote(project, mediaId, currentEntryId);
  return note ? { mediaId, note } : { mediaId };
}

/** The images a layer's generation sends by default: its subject's/scene's chosen variation (see
 * layer.variationId), if it has one and that variation has images yet; otherwise every image the
 * character/object (foreground) or scene (background) it shows has. */
export function defaultLayerReferences(
  deps: ComicBuilderDeps,
  panelId: string,
  layerId: string
): GenerationReference[] {
  const project = requireProject(deps);
  const layer = findPanel(project, panelId)?.layers.find((l) => l.id === layerId);
  if (!layer) throw new Error(`Layer "${layerId}" not found.`);
  const subject = layerSubject(project, layer);
  if (!subject) return [];
  const variation = layer.variationId
    ? subject.variations.find((v) => v.id === layer.variationId)
    : undefined;
  const ids = variation?.imageIds.length ? variation.imageIds : allEntryImageIds(subject);
  return ids.map((mediaId) => referenceTo(project, mediaId, subject.id));
}

/** The images a story-bible entry's reference generation sends by default: with `variationId`, that
 * variation's own images (falling back to every image the entry has, across every variation, if that
 * variation has none yet); without one, every image the entry has. */
export function defaultEntryReferences(
  deps: ComicBuilderDeps,
  kind: ReferenceKind,
  id: string,
  variationId?: string
): GenerationReference[] {
  const project = requireProject(deps);
  const entry = project.metadata[kind].find((e) => e.id === id);
  if (!entry) return [];
  const variation = variationId ? entry.variations.find((v) => v.id === variationId) : undefined;
  const ids = variation?.imageIds.length ? variation.imageIds : allEntryImageIds(entry);
  return ids.map((mediaId) => referenceTo(project, mediaId, id));
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

function describeVariation(
  deps: ComicBuilderDeps,
  kind: ReferenceKind,
  id: string,
  variationId: string
): string {
  try {
    const entry = requireProject(deps).metadata[kind].find((e) => e.id === id);
    const variation = entry?.variations.find((v) => v.id === variationId);
    return `Reference: ${entry?.name || id} — ${variation?.name || variationId}`;
  } catch {
    return `Reference: ${id} — ${variationId}`;
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
      await trackedGeneration(key, label, async (signal) => {
        const image = await runLayerGeneration(
          deps,
          ref.panelId,
          ref.layerId,
          undefined,
          undefined,
          signal
        );
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
