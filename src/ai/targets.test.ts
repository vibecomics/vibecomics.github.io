/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatTarget, parseTarget } from './targets';
import type { AnyTarget } from './targets';

test('a target string round-trips through parseTarget and formatTarget', () => {
  const targets: AnyTarget[] = [
    { type: 'layer', panelId: 'panel_1', layerId: 'layer_2' },
    { type: 'reference', kind: 'characters', entryId: 'char_1' },
    { type: 'reference', kind: 'scenes', entryId: 'scene_1', variationId: 'var_1' },
    { type: 'variations', kind: 'objects', entryId: 'obj_1' },
    { type: 'panel', panelId: 'panel_9' },
  ];
  for (const target of targets) {
    assert.deepEqual(parseTarget(formatTarget(target)), target);
  }
});

test('parseTarget passes an object through untouched', () => {
  const target: AnyTarget = { type: 'layer', panelId: 'p', layerId: 'l' };
  assert.equal(parseTarget(target), target);
});

test('parseTarget rejects malformed targets and shows the syntax', () => {
  for (const bad of [
    'layer',
    'layer:only-one',
    'layer:a/b/c',
    'layer:a/',
    'panel:a/b',
    'reference:monsters/x',
    'reference:characters',
    'reference:characters/a/b/c',
    'whatever:a/b',
  ]) {
    assert.throws(() => parseTarget(bad), /Bad target .*Targets look like: layer:/, bad);
  }
});
