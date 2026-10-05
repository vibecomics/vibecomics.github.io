/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBlankProject } from '../state/project';
import type { ComicProject } from '../types/comic';
import {
  allEntryImageIds,
  buildLayerPrompt,
  buildLayerPromptParts,
  buildReferencePromptParts,
  defaultReferenceNote,
  initialPromptText,
  insertPartText,
  removePartText,
} from './prompt';

function projectWithScene(): ComicProject {
  const project = createBlankProject('Test');
  project.metadata.style = 'STYLE: watercolor comic.';
  project.metadata.scenes.push({
    id: 'scene1',
    name: 'Rooftop',
    description: 'A rooftop at dusk, orange sky.',
    characterIds: [],
    imageIds: [],
    variations: [],
  });
  const panel = project.pages[0].panels[0];
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

test('buildLayerPrompt stitches STYLE, scene and layer prompts in order', () => {
  const project = projectWithScene();
  const panelId = project.pages[0].panels[0].id;
  const prompt = buildLayerPrompt(project, panelId, 'bg1');
  const parts = prompt.split('\n\n');
  assert.deepEqual(parts.slice(0, 3), [
    'STYLE: watercolor comic.',
    'A rooftop at dusk, orange sky.',
    'Rain-slicked tiles in the foreground.',
  ]);
  assert.match(parts[3], /full-bleed/i);
  assert.doesNotMatch(prompt, /Wide shot, low angle/);
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
  const prompt = buildLayerPrompt(project, panelId, 'fg1');
  assert.match(prompt, /^A cat\.\n\n/);
  assert.match(prompt, /single image of one pose only/i);
  assert.match(prompt, /not a multi-view turnaround sheet/i);
});

test("buildLayerPrompt leaves the background scene out of a foreground layer's prompt", () => {
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
  // not draw it" — so the scene description does not belong here.
  assert.doesNotMatch(prompt, /Wide shot, low angle/);
  assert.doesNotMatch(prompt, /rooftop/i);
});

test('buildLayerPrompt throws when the layer is not found', () => {
  const project = createBlankProject('Test');
  assert.throws(() => buildLayerPrompt(project, project.pages[0].panels[0].id, 'nope'));
});

test('buildLayerPromptParts includes Scene style (not Character style) for a background layer', () => {
  const project = projectWithScene();
  project.metadata.sceneStyle = 'Atmospheric backgrounds.';
  project.metadata.characterStyle = 'Big expressive eyes.';
  const panelId = project.pages[0].panels[0].id;
  const parts = buildLayerPromptParts(project, panelId, 'bg1');
  assert.deepEqual(
    parts.map((p) => p.label),
    ['Style', 'Scene style', 'Scene', 'Layer prompt', 'Technical requirements']
  );
  assert.equal(parts[1].text, 'Atmospheric backgrounds.');
});

test('buildLayerPromptParts includes Character style for a character foreground layer, not for an object one', () => {
  const project = createBlankProject('Test');
  project.metadata.style = 'STYLE: watercolor comic.';
  project.metadata.characterStyle = 'Big expressive eyes.';
  project.metadata.sceneStyle = 'Atmospheric backgrounds.';
  project.metadata.characters.push({
    id: 'char1',
    name: 'Ashwini',
    description: 'A girl.',
    sceneIds: [],
    imageIds: [],
    variations: [],
  });
  project.metadata.objects.push({
    id: 'obj1',
    name: 'Table',
    description: 'Wooden.',
    imageIds: [],
    sceneIds: [],
    variations: [],
  });
  const panelId = project.pages[0].panels[0].id;
  const baseLayer = {
    kind: 'foreground' as const,
    visible: true,
    x: 0,
    y: 0,
    width: 100,
    rotation: 0,
    opacity: 1,
  };
  project.pages[0].panels[0].layers.push(
    { ...baseLayer, id: 'charL', name: 'C', subjectId: 'char1', prompt: 'Smiling.' },
    { ...baseLayer, id: 'objL', name: 'O', subjectId: 'obj1', prompt: 'On the floor.' }
  );

  const charParts = buildLayerPromptParts(project, panelId, 'charL');
  assert.deepEqual(
    charParts.map((p) => p.label),
    ['Style', 'Character style', 'Character', 'Layer prompt', 'Technical requirements']
  );
  assert.equal(charParts[1].text, 'Big expressive eyes.');

  const objParts = buildLayerPromptParts(project, panelId, 'objL');
  assert.ok(!objParts.some((p) => p.label.includes('style')));
});

function projectWithCharacterAndScene(): ComicProject {
  const project = createBlankProject('Test');
  project.metadata.characters.push({
    id: 'char1',
    name: 'Ashwini',
    description: '',
    sceneIds: [],
    imageIds: ['media1'],
    variations: [],
  });
  project.metadata.scenes.push({
    id: 'scene1',
    name: 'Rooftop',
    description: '',
    characterIds: [],
    imageIds: ['media2'],
    variations: [],
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

test("defaultReferenceNote omits the entry's name when it's the one currently being generated", () => {
  const project = projectWithCharacterAndScene();
  const note = defaultReferenceNote(project, 'media1', 'char1');
  assert.doesNotMatch(note ?? '', /Ashwini/);
  assert.match(note ?? '', /match this character's design exactly/i);
});

test('defaultReferenceNote still names the entry when currentEntryId is a different one', () => {
  const project = projectWithCharacterAndScene();
  assert.match(defaultReferenceNote(project, 'media1', 'some-other-entry') ?? '', /Ashwini/);
});

test("defaultReferenceNote also matches an image inside one of the entry's variations", () => {
  const project = projectWithCharacterAndScene();
  project.metadata.characters[0].variations = [
    { id: 'v1', name: 'Back view', prompt: '', imageIds: ['media-back'] },
  ];
  assert.match(defaultReferenceNote(project, 'media-back') ?? '', /Ashwini/);
});

test("allEntryImageIds unions the ungrouped imageIds with every variation's", () => {
  const project = projectWithCharacterAndScene();
  project.metadata.characters[0].variations = [
    { id: 'v1', name: 'Front view', prompt: '', imageIds: ['media-front'] },
    { id: 'v2', name: 'Back view', prompt: '', imageIds: ['media-back'] },
  ];
  assert.deepEqual(allEntryImageIds(project.metadata.characters[0]), [
    'media1',
    'media-front',
    'media-back',
  ]);
});

test("buildReferencePromptParts appends the chosen variation's own prompt last", () => {
  const project = projectWithCharacterAndScene();
  project.metadata.style = 'STYLE: watercolor comic.';
  project.metadata.characters[0].description = 'A girl with a backpack.';
  project.metadata.characters[0].variations = [
    {
      id: 'v1',
      name: 'Back view',
      prompt: 'Back view, facing away from the camera.',
      imageIds: [],
    },
  ];
  const parts = buildReferencePromptParts(project, 'characters', 'char1', 'v1');
  assert.deepEqual(
    parts.map((p) => p.label),
    ['Style', 'Character', 'Technical requirements', 'Variation']
  );
  assert.equal(parts.at(-1)?.text, 'Back view, facing away from the camera.');
});

test('buildReferencePromptParts omits the Variation part when no variationId is given', () => {
  const project = projectWithCharacterAndScene();
  project.metadata.characters[0].variations = [
    { id: 'v1', name: 'Back view', prompt: 'Back view.', imageIds: [] },
  ];
  const parts = buildReferencePromptParts(project, 'characters', 'char1');
  assert.ok(!parts.some((p) => p.label === 'Variation'));
});

test('buildReferencePromptParts includes the Character style addendum right after Style, for a character', () => {
  const project = projectWithCharacterAndScene();
  project.metadata.style = 'STYLE: watercolor comic.';
  project.metadata.characterStyle = 'Simple, iconic designs with big eyes.';
  project.metadata.sceneStyle = 'Atmospheric backgrounds.';
  project.metadata.characters[0].description = 'A girl.';
  const parts = buildReferencePromptParts(project, 'characters', 'char1');
  assert.deepEqual(
    parts.map((p) => p.label),
    ['Style', 'Character style', 'Character', 'Technical requirements']
  );
  assert.equal(parts[1].text, 'Simple, iconic designs with big eyes.');
});

test('buildReferencePromptParts includes the Scene style addendum for a scene, not the Character one', () => {
  const project = projectWithCharacterAndScene();
  project.metadata.characterStyle = 'Simple, iconic designs with big eyes.';
  project.metadata.sceneStyle = 'Atmospheric backgrounds.';
  project.metadata.scenes[0].description = 'A rooftop.';
  const parts = buildReferencePromptParts(project, 'scenes', 'scene1');
  assert.deepEqual(
    parts.map((p) => p.label),
    ['Scene style', 'Scene', 'Technical requirements']
  );
  assert.equal(parts[0].text, 'Atmospheric backgrounds.');
});

test('buildReferencePromptParts omits any style addendum for an object', () => {
  const project = createBlankProject('Test');
  project.metadata.characterStyle = 'Simple, iconic designs with big eyes.';
  project.metadata.sceneStyle = 'Atmospheric backgrounds.';
  project.metadata.objects.push({
    id: 'obj1',
    name: 'Table',
    description: 'Wooden.',
    imageIds: [],
    sceneIds: [],
    variations: [],
  });
  const parts = buildReferencePromptParts(project, 'objects', 'obj1');
  assert.ok(!parts.some((p) => p.label.includes('style')));
});

test('buildReferencePromptParts throws for a variationId not on the entry', () => {
  const project = projectWithCharacterAndScene();
  assert.throws(
    () => buildReferencePromptParts(project, 'characters', 'char1', 'nope'),
    /not found/
  );
});

const STITCHED = [
  { label: 'Style', text: 'Watercolor.' },
  { label: 'Character style', text: 'Big eyes.' },
  { label: 'Character', text: 'Mara, a girl.' },
  { label: 'Layer prompt', text: 'Running.' },
  { label: 'Technical requirements', text: 'One pose.' },
];

test('initialPromptText has every part when there are no reference images', () => {
  assert.equal(
    initialPromptText(STITCHED, ['Layer prompt', 'Technical requirements'], false),
    'Watercolor.\n\nBig eyes.\n\nMara, a girl.\n\nRunning.\n\nOne pose.'
  );
});

test('initialPromptText keeps only the always-included parts when there are reference images', () => {
  assert.equal(
    initialPromptText(STITCHED, ['Layer prompt', 'Technical requirements'], true),
    'Running.\n\nOne pose.'
  );
});

test('insertPartText puts a part after the nearest earlier part already in the prompt', () => {
  assert.equal(
    insertPartText('Watercolor.\n\nOne pose.', STITCHED, STITCHED[2]),
    'Watercolor.\n\nMara, a girl.\n\nOne pose.'
  );
});

test('insertPartText puts a part before the nearest later part when no earlier one is present', () => {
  assert.equal(
    insertPartText('Running.\n\nOne pose.', STITCHED, STITCHED[2]),
    'Mara, a girl.\n\nRunning.\n\nOne pose.'
  );
});

test('insertPartText puts the Style part in front of a prompt with later parts', () => {
  assert.equal(insertPartText('One pose.', STITCHED, STITCHED[0]), 'Watercolor.\n\nOne pose.');
});

test('insertPartText on an empty prompt is just the part', () => {
  assert.equal(insertPartText('', STITCHED, STITCHED[3]), 'Running.');
});

test('removePartText takes a part out with the separator that joined it in', () => {
  assert.equal(removePartText('A.\n\nB.\n\nC.', 'B.'), 'A.\n\nC.');
  assert.equal(removePartText('A.\n\nB.', 'B.'), 'A.');
  assert.equal(removePartText('A.\n\nB.', 'A.'), 'B.');
  assert.equal(removePartText('A.', 'A.'), '');
});

test('removePartText leaves the prompt alone when the part is no longer in it', () => {
  assert.equal(removePartText('A.\n\nC.', 'B.'), 'A.\n\nC.');
});
