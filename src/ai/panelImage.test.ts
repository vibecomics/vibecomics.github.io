/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertValidProject, createBlankProject } from '../state/project';
import type { Layer, Panel } from '../types/comic';
import { buildPanelBrief } from './panelBrief';
import { isPanelImageDirty, panelCompositeBasis, swapPanelImage } from './panelImage';
import { buildPanelPromptParts } from './prompt';

const layer = (over: Partial<Layer> = {}): Layer => ({
  id: 'l1',
  name: 'Mara',
  kind: 'foreground',
  mediaId: 'm1',
  visible: true,
  x: 10,
  y: 20,
  width: 30,
  rotation: 0,
  opacity: 1,
  ...over,
});

const panelWith = (layers: Layer[]): Panel => ({
  ...createBlankProject('T').pages[0].panels[0],
  layers,
});

test('a panel image is out of date when something it was made from changes', () => {
  const panel = panelWith([layer({ kind: 'background', id: 'bg', mediaId: 'bg1' }), layer()]);
  assert.equal(isPanelImageDirty(panel), false, 'no panel image: nothing to be out of date');

  panel.image = swapPanelImage(panel, 'panel1');
  assert.equal(isPanelImageDirty(panel), false);

  // Things that do not show up in the composite leave it current.
  panel.bubbles.push({ id: 'b', kind: 'speech', text: 'Hi', x: 1, y: 1, width: 20, height: 20 });
  panel.layers[1].name = 'Renamed';
  panel.layers[1].prompt = 'a new prompt, no new image yet';
  panel.layers[0].x = 50; // a background fills the panel, so its place is ignored
  assert.equal(isPanelImageDirty(panel), false);

  // Things that do change it.
  const changes: Array<(p: Panel) => void> = [
    (p) => (p.layers[1].x = 11),
    (p) => (p.layers[1].width = 31),
    (p) => (p.layers[1].rotation = 5),
    (p) => (p.layers[1].flipX = true),
    (p) => (p.layers[1].opacity = 0.5),
    (p) => (p.layers[1].mediaId = 'm2'),
    (p) => (p.layers[1].visible = false),
    (p) => p.layers.reverse(),
    (p) => (p.prompt = 'moonlight'),
  ];
  for (const change of changes) {
    const edited = structuredClone(panel);
    change(edited);
    assert.equal(isPanelImageDirty(edited), true, change.toString());
  }
});

test('swapping a panel image keeps the old one in history, once, and shows it', () => {
  const panel = panelWith([layer()]);
  panel.image = swapPanelImage(panel, 'a');
  panel.image = { ...panel.image, visible: false };
  panel.image = swapPanelImage(panel, 'b');
  assert.deepEqual(panel.image.mediaHistory, ['a']);
  assert.equal(panel.image.visible, true);
  assert.equal(panel.image.basis, panelCompositeBasis(panel));
  panel.image = swapPanelImage(panel, 'a'); // restoring an old one never lists it twice
  assert.deepEqual(panel.image.mediaHistory, ['b']);
  assert.equal(panel.image.mediaId, 'a');
});

test('the panel image and prompt are valid project data, and bad ones are not', () => {
  const project = createBlankProject('T');
  project.pages[0].panels[0].prompt = 'Golden hour';
  project.pages[0].panels[0].image = { mediaId: 'm', visible: true, basis: 'x' };
  assertValidProject(project);

  const bad = structuredClone(project) as unknown as {
    pages: Array<{ panels: Array<{ image: Record<string, unknown> }> }>;
  };
  bad.pages[0].panels[0].image.visible = 'yes';
  assert.throws(() => assertValidProject(bad), /panels\[0\]\.image.*visible/);
});

test('panel prompt parts only include the style addenda that apply', () => {
  const project = createBlankProject('T');
  project.metadata.style = 'S';
  project.metadata.characterStyle = 'C';
  project.metadata.sceneStyle = 'SC';
  const panelId = project.pages[0].panels[0].id;
  const labels = () => buildPanelPromptParts(project, panelId).map((p) => p.label);
  assert.deepEqual(labels(), ['Style', 'Technical requirements']);

  project.metadata.characters.push({
    id: 'c1',
    name: 'Mara',
    description: 'Red hair',
    imageIds: [],
    sceneIds: [],
    variations: [],
  });
  project.pages[0].panels[0].layers.push(layer({ subjectId: 'c1' }));
  project.pages[0].panels[0].prompt = 'Dusk';
  assert.deepEqual(labels(), [
    'Style',
    'Character style',
    'Panel prompt',
    'Technical requirements',
  ]);
  assert.throws(() => buildPanelPromptParts(project, 'nope'), /not found/);
});

test('placement turns a layer into percentages, pixels and plain words', () => {
  const project = createBlankProject('T');
  const panel = project.pages[0].panels[0];
  // A wide image whose height follows its aspect ratio: 2:1 at 40% of the panel width.
  panel.layers.push(layer({ x: 0, y: 70, width: 40, aspectRatio: 2, rotation: 10 }));
  const brief = buildPanelBrief(project, panel.id);
  const { placement } = brief.layers[0];
  const panelAspect = brief.panel.size.widthIn / brief.panel.size.heightIn;
  assert.equal(placement.width, 40);
  assert.ok(Math.abs(placement.height - (40 * panelAspect) / 2) < 0.2);
  assert.equal(placement.pixels.width, Math.round(0.4 * brief.panel.size.pixels.width));
  assert.match(placement.description, /left third, lower part/);
  assert.match(placement.description, /rotated 10 degrees/);
  assert.equal(brief.layers[0].order, 1);
});
