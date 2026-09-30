/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ComicProject, Layer } from '../types/comic';
import { mergeProjects, resolveAll, settled } from './merge';
import { createBlankProject } from './project';

const clone = <T>(value: T): T => structuredClone(value);

const layer = (id: string, name: string, extra: Partial<Layer> = {}): Layer => ({
  id,
  name,
  kind: 'foreground',
  visible: true,
  x: 0,
  y: 0,
  width: 100,
  rotation: 0,
  opacity: 1,
  prompt: `${name} prompt`,
  ...extra,
});

/** A cover, then "Chase" (two stacked panels, a layer each, a bubble) and "Roof" (one panel). */
function base(): ComicProject {
  const project = createBlankProject('Test');
  project.metadata.style = 'Style';
  project.metadata.characters = [
    { id: 'c1', name: 'Mira', description: 'Red hair', imageIds: [], sceneIds: [], variations: [] },
    { id: 'c2', name: 'Otto', description: 'Tall', imageIds: [], sceneIds: [], variations: [] },
  ];
  project.pages.push(
    {
      id: 'p1',
      number: 1,
      title: 'Chase',
      panels: [
        {
          id: 'a',
          x: 0,
          y: 0,
          width: 100,
          height: 50,
          layers: [layer('l1', 'Hero'), layer('l2', 'Villain')],
          bubbles: [{ id: 'b1', kind: 'speech', text: 'Hi', x: 10, y: 10, width: 40, height: 20 }],
        },
        { id: 'b', x: 0, y: 50, width: 100, height: 50, layers: [], bubbles: [] },
      ],
    },
    {
      id: 'p2',
      number: 2,
      title: 'Roof',
      panels: [{ id: 'c', x: 0, y: 0, width: 100, height: 100, layers: [], bubbles: [] }],
    }
  );
  return project;
}

const panelA = (p: ComicProject) => p.pages[1].panels[0];
const titles = (p: ComicProject) => p.pages.map((page) => page.title).join(',');

test('nothing changed on either side: no conflicts, nothing changes', () => {
  const b = base();
  const { merged, conflicts } = mergeProjects(b, clone(b), clone(b));
  assert.deepEqual(conflicts, []);
  assert.deepEqual(merged, b);
});

test('changes to different fields of one layer, and to different layers, both survive', () => {
  const b = base();
  const mine = clone(b);
  const theirs = clone(b);
  panelA(mine).layers[0].prompt = 'Hero, running';
  panelA(theirs).layers[0].opacity = 0.5; // same layer, other field
  panelA(theirs).layers[1].name = 'Baddie'; // other layer
  mine.pages[2].title = 'Rooftop'; // other page
  theirs.metadata.characters[0].description = 'Short red hair';

  const { merged, conflicts } = mergeProjects(b, mine, theirs);
  assert.deepEqual(conflicts, []);
  assert.equal(panelA(merged).layers[0].prompt, 'Hero, running');
  assert.equal(panelA(merged).layers[0].opacity, 0.5);
  assert.equal(panelA(merged).layers[1].name, 'Baddie');
  assert.equal(merged.pages[2].title, 'Rooftop');
  assert.equal(merged.metadata.characters[0].description, 'Short red hair');
});

test('both sides made the same change: no conflict', () => {
  const b = base();
  const mine = clone(b);
  const theirs = clone(b);
  panelA(mine).layers[0].prompt = 'Same';
  panelA(theirs).layers[0].prompt = 'Same';
  assert.deepEqual(mergeProjects(b, mine, theirs).conflicts, []);
});

test('the same field changed differently is a conflict that says where it is, and can go any of three ways', () => {
  const b = base();
  const mine = clone(b);
  const theirs = clone(b);
  panelA(mine).layers[0].prompt = 'Ours';
  panelA(theirs).layers[0].prompt = 'Theirs';

  const { merged, conflicts } = mergeProjects(b, mine, theirs);
  assert.equal(conflicts.length, 1);
  const [conflict] = conflicts;
  assert.equal(conflict.kind, 'value');
  assert.equal(conflict.label, 'Page 1 "Chase" › Panel 1 › Layer "Hero" › prompt');
  assert.deepEqual(conflict.where, { tab: 'pages', pageId: 'p1', panelId: 'a' });
  assert.deepEqual(conflict.text, { base: 'Hero prompt', ours: 'Ours', theirs: 'Theirs' });

  assert.equal(panelA(merged).layers[0].prompt, 'Ours'); // ours until the user chooses
  assert.equal(panelA(settled(merged, conflict, 'theirs')).layers[0].prompt, 'Theirs');
  assert.equal(panelA(settled(merged, conflict, 'base')).layers[0].prompt, 'Hero prompt');
  assert.equal(panelA(settled(merged, conflict, 'ours')).layers[0].prompt, 'Ours');
  assert.equal(panelA(merged).layers[0].prompt, 'Ours'); // settled works on a copy
});

