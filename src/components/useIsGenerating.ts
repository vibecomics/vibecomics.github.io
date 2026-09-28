import { useSyncExternalStore } from 'react';
import {
  getQueue,
  isGeneratingLayer,
  isGeneratingReference,
  subscribeGenerating,
  subscribeQueue,
} from '../ai/generation';
import type { QueueItem, ReferenceKind } from '../ai/generation';

/** Whether this layer has a generation in flight, kept in sync even across remounts (e.g. collapsing
 * and reopening the layer, or a batch generate started elsewhere). */
export function useIsGenerating(panelId: string, layerId: string): boolean {
  return useSyncExternalStore(subscribeGenerating, () => isGeneratingLayer(panelId, layerId));
}

/** Whether this story-bible entry has a reference-image generation in flight. */
export function useIsGeneratingReference(kind: ReferenceKind, id: string): boolean {
  return useSyncExternalStore(subscribeGenerating, () => isGeneratingReference(kind, id));
}

/** The generation queue right now (running item first, then queued, in run order). */
export function useGenerationQueue(): QueueItem[] {
  return useSyncExternalStore(subscribeQueue, getQueue);
}
