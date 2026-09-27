/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ComicProject, MediaItem } from '../types/comic';
import { removeMedia } from './media';
import { assertValidProject, createBlankProject } from './project';

const item = (id: string): MediaItem => ({
  id,
  name: `${id}.png`,
  fileName: `${id}.png`,
  mimeType: 'image/png',
  thumbnailFileName: `${id}.thumb.png`,
});

function projectWithMedia(): ComicProject {
  const project = createBlankProject('Test');
  project.metadata.media = [item('m1'), item('m2')];
  project.metadata.characters.push({
    id: 'c1',
    name: 'Hero',
    description: '',
    imageIds: ['m1', 'm2'],
    sceneIds: [],
  });
  const layer = (id: string, mediaId: string | undefined) => ({
    id,
    name: id,
    kind: 'foreground' as const,
    ...(mediaId && { mediaId }),
    visible: true,
    x: 0,
    y: 0,
    width: 100,
    rotation: 0,
    opacity: 1,
  });
  project.pages[0].panels[0].layers = [
    layer('with-id', 'm1'),
    layer('no-media', undefined),
    layer('other', 'm2'),
  ];
  return project;
}

test('removeMedia unregisters the image and lets go of everything using it', () => {
  const project = projectWithMedia();
  assert.deepEqual(removeMedia(project, 'm1'), { layers: 1, entries: 1 });

  assert.deepEqual(
    project.metadata.media.map((m) => m.id),
    ['m2']
  );
  assert.deepEqual(project.metadata.characters[0].imageIds, ['m2']);
  const [withId, noMedia, other] = project.pages[0].panels[0].layers;
  assert.equal('mediaId' in withId, false);
  assert.equal('mediaId' in noMedia, false);
  assert.equal(other.mediaId, 'm2');
  assertValidProject(project);
});

test('removeMedia rejects an unknown id and changes nothing', () => {
  const project = projectWithMedia();
  assert.throws(() => removeMedia(project, 'nope'), /not found/);
  assert.equal(project.metadata.media.length, 2);
});
