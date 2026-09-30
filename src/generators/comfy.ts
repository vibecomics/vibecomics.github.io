/**
 * ComfyUI as an ImageProvider: a saved workflow (exported from ComfyUI in "API format") is treated
 * as an opaque template. Generating an image patches a few designated nodes (prompt text, reference
 * images, output, optionally size and seed), submits it, and reads back the result. Everything else
 * in the graph (checkpoint, sampler, LoRAs, ...) is whatever the user built in ComfyUI's own UI.
 */
import { readFileAsDataUrl } from '../utils/files';
import { GenerationCancelledError } from './types';
import type { GenerationRequest, ImageProvider } from './types';

export interface ComfyNodeMapping {
  positivePromptNodeId: string;
  /** The positive prompt node's input field name. Defaults to "text" (CLIPTextEncode); some nodes
   * (e.g. TextEncodeQwenImageEditPlus) use "prompt" instead. */
  promptField?: string;
  /** LoadImage node ids, in fill order. Empty or absent means a text-only workflow. */
  referenceImageNodeIds?: string[];
  outputNodeId: string;
  sizeNodeId?: string;
  seedNodeId?: string;
  /** The seed node's input field name. Defaults to "seed". */
  seedField?: string;
}

export interface ComfyWorkflowNode {
  class_type: string;
  inputs: Record<string, unknown>;
}

export type ComfyWorkflow = Record<string, ComfyWorkflowNode>;

export interface ComfyConfig {
  baseUrl: string;
  /** A workflow saved in ComfyUI's own workflows folder. When set, the browser keeps only this name
   * and fetches `workflow` from the server once, on page load (see browserConfigStore). */
  workflowName?: string;
  workflow: ComfyWorkflow;
  nodes: ComfyNodeMapping;
}

export function assertValidComfyConfig(config: unknown): asserts config is ComfyConfig {
  if (!config || typeof config !== 'object') throw new Error('ComfyUI config must be an object.');
  const { baseUrl, workflow, nodes } = config as Record<string, unknown>;
  if (typeof baseUrl !== 'string' || !/^https?:\/\//.test(baseUrl)) {
    throw new Error('baseUrl must be an http(s) URL.');
  }
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    throw new Error('workflow must be a ComfyUI workflow exported in "API format".');
  }
  if (!nodes || typeof nodes !== 'object')
    throw new Error('nodes (the node-id mapping) is required.');
  const { positivePromptNodeId, outputNodeId, referenceImageNodeIds } = nodes as ComfyNodeMapping;
  for (const [label, id] of [
    ['positivePromptNodeId', positivePromptNodeId],
    ['outputNodeId', outputNodeId],
  ] as const) {
    if (typeof id !== 'string' || !(id in workflow)) {
      throw new Error(`nodes.${label} must name a node in the workflow.`);
    }
  }
  for (const id of referenceImageNodeIds ?? []) {
    if (!(id in workflow))
      throw new Error(`nodes.referenceImageNodeIds: no node "${id}" in the workflow.`);
  }
}

function patchWorkflow(
  workflow: ComfyWorkflow,
  nodes: ComfyNodeMapping,
  patch: { prompt: string; referenceFilenames: string[]; width?: number; height?: number }
): ComfyWorkflow {
  const graph = structuredClone(workflow);
  const at = (id: string, label: string): ComfyWorkflowNode => {
    const node = graph[id];
    if (!node) throw new Error(`Workflow has no node "${id}" (${label}).`);
    return node;
  };
  at(nodes.positivePromptNodeId, 'positive prompt').inputs[nodes.promptField ?? 'text'] =
    patch.prompt;
  (nodes.referenceImageNodeIds ?? []).forEach((id, i) => {
    if (patch.referenceFilenames[i]) {
      at(id, 'reference image').inputs.image = patch.referenceFilenames[i];
      return;
    }
    // No reference image for this slot: remove the LoadImage node and unlink it, rather than feed
    // in whatever placeholder image it was authored with (e.g. ComfyUI's own sample photo).
    delete graph[id];
    for (const node of Object.values(graph)) {
      for (const [key, value] of Object.entries(node.inputs)) {
        if (Array.isArray(value) && value[0] === id) delete node.inputs[key];
      }
    }
  });
  if (nodes.sizeNodeId && patch.width && patch.height) {
    const size = at(nodes.sizeNodeId, 'size');
    size.inputs.width = Math.round(patch.width);
    size.inputs.height = Math.round(patch.height);
  }
  if (nodes.seedNodeId) {
    at(nodes.seedNodeId, 'seed').inputs[nodes.seedField ?? 'seed'] = Math.floor(
      Math.random() * 1e15
    );
  }
  return graph;
}

interface ComfyImageRef {
  filename: string;
  subfolder: string;
  type: string;
}

type ComfyHistory = Record<
  string,
  { status?: { status_str?: string }; outputs?: Record<string, { images?: ComfyImageRef[] }> }
>;

