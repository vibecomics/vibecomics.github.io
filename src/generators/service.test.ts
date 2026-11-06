/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProvider } from './service';
import { assertValidGeneratorConfig, hasServiceUrl } from './types';

const png = new Uint8Array([137, 80, 78, 71]);

test('config needs a url, a prompt, or both, and a valid url', () => {
  assert.throws(() => assertValidGeneratorConfig({ provider: 'service' }), /url, a prompt/);
  assert.throws(() => assertValidGeneratorConfig({ provider: 'comfy' }), /service/);
  assert.throws(() => assertValidGeneratorConfig({ provider: 'service', url: 'ftp://x' }), /http/);
  assertValidGeneratorConfig({ provider: 'service', prompt: 'call my tool' });
  assertValidGeneratorConfig({ provider: 'service', url: 'http://localhost:8188/x', prompt: 'y' });
});

test('a prompt-only config cannot be called by the app and repeats the prompt', () => {
  const config = { provider: 'service' as const, prompt: 'use the foo tool' };
  assert.equal(hasServiceUrl(config), false);
  assert.throws(() => createProvider(config), /use the foo tool/);
});

test('generate POSTs the request JSON (without the signal) and returns the image as a data URL', async () => {
  let seen: { url: string; body: Record<string, unknown> } | undefined;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, body: JSON.parse(init.body as string) };
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  }) as unknown as typeof fetch;
  const provider = createProvider({ provider: 'service', url: 'http://svc/generate' }, fetchImpl);
  const dataUrl = await provider.generate({
    kind: 'foreground',
    prompt: 'a cat',
    referenceImages: ['data:image/png;base64,AAAA'],
    transparent: true,
    signal: new AbortController().signal,
  });
  assert.match(dataUrl, /^data:image\/png;base64,/);
  assert.equal(seen?.url, 'http://svc/generate');
  assert.deepEqual(seen?.body, {
    kind: 'foreground',
    prompt: 'a cat',
    referenceImages: ['data:image/png;base64,AAAA'],
    transparent: true,
  });
});

test('errors from the service surface their message', async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ error: 'no checkpoint' }), {
      status: 500,
    })) as unknown as typeof fetch;
  const provider = createProvider({ provider: 'service', url: 'http://svc/g' }, fetchImpl);
  await assert.rejects(
    provider.generate({ kind: 'scene', prompt: 'x', referenceImages: [] }),
    /500 no checkpoint/
  );
  await assert.rejects(provider.test(), /500 no checkpoint/);
});
