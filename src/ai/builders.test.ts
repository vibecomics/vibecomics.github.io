/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBlankProject } from '../state/project';
import type { ComicProject } from '../types/comic';
import type { ComicBuilderDeps } from './deps';
import {
  addToHistoryPatch,
  assertVariation,
  dirtyLayerRefs,
  imageSwapPatch,
  storyApi,
  variationsApi,
} from './builders';

/** A minimal ComicBuilderDeps backed by one in-memory project, enough for storyApi/variationsApi
 * (which only read getProject and mutate through updateProject). */
function makeDeps(project: ComicProject): ComicBuilderDeps {
  let current = project;
  return {
    getProject: () => current,
    updateProject: (mut: (p: ComicProject) => void) => {
      const next = structuredClone(current);
      mut(next);
      current = next;
    },
  } as unknown as ComicBuilderDeps;
}

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

test('storyApi(characters).create seeds Front/Back/Side view variations by default', () => {
  const deps = makeDeps(createBlankProject('Test'));
  const entry = storyApi(deps, 'characters').create({ name: 'Mara' });
  assert.deepEqual(
    entry.variations.map((v) => v.name),
    ['Front view', 'Back view', 'Side view']
  );
  assert.ok(entry.variations.every((v) => v.imageIds.length === 0 && v.id));
});

test('storyApi(objects/scenes).create starts with no variations, and an explicit list wins', () => {
  const deps = makeDeps(createBlankProject('Test'));
  assert.deepEqual(storyApi(deps, 'objects').create({ name: 'Sword' }).variations, []);
  assert.deepEqual(storyApi(deps, 'scenes').create({ name: 'Roof' }).variations, []);
  const custom = [{ id: 'v1', name: 'Open', prompt: 'Door open.', imageIds: [] }];
  assert.deepEqual(
    storyApi(deps, 'characters').create({ name: 'Robo', variations: custom }).variations,
    custom
  );
});

test("variationsApi add/update/delete manage one entry's variations", () => {
  const deps = makeDeps(createBlankProject('Test'));
  const entry = storyApi(deps, 'objects').create({ name: 'Locker' });
  const variations = variationsApi(deps);
  const open = variations.add('objects', entry.id, { name: 'Open', prompt: 'Door open.' });
  assert.equal(variations.list('objects', entry.id).length, 1);
  variations.update('objects', entry.id, open.id, { imageIds: ['m1'] });
  assert.deepEqual(variations.get('objects', entry.id, open.id)?.imageIds, ['m1']);
  assert.equal(variations.delete('objects', entry.id, open.id), true);
  assert.deepEqual(variations.list('objects', entry.id), []);
});

test('deleting a variation clears any layer pinned to it', () => {
  const deps = makeDeps(createBlankProject('Test'));
  const entry = storyApi(deps, 'objects').create({ name: 'Locker' });
  const variations = variationsApi(deps);
  const open = variations.add('objects', entry.id, { name: 'Open' });
  deps.updateProject((p) => {
    p.pages[0].panels[0].layers.push({
      id: 'l1',
      name: 'L',
      kind: 'foreground',
      visible: true,
      x: 0,
      y: 0,
      width: 100,
      rotation: 0,
      opacity: 1,
      subjectId: entry.id,
      variationId: open.id,
    });
  });
  variations.delete('objects', entry.id, open.id);
  const layer = deps.getProject()!.pages[0].panels[0].layers[0];
  assert.equal('variationId' in layer, false);
});

test("assertVariation throws for an id not among the owner's variations", () => {
  const project = createBlankProject('Test');
  project.metadata.objects.push({
    id: 'obj1',
    name: 'Sword',
    description: '',
    imageIds: [],
    sceneIds: [],
    variations: [{ id: 'v1', name: 'Shining', prompt: '', imageIds: [] }],
  });
  assert.throws(() => assertVariation(project, 'obj1', 'nope'), /not found/);
  assert.doesNotThrow(() => assertVariation(project, 'obj1', 'v1'));
});
