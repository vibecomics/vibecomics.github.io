/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBlankProject } from '../state/project';
import { createPanel } from '../state/layout';
import type { ComicPage, ComicProject, Layer } from '../types/comic';
import { formatHash, parseHash, placeHash, routeOf, startView, viewFromRoute } from './hashRoute';

function twoPageProject(): ComicProject {
  const project = createBlankProject('Ashnix');
  const first = createPanel();
  const second = createPanel();
  first.layers.push({ id: 'layer-a' } as Layer);
  const page: ComicPage = { id: 'page-1', number: 1, title: 'One', panels: [first, second] };
  project.pages.push(page);
  return project;
}

test('welcome and anything unreadable parse to the welcome page', () => {
  for (const hash of [
    '',
    '#welcome',
    '#',
    '#comic=',
    '#comic=x&cast&media',
    '#comic=x&page=abc',
    '#comic=x&panel=1',
  ]) {
    assert.deepEqual(parseHash(hash), { screen: 'welcome' }, hash);
  }
});

test('parses comic tabs and pages', () => {
  assert.deepEqual(parseHash('#comic=Ashnix%20tardy&cast'), {
    screen: 'comic',
    comic: 'Ashnix tardy',
    tab: 'cast',
  });
  assert.deepEqual(parseHash('#comic=x&scenes'), { screen: 'comic', comic: 'x', tab: 'scenes' });
  assert.deepEqual(parseHash('#comic=x'), { screen: 'comic', comic: 'x', tab: undefined });
  assert.deepEqual(parseHash('#comic=x&page=1&panel=2&layer=abc'), {
    screen: 'comic',
    comic: 'x',
    tab: 'pages',
    page: 1,
    panel: 2,
    layer: 'abc',
  });
});

test('formats the same hash it parses', () => {
  const hashes = [
    '#welcome',
    '#comic=Ashnix%20tardy&page=1&panel=1',
    '#comic=x&page=0&panel=3&layer=layer-a',
    '#comic=x&cast',
    '#comic=x&scenes',
    '#comic=x&outline',
    '#comic=x&media',
  ];
  for (const hash of hashes) assert.equal(formatHash(parseHash(hash)), hash);
});

test('a place ignores the panel and layer', () => {
  assert.equal(placeHash(parseHash('#comic=x&page=1&panel=2&layer=abc')), '#comic=x&page=1');
  assert.equal(placeHash({ screen: 'welcome' }), '#welcome');
});

test('a URL resolves to a view, and a view back to its URL', () => {
  const project = twoPageProject();
  const panelTwo = viewFromRoute(project, { comic: 'x', tab: 'pages', page: 1, panel: 2 });
  assert.deepEqual(panelTwo, {
    tab: 'pages',
    pageIndex: 1,
    selection: { panelId: project.pages[1].panels[1].id },
  });
  assert.equal(
    formatHash({ screen: 'comic', ...routeOf('x', project, panelTwo!) }),
    '#comic=x&page=1&panel=2'
  );

  const layer = viewFromRoute(project, {
    comic: 'x',
    tab: 'pages',
    page: 1,
    panel: 1,
    layer: 'layer-a',
  });
  assert.deepEqual(layer?.selection, {
    panelId: project.pages[1].panels[0].id,
    layerId: 'layer-a',
  });
});

test('a URL to something missing from the project resolves to nothing', () => {
  const project = twoPageProject();
  assert.equal(viewFromRoute(project, { comic: 'x', tab: 'pages', page: 9 }), null);
  assert.equal(viewFromRoute(project, { comic: 'x', tab: 'pages', page: 1, panel: 3 }), null);
  assert.equal(
    viewFromRoute(project, { comic: 'x', tab: 'pages', page: 1, panel: 1, layer: 'nope' }),
    null
  );
  assert.equal(
    viewFromRoute(project, { comic: 'x', tab: 'pages', panel: 1, layer: 'layer-a' }),
    null
  );
});

test('no tab in the URL opens the starting view', () => {
  const project = twoPageProject();
  assert.deepEqual(viewFromRoute(project, { comic: 'x' }), startView(project));
  assert.equal(startView(project).tab, 'pages');
  assert.equal(startView(createBlankProject('Ashnix')).tab, 'outline');
});
