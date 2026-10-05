/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ComicProject } from '../types/comic';
import { assertValidProject, createBlankProject, isCoverOnly, normalizeProject } from './project';

const layer = (overrides: Record<string, unknown> = {}) => ({
  id: 'l1',
  name: 'Layer',
  kind: 'foreground',
  mediaId: 'm1',
  visible: true,
  x: 0,
  y: 0,
  width: 100,
  rotation: 0,
  opacity: 1,
  ...overrides,
});

/** A project whose only panel holds the given layers and bubbles. */
function projectWith(layers: unknown[], bubbles: unknown[] = []) {
  const project = createBlankProject('Test') as unknown as {
    pages: Array<{ panels: Array<{ layers: unknown[]; bubbles: unknown[] }> }>;
  };
  project.pages[0].panels[0].layers = layers;
  project.pages[0].panels[0].bubbles = bubbles;
  return project as unknown as ComicProject;
}

test('a blank project is valid and starts with one full-page panel', () => {
  const project = createBlankProject('Test');
  assertValidProject(project);
  assert.equal(project.pages[0].panels.length, 1);
  assert.equal(project.pages[0].panels[0].width, 100);
});

test('layers may have a mediaId or none', () => {
  assertValidProject(projectWith([layer()]));
  assertValidProject(projectWith([layer({ mediaId: undefined })]));
});

test('validation reports the path of the problem', () => {
  const project = projectWith([layer({ opacity: 3 })]);
  assert.throws(() => assertValidProject(project), /pages\[0\]\.panels\[0\]\.layers\[0\].*opacity/);
});

test('a panel rectangle is all-or-nothing and must lie within the page', () => {
  const partial = createBlankProject('Test') as unknown as {
    pages: Array<{ panels: Array<Record<string, unknown>> }>;
  };
  delete partial.pages[0].panels[0].height;
  assert.throws(() => assertValidProject(partial), /all of/);

  const outside = createBlankProject('Test');
  outside.pages[0].panels[0].width = 150;
  assert.throws(() => assertValidProject(outside), /within the page/);
});

test('normalizeProject fills in fields added after a project.json was written', () => {
  const old = projectWith(
    [layer()],
    [{ id: 'b', kind: 'speech', text: 'Hi', x: 1, y: 1, width: 40 }]
  );
  old.pages.push({ id: 'p2', number: 1, title: '', panels: [] });
  (old.metadata as { pageSize?: unknown }).pageSize = undefined;

  assertValidProject(old);
  normalizeProject(old);

  assert.equal(old.pages[0].panels[0].bubbles[0].height, 20);
  assert.equal(old.pages[1].panels.length, 1);
  assert.ok(old.metadata.pageSize.widthIn > 0);
});

test('a project.json with only the old outline field is valid, and normalizeProject migrates it to style', () => {
  const old = projectWith([layer()]);
  delete (old.metadata as { style?: string }).style;
  (old.metadata as unknown as { outline: string }).outline =
    'STYLE: watercolor. Then a long synopsis.';

  assertValidProject(old);
  normalizeProject(old);

  assert.equal(old.metadata.style, 'STYLE: watercolor. Then a long synopsis.');
  assert.equal((old.metadata as unknown as { outline?: string }).outline, undefined);
});

test('a metadata block with neither style nor the old outline field is invalid', () => {
  const project = projectWith([layer()]);
  delete (project.metadata as { style?: string }).style;
  assert.throws(() => assertValidProject(project), /style/);
});

test('normalizeProject folds an entry\'s leftover imageIds into a "Default" variation', () => {
  const project = projectWith([layer()]);
  project.metadata.characters.push({
    id: 'char1',
    name: 'Mira',
    description: '',
    imageIds: ['m1', 'm2'],
    sceneIds: [],
    variations: [],
  } as never);

  normalizeProject(project);

  const entry = project.metadata.characters[0];
  assert.deepEqual(entry.imageIds, []);
  assert.equal(entry.variations.length, 1);
  assert.equal(entry.variations[0].name, 'Default');
  assert.deepEqual(entry.variations[0].imageIds, ['m1', 'm2']);
});

test('normalizeProject reuses an existing "Default" variation instead of making a second one', () => {
  const project = projectWith([layer()]);
  project.metadata.objects.push({
    id: 'obj1',
    name: 'Locker',
    description: '',
    imageIds: ['m1'],
    sceneIds: [],
    variations: [{ id: 'v1', name: 'Default', prompt: '', imageIds: ['m0'] }],
  } as never);

  normalizeProject(project);

  const entry = project.metadata.objects[0];
  assert.equal(entry.variations.length, 1);
  assert.deepEqual(entry.variations[0].imageIds, ['m0', 'm1']);
});

test('a media item may carry a thumbnail file name, which must be a string', () => {
  const project = createBlankProject('Test');
  project.metadata.media.push({
    id: 'm1',
    name: 'a.png',
    fileName: 'a.png',
    mimeType: 'image/png',
    thumbnailFileName: 'a.thumb.png',
  });
  assertValidProject(project);
  (project.metadata.media[0] as unknown as Record<string, unknown>).thumbnailFileName = 5;
  assert.throws(() => assertValidProject(project), /thumbnailFileName/);
});

test('a new project is cover-only until a page is added', () => {
  const project = createBlankProject('Ashnix');
  assert.equal(isCoverOnly(project), true);
  project.pages.push({ id: 'page-1', number: 1, title: 'One', panels: [] });
  assert.equal(isCoverOnly(project), false);
});
