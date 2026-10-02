import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectComfyNodes, listComfyWorkflows, loadComfyWorkflow } from './comfyWorkflows';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

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

test('finds a second SaveImage fed by a background-removal node as the transparent output', () => {
  const workflow = {
    '1': { class_type: 'CLIPTextEncode', inputs: { text: 'x' } },
    '2': { class_type: 'KSampler', inputs: { positive: ['1', 0], seed: 1 } },
    '3': { class_type: 'VAEDecode', inputs: { samples: ['2', 0] } },
    '4': { class_type: 'SaveImage', inputs: { images: ['3', 0] } },
    '5': { class_type: 'InspyrenetRembg', inputs: { image: ['3', 0] } },
    '6': { class_type: 'SaveImage', inputs: { images: ['5', 0] } },
  };
  const nodes = detectComfyNodes(workflow);
  assert.equal(nodes.outputNodeId, '4');
  assert.equal(nodes.transparentOutputNodeId, '6');
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
  const api = { '1': { class_type: 'SaveImage', inputs: { images: ['2', 0] } } };
  assert.deepEqual(await loadComfyWorkflow('http://x', 'a.json', async () => json(api)), api);
  await assert.rejects(
    loadComfyWorkflow('http://x', 'a.json', async () => json({ nodes: [] })),
    /editor format/
  );
});