test('an optional field set on one side and cleared on the other is a conflict, and can be unset', () => {
  const b = base();
  const mine = clone(b);
  const theirs = clone(b);
  mine.pages[1].prompt = 'Ours';
  const { conflicts, merged } = mergeProjects(b, mine, theirs);
  assert.deepEqual(conflicts, []); // only ours changed it
  assert.equal(merged.pages[1].prompt, 'Ours');

  const withPrompt = clone(b);
  withPrompt.pages[1].prompt = 'Base';
  const ours = clone(withPrompt);
  const other = clone(withPrompt);
  ours.pages[1].prompt = 'Ours';
  delete other.pages[1].prompt;
  const result = mergeProjects(withPrompt, ours, other);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].text.theirs, '(not set)');
  assert.equal(settled(result.merged, result.conflicts[0], 'theirs').pages[1].prompt, undefined);
});

test('pages added on both sides are all kept, in a sensible order, and renumbered', () => {
  const b = base();
  const mine = clone(b);
  const theirs = clone(b);
  const newPage = (id: string, title: string) => ({
    id,
    number: 0,
    title,
    panels: [{ id: `${id}-panel`, x: 0, y: 0, width: 100, height: 100, layers: [], bubbles: [] }],
  });
  mine.pages.push(newPage('m1', 'Mine'));
  theirs.pages.splice(1, 0, newPage('t1', 'Theirs')); // before "Chase"

  const { merged, conflicts } = mergeProjects(b, mine, theirs);
  assert.deepEqual(conflicts, []);
  assert.equal(titles(merged), 'Cover,Theirs,Chase,Roof,Mine');
  assert.deepEqual(
    merged.pages.map((p) => p.number),
    [0, 1, 2, 3, 4]
  );
});

test('a page reordered on one side and edited on the other combine; reordered differently on both is a conflict', () => {
  const b = base();
  const mine = clone(b);
  const theirs = clone(b);
  mine.pages.reverse(); // Roof, Chase, Cover  (order only among the pages that all sides have)
  mine.pages = [mine.pages[2], mine.pages[0], mine.pages[1]]; // Cover, Roof, Chase
  theirs.pages[1].title = 'The chase';
  let result = mergeProjects(b, mine, theirs);
  assert.deepEqual(result.conflicts, []);
  assert.equal(titles(result.merged), 'Cover,Roof,The chase');

  const other = clone(b);
  other.pages = [other.pages[0], other.pages[1], other.pages[2]];
  const both = clone(b);
  both.pages = [both.pages[2], both.pages[0], both.pages[1]]; // Roof, Cover, Chase
  result = mergeProjects(b, mine, both);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].kind, 'order');
  assert.deepEqual(result.conflicts[0].where, { tab: 'pages' });
  assert.equal(titles(result.merged), 'Cover,Roof,Chase'); // ours
  assert.equal(titles(settled(result.merged, result.conflicts[0], 'theirs')), 'Roof,Cover,Chase');
  assert.equal(titles(settled(result.merged, result.conflicts[0], 'base')), 'Cover,Chase,Roof');
  void other;
});

test('a thing deleted on one side and untouched on the other is simply deleted', () => {
  const b = base();
  const mine = clone(b);
  const theirs = clone(b);
  panelA(mine).layers.splice(1, 1); // we delete the Villain
  theirs.pages.splice(2, 1); // they delete the Roof page
  const { merged, conflicts } = mergeProjects(b, mine, theirs);
  assert.deepEqual(conflicts, []);
  assert.equal(panelA(merged).layers.length, 1);
  assert.equal(titles(merged), 'Cover,Chase');
});

