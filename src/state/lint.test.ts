/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ComicProject, Layer, MediaItem } from '../types/comic';
import { lintErrors, lintProject } from './lint';
import type { LintFinding } from './lint';
import { createBlankProject } from './project';

const media = (id: string, name: string, extra: Partial<MediaItem> = {}): MediaItem => ({
  id,
  name,
  fileName: `${id}.png`,
  mimeType: 'image/png',
  thumbnailFileName: `${id}.thumb.png`,
  ...extra,
});

const layer = (id: string, name: string, extra: Partial<Layer> = {}): Layer => ({
  id,
  name,
  kind: 'foreground',
  prompt: `${name} prompt`,
  visible: true,
  x: 0,
  y: 0,
  width: 50,
  rotation: 0,
  opacity: 1,
  ...extra,
});

/** A tidy project: Mara and a scooter, a rooftop scene, three images, two layers. */
function tidy(): ComicProject {
  const project = createBlankProject('Test');
  project.metadata.characters = [
    {
      id: 'char-mara',
      name: 'Mara',
      description: 'Red hair',
      imageIds: ['m-ref'],
      sceneIds: ['scene-roof'],
      variations: [],
    },
  ];
  project.metadata.objects = [
    {
      id: 'obj-scooter',
      name: 'Scooter',
      description: 'Red',
      imageIds: [],
      sceneIds: [],
      variations: [],
    },
  ];
  project.metadata.scenes = [
    {
      id: 'scene-roof',
      name: 'Rooftop',
      description: 'Dusk',
      characterIds: ['char-mara'],
      imageIds: ['m-roof-ref'],
      variations: [],
    },
  ];
  project.metadata.media = [
    media('m-ref', 'mara-front.png'),
    media('m-roof-ref', 'rooftop-reference.png'),
    media('m-art', 'mara-running.png', { subjectId: 'char-mara' }),
    media('m-bg', 'rooftop-dusk.png', { sceneId: 'scene-roof' }),
  ];
  project.pages[0].panels[0].layers = [
    layer('l-bg', 'Background', {
      kind: 'background',
      mediaId: 'm-bg',
      sceneId: 'scene-roof',
      width: 100,
    }),
    layer('l-mara', 'Mara running', {
      mediaId: 'm-art',
      subjectId: 'char-mara',
    }),
  ];
  return project;
}

const codes = (findings: LintFinding[]) => findings.map((f) => f.code);
const find = (findings: LintFinding[], code: string) => findings.filter((f) => f.code === code);
const layers = (project: ComicProject) => project.pages[0].panels[0].layers;

test('a tidy project has no findings', () => {
  assert.deepEqual(lintProject(tidy()), []);
});

test('a project with nothing in it has no findings', () => {
  assert.deepEqual(lintProject(createBlankProject('Empty')), []);
});

test('a layer or image pointing at a subject or scene that is gone is an error with a fix', () => {
  const project = tidy();
  layers(project)[1].subjectId = 'char-gone';
  layers(project)[0].sceneId = 'scene-gone';
  project.metadata.media[2].subjectId = 'char-gone';
  project.metadata.media[3].sceneId = 'scene-gone';
  const findings = lintProject(project);
  assert.deepEqual(codes(findings).sort(), [
    'dangling-image-scene',
    'dangling-image-subject',
    'dangling-scene',
    'dangling-subject',
  ]);
  assert.ok(findings.every((f) => f.severity === 'error'));
  const subject = find(findings, 'dangling-subject')[0];
  assert.match(subject.message, /"Mara running" \(l-mara\)/);
  assert.match(subject.message, /char-gone/);
  const panelId = project.pages[0].panels[0].id;
  assert.deepEqual(subject.fix, {
    call: 'layers.update',
    args: [panelId, 'l-mara', { subjectId: null }],
  });
  assert.deepEqual(subject.where, {
    tab: 'pages',
    pageId: project.pages[0].id,
    panelId,
    layerId: 'l-mara',
  });
  assert.deepEqual(find(findings, 'dangling-image-scene')[0].fix, {
    call: 'media.update',
    args: ['m-bg', { sceneId: null }],
  });
});

test('a subject on a background and a scene on a foreground layer are warnings', () => {
  const project = tidy();
  layers(project)[0].subjectId = 'char-mara';
  layers(project)[1].sceneId = 'scene-roof';
  const findings = lintProject(project);
  assert.deepEqual(codes(findings).sort(), ['scene-on-foreground', 'subject-on-background']);
  assert.ok(findings.every((f) => f.severity === 'warning' && f.fix));
});

test('references to images and links that do not exist are errors with a fix that drops them', () => {
  const project = tidy();
  project.metadata.characters[0].imageIds = ['m-ref', 'm-gone'];
  project.metadata.characters[0].sceneIds = ['scene-roof', 'scene-gone'];
  project.metadata.scenes[0].characterIds = ['char-gone'];
  const findings = lintProject(project);
  assert.deepEqual(codes(findings).sort(), [
    'dangling-link',
    'dangling-link',
    'dangling-reference-image',
  ]);
  assert.deepEqual(find(findings, 'dangling-reference-image')[0].fix, {
    call: 'characters.update',
    args: ['char-mara', { imageIds: ['m-ref'] }],
  });
  const links = find(findings, 'dangling-link').map((f) => f.fix);
  assert.deepEqual(links, [
    { call: 'characters.update', args: ['char-mara', { linkIds: ['scene-roof'] }] },
    { call: 'scenes.update', args: ['scene-roof', { linkIds: [] }] },
  ]);
});

