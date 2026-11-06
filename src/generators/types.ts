/**
 * The image-generator seam: ComicBuilder talks only to this interface, never to a specific
 * backend. The one implementation is a plain HTTP "image service" (./service.ts): POST the
 * generation request as JSON, get an image back. What sits behind the URL (ComfyUI via
 * the ComfyUI-Vibecomic extension, a hosted API, ...) is not this app's concern.
 */
/** What kind of art is being asked for. Lets a service pick a different workflow per case. */
export type GenerationKind =
  | 'background' // a full-bleed layer background
  | 'foreground' // a transparent layer cutout
  | 'character' // character reference art
  | 'object' // prop/object reference art
  | 'scene'; // scene (location) reference art

export interface GenerationRequest {
  kind: GenerationKind;
  prompt: string;
  /** Reference images as data: URLs, in priority order. A provider may use fewer than it's given. */
  referenceImages: string[];
  width?: number;
  height?: number;
  /** Whether the result should be a transparent cutout (a character/object layer) rather than a
   * full-bleed image (a background/scene). A provider that has no way to produce real transparency
   * may ignore this; the caller falls back to its own background-removal heuristic in that case. */
  transparent?: boolean;
  /** Aborts the request when the caller cancels it. */
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

/**
 * The image service, as set from the settings UI or by an LLM via generate.config. At least one of:
 *  - `url`: an endpoint this app POSTs generation requests to (JSON in, image out). Used by the
 *    browser UI and the CLI.
 *  - `prompt`: free-text instructions for an LLM agent on where/how to generate images itself
 *    (a URL to call, a tool to use, ...). Shown to the agent by generate.config and generate.inspect.
 */
export interface GeneratorConfig {
  provider: 'service';
  url?: string;
  prompt?: string;
}

export function assertValidGeneratorConfig(config: unknown): asserts config is GeneratorConfig {
  if (!config || typeof config !== 'object') throw new Error('Image service must be an object.');
  const { provider, url, prompt } = config as Record<string, unknown>;
  if (provider !== 'service') throw new Error('provider must be "service".');
  if (url !== undefined && typeof url !== 'string') throw new Error('url must be a string.');
  if (prompt !== undefined && typeof prompt !== 'string')
    throw new Error('prompt must be a string.');
  if (!url?.trim() && !prompt?.trim())
    throw new Error('Set a url, a prompt, or both for the image service.');
  if (url?.trim() && !/^https?:\/\/./.test(url.trim()))
    throw new Error('url must start with http:// or https://.');
}

/** A config the app can call itself (has a url). A prompt-only config is for an LLM agent. */
export function hasServiceUrl(config: GeneratorConfig | null): boolean {
  return !!config?.url?.trim();
}
