/**
 * Orchestrates image generation for a layer, the whole project's dirty layers, or a story-bible
 * entry's reference art: stitches the prompt, gathers reference images, calls the configured
 * ImageProvider, and uploads the result. Knows nothing about any specific provider (see ../generators).
 * Every generation call is serialized through one labeled queue (see enqueue/getQueue), so only one
 * request runs at a time and its progress is visible regardless of which entry point started it.
 *
 * A single layer or reference-image generation only registers the result (like media.upload) — it
 * does not add it to a story-bible entry's imageIds, and it sets it as a layer's image only when the
 * layer has none yet (see the generate.layer action). The caller previews it and commits with
 * layers.update(..., { mediaId }) or characters.update(..., { imageIds }).
 * The dirty-batch path is the exception: it has no one to show a preview to, so it commits each result
 * itself as it goes.
 */
import { createProvider, GenerationCancelledError } from '../generators/types';
import type { ImageProvider } from '../generators/types';
import { artPixels } from '../state/layout';
import type { ComicProject, Layer, MediaItem, StoryEntry, Variation } from '../types/comic';
import { errorMessage } from '../utils/errors';
import { pngDimensions } from '../utils/image';
import {
  dirtyLayerRefs,
  dirtyVariationRefs,
  findPanel,
  layerArtSize,
  requireProject,
} from './builders';
import type { LayerKind, LayerRef, StoryKind, VariationRef } from './builders';
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

// Which layer, story-bible entry or variation has a generation queued or running, so any component
// showing it can reflect that, even one that mounted after the request started (see
// useGenerationStatus). Every request gets its own id (`key#n`), so each one is its own queue row and
// its own abort controller; a key's status follows all of its outstanding requests together: running
// if any is, otherwise queued while any waits, and nothing once they've all finished.
const requestsByKey = new Map<string, Map<string, 'queued' | 'running'>>();
const generatingListeners = new Set<() => void>();
const layerKey = (panelId: string, layerId: string) => `layer:${panelId}:${layerId}`;
const referenceKey = (kind: ReferenceKind, id: string) => `ref:${kind}:${id}`;
const variationKey = (kind: ReferenceKind, id: string, variationId: string) =>
  `ref:${kind}:${id}:${variationId}`;

function statusOf(key: string): GenerationStatus {
  const requests = requestsByKey.get(key);
  if (!requests) return undefined;
  return [...requests.values()].includes('running') ? 'running' : 'queued';
}

export function layerGenerationStatus(panelId: string, layerId: string): GenerationStatus {
  return statusOf(layerKey(panelId, layerId));
}

export function referenceGenerationStatus(kind: ReferenceKind, id: string): GenerationStatus {
  return statusOf(referenceKey(kind, id));
}

export function variationGenerationStatus(
  kind: ReferenceKind,
  id: string,
  variationId: string
): GenerationStatus {
  return statusOf(variationKey(kind, id, variationId));
}

export function subscribeGenerating(listener: () => void): () => void {
  generatingListeners.add(listener);
  return () => generatingListeners.delete(listener);
}

function setRequestState(key: string, id: string, state: 'queued' | 'running' | undefined): void {
  const requests = requestsByKey.get(key) ?? new Map<string, 'queued' | 'running'>();
  if (state) {
    requests.set(id, state);
    requestsByKey.set(key, requests);
  } else {
    requests.delete(id);
    if (requests.size === 0) requestsByKey.delete(key);
  }
  generatingListeners.forEach((listener) => listener());
}

// One AbortController per outstanding request, keyed by request id, from the moment it's queued (so
// cancelling a queued item skips it entirely once its turn comes) until it finishes, succeeds, fails
// or is cancelled.
const abortControllers = new Map<string, AbortController>();
let requestCount = 0;

/** Cancels one request (a queue item's id), if it's still outstanding. A queued one is skipped when
 * its turn comes; a running one has its network request aborted (see comfy.ts). */
function cancelRequest(id: string): boolean {
  const controller = abortControllers.get(id);
  if (!controller) return false;
  controller.abort();
  return true;
}

/** Cancels every outstanding request for `key` (a layer, entry or variation). Returns false when there
 * was nothing outstanding to cancel. */
function cancelKey(key: string): boolean {
  const ids = [...(requestsByKey.get(key)?.keys() ?? [])];
  return ids.map(cancelRequest).some(Boolean);
}

