/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBlankProject } from '../state/project';
import type { ComicProject } from '../types/comic';
import type { ComicBuilderDeps } from './deps';
import {
  addToHistoryPatch,
  assertVariation,
  cascadeCharacterStyleDirty,
  cascadeSceneStyleDirty,
  cascadeStyleDirty,
  dirtyLayerRefs,
  dirtyVariationRefs,
  imageSwapPatch,
  imageUnlinkPatch,
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

test('imageUnlinkPatch goes dirty again when there is a prompt, without touching history', () => {
  const layer = { mediaId: 'm1', mediaHistory: ['m0'], prompt: 'A table.', dirty: false } as never;
  assert.deepEqual(imageUnlinkPatch(layer), { dirty: true });
});

test('imageUnlinkPatch leaves dirty false when there is no prompt to act on', () => {
  const layer = { mediaId: 'm1', prompt: '', dirty: false } as never;
  assert.deepEqual(imageUnlinkPatch(layer), { dirty: false });
});

test('imageUnlinkPatch on a layer with no current image still just reports dirty', () => {
  const layer = { prompt: '', dirty: false } as never;
  assert.deepEqual(imageUnlinkPatch(layer), { dirty: false });
});

test('addToHistoryPatch moves an image already in history back to the front', () => {
  const layer = { mediaId: 'm2', mediaHistory: ['m1', 'm0'] } as never;
  assert.deepEqual(addToHistoryPatch(layer, 'm0'), { mediaHistory: ['m0', 'm1'] });
});

test('addToHistoryPatch leaves history alone when the image is already the current one', () => {
  const layer = { mediaId: 'm2', mediaHistory: ['m1'] } as never;
  assert.deepEqual(addToHistoryPatch(layer, 'm2'), {});
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

test('variationsApi.add sets dirty like layers.add: true with a prompt and no image, false with one', () => {
  const deps = makeDeps(createBlankProject('Test'));
  const entry = storyApi(deps, 'objects').create({ name: 'Locker' });
  const variations = variationsApi(deps);
  const withPromptOnly = variations.add('objects', entry.id, {
    name: 'Open',
    prompt: 'Door open.',
  });
  assert.equal(withPromptOnly.dirty, true);
  const withImage = variations.add('objects', entry.id, {
    name: 'Closed',
    prompt: 'Door closed.',
    imageIds: ['m1'],
  });
  assert.equal(withImage.dirty, false);
  const noPrompt = variations.add('objects', entry.id, { name: 'Untitled' });
  assert.equal(noPrompt.dirty, false);
  const explicit = variations.add('objects', entry.id, { name: 'Forced', dirty: true });
  assert.equal(explicit.dirty, true);
});

test('variationsApi.update marks dirty on a prompt change, and clears it when an image is set', () => {
  const deps = makeDeps(createBlankProject('Test'));
  const entry = storyApi(deps, 'objects').create({ name: 'Locker' });
  const variations = variationsApi(deps);
  const v = variations.add('objects', entry.id, { name: 'Open' });
  assert.equal(v.dirty, false); // no prompt yet

  const prompted = variations.update('objects', entry.id, v.id, { prompt: 'Door wide open.' });
  assert.equal(prompted.dirty, true);

  const imaged = variations.update('objects', entry.id, v.id, { imageIds: ['m1'] });
  assert.equal(imaged.dirty, false);

  // Touching an unrelated field (name) leaves dirty alone.
  const renamed = variations.update('objects', entry.id, v.id, { name: 'Wide Open' });
  assert.equal(renamed.dirty, false);
});

test("characters/scenes/objects.update(description) marks every one of the entry's variations dirty", () => {
  const deps = makeDeps(createBlankProject('Test'));
  const story = storyApi(deps, 'objects');
  const entry = story.create({
    name: 'Sword',
    description: 'A plain blade.',
    variations: [{ id: 'v1', name: 'Default', prompt: '', imageIds: [] }],
  });
  const variations = variationsApi(deps);
  variations.update('objects', entry.id, entry.variations[0].id, { imageIds: ['m1'] });
  assert.equal(variations.get('objects', entry.id, entry.variations[0].id)?.dirty, false);

  const updated = story.update(entry.id, { description: 'A glowing blade with a pink gem.' });
  assert.ok(updated.variations.every((v) => v.dirty === true));

  // Replacing `variations` wholesale in the same call is the caller's own art plan: don't override it.
  const replaced = story.update(entry.id, {
    description: 'Yet another description.',
    variations: [{ id: 'v1', name: 'Default', prompt: '', imageIds: ['m2'], dirty: false }],
  });
  assert.deepEqual(
    replaced.variations.map((v) => v.dirty),
    [false]
  );

  // A field unrelated to description (e.g. name) does not touch dirty.
  const renamed = story.update(entry.id, { name: 'Ash’s Sword' });
  assert.ok(renamed.variations.every((v) => v.dirty === false));
});

test('dirtyVariationRefs finds every dirty variation across characters, scenes and objects', () => {
  const deps = makeDeps(createBlankProject('Test'));
  const char = storyApi(deps, 'characters').create({ name: 'Mara', description: 'A girl.' });
  const variations = variationsApi(deps);
  for (const v of char.variations) {
    variations.update('characters', char.id, v.id, { imageIds: [`m-${v.id}`] });
  }
  const [front] = char.variations;
  variations.update('characters', char.id, front.id, { prompt: 'New front pose.' });

  assert.deepEqual(dirtyVariationRefs(deps.getProject()!), [
    { kind: 'characters', entryId: char.id, variationId: front.id },
  ]);
});

test('cascadeStyleDirty marks every layer and variation with a prompt dirty, and leaves empty ones alone', () => {
  const deps = makeDeps(createBlankProject('Test'));
  const char = storyApi(deps, 'characters').create({ name: 'Mara', description: 'A girl.' });
  const variations = variationsApi(deps);
  for (const v of char.variations) {
    variations.update('characters', char.id, v.id, { imageIds: [`m-${v.id}`] });
  }
  const noDescription = storyApi(deps, 'objects').create({
    name: 'Blank',
    variations: [{ id: 'v1', name: 'Default', prompt: '', imageIds: [] }],
  });
  const baseLayer = {
    kind: 'foreground' as const,
    visible: true,
    x: 0,
    y: 0,
    width: 100,
    rotation: 0,
    opacity: 1,
    dirty: false,
  };
  deps.updateProject((p) => {
    p.pages[0].panels[0].layers.push(
      { ...baseLayer, id: 'l1', name: 'A', prompt: 'Something.' },
      { ...baseLayer, id: 'l2', name: 'B', prompt: '' }
    );
  });

  cascadeStyleDirty(deps.getProject()!);

  const layers = deps.getProject()!.pages[0].panels[0].layers;
  assert.equal(layers.find((l) => l.id === 'l1')?.dirty, true);
  assert.ok(!layers.find((l) => l.id === 'l2')?.dirty); // no prompt at all: nothing to act on
  assert.ok(
    storyApi(deps, 'characters')
      .get(char.id)!
      .variations.every((v) => v.dirty === true)
  );
  assert.ok(!storyApi(deps, 'objects').get(noDescription.id)!.variations[0].dirty);
});

test('cascadeCharacterStyleDirty and cascadeSceneStyleDirty only dirty their own kind', () => {
  const deps = makeDeps(createBlankProject('Test'));
  const char = storyApi(deps, 'characters').create({ name: 'Mara', description: 'A girl.' });
  const obj = storyApi(deps, 'objects').create({ name: 'Table', description: 'Wooden.' });
  const scene = storyApi(deps, 'scenes').create({ name: 'Room', description: 'A room.' });
  const variations = variationsApi(deps);
  for (const [kind, entry] of [
    ['characters', char],
    ['objects', obj],
    ['scenes', scene],
  ] as const) {
    for (const v of entry.variations) {
      variations.update(kind, entry.id, v.id, { imageIds: [`m-${v.id}`] });
    }
  }
  const baseLayer = {
    visible: true,
    x: 0,
    y: 0,
    width: 100,
    rotation: 0,
    opacity: 1,
    dirty: false,
  };
  deps.updateProject((p) => {
    p.pages[0].panels[0].layers.push(
      {
        ...baseLayer,
        id: 'charL',
        name: 'C',
        kind: 'foreground',
        subjectId: char.id,
        prompt: 'Mara.',
      },
      {
        ...baseLayer,
        id: 'objL',
        name: 'O',
        kind: 'foreground',
        subjectId: obj.id,
        prompt: 'Table.',
      },
      {
        ...baseLayer,
        id: 'bgL',
        name: 'B',
        kind: 'background',
        sceneId: scene.id,
        prompt: 'Room bg.',
      }
    );
  });

  cascadeCharacterStyleDirty(deps.getProject()!);
  let layers = deps.getProject()!.pages[0].panels[0].layers;
  assert.equal(layers.find((l) => l.id === 'charL')?.dirty, true);
  assert.ok(!layers.find((l) => l.id === 'objL')?.dirty);
  assert.ok(!layers.find((l) => l.id === 'bgL')?.dirty);
  assert.ok(
    storyApi(deps, 'characters')
      .get(char.id)!
      .variations.every((v) => v.dirty === true)
  );
  assert.ok(
    storyApi(deps, 'objects')
      .get(obj.id)!
      .variations.every((v) => !v.dirty)
  );
  assert.ok(
    storyApi(deps, 'scenes')
      .get(scene.id)!
      .variations.every((v) => !v.dirty)
  );

  // Reset and check the scene scope is the mirror image.
  deps.updateProject((p) => {
    for (const layer of p.pages[0].panels[0].layers) layer.dirty = false;
    for (const kind of ['characters', 'objects', 'scenes'] as const) {
      for (const entry of p.metadata[kind]) for (const v of entry.variations) v.dirty = false;
    }
  });
  cascadeSceneStyleDirty(deps.getProject()!);
  layers = deps.getProject()!.pages[0].panels[0].layers;
  assert.ok(!layers.find((l) => l.id === 'charL')?.dirty);
  assert.ok(!layers.find((l) => l.id === 'objL')?.dirty);
  assert.equal(layers.find((l) => l.id === 'bgL')?.dirty, true);
  assert.ok(
    storyApi(deps, 'characters')
      .get(char.id)!
      .variations.every((v) => !v.dirty)
  );
  assert.ok(
    storyApi(deps, 'objects')
      .get(obj.id)!
      .variations.every((v) => !v.dirty)
  );
  assert.ok(
    storyApi(deps, 'scenes')
      .get(scene.id)!
      .variations.every((v) => v.dirty === true)
  );
});

test('metadata.setStyle cascades dirty only when the text actually changes', () => {
  const deps = makeDeps(createBlankProject('Test'));
  deps.updateProject((p) => {
    p.pages[0].panels[0].layers.push({
      id: 'l1',
      name: 'A',
      kind: 'foreground',
      visible: true,
      x: 0,
      y: 0,
      width: 100,
      rotation: 0,
      opacity: 1,
      prompt: 'Something.',
      dirty: false,
    });
  });

  // Setting the same (empty) style is a no-op: nothing to cascade.
  const before = deps.getProject()!.pages[0].panels[0].layers[0].dirty;
  deps.updateProject((p) => {
    if (p.metadata.style !== p.metadata.style) cascadeStyleDirty(p);
  });
  assert.equal(deps.getProject()!.pages[0].panels[0].layers[0].dirty, before);

  deps.updateProject((p) => {
    if (p.metadata.style !== 'New style') cascadeStyleDirty(p);
    p.metadata.style = 'New style';
  });
  assert.equal(deps.getProject()!.pages[0].panels[0].layers[0].dirty, true);
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
