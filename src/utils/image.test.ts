/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pngDimensions } from './image';

function fakePng(width: number, height: number): string {
  const bytes = new Uint8Array(24);
  const view = new DataView(bytes.buffer);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:image/png;base64,${btoa(binary)}`;
}

test('pngDimensions reads width/height from the IHDR chunk', () => {
  assert.deepEqual(pngDimensions(fakePng(384, 192)), { width: 384, height: 192 });
});

test('pngDimensions returns null for a non-PNG data URL', () => {
  assert.equal(pngDimensions('data:image/jpeg;base64,AAAA'), null);
});
