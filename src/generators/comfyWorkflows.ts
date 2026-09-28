/**
 * Workflows saved in ComfyUI itself (its workflows folder), so the app can pick one from the server
 * instead of holding a pasted copy, and a guess at which of a workflow's nodes play which role.
 */
import type { ComfyNodeMapping, ComfyWorkflow } from './comfy';

const dir = (baseUrl: string) => `${baseUrl.replace(/\/+$/, '')}/api/userdata`;

/** The .json files in the server's workflows folder (subfolders included), e.g. "comic generator.json".
 * Empty when the folder doesn't exist yet: ComfyUI only creates it once something is saved. */
export async function listComfyWorkflows(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<string[]> {
  const res = await fetchImpl(`${dir(baseUrl)}?dir=workflows&recurse=true`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`ComfyUI workflow list failed: ${res.status}`);
  const files = (await res.json()) as string[];
  return files.filter((file) => file.endsWith('.json')).sort();
}

/** One saved workflow, which must be in API format. ComfyUI's Save button writes the editor's graph
 * format instead, which can't be submitted for generation, so that gets a message saying so. */
export async function loadComfyWorkflow(
  baseUrl: string,
  name: string,
  fetchImpl: typeof fetch = fetch
): Promise<ComfyWorkflow> {
  const res = await fetchImpl(`${dir(baseUrl)}/${encodeURIComponent(`workflows/${name}`)}`);
  if (!res.ok) throw new Error(`Couldn't load workflow "${name}" from ComfyUI: ${res.status}`);
  const workflow = (await res.json()) as unknown;
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    throw new Error(`Workflow "${name}" isn't a ComfyUI workflow.`);
  }
  if (Array.isArray((workflow as { nodes?: unknown }).nodes)) {
    throw new Error(
      `Workflow "${name}" is in ComfyUI's editor format. Export it with "Save (API Format)" and put that file in the workflows folder.`
    );
  }
  return workflow as ComfyWorkflow;
}

const isLink = (value: unknown): value is [string, number] =>
  Array.isArray(value) && typeof value[0] === 'string';

const byNodeId = (a: string, b: string) => Number(a) - Number(b) || a.localeCompare(b);

/** Guess the node mapping: SaveImage is the output, LoadImage nodes are the reference images, the
 * prompt node is whatever feeds a sampler's `positive` input, the size node is the latent with a
 * width and height, and the seed node is the one with a `seed`. Throws when there's no prompt or
 * output node to find. */
export function detectComfyNodes(workflow: ComfyWorkflow): ComfyNodeMapping {
  const ids = Object.keys(workflow).sort(byNodeId);
  const withClass = (test: (type: string) => boolean) =>
    ids.filter((id) => test(workflow[id].class_type));
  const textField = (id: string) =>
    ['prompt', 'text'].find((field) => typeof workflow[id]?.inputs[field] === 'string');

  // Follow the sampler's positive conditioning back to the node that holds the text.
  let promptId: string | undefined;
  const sampler = ids.find((id) => isLink(workflow[id].inputs.positive));
  let current = sampler && (workflow[sampler].inputs.positive as [string, number])[0];
  for (let hops = 0; current && workflow[current] && hops < 10; hops++) {
    if (textField(current)) {
      promptId = current;
      break;
    }
    const next = Object.values(workflow[current].inputs).find(isLink);
    current = next?.[0];
  }
  promptId ??= ids.find((id) => /TextEncode/.test(workflow[id].class_type) && textField(id));

  const outputId =
    withClass((t) => t === 'SaveImage')[0] ?? withClass((t) => t === 'PreviewImage')[0];
  if (!promptId) throw new Error('Couldn’t find a prompt node in that workflow.');
  if (!outputId) throw new Error('Couldn’t find a SaveImage node in that workflow.');

  const sizeId = ids.find((id) => {
    const { width, height } = workflow[id].inputs;
    return (
      typeof width === 'number' &&
      typeof height === 'number' &&
      /Latent/.test(workflow[id].class_type)
    );
  });
  const seedField = ['seed', 'noise_seed'].find((field) =>
    ids.some((id) => typeof workflow[id].inputs[field] === 'number')
  );
  const seedId = seedField && ids.find((id) => typeof workflow[id].inputs[seedField] === 'number');
  const referenceImageNodeIds = withClass((t) => t === 'LoadImage');

  return {
    positivePromptNodeId: promptId,
    promptField: textField(promptId),
    outputNodeId: outputId,
    ...(referenceImageNodeIds.length && { referenceImageNodeIds }),
    ...(sizeId && { sizeNodeId: sizeId }),
    ...(seedId && { seedNodeId: seedId, seedField }),
  };
}
