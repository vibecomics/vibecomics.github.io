/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ComicProject } from '../types/comic';
import { assertValidProject, createBlankProject, normalizeProject } from './project';

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

test('pages and panels may have a prompt, which must be text', () => {
  const project = createBlankProject('Test');
  assertValidProject(project); // no prompt at all is fine (older projects)

  project.pages[0].prompt = 'The chase ends on the rooftop.';
  project.pages[0].panels[0].prompt = 'Low angle: nowhere left to run.';
  assertValidProject(project);
  project.pages[0].prompt = '';
  assertValidProject(project);

  const badPage = structuredClone(project) as unknown as { pages: Array<{ prompt: unknown }> };
  badPage.pages[0].prompt = 3;
  assert.throws(() => assertValidProject(badPage), /project\.pages\[0\].*prompt/);

  const badPanel = structuredClone(project) as unknown as {
    pages: Array<{ panels: Array<{ prompt: unknown }> }>;
  };
  badPanel.pages[0].panels[0].prompt = { text: 'no' };
  assert.throws(() => assertValidProject(badPanel), /project\.pages\[0\]\.panels\[0\].*prompt/);
});

test('page and panel prompts survive normalization', () => {
  const project = createBlankProject('Test');
  project.pages[0].prompt = 'Page intent';
  project.pages[0].panels[0].prompt = 'Panel intent';
  normalizeProject(project);
  assert.equal(project.pages[0].prompt, 'Page intent');
  assert.equal(project.pages[0].panels[0].prompt, 'Panel intent');
});