test('deleted on one side and changed on the other is a conflict, either way round', () => {
  const b = base();

  // We changed the Villain, they deleted it: it stays until the user agrees to delete it.
  let mine = clone(b);
  let theirs = clone(b);
  panelA(mine).layers[1].prompt = 'Villain, angrier';
  panelA(theirs).layers.splice(1, 1);
  let result = mergeProjects(b, mine, theirs);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].kind, 'deleted');
  assert.equal(result.conflicts[0].label, 'Layer "Villain"');
  assert.deepEqual(result.conflicts[0].where, { tab: 'pages', pageId: 'p1', panelId: 'a' });
  assert.deepEqual(result.conflicts[0].text, {
    base: 'as it was',
    ours: 'changed here',
    theirs: 'deleted there',
  });
  assert.equal(panelA(result.merged).layers.length, 2);
  assert.equal(panelA(settled(result.merged, result.conflicts[0], 'theirs')).layers.length, 1);
  assert.equal(
    panelA(settled(result.merged, result.conflicts[0], 'base')).layers[1].prompt,
    'Villain prompt'
  );

  // We deleted a whole page, they edited it: it stays deleted until the user brings it back.
  mine = clone(b);
  theirs = clone(b);
  mine.pages.splice(2, 1);
  theirs.pages[2].panels[0].prompt = 'They wrote a prompt';
  result = mergeProjects(b, mine, theirs);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].label, 'Page 2 "Roof"');
  assert.deepEqual(result.conflicts[0].where, { tab: 'pages', pageId: 'p2' });
  assert.equal(titles(result.merged), 'Cover,Chase');
  const back = settled(result.merged, result.conflicts[0], 'theirs');
  assert.equal(titles(back), 'Cover,Chase,Roof');
  assert.equal(back.pages[2].panels[0].prompt, 'They wrote a prompt');
  assert.equal(back.pages[2].number, 2);
  assert.equal(
    settled(result.merged, result.conflicts[0], 'base').pages[2].panels[0].prompt,
    undefined
  );
});

test('layouts that are each fine but do not fit together are a layout conflict', () => {
  const b = base();
  const mine = clone(b);
  const theirs = clone(b);
  // We move the horizontal divider down to 60; they split the lower panel in two side by side.
  mine.pages[1].panels[0].height = 60;
  mine.pages[1].panels[1].y = 60;
  mine.pages[1].panels[1].height = 40;
  theirs.pages[1].panels[1].width = 50;
  theirs.pages[1].panels.push({
    id: 'new',
    x: 50,
    y: 50,
    width: 50,
    height: 50,
    layers: [],
    bubbles: [],
  });

  const { merged, conflicts } = mergeProjects(b, mine, theirs);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'layout');
  assert.equal(conflicts[0].label, 'Page 1 "Chase" › panel layout');
  assert.deepEqual(conflicts[0].text, { base: '2 panels', ours: '2 panels', theirs: '3 panels' });
  assert.equal(merged.pages[1].panels.length, 2); // our layout
  assert.equal(merged.pages[1].panels[1].y, 60);
  assert.equal(settled(merged, conflicts[0], 'theirs').pages[1].panels.length, 3);
  assert.equal(settled(merged, conflicts[0], 'base').pages[1].panels[0].height, 50);
});

test('layouts that do fit together (different tiers) merge', () => {
  const b = base();
  b.pages[1].panels.push({
    id: 'd',
    x: 0,
    y: 0,
    width: 0.01,
    height: 0.01,
    layers: [],
    bubbles: [],
  });
  b.pages[1].panels.pop();
  const mine = clone(b);
  const theirs = clone(b);
  // We split the top panel, they split the bottom one.
  mine.pages[1].panels[0].width = 50;
  mine.pages[1].panels.push({
    id: 'm',
    x: 50,
    y: 0,
    width: 50,
    height: 50,
    layers: [],
    bubbles: [],
  });
  theirs.pages[1].panels[1].width = 50;
  theirs.pages[1].panels.push({
    id: 't',
    x: 50,
    y: 50,
    width: 50,
    height: 50,
    layers: [],
    bubbles: [],
  });
  const { merged, conflicts } = mergeProjects(b, mine, theirs);
  assert.deepEqual(conflicts, []);
  assert.equal(merged.pages[1].panels.length, 4);
});

