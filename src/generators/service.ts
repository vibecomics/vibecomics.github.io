/** The generic image service: POST the generation request as JSON to a URL, get an image back.
 *
 * Request body: { kind, prompt, referenceImages: [dataUrl], width?, height?, transparent?,
 * panelBackground?, panelLayers? } (the last two, kind: 'panel' only — see GenerationRequest). A
 * service that doesn't understand panelBackground/panelLayers can ignore them and use
 * prompt/referenceImages as it always has.
 * Response: the image bytes (any image/* content type), or JSON { image: "data:..." }. A non-2xx
 * response carries JSON { error } or plain text. GET on the same URL answers 2xx when it's alive. */
import { readFileAsDataUrl } from '../utils/files';
import type { GeneratorConfig, GenerationRequest, ImageProvider } from './types';
import { GenerationCancelledError, hasServiceUrl } from './types';

/** Services truncate to what they support; this just caps what we upload. */
const MAX_REFERENCES = 4;

async function failure(res: Response): Promise<Error> {
  const text = await res.text().catch(() => '');
  let detail = text;
  try {
    detail = (JSON.parse(text) as { error?: string }).error ?? text;
  } catch {
    // plain text body
  }
  return new Error(`Image service failed: ${res.status} ${detail}`.trim());
}

function createHttpProvider(
  url: string,
  fetchImpl: typeof fetch = (...args) => fetch(...args)
): ImageProvider {
  return {
    maxReferenceImages: MAX_REFERENCES,

    async test() {
      let res: Response;
      try {
        res = await fetchImpl(url);
      } catch (e) {
        throw new Error(`Can't reach the image service at ${url}: ${(e as Error).message}`);
      }
      if (!res.ok) throw await failure(res);
    },

    async generate(request: GenerationRequest) {
      const { signal, ...body } = request;
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        });
      } catch (e) {
        if (signal?.aborted) throw new GenerationCancelledError();
        throw new Error(`Can't reach the image service at ${url}: ${(e as Error).message}`);
      }
      if (!res.ok) throw await failure(res);
      const type = res.headers.get('content-type') ?? '';
      if (type.includes('application/json')) {
        const json = (await res.json()) as { image?: string };
        if (!json.image?.startsWith('data:')) {
          throw new Error('Image service returned JSON without an "image" data URL.');
        }
        return json.image;
      }
      return readFileAsDataUrl(await res.blob());
    },
  };
}

/** The provider for a config. Throws (with the agent prompt, if any) when there is no url to call. */
export function createProvider(config: GeneratorConfig, fetchImpl?: typeof fetch): ImageProvider {
  if (!hasServiceUrl(config)) {
    throw new Error(
      config.prompt?.trim()
        ? `The image service has no URL, so the app cannot generate images itself. Generate the image yourself following the image service instructions: ${config.prompt.trim()}`
        : 'The image service has no URL.'
    );
  }
  return createHttpProvider(config.url!.trim(), fetchImpl);
}
