import { useSyncExternalStore } from 'react';
import {
  getQueue,
  layerGenerationStatus,
  referenceGenerationStatus,
  subscribeGenerating,
  subscribeQueue,
  variationGenerationStatus,
} from '../ai/generation';
import type { GenerationStatus, QueueItem, ReferenceKind } from '../ai/generation';

/** Whether this layer has a generation queued or running, kept in sync even across remounts (e.g.
 * collapsing and reopening the layer, or a batch generate started elsewhere). */
export function useLayerGenerationStatus(panelId: string, layerId: string): GenerationStatus {
  return useSyncExternalStore(subscribeGenerating, () => layerGenerationStatus(panelId, layerId));
}

/** Whether this story-bible entry has a reference-image generation queued or running. */
export function useReferenceGenerationStatus(kind: ReferenceKind, id: string): GenerationStatus {
  return useSyncExternalStore(subscribeGenerating, () => referenceGenerationStatus(kind, id));
}

/** Whether this variation (pose/state) has a generation queued or running. */
export function useVariationGenerationStatus(
  kind: ReferenceKind,
  id: string,
  variationId: string
): GenerationStatus {
  return useSyncExternalStore(subscribeGenerating, () =>
    variationGenerationStatus(kind, id, variationId)
  );
}

/** The generation queue right now (running item first, then queued, in run order). */
export function useGenerationQueue(): QueueItem[] {
  return useSyncExternalStore(subscribeQueue, getQueue);
}
