/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBlankProject } from '../state/project';
import type { ComicProject } from '../types/comic';
import { addToHistoryPatch, dirtyLayerRefs, imageSwapPatch } from './builders';

test('imageSwapPatch keeps the old image in history and clears dirty', () => {
  const layer = { mediaId: 'm1', mediaHistory: ['m0'], dirty: true } as never;
  const patch = imageSwapPatch(layer, 'm2');
  assert.deepEqual(patch, { mediaId: 'm2', mediaHistory: ['m1', 'm0'], dirty: false });
});

test('imageSwapPatch restoring a history entry removes it from history and re-adds the current one', () => {
  const layer = { mediaId: 'm2', mediaHistory: ['m1', 'm0'], dirty: false } as never;
  const patch = imageSwapPatch(layer, 'm1');
  assert.deepEqual(patch, { mediaId: 'm1', mediaHistory: ['m2', 'm0'], dirty: false });
});

test('imageSwapPatch on a layer with no previous image sets no history', () => {
  const patch = imageSwapPatch({} as never, 'm1');
  assert.deepEqual(patch, { mediaId: 'm1', dirty: false });
});

test('addToHistoryPatch adds the image to the front of history without touching mediaId', () => {
  const layer = { mediaId: 'm1', mediaHistory: ['m0'] } as never;
  assert.deepEqual(addToHistoryPatch(layer, 'm2'), { mediaHistory: ['m2', 'm0'] });
});

test('addToHistoryPatch moves an image already in history back to the front', () => {
  const layer = { mediaId: 'm2', mediaHistory: ['m1', 'm0'] } as never;
  assert.deepEqual(addToHistoryPatch(layer, 'm0'), { mediaHistory: ['m0', 'm1'] });
});

test('dirtyLayerRefs finds every dirty layer across pages and panels', () => {
  const project: ComicProject = createBlankProject('Test');
  project.pages[0].panels[0].layers.push(
    {
      id: 'l1',
      name: 'A',
      kind: 'foreground',
      visible: true,
      x: 0,
      y: 0,
      width: 100,
      rotation: 0,
      opacity: 1,
      dirty: true,
    },
    {
      id: 'l2',
      name: 'B',
      kind: 'foreground',
      visible: true,
      x: 0,
      y: 0,
      width: 100,
      rotation: 0,
      opacity: 1,
      dirty: false,
    }
  );
  assert.deepEqual(dirtyLayerRefs(project), [
    { pageId: project.pages[0].id, panelId: project.pages[0].panels[0].id, layerId: 'l1' },
  ]);
});
