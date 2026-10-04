/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBlankProject } from '../state/project';
import type { ComicProject } from '../types/comic';
import type { ComicBuilderDeps } from './deps';
import {
  clearCompletedQueueItems,
  defaultEntryReferences,
  defaultLayerReferences,
  generateLayerImage,
  getQueue,
  layerGenerationStatus,
} from './generation';

/** A minimal ComicBuilderDeps backed by one in-memory project: enough for the pure read-only
 * reference-picking functions under test, which only call getProject. */
function makeDeps(project: ComicProject): ComicBuilderDeps {
  return { getProject: () => project } as unknown as ComicBuilderDeps;
}

function withCharacter(mutate: (p: ComicProject) => void): ComicProject {
  const project = createBlankProject('Test');
  mutate(project);
  return project;
}

test("defaultEntryReferences never sends a different variation's images for an empty one", () => {
  const project = withCharacter((p) => {
    p.metadata.characters.push({
      id: 'char1',
      name: 'Mara',
      description: 'A girl.',
      imageIds: [],
      sceneIds: [],
      variations: [
        { id: 'front', name: 'Front view', prompt: 'Front view.', imageIds: ['m-front'] },
        { id: 'back', name: 'Back view', prompt: 'Back view.', imageIds: [] },
      ],
    });
  });
  const deps = makeDeps(project);

  const note = "Match this character's design exactly (face, proportions, outfit, colors).";

  // The empty "back" variation must not fall back to "front"'s image — a different orientation
  // would mislead the model (e.g. drawing a face on a back view).
  assert.deepEqual(defaultEntryReferences(deps, 'characters', 'char1', 'back'), []);
  // The populated variation still sends its own image.
  assert.deepEqual(defaultEntryReferences(deps, 'characters', 'char1', 'front'), [
    { mediaId: 'm-front', note },
  ]);
  // No variationId at all: any existing art across every variation is fair game.
  assert.deepEqual(defaultEntryReferences(deps, 'characters', 'char1'), [
    { mediaId: 'm-front', note },
  ]);
});

test("defaultEntryReferences falls back to the entry's own pose-neutral imageIds, not another variation's", () => {
  const project = withCharacter((p) => {
    p.metadata.characters.push({
      id: 'char1',
      name: 'Mara',
      description: 'A girl.',
      imageIds: ['m-neutral'],
      sceneIds: [],
      variations: [
        { id: 'front', name: 'Front view', prompt: 'Front view.', imageIds: ['m-front'] },
        { id: 'back', name: 'Back view', prompt: 'Back view.', imageIds: [] },
      ],
    });
  });
  const deps = makeDeps(project);

  assert.deepEqual(defaultEntryReferences(deps, 'characters', 'char1', 'back'), [
    {
      mediaId: 'm-neutral',
      note: "Match this character's design exactly (face, proportions, outfit, colors).",
    },
  ]);
});

test('defaultLayerReferences mirrors defaultEntryReferences for a layer pinned to an empty variation', () => {
  const project = withCharacter((p) => {
    p.metadata.characters.push({
      id: 'char1',
      name: 'Mara',
      description: 'A girl.',
      imageIds: [],
      sceneIds: [],
      variations: [
        { id: 'front', name: 'Front view', prompt: 'Front view.', imageIds: ['m-front'] },
        { id: 'back', name: 'Back view', prompt: 'Back view.', imageIds: [] },
      ],
    });
    p.pages[0].panels[0].layers.push({
      id: 'l1',
      name: 'Mara running',
      kind: 'foreground',
      visible: true,
      x: 0,
      y: 0,
      width: 100,
      rotation: 0,
      opacity: 1,
      subjectId: 'char1',
      variationId: 'back',
    });
  });
  const deps = makeDeps(project);

  assert.deepEqual(defaultLayerReferences(deps, project.pages[0].panels[0].id, 'l1'), []);
});

test("defaultLayerReferences sends the layer's own images first, then the subject's, once each", () => {
  const project = withCharacter((p) => {
    p.metadata.characters.push({
      id: 'char1',
      name: 'Mara',
      description: 'A girl.',
      imageIds: ['m-sheet'],
      sceneIds: [],
      variations: [],
    });
    for (const id of ['m-current', 'm-old', 'm-sheet']) {
      p.metadata.media.push({ id, name: id, fileName: `${id}.png`, mimeType: 'image/png' });
    }
    p.pages[0].panels[0].layers.push({
      id: 'l1',
      name: 'Mara running',
      kind: 'foreground',
      visible: true,
      x: 0,
      y: 0,
      width: 100,
      rotation: 0,
      opacity: 1,
      subjectId: 'char1',
      mediaId: 'm-current',
      mediaHistory: ['m-old', 'm-sheet', 'm-gone'],
    });
  });
  const deps = makeDeps(project);

  const note = "Match this character's design exactly (face, proportions, outfit, colors).";
  assert.deepEqual(defaultLayerReferences(deps, project.pages[0].panels[0].id, 'l1'), [
    { mediaId: 'm-current' },
    { mediaId: 'm-old' },
    { mediaId: 'm-sheet', note },
  ]);
});

test('each layer generation gets its own queue row, and the layer stays queued until its last one ends', async () => {
  clearCompletedQueueItems();
  const project = withCharacter((p) => {
    p.pages[0].panels[0].layers.push({
      id: 'l1',
      name: 'Mara',
      kind: 'foreground',
      visible: true,
      x: 0,
      y: 0,
      width: 100,
      rotation: 0,
      opacity: 1,
    });
  });
  // No generator configured, so each run fails straight away; the queue and status are what's tested.
  const deps = {
    getProject: () => project,
    getGeneratorConfig: () => null,
  } as unknown as ComicBuilderDeps;
  const panelId = project.pages[0].panels[0].id;

  const first = generateLayerImage(deps, panelId, 'l1').catch((e: unknown) => e);
  const second = generateLayerImage(deps, panelId, 'l1').catch((e: unknown) => e);
  assert.equal(layerGenerationStatus(panelId, 'l1'), 'queued');
  assert.equal(getQueue().length, 2);
  assert.deepEqual(getQueue()[0].target, { type: 'layer', panelId, layerId: 'l1' });

  await Promise.all([first, second]);
  assert.equal(layerGenerationStatus(panelId, 'l1'), undefined);
  assert.deepEqual(
    getQueue().map((i) => i.status),
    ['error', 'error']
  );
});