/** Cancels a layer's (or background's) outstanding generation requests, if any. */
export function cancelLayerGeneration(panelId: string, layerId: string): boolean {
  return cancelKey(layerKey(panelId, layerId));
}

/** Cancels a story-bible entry's outstanding reference-image generation requests, if any. */
export function cancelReferenceGeneration(kind: ReferenceKind, id: string): boolean {
  return cancelKey(referenceKey(kind, id));
}

/** Cancels a variation's outstanding generation requests, if any. */
export function cancelVariationGeneration(
  kind: ReferenceKind,
  id: string,
  variationId: string
): boolean {
  return cancelKey(variationKey(kind, id, variationId));
}

/** Cancels one queue item straight from generate.queue()'s list, by its `id` (round-trip whatever
 * queue() gave you). */
export function cancelQueueItem(id: string): boolean {
  return cancelRequest(id);
}

/**
 * Cancels every outstanding generation at once — everything still queued or running, across layers,
 * reference art and variations alike. A batch call (generate.dirty(), generate.dirtyReferences()) has
 * already enqueued every one of its items up front (see trackedGeneration): aborting each one here
 * makes its turn, when it comes, throw immediately instead of actually generating, so the batch's own
 * loop unwinds on its own almost at once rather than needing a separate "stop" flag threaded through
 * it. Returns how many were cancelled.
 */
export function cancelAllGenerations(): number {
  const ids = [...abortControllers.keys()];
  for (const id of ids) cancelRequest(id);
  return ids.length;
}

/** What a generation is for, so the queue can take you back to it: a layer (a background is one too),
 * or a story-bible entry, or one of its variations. */
export type GenerationTarget =
  | { type: 'layer'; panelId: string; layerId: string }
  | { type: 'reference'; kind: ReferenceKind; entryId: string; variationId?: string };

/** One request in the generation queue: what it's for, and how far it's gotten. Unlike the old
 * queue, a finished item (done or error) stays here, in place, until clearCompletedQueueItems()
 * removes it — so a panel listing the queue can show what was generated, not just what's in flight. */
export interface QueueItem {
  id: string;
  label: string;
  target: GenerationTarget;
  status: 'queued' | 'running' | 'done' | 'error';
  error?: string;
}

let queueItems: QueueItem[] = [];
const queueListeners = new Set<() => void>();

/** The generation queue right now, in the order each item was first requested: queued/running items
 * (at most one running at a time) alongside finished ones (done/error) that haven't been cleared. */
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

/** Removes every finished (done or error) item from the queue; anything still queued or running is
 * left alone. */
export function clearCompletedQueueItems(): void {
  queueItems = queueItems.filter((i) => i.status === 'queued' || i.status === 'running');
  notifyQueue();
}

function setQueueItem(id: string, item: QueueItem): void {
  queueItems = queueItems.some((i) => i.id === id)
    ? queueItems.map((i) => (i.id === id ? item : i))
    : [...queueItems, item];
  notifyQueue();
}

