/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertValidComfyConfig, createComfyProvider, listComfyQwenModels } from './comfy';
import type { ComfyConfig } from './comfy';
import { GenerationCancelledError } from './types';

const config: ComfyConfig = {
  baseUrl: 'http://comfy.local:8188',
  workflow: {
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'placeholder' } },
    '9': { class_type: 'SaveImage', inputs: {} },
    '12': { class_type: 'LoadImage', inputs: { image: '' } },
  },
  nodes: { positivePromptNodeId: '6', outputNodeId: '9', referenceImageNodeIds: ['12'] },
};

test('assertValidComfyConfig accepts a well-formed config', () => {
  assert.doesNotThrow(() => assertValidComfyConfig(config));
});

test('assertValidComfyConfig rejects a node id missing from the workflow', () => {
  assert.throws(
    () => assertValidComfyConfig({ ...config, nodes: { ...config.nodes, outputNodeId: '99' } }),
    /outputNodeId/
  );
});

function fakeFetch(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/upload/image')) {
      return new Response(JSON.stringify({ name: 'ref-0.png' }), { status: 200 });
    }
    if (url.endsWith('/prompt')) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.prompt['6'].inputs.text, 'a cat');
      assert.equal(body.prompt['12'].inputs.image, 'ref-0.png');
      return new Response(JSON.stringify({ prompt_id: 'p1' }), { status: 200 });
    }
    if (url.includes('/history/')) {
      const outputs = { '9': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } };
      return new Response(JSON.stringify({ p1: { outputs } }), { status: 200 });
    }
    if (url.includes('/view')) {
      return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), {
        status: 200,
      });
    }
    if (url.endsWith('/system_stats')) return new Response('{}', { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}

test('createComfyProvider generates: uploads references, patches the workflow, polls, and returns a data URL', async () => {
  const provider = createComfyProvider(config, fakeFetch());
  assert.equal(provider.maxReferenceImages, 1);
  const dataUrl = await provider.generate({
    prompt: 'a cat',
    referenceImages: ['data:image/png;base64,AAAA'],
  });
  assert.match(dataUrl, /^data:image\/png;base64,/);
});

test('createComfyProvider.generate() rejects with GenerationCancelledError when aborted mid-request', async () => {
  // Mimics real fetch's own abort handling: reject immediately for a signal that's already aborted
  // by the time fetch is called, otherwise wait for it to abort later.
  const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener('abort', abort);
    })) as typeof fetch;

  const controller = new AbortController();
  const generation = createComfyProvider(config, fetchImpl).generate({
    prompt: 'a cat',
    referenceImages: [],
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(generation, GenerationCancelledError);
});

test('createComfyProvider.test() succeeds when the server answers', async () => {
  await assert.doesNotReject(() => createComfyProvider(config, fakeFetch()).test());
});

test('createComfyProvider drops an unused reference-image node and its link, rather than leave a placeholder image wired in', async () => {
  const withConsumer: ComfyConfig = {
    ...config,
    workflow: {
      ...config.workflow,
      '6': {
        class_type: 'TextEncodeQwenImageEditPlus',
        inputs: { prompt: 'placeholder', image1: ['12', 0] },
      },
    },
  };
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/prompt')) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.prompt['12'], undefined);
      assert.equal(body.prompt['6'].inputs.image1, undefined);
      return new Response(JSON.stringify({ prompt_id: 'p1' }), { status: 200 });
    }
    if (url.includes('/history/')) {
      const outputs = { '9': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } };
      return new Response(JSON.stringify({ p1: { outputs } }), { status: 200 });
    }
    if (url.includes('/view'))
      return new Response(new Blob([new Uint8Array([1])], { type: 'image/png' }), { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  await createComfyProvider(withConsumer, fetchImpl).generate({
    prompt: 'a cat',
    referenceImages: [],
  });
});

test('createComfyProvider drops the transparent-output branch when the request does not want it', async () => {
  const withBranch: ComfyConfig = {
    ...config,
    workflow: {
      ...config.workflow,
      '20': { class_type: 'InspyrenetRembg', inputs: { image: ['9', 0] } },
      '21': { class_type: 'SaveImage', inputs: { images: ['20', 0] } },
    },
    nodes: { ...config.nodes, transparentOutputNodeId: '21' },
  };
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/prompt')) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.prompt['21'], undefined, 'the unused transparent branch should be pruned');
      assert.equal(
        body.prompt['20'].inputs.image[0],
        '9',
        'the branch itself may be left dangling'
      );
      return new Response(JSON.stringify({ prompt_id: 'p1' }), { status: 200 });
    }
    if (url.includes('/history/')) {
      const outputs = { '9': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } };
      return new Response(JSON.stringify({ p1: { outputs } }), { status: 200 });
    }
    if (url.includes('/view'))
      return new Response(new Blob([new Uint8Array([1])], { type: 'image/png' }), { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  await createComfyProvider(withBranch, fetchImpl).generate({
    prompt: 'a cat',
    referenceImages: [],
  });
});

test('createComfyProvider reads from the transparent-output node when the request wants it', async () => {
  const withBranch: ComfyConfig = {
    ...config,
    workflow: {
      ...config.workflow,
      '20': { class_type: 'InspyrenetRembg', inputs: { image: ['9', 0] } },
      '21': { class_type: 'SaveImage', inputs: { images: ['20', 0] } },
    },
    nodes: { ...config.nodes, transparentOutputNodeId: '21' },
  };
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/prompt')) {
      const body = JSON.parse(String(init?.body));
      assert.ok(body.prompt['21'], 'the transparent branch should be kept');
      return new Response(JSON.stringify({ prompt_id: 'p1' }), { status: 200 });
    }
    if (url.includes('/history/')) {
      const outputs = {
        '9': { images: [{ filename: 'raw.png', subfolder: '', type: 'output' }] },
        '21': { images: [{ filename: 'cut.png', subfolder: '', type: 'output' }] },
      };
      return new Response(JSON.stringify({ p1: { outputs } }), { status: 200 });
    }
    if (url.includes('/view')) {
      assert.match(url, /filename=cut\.png/);
      return new Response(new Blob([new Uint8Array([1])], { type: 'image/png' }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  await createComfyProvider(withBranch, fetchImpl).generate({
    prompt: 'a cat',
    referenceImages: [],
    transparent: true,
  });
});

test('listComfyQwenModels reads the installed UNET/CLIP/VAE/LoRA filenames from object_info', async () => {
  const byClass: Record<string, [string, string]> = {
    UNETLoader: ['unet_name', 'u.safetensors'],
    CLIPLoader: ['clip_name', 'c.safetensors'],
    VAELoader: ['vae_name', 'v.safetensors'],
    LoraLoaderModelOnly: ['lora_name', 'l.safetensors'],
  };
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const classType = String(input).split('/object_info/')[1];
    const [inputName, value] = byClass[classType];
    return new Response(
      JSON.stringify({ [classType]: { input: { required: { [inputName]: [[value]] } } } }),
      { status: 200 }
    );
  }) as typeof fetch;
  assert.deepEqual(await listComfyQwenModels('http://comfy.local:8188', fetchImpl), {
    unet: ['u.safetensors'],
    clip: ['c.safetensors'],
    vae: ['v.safetensors'],
    lora: ['l.safetensors'],
  });
});