async function asJson<T>(res: Response, action: string): Promise<T> {
  if (!res.ok)
    throw new Error(`ComfyUI ${action} failed: ${res.status} ${await res.text().catch(() => '')}`);
  return res.json() as Promise<T>;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/** A cancellable wait between history polls: rejects immediately (rather than after the full delay)
 * once `signal` aborts, so cancelling during the wait doesn't cost up to another 1.5s. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new GenerationCancelledError());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new GenerationCancelledError());
      },
      { once: true }
    );
  });
}

/** The allowed values of one required input of a node type, e.g. the checkpoint filenames a
 * CheckpointLoaderSimple can load, straight from what this ComfyUI server has installed. */
async function listNodeOptions(
  baseUrl: string,
  fetchImpl: typeof fetch,
  classType: string,
  inputName: string
): Promise<string[]> {
  const base = baseUrl.replace(/\/+$/, '');
  const res = await fetchImpl(`${base}/object_info/${classType}`);
  const info = await asJson<Record<string, { input?: { required?: Record<string, [unknown]> } }>>(
    res,
    'object_info'
  );
  const options = info[classType]?.input?.required?.[inputName]?.[0];
  return Array.isArray(options) ? (options as string[]) : [];
}

/** The split-loader model files (UNET/CLIP/VAE/LoRA) installed, for models like Qwen-Image that have
 * no single checkpoint file. Empty arrays mean that loader type isn't installed. */
export async function listComfyQwenModels(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ unet: string[]; clip: string[]; vae: string[]; lora: string[] }> {
  const [unet, clip, vae, lora] = await Promise.all([
    listNodeOptions(baseUrl, fetchImpl, 'UNETLoader', 'unet_name'),
    listNodeOptions(baseUrl, fetchImpl, 'CLIPLoader', 'clip_name'),
    listNodeOptions(baseUrl, fetchImpl, 'VAELoader', 'vae_name'),
    listNodeOptions(baseUrl, fetchImpl, 'LoraLoaderModelOnly', 'lora_name'),
  ]);
  return { unet, clip, vae, lora };
}

export function createComfyProvider(
  config: ComfyConfig,
  fetchImpl: typeof fetch = fetch
): ImageProvider {
  const base = config.baseUrl.replace(/\/+$/, '');
  const clientId = `vibecomics-${Math.random().toString(36).slice(2)}`;
  const maxReferenceImages = config.nodes.referenceImageNodeIds?.length ?? 0;

  async function uploadReferenceImage(
    dataUrl: string,
    name: string,
    signal?: AbortSignal
  ): Promise<string> {
    const form = new FormData();
    form.append('image', new Blob([dataUrlToBytes(dataUrl) as BlobPart]), name);
    form.append('overwrite', 'true');
    const res = await fetchImpl(`${base}/upload/image`, { method: 'POST', body: form, signal });
    return (await asJson<{ name: string }>(res, 'upload')).name;
  }

  async function waitForResult(promptId: string, signal?: AbortSignal): Promise<ComfyImageRef> {
    for (;;) {
      const res = await fetchImpl(`${base}/history/${promptId}`, { signal });
      const history = await asJson<ComfyHistory>(res, 'history');
      const entry = history[promptId];
      if (entry?.status?.status_str === 'error') {
        throw new Error(`ComfyUI reported an error running prompt ${promptId}.`);
      }
      const image = entry?.outputs?.[config.nodes.outputNodeId]?.images?.[0];
      if (image) return image;
      await delay(1500, signal);
    }
  }

  return {
    maxReferenceImages,

    async test() {
      const res = await fetchImpl(`${base}/system_stats`);
      if (!res.ok) throw new Error(`ComfyUI at ${base} answered with ${res.status}.`);
    },

    async generate({
      prompt,
      referenceImages,
      width,
      height,
      signal,
    }: GenerationRequest): Promise<string> {
      try {
        const referenceFilenames = await Promise.all(
          referenceImages
            .slice(0, maxReferenceImages)
            .map((dataUrl, i) => uploadReferenceImage(dataUrl, `ref-${i}.png`, signal))
        );
        const graph = patchWorkflow(config.workflow, config.nodes, {
          prompt,
          referenceFilenames,
          width,
          height,
        });
        const submitRes = await fetchImpl(`${base}/prompt`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: graph, client_id: clientId }),
          signal,
        });
        const { prompt_id: promptId } = await asJson<{ prompt_id: string }>(submitRes, 'submit');
        const image = await waitForResult(promptId, signal);
        const viewRes = await fetchImpl(
          `${base}/view?${new URLSearchParams(Object.entries(image))}`,
          { signal }
        );
        if (!viewRes.ok) throw new Error(`ComfyUI view failed: ${viewRes.status}`);
        return readFileAsDataUrl(await viewRes.blob());
      } catch (e) {
        // Whatever shape the underlying fetch rejection took (an AbortError, a network failure from
        // the connection being torn down mid-request, ...), a signal the caller aborted means this
        // was a cancellation, not a real failure.
        if (signal?.aborted) throw new GenerationCancelledError();
        throw e;
      }
    },
  };
}
