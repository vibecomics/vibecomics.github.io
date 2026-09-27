/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBlankProject } from '../state/project';
import type { ComicProject, MediaItem } from '../types/comic';
import type { MediaInfo } from './mediaImages';
import {
  firstOfGroups,
  groupMedia,
  initialCount,
  normalizeText,
  placedMediaIds,
  searchMedia,
  searchTextByMedia,
  subjectOf,
} from './mediaOrder';

const item = (id: string): MediaItem => ({
  id,
  name: id,
  driveFileId: id,
  url: '',
  mimeType: 'image/png',
});

const ids = (groups: Array<{ items: MediaItem[] }>) =>
  groups.map((group) => group.items.map((i) => i.id));

test('backgrounds: opaque images that fit the panel come first, transparent ones last', () => {
  const media = ['cutout', 'wide', 'tall', 'unknown'].map(item);
  const infos = new Map<string, MediaInfo | undefined>([
    ['cutout', { aspect: 1.5, transparent: true }],
    ['wide', { aspect: 1.5, transparent: false }],
    ['tall', { aspect: 0.7, transparent: false }],
    ['unknown', undefined],
  ]);
  const groups = groupMedia(media, infos, { kind: 'background', aspectRatio: 1.52 });
  assert.deepEqual(
    groups.map((g) => g.title),
    ['Fits this panel', 'Other backgrounds', 'Other images']
  );
  assert.deepEqual(ids(groups), [['wide'], ['tall'], ['cutout', 'unknown']]);
});

test('layers: transparent images first', () => {
  const media = ['photo', 'cutout'].map(item);
  const infos = new Map<string, MediaInfo | undefined>([
    ['photo', { aspect: 1, transparent: false }],
    ['cutout', { aspect: 1, transparent: true }],
  ]);
  assert.deepEqual(ids(groupMedia(media, infos, { kind: 'layer' })), [['cutout'], ['photo']]);
});

test('firstOfGroups lists the first images across groups and drops groups left empty', () => {
  const groups = [
    { title: 'A', items: ['a1', 'a2', 'a3'].map(item) },
    { title: 'B', items: ['b1', 'b2', 'b3', 'b4'].map(item) },
  ];
  assert.deepEqual(ids(firstOfGroups(groups, 2)), [['a1', 'a2']]);
  assert.deepEqual(ids(firstOfGroups(groups, 4)), [['a1', 'a2', 'a3'], ['b1']]);
  assert.deepEqual(
    firstOfGroups(groups, 4).map((g) => g.title),
    ['A', 'B']
  );
  assert.deepEqual(ids(firstOfGroups(groups, 99)), ids(groups));
  assert.deepEqual(firstOfGroups(groups, 0), []);
  assert.deepEqual(firstOfGroups([], 5), []);
});

test('initialCount is whole batches that include the image in use', () => {
  const groups = [{ title: 'A', items: ['a1', 'a2', 'a3', 'a4', 'a5'].map(item) }];
  assert.equal(initialCount(groups, 'a5', 2), 6);
  assert.equal(initialCount(groups, 'a2', 2), 2);
  assert.equal(initialCount(groups, 'a1', 2), 2);
  assert.equal(initialCount(groups, 'missing', 2), 2);
  assert.equal(initialCount(groups, undefined, 2), 2);
  assert.equal(initialCount([], undefined), 24);
});

/** A project with Mara, a scooter, five images and one layer that uses `used`. */
function castProject(): ComicProject {
  const project = createBlankProject('Test');
  const media = (id: string, extra: Partial<MediaItem> = {}): MediaItem => ({
    ...item(id),
    url: `https://www.googleapis.com/drive/v3/files/${id}?alt=media`,
    ...extra,
  });
  project.metadata.media = [
    media('ref', { name: 'front-view.png' }),
    media('fresh', { subjectId: 'char-mara', name: 'running.png' }),
    media('used', { subjectId: 'char-mara', name: 'waving.png' }),
    media('both', { subjectId: 'char-mara', name: 'both.png' }),
    media('scooter-art', { subjectId: 'obj-scooter' }),
    media('other'),
  ];
  project.metadata.characters.push({
    id: 'char-mara',
    name: 'Mara Ödegård',
    description: '',
    imageIds: ['ref', 'both'],
    sceneIds: [],
  });
  project.metadata.objects.push({
    id: 'obj-scooter',
    name: 'Red scooter',
    description: '',
    imageIds: [],
    sceneIds: [],
  });
  project.pages[0].panels[0].layers = [
    {
      id: 'l1',
      name: 'Mara at the gate',
      kind: 'foreground',
      src: project.metadata.media[2].url,
      mediaId: 'used',
      visible: true,
      x: 0,
      y: 0,
      width: 100,
      rotation: 0,
      opacity: 1,
    },
    {
      id: 'l2',
      name: 'Layer',
      kind: 'foreground',
      src: project.metadata.media[5].url,
      visible: true,
      x: 0,
      y: 0,
      width: 100,
      rotation: 0,
      opacity: 1,
    },
  ];
  return project;
}