test('story bible: additions on both sides combine; the same description changed is a conflict on its tab', () => {
  const b = base();
  const mine = clone(b);
  const theirs = clone(b);
  mine.metadata.characters.push({
    id: 'c3',
    name: 'Zed',
    description: 'New',
    imageIds: [],
    sceneIds: [],
    variations: [],
  });
  theirs.metadata.scenes.push({
    id: 's1',
    name: 'Roof',
    description: 'Dusk',
    characterIds: [],
    imageIds: [],
    variations: [],
  });
  mine.metadata.characters[0].name = 'Mira K';
  theirs.metadata.characters[0].description = 'Short red hair';
  let result = mergeProjects(b, mine, theirs);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.merged.metadata.characters.length, 3);
  assert.equal(result.merged.metadata.scenes.length, 1);
  assert.equal(result.merged.metadata.characters[0].name, 'Mira K');
  assert.equal(result.merged.metadata.characters[0].description, 'Short red hair');

  mine.metadata.characters[1].description = 'Ours';
  theirs.metadata.characters[1].description = 'Theirs';
  result = mergeProjects(b, mine, theirs);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].label, 'Character "Otto" › description');
  assert.deepEqual(result.conflicts[0].where, { tab: 'cast' });
});

test('style, page size and project title: conflicts point at the outline tab', () => {
  const b = base();
  const mine = clone(b);
  const theirs = clone(b);
  mine.metadata.style = 'Our style';
  theirs.metadata.style = 'Their style';
  mine.metadata.pageSize = { label: 'Square', widthIn: 8, heightIn: 8 };
  theirs.metadata.pageSize = { label: 'Wide', widthIn: 10, heightIn: 6 };
  mine.title = 'Ours';
  theirs.title = 'Theirs';
  const { conflicts } = mergeProjects(b, mine, theirs);
  assert.deepEqual(conflicts.map((c) => c.label).sort(), ['Page size', 'Project title', 'Style']);
  assert.ok(conflicts.every((c) => c.where.tab === 'outline'));
});

test('bookkeeping fields never conflict', () => {
  const b = base();
  const mine = clone(b);
  const theirs = clone(b);
  mine.updatedAt = '2026-01-01T00:00:00.000Z';
  theirs.updatedAt = '2026-02-02T00:00:00.000Z';
  mine.savedAt = 'a';
  theirs.savedAt = 'b';
  assert.deepEqual(mergeProjects(b, mine, theirs).conflicts, []);
});

test('resolveAll applies one choice per conflict and returns a valid project', () => {
  const b = base();
  const mine = clone(b);
  const theirs = clone(b);
  panelA(mine).layers[0].prompt = 'Ours';
  panelA(theirs).layers[0].prompt = 'Theirs';
  mine.metadata.style = 'Our style';
  theirs.metadata.style = 'Their style';
  const { merged, conflicts } = mergeProjects(b, mine, theirs);
  assert.equal(conflicts.length, 2);
  const promptAt = conflicts.findIndex((c) => c.kind === 'value' && c.label.includes('prompt'));
  const choices = conflicts.map((_, i) => (i === promptAt ? 'theirs' : 'ours')) as Array<
    'ours' | 'theirs'
  >;
  const result = resolveAll(merged, conflicts, choices);
  assert.equal(panelA(result).layers[0].prompt, 'Theirs');
  assert.equal(result.metadata.style, 'Our style');
});

test('the inputs are never changed', () => {
  const b = base();
  const mine = clone(b);
  const theirs = clone(b);
  panelA(mine).layers[0].prompt = 'Ours';
  panelA(theirs).layers[0].prompt = 'Theirs';
  theirs.pages.push({
    id: 'x',
    number: 3,
    title: 'X',
    panels: [{ id: 'xp', x: 0, y: 0, width: 100, height: 100, layers: [], bubbles: [] }],
  });
  const [b0, m0, t0] = [clone(b), clone(mine), clone(theirs)];
  const { merged } = mergeProjects(b, mine, theirs);
  merged.pages[1].title = 'changed after the merge';
  assert.deepEqual(b, b0);
  assert.deepEqual(mine, m0);
  assert.deepEqual(theirs, t0);
});

