/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  displayName,
  isValidFileName,
  numberedFileName,
  thumbnailFileNameOf,
  toFileName,
} from './fileName';

test('toFileName lowercases, dashes words and drops punctuation', () => {
  assert.equal(toFileName('Ashwini running (fix).PNG'), 'ashwini-running-fix.png');
  assert.equal(toFileName('Dream: big dog Cookie.thumb.png'), 'dream-big-dog-cookie.thumb.png');
  assert.equal(toFileName("Ash's sword reference.png"), 'ashs-sword-reference.png');
  assert.equal(toFileName('Café  au lait.jpeg'), 'cafe-au-lait.jpeg');
});

test('toFileName adds an extension when there is none, and keeps valid names as they are', () => {
  assert.equal(toFileName('p07-1-bg'), 'p07-1-bg.png');
  assert.equal(toFileName('scan', 'webp'), 'scan.webp');
  assert.equal(toFileName('media-1a2b.thumb.png'), 'media-1a2b.thumb.png');
  assert.equal(toFileName('???'), 'image.png');
});

test('isValidFileName accepts only lowercase dashed names with an extension', () => {
  assert.ok(isValidFileName('p07-1-bg.png'));
  assert.ok(isValidFileName('media-1a2b.thumb.png'));
  for (const bad of [
    'P07.png',
    'a b.png',
    'a_b.png',
    'a.png.png',
    'noext',
    'project.json',
    'notes.txt',
    '-a.png',
    'a--b.png',
  ]) {
    assert.ok(!isValidFileName(bad), bad);
  }
});

test('displayName turns a stored name into a readable label', () => {
  assert.equal(displayName('ashwini-running-away.png'), 'Ashwini running away');
  assert.equal(displayName('p07-1-bg.thumb.png'), 'P07 1 bg');
});

test('numberedFileName and thumbnailFileNameOf build related names', () => {
  assert.equal(numberedFileName('ash-sword.png', 2), 'ash-sword-2.png');
  assert.equal(numberedFileName('ash-sword.thumb.png', 3), 'ash-sword-3.thumb.png');
  assert.equal(thumbnailFileNameOf('ash-sword.png', 'jpg'), 'ash-sword.thumb.jpg');
});

test('toFileName keeps a very long label to a sensible length', () => {
  const name = toFileName(`${'word '.repeat(100)}.png`);
  assert.ok(name.length <= 90 && isValidFileName(name), name);
});