test('placedMediaIds counts an image used by media id or by its Drive URL', () => {
  assert.deepEqual([...placedMediaIds(castProject())].sort(), ['other', 'used']);
});

test('a subject lists its unused art, its used art, the rest, then its reference images', () => {
  const project = castProject();
  const subject = subjectOf(project, 'char-mara');
  assert.ok(subject);
  const infos = new Map<string, MediaInfo | undefined>();
  const groups = groupMedia(project.metadata.media, infos, { kind: 'layer', subject });
  assert.deepEqual(
    groups.map((g) => g.title),
    [
      'Art of Mara Ödegård, not used yet',
      'Art of Mara Ödegård, in use',
      'Other images',
      'Reference images of Mara Ödegård',
    ]
  );
  // "both" is Mara's art and also in her reference list: the tag wins.
  assert.deepEqual(ids(groups), [['fresh', 'both'], ['used'], ['scooter-art', 'other'], ['ref']]);
});

test('a subject with no images of its own adds no groups, and an unknown subject is ignored', () => {
  const project = castProject();
  assert.equal(subjectOf(project, 'char-gone'), undefined);
  assert.equal(subjectOf(project, undefined), undefined);
  const scooter = subjectOf(project, 'obj-scooter');
  const groups = groupMedia(project.metadata.media, null, { kind: 'layer', subject: scooter });
  assert.deepEqual(
    groups.map((g) => g.title),
    ['Art of Red scooter, not used yet', 'Other images']
  );
});

test('while shapes are unknown the rest is one group', () => {
  const groups = groupMedia(castProject().metadata.media, null, { kind: 'layer' });
  assert.deepEqual(
    groups.map((g) => g.title),
    ['Images']
  );
});

test('search finds an image by its name, its subject, its reference owner or its layer', () => {
  const project = castProject();
  const text = searchTextByMedia(project);
  const found = (query: string) =>
    searchMedia(project.metadata.media, text, query).map((i) => i.id);
  assert.deepEqual(found('running'), ['fresh']);
  assert.deepEqual(found('mara'), ['ref', 'fresh', 'used', 'both']);
  assert.deepEqual(found('ODEGARD mara'), ['ref', 'fresh', 'used', 'both']);
  assert.deepEqual(found('scooter'), ['scooter-art']);
  assert.deepEqual(found('at the gate'), ['used']);
  assert.deepEqual(
    found('  '),
    project.metadata.media.map((i) => i.id)
  );
  assert.deepEqual(found('nothing'), []);
});

test('a layer that still has a default name is not searchable by it', () => {
  const project = castProject();
  const text = searchTextByMedia(project);
  assert.deepEqual(
    searchMedia(project.metadata.media, text, 'layer').map((i) => i.id),
    []
  );
});

test('normalizeText drops case, accents and repeated spaces', () => {
  assert.equal(normalizeText('  Ödegård   MARA '), 'odegard mara');
});

test('a background lists the art of its scene first, and its reference images last', () => {
  const project = castProject();
  project.metadata.scenes.push({
    id: 'scene-roof',
    name: 'Rooftop',
    description: '',
    characterIds: [],
    imageIds: ['ref'],
  });
  project.metadata.media[5].sceneId = 'scene-roof'; // "other", used by the layer l2
  project.metadata.media[4].sceneId = 'scene-roof'; // "scooter-art", used nowhere
  const scene = subjectOf(project, 'scene-roof');
  assert.equal(scene?.tag, 'sceneId');
  const groups = groupMedia(project.metadata.media, new Map(), {
    kind: 'background',
    subject: scene,
  });
  assert.deepEqual(
    groups.map((g) => g.title),
    [
      'Art of Rooftop, not used yet',
      'Art of Rooftop, in use',
      'Other images',
      'Reference images of Rooftop',
    ]
  );
  assert.deepEqual(ids(groups), [['scooter-art'], ['other'], ['fresh', 'used', 'both'], ['ref']]);
});

test('search also finds images by their scene', () => {
  const project = castProject();
  project.metadata.scenes.push({
    id: 'scene-roof',
    name: 'Rooftop',
    description: '',
    characterIds: [],
    imageIds: ['ref'],
  });
  project.metadata.media[5].sceneId = 'scene-roof';
  const text = searchTextByMedia(project);
  assert.deepEqual(
    searchMedia(project.metadata.media, text, 'rooftop').map((i) => i.id),
    ['ref', 'other']
  );
});