/** A small deterministic random number generator, so a failure can be reproduced. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

test('property: edits to different things on the two sides always merge, and both are kept', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rand = random(seed);
    const b = base();
    // More layers, so there is room for both sides to edit different ones.
    for (const panel of b.pages[1].panels) {
      for (let i = 0; i < 4; i++) panel.layers.push(layer(`${panel.id}-x${i}`, `Extra ${i}`));
    }
    const targets = b.pages[1].panels.flatMap((panel) =>
      panel.layers.map((l) => ({ panel: panel.id, id: l.id }))
    );
    const fields = ['prompt', 'name', 'opacity', 'rotation'] as const;
    const mine = clone(b);
    const theirs = clone(b);
    const expected = clone(b);
    const claimed = new Set<string>();
    const find = (project: ComicProject, panel: string, id: string) =>
      project.pages[1].panels.find((p) => p.id === panel)!.layers.find((l) => l.id === id)!;

    for (let n = 0; n < 12; n++) {
      const target = targets[Math.floor(rand() * targets.length)];
      const field = fields[Math.floor(rand() * fields.length)];
      const key = `${target.id}.${field}`;
      if (claimed.has(key)) continue; // never both sides on the same field
      claimed.add(key);
      const value =
        field === 'prompt' || field === 'name' ? `v${seed}-${n}` : Math.round(rand() * 100) / 100;
      const side = rand() < 0.5 ? mine : theirs;
      (find(side, target.panel, target.id) as unknown as Record<string, unknown>)[field] = value;
      (find(expected, target.panel, target.id) as unknown as Record<string, unknown>)[field] =
        value;
    }
    const { merged, conflicts } = mergeProjects(b, mine, theirs);
    assert.deepEqual(conflicts, [], `seed ${seed}`);
    assert.deepEqual(merged.pages, expected.pages, `seed ${seed}`);
  }
});

test('property: merging is the same whichever side is "ours" when nothing conflicts', () => {
  for (let seed = 100; seed < 130; seed++) {
    const rand = random(seed);
    const b = base();
    const mine = clone(b);
    const theirs = clone(b);
    if (rand() < 0.7) mine.metadata.characters[0].name = `n${seed}`;
    if (rand() < 0.7) theirs.metadata.characters[1].description = `d${seed}`;
    if (rand() < 0.5) mine.pages[2].title = `t${seed}`;
    if (rand() < 0.5) theirs.pages[1].title = `u${seed}`;
    const ab = mergeProjects(b, mine, theirs);
    const ba = mergeProjects(b, theirs, mine);
    assert.deepEqual(ab.conflicts, []);
    assert.deepEqual(ab.merged.pages, ba.merged.pages, `seed ${seed}`);
    assert.deepEqual(ab.merged.metadata, ba.merged.metadata, `seed ${seed}`);
  }
});

test('a layer or image subject merges like any other field, and can be cleared', () => {
  const b = base();
  b.metadata.media = [{ id: 'm1', name: 'run.png', fileName: 'run.png', mimeType: 'image/png' }];
  const mine = clone(b);
  const theirs = clone(b);
  mine.pages[1].panels[0].layers[0].subjectId = 'c1';
  theirs.pages[1].panels[0].layers[0].name = 'Mira';
  mine.metadata.media[0].subjectId = 'c1';
  let result = mergeProjects(b, mine, theirs);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.merged.pages[1].panels[0].layers[0].subjectId, 'c1');
  assert.equal(result.merged.pages[1].panels[0].layers[0].name, 'Mira');
  assert.equal(result.merged.metadata.media[0].subjectId, 'c1');

  theirs.pages[1].panels[0].layers[0].subjectId = 'c2';
  result = mergeProjects(b, mine, theirs);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].label, 'Page 1 "Chase" › Panel 1 › Layer "Hero" › subjectId');

  // Cleared on one side (the key is removed), untouched on the other
  const withSubject = clone(b);
  withSubject.pages[1].panels[0].layers[0].subjectId = 'c1';
  const cleared = clone(withSubject);
  delete cleared.pages[1].panels[0].layers[0].subjectId;
  const renamed = clone(withSubject);
  renamed.pages[1].panels[0].layers[0].name = 'Mira';
  result = mergeProjects(withSubject, cleared, renamed);
  assert.deepEqual(result.conflicts, []);
  assert.equal('subjectId' in result.merged.pages[1].panels[0].layers[0], false);
  assert.equal(result.merged.pages[1].panels[0].layers[0].name, 'Mira');
});