// One request at a time, even across overlapping layer()/dirty()/reference-image calls. Each item is
// tracked by its own unique string id (see trackedGeneration), so every generation keeps its own row
// in the queue, and cancelRequest(id) can cancel straight from a queue() listing.
let queueTail: Promise<unknown> = Promise.resolve();
function enqueue<T>(
  id: string,
  label: string,
  target: GenerationTarget,
  task: () => Promise<T>
): Promise<T> {
  const row = { id, label, target };
  setQueueItem(id, { ...row, status: 'queued' });

  const runTask = async (): Promise<T> => {
    setQueueItem(id, { ...row, status: 'running' });
    try {
      const result = await task();
      setQueueItem(id, { ...row, status: 'done' });
      return result;
    } catch (e) {
      setQueueItem(id, { ...row, status: 'error', error: errorMessage(e) });
      throw e;
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

/** Runs a generation in the queue as its own request, marking `key` as queued the instant it's
 * requested and running once its turn comes, so a button for it can tell "waiting" from "actively
 * generating". Each request also gets its own AbortController, so cancelRequest can either skip it
 * (still queued) or abort it (already running) — `task` gets the signal to pass on to whatever it
 * awaits. */
function trackedGeneration<T>(
  key: string,
  label: string,
  target: GenerationTarget,
  task: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  requestCount++;
  const id = `${key}#${requestCount}`;
  const controller = new AbortController();
  abortControllers.set(id, controller);
  setRequestState(key, id, 'queued');
  return enqueue(id, label, target, async () => {
    try {
      if (controller.signal.aborted) throw new GenerationCancelledError();
      setRequestState(key, id, 'running');
      return await task(controller.signal);
    } finally {
      setRequestState(key, id, undefined);
      abortControllers.delete(id);
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
    transparent: layer.kind === 'foreground',
    signal,
  });
  // A provider without real transparency draws the subject on a plain white background instead (see
  // the technical requirements line in buildLayerPrompt); cut that background out here, in the
  // browser. removeBackground is a no-op if the provider already returned a real cutout.
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
// A scene is a background/establishing shot: it reads best wide, unlike a character or object
// turnaround, which the workflow's own default (portrait) already suits. 9in x 6in at the usual
// generation DPI (see artPixels) lands on a clean 3:2 landscape canvas.
const SCENE_REFERENCE_SIZE = artPixels(9, 6);

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
  const rawDataUrl = await provider.generate({
    prompt: finalPrompt,
    referenceImages,
    ...(kind === 'scenes' && {
      width: SCENE_REFERENCE_SIZE.width,
      height: SCENE_REFERENCE_SIZE.height,
    }),
    transparent: kind !== 'scenes',
    signal,
  });
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
 * image (see the module doc) — the generate.layer action does that only when the layer has none yet. */
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
    { type: 'layer', panelId, layerId },
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
  return trackedGeneration(
    referenceKey(kind, id),
    describeReference(deps, kind, id),
    { type: 'reference', kind, entryId: id },
    (signal) => generateReferenceOne(deps, kind, id, undefined, prompt, references, signal)
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
    { type: 'reference', kind, entryId: id, variationId },
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
    if (!variation) return;
    if (!variation.imageIds.includes(mediaId)) variation.imageIds.push(mediaId);
    // A new image satisfies whatever prompt asked for it, same as a layer's image swap.
    variation.dirty = false;
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
    const target: GenerationTarget = {
      type: 'reference',
      kind,
      entryId: id,
      variationId: variation.id,
    };
    const run = trackedGeneration(key, label, target, async (signal) => {
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

/** The reference images to send for a specific variation that has none of its own yet: the entry's
 * own pose-neutral `imageIds`, never another variation's — a different pose or orientation (the
 * Front view's image, say, while generating Back view) actively misleads the model into blending the
 * two (a face appearing on a "back view," for instance), which is worse than sending nothing. */
/** The reference image ids to use for a given variation (or, with none picked, the whole entry): that
 * variation's own images; if it has none yet, the entry's own pose-neutral `imageIds` (never another
 * variation's — a different pose or orientation, the Front view's image while generating Back view,
 * say, actively misleads the model into blending the two); with no variation picked at all, every
 * image the entry has, across every variation, since no particular pose was requested. */
function referenceIdsFor(entry: StoryEntry, variation: Variation | undefined): string[] {
  if (!variation) return allEntryImageIds(entry);
  return variation.imageIds.length ? variation.imageIds : entry.imageIds;
}

/** The images a layer's generation sends by default: the layer's own images first (its current image,
 * then its history, most recent first — so regenerating keeps the look it already has), then its
 * subject's/scene's chosen variation (see layer.variationId) if it has one and that variation has
 * images yet; otherwise every image the character/object (foreground) or scene (background) it shows
 * has — see referenceIdsFor. An image in both lists is sent once. */
export function defaultLayerReferences(
  deps: ComicBuilderDeps,
  panelId: string,
  layerId: string
): GenerationReference[] {
  const project = requireProject(deps);
  const layer = findPanel(project, panelId)?.layers.find((l) => l.id === layerId);
  if (!layer) throw new Error(`Layer "${layerId}" not found.`);
  const subject = layerSubject(project, layer);
  const variation =
    subject && layer.variationId
      ? subject.variations.find((v) => v.id === layer.variationId)
      : undefined;
  const ownIds = [layer.mediaId, ...(layer.mediaHistory ?? [])].filter(
    (id): id is string => Boolean(id) && project.metadata.media.some((m) => m.id === id)
  );
  const subjectIds = subject ? referenceIdsFor(subject, variation) : [];
  const ids = [...new Set([...ownIds, ...subjectIds])];
  return ids.map((mediaId) => referenceTo(project, mediaId, subject?.id));
}

/** The images a story-bible entry's reference generation sends by default: with `variationId`, that
 * variation's own images (or, with none yet, every image the entry has); without one, every image the
 * entry has — see referenceIdsFor. */
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
  const ids = referenceIdsFor(entry, variation);
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
  commit: CommitLayerImage,
  kinds?: readonly LayerKind[]
): Promise<GenerationOutcome[]> {
  const project = requireProject(deps);
  let refs = dirtyLayerRefs(project);
  if (kinds) {
    refs = refs.filter((ref) => {
      const layer = findPanel(project, ref.panelId)?.layers.find((l) => l.id === ref.layerId);
      return layer && kinds.includes(layer.kind);
    });
  }

  // Queue every dirty layer's generation up front, not one at a time as each finishes:
  // trackedGeneration marks its key "queued" the instant it's called, so the queue (and any panel
  // showing it) lists every layer waiting its turn right away, not just the one currently running
  // (see generateAllVariations, which does the same). The shared queue (see enqueue/queueTail) still
  // runs them one request at a time, in this same order.
  const runs = refs.map((ref) => {
    const key = layerKey(ref.panelId, ref.layerId);
    const label = describeLayer(deps, ref.panelId, ref.layerId);
    const target: GenerationTarget = { type: 'layer', panelId: ref.panelId, layerId: ref.layerId };
    const run = trackedGeneration(key, label, target, async (signal) => {
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
    return { ref, run };
  });

  const outcomes: GenerationOutcome[] = [];
  for (const { ref, run } of runs) {
    deps.setStatus(`Generating image ${outcomes.length + 1} of ${refs.length}…`);
    try {
      await run;
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

/** One dirty variation's outcome from generateAllDirtyVariations. */
export interface VariationRefOutcome extends VariationRef {
  ok: boolean;
  error?: string;
}

/**
 * Generates images for every dirty variation (reference art for a character, object or scene) across
 * the whole story bible, one request at a time, committing each result into that variation's imageIds
 * as it goes (like generateAllDirty, there's no one to preview a batch for). Mirrors generateAllDirty,
 * but for story-bible reference art instead of layers. `kinds`, when given, restricts this to only
 * those story-bible lists (e.g. ['characters'] regenerates dirty cast reference art only).
 */
export async function generateAllDirtyVariations(
  deps: ComicBuilderDeps,
  kinds?: readonly StoryKind[]
): Promise<VariationRefOutcome[]> {
  let refs = dirtyVariationRefs(requireProject(deps));
  if (kinds) refs = refs.filter((ref) => kinds.includes(ref.kind));

  // Queue every dirty variation's generation up front, not one at a time as each finishes: same
  // reasoning as generateAllDirty and generateAllVariations.
  const runs = refs.map((ref) => {
    const key = variationKey(ref.kind, ref.entryId, ref.variationId);
    const label = describeVariation(deps, ref.kind, ref.entryId, ref.variationId);
    const target: GenerationTarget = {
      type: 'reference',
      kind: ref.kind,
      entryId: ref.entryId,
      variationId: ref.variationId,
    };
    const run = trackedGeneration(key, label, target, async (signal) => {
      const media = await generateReferenceOne(
        deps,
        ref.kind,
        ref.entryId,
        ref.variationId,
        undefined,
        undefined,
        signal
      );
      commitVariationImage(deps, ref.kind, ref.entryId, ref.variationId, media.id);
    });
    return { ref, run };
  });

  const outcomes: VariationRefOutcome[] = [];
  for (const { ref, run } of runs) {
    deps.setStatus(`Generating reference image ${outcomes.length + 1} of ${refs.length}…`);
    try {
      await run;
      outcomes.push({ ...ref, ok: true });
    } catch (e) {
      outcomes.push({ ...ref, ok: false, error: errorMessage(e) });
    }
  }
  const failed = outcomes.filter((o) => !o.ok).length;
  deps.setStatus(
    failed
      ? `Generated ${outcomes.length - failed} of ${outcomes.length}; ${failed} failed.`
      : `Generated ${outcomes.length} reference image${outcomes.length === 1 ? '' : 's'}.`
  );
  return outcomes;
}
