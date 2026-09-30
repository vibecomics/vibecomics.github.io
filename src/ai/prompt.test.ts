/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBlankProject } from '../state/project';
import type { ComicProject } from '../types/comic';
import { buildLayerPrompt, defaultReferenceNote } from './prompt';

function projectWithScene(): ComicProject {
  const project = createBlankProject('Test');
  project.metadata.style = 'STYLE: watercolor comic.';
  project.metadata.scenes.push({
    id: 'scene1',
    name: 'Rooftop',
    description: 'A rooftop at dusk, orange sky.',
    characterIds: [],
    imageIds: [],
  });
  const page = project.pages[0];
  page.prompt = 'The chase ends here.';
  const panel = page.panels[0];
  panel.prompt = 'Wide shot, low angle.';
  panel.layers.push({
    id: 'bg1',
    name: 'Background',
    kind: 'background',
    sceneId: 'scene1',
    prompt: 'Rain-slicked tiles in the foreground.',
    visible: true,
    x: 0,
    y: 0,
    width: 100,
    rotation: 0,
    opacity: 1,
  });
  return project;
}

test('buildLayerPrompt stitches STYLE, page, panel, scene and layer prompts in order', () => {
  const project = projectWithScene();
  const panelId = project.pages[0].panels[0].id;
  const prompt = buildLayerPrompt(project, panelId, 'bg1');
  const parts = prompt.split('\n\n');
  assert.deepEqual(parts.slice(0, 5), [
    'STYLE: watercolor comic.',
    'The chase ends here.',
    'Wide shot, low angle.',
    'A rooftop at dusk, orange sky.',
    'Rain-slicked tiles in the foreground.',
  ]);
  assert.match(parts[5], /full-bleed/i);
});

test('buildLayerPrompt skips empty parts', () => {
  const project = createBlankProject('Test');
  const panelId = project.pages[0].panels[0].id;
  project.pages[0].panels[0].layers.push({
    id: 'fg1',
    name: 'Layer',
    kind: 'foreground',
    prompt: 'A cat.',
    visible: true,
    x: 0,
    y: 0,
    width: 100,
    rotation: 0,
    opacity: 1,
  });
  assert.equal(
    buildLayerPrompt(project, panelId, 'fg1'),
    `A cat.\n\nForeground subject only, on a plain solid white background: no scene, no shadow, no border, no baked-in text.`
  );
});

test("buildLayerPrompt leaves the page prompt, panel prompt and background scene out of a foreground layer's prompt", () => {
  const project = projectWithScene();
  const panelId = project.pages[0].panels[0].id;
  project.pages[0].panels[0].layers.push({
    id: 'fg1',
    name: 'Layer',
    kind: 'foreground',
    prompt: 'A cat.',
    visible: true,
    x: 0,
    y: 0,
    width: 100,
    rotation: 0,
    opacity: 1,
  });
  const prompt = buildLayerPrompt(project, panelId, 'fg1');
  // Stray setting language anywhere in the prompt makes some generators draw a full scene instead of
  // an isolated cutout (confirmed by testing), even a scene description added "for context only, do
  // not draw it" — so none of the page prompt, panel prompt or scene description belong here.
  assert.doesNotMatch(prompt, /The chase ends here/);
  assert.doesNotMatch(prompt, /Wide shot, low angle/);
  assert.doesNotMatch(prompt, /rooftop/i);
});

test('buildLayerPrompt throws when the layer is not found', () => {
  const project = createBlankProject('Test');
  assert.throws(() => buildLayerPrompt(project, project.pages[0].panels[0].id, 'nope'));
});

function projectWithCharacterAndScene(): ComicProject {
  const project = createBlankProject('Test');
  project.metadata.characters.push({
    id: 'char1',
    name: 'Ashwini',
    description: '',
    sceneIds: [],
    imageIds: ['media1'],
  });
  project.metadata.scenes.push({
    id: 'scene1',
    name: 'Rooftop',
    description: '',
    characterIds: [],
    imageIds: ['media2'],
  });
  return project;
}

test('defaultReferenceNote names the character whose imageIds list this mediaId', () => {
  const project = projectWithCharacterAndScene();
  assert.match(defaultReferenceNote(project, 'media1') ?? '', /Ashwini/);
});

test('defaultReferenceNote names the scene whose imageIds list this mediaId', () => {
  const project = projectWithCharacterAndScene();
  assert.match(defaultReferenceNote(project, 'media2') ?? '', /Rooftop/);
});

test('defaultReferenceNote is undefined for a mediaId no entry lists', () => {
  const project = projectWithCharacterAndScene();
  assert.equal(defaultReferenceNote(project, 'media-unknown'), undefined);
});
