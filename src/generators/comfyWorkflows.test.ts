import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildQwenImageEditWorkflow, QWEN_IMAGE_EDIT_NODES } from './defaultWorkflow';
import { detectComfyNodes, listComfyWorkflows, loadComfyWorkflow } from './comfyWorkflows';

const models = { unet: 'u', clip: 'c', vae: 'v', lora: 'l' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test('detects the built-in starter workflow exactly', () => {
  assert.deepEqual(detectComfyNodes(buildQwenImageEditWorkflow(models)), {
    ...QWEN_IMAGE_EDIT_NODES,
    seedField: 'seed',
  });
});

test('follows the positive input through intermediate nodes', () => {
  const workflow = {
    '1': { class_type: 'CLIPTextEncode', inputs: { text: 'x', clip: ['9', 0] } },
    '2': { class_type: 'FluxGuidance', inputs: { conditioning: ['1', 0], guidance: 3 } },
    '3': { class_type: 'KSampler', inputs: { positive: ['2', 0], seed: 1 } },
    '4': { class_type: 'SaveImage', inputs: { images: ['3', 0] } },
  };
  const nodes = detectComfyNodes(workflow);
  assert.equal(nodes.positivePromptNodeId, '1');
  assert.equal(nodes.promptField, 'text');
  assert.equal(nodes.referenceImageNodeIds, undefined);
});

test('a workflow with no output is rejected', () => {
  assert.throws(
    () => detectComfyNodes({ '1': { class_type: 'CLIPTextEncode', inputs: { text: '' } } }),
    /SaveImage/
  );
});

test('lists .json workflows and treats a missing folder as empty', async () => {
  assert.deepEqual(
    await listComfyWorkflows('http://x/', async () => json(['b.json', 'a.json', 'n.txt'])),
    ['a.json', 'b.json']
  );
  assert.deepEqual(
    await listComfyWorkflows(
      'http://x',
      async () => new Response('Directory not found', { status: 404 })
    ),
    []
  );
});

test('loads an API-format workflow and rejects the editor format', async () => {
  const api = buildQwenImageEditWorkflow(models);
  assert.deepEqual(await loadComfyWorkflow('http://x', 'a.json', async () => json(api)), api);
  await assert.rejects(
    loadComfyWorkflow('http://x', 'a.json', async () => json({ nodes: [] })),
    /editor format/
  );
});
