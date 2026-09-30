/**
 * The image-generator seam: ComicBuilder talks only to this interface, never to a specific
 * provider. ComfyUI (./comfy.ts) is the only implementation so far; adding another provider means
 * adding a case to createProvider and a new tagged member of GeneratorConfig, nothing else.
 */
import type { ComfyConfig } from './comfy';
import { assertValidComfyConfig, createComfyProvider } from './comfy';

export interface GenerationRequest {
  prompt: string;
  /** Reference images as data: URLs, in priority order. A provider may use fewer than it's given. */
  referenceImages: string[];
  width?: number;
  height?: number;
  /** Whether the result should be a transparent cutout (a character/object layer) rather than a
   * full-bleed image (a background/scene). A provider that has no way to produce real transparency
   * may ignore this; the caller falls back to its own background-removal heuristic in that case. */
  transparent?: boolean;
  /** Aborts the request (and any polling it's doing) when the caller cancels it. A provider that
   * can't cancel mid-flight should at least stop polling and reject with GenerationCancelledError. */
  signal?: AbortSignal;
}

/** Thrown (instead of whatever the underlying network failure looked like) when a generation is
 * cancelled — either before it started (still queued) or while a provider was mid-request. Callers
 * that want to tell "the user cancelled this" from "it actually failed" can check for this type. */
export class GenerationCancelledError extends Error {
  constructor() {
    super('Generation cancelled.');
    this.name = 'GenerationCancelledError';
  }
}

export interface ImageProvider {
  /** Reference images beyond this many are ignored. */
  maxReferenceImages: number;
  /** Throws with a human-readable message when the provider is not reachable or misconfigured. */
  test(): Promise<void>;
  /** Resolves to the generated image as a data: URL. */
  generate(request: GenerationRequest): Promise<string>;
}

export type GeneratorConfig = { provider: 'comfy'; comfy: ComfyConfig };

export function assertValidGeneratorConfig(config: unknown): asserts config is GeneratorConfig {
  if (!config || typeof config !== 'object') throw new Error('Generator config must be an object.');
  const { provider, comfy } = config as { provider?: unknown; comfy?: unknown };
  if (provider !== 'comfy')
    throw new Error('provider must be "comfy" (the only supported generator so far).');
  assertValidComfyConfig(comfy);
}

export function createProvider(config: GeneratorConfig, fetchImpl?: typeof fetch): ImageProvider {
  switch (config.provider) {
    case 'comfy':
      return createComfyProvider(config.comfy, fetchImpl);
    default:
      throw new Error(
        `Unknown image generator provider "${(config as { provider: string }).provider}".`
      );
  }
}