test('a layer whose mediaId names an image that is not registered is an error', () => {
  const project = tidy();
  layers(project)[1].mediaId = 'm-gone';
  const findings = lintProject(project);
  assert.deepEqual(codes(findings), ['missing-media']);
  assert.equal(find(findings, 'missing-media')[0].fix, undefined);
});

test('duplicate ids are errors', () => {
  const project = tidy();
  project.metadata.characters.push({ ...project.metadata.characters[0], name: 'Other Mara' });
  project.metadata.media.push(media('m-ref', 'again.png'));
  layers(project).push(layer('l-mara', 'Twin', { subjectId: 'char-mara' }));
  const findings = lintProject(project);
  assert.deepEqual(codes(findings).sort(), ['duplicate-id', 'duplicate-id', 'duplicate-id']);
  assert.ok(lintErrors(findings).length === 3);
});

test('duplicate names are warnings, whatever the case or spacing', () => {
  const project = tidy();
  project.metadata.characters.push({
    id: 'char-2',
    name: '  mara ',
    description: 'x',
    imageIds: [],
    sceneIds: [],
    variations: [],
  });
  project.metadata.objects.push({
    id: 'obj-2',
    name: 'MARA',
    description: 'x',
    imageIds: [],
    sceneIds: [],
    variations: [],
  });
  project.metadata.media.push(media('m-copy', 'Mara-Front.PNG'));
  project.metadata.media[0].name = 'mara-front.png';
  const findings = lintProject(project);
  assert.deepEqual(codes(findings).sort(), [
    'ambiguous-name',
    'duplicate-name',
    'duplicate-name',
    'unused-image',
  ]);
  assert.ok(find(findings, 'ambiguous-name')[0].message.includes('obj-2'));
});

test('default names, a missing thumbnail and an unused image are warnings', () => {
  const project = tidy();
  layers(project)[1].name = 'Layer 3';
  project.metadata.media.push(media('m-img', 'image_2384.png', { thumbnailFileName: undefined }));
  const findings = lintProject(project);
  assert.deepEqual(codes(findings).sort(), [
    'default-image-name',
    'default-layer-name',
    'missing-thumbnail',
    'unused-image',
  ]);
  // An untagged image that is reference art or on a layer is used; a tagged one is waiting to be placed.
  assert.equal(find(findings, 'unused-image')[0].where.mediaId, 'm-img');
  // "Background" is the right name for a background.
  assert.equal(find(lintProject(tidy()), 'default-layer-name').length, 0);
});

test('a used character with no description or reference images is a warning; an unused one is not', () => {
  const project = tidy();
  project.metadata.characters[0].description = '  ';
  project.metadata.characters[0].imageIds = [];
  project.metadata.objects[0].description = '';
  let findings = lintProject(project);
  // (Dropping her reference images also leaves m-ref used nowhere.)
  assert.deepEqual(codes(findings).sort(), [
    'no-description',
    'no-reference-images',
    'unused-image',
  ]);
  assert.ok(
    findings.filter((f) => f.code !== 'unused-image').every((f) => f.where.entityId === 'char-mara')
  );
  // Mara is no longer on any layer: nothing to report about her
  delete layers(project)[1].subjectId;
  findings = lintProject(project);
  assert.equal(find(findings, 'no-description').length, 0);
});

test('layers with no subject, no scene or nothing in them are info', () => {
  const project = tidy();
  delete layers(project)[1].subjectId;
  delete layers(project)[0].sceneId;
  layers(project).push(layer('l-empty', 'Sketch', { prompt: '' }));
  const findings = lintProject(project);
  assert.deepEqual(codes(findings).sort(), [
    'background-without-scene',
    'empty-layer',
    'layer-without-subject',
    'layer-without-subject',
  ]);
  assert.ok(findings.every((f) => f.severity === 'info'));
  // With no characters, objects or scenes there is nothing to point at, so nothing is said
  const bare = createBlankProject('Bare');
  bare.pages[0].panels[0].layers = [layer('x', 'Hero')];
  assert.deepEqual(codes(lintProject(bare)), []);
});

test("an image that is both a subject's art and its reference art is info", () => {
  const project = tidy();
  project.metadata.media[0].subjectId = 'char-mara';
  const findings = lintProject(project);
  assert.deepEqual(codes(findings), ['art-and-reference']);
  assert.equal(findings[0].severity, 'info');
});

test('errors come first, then warnings, then info, each in project order', () => {
  const project = tidy();
  layers(project)[1].name = 'Layer';
  layers(project)[0].sceneId = 'scene-gone';
  delete layers(project)[1].subjectId;
  const findings = lintProject(project);
  assert.deepEqual(
    findings.map((f) => f.severity),
    ['error', 'warning', 'info']
  );
});
