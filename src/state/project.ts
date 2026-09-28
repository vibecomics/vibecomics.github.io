import type { ComicProject, PageSize } from '../types/comic';
import { blankMetadata, DEFAULT_PAGE_SIZE } from '../types/comic';
import { createPanel, normalizePagePanels } from './layout';
import { newId } from '../utils/id';

export function createBlankProject(
  title = 'Untitled Comic',
  pageSize: PageSize = DEFAULT_PAGE_SIZE
): ComicProject {
  const now = new Date().toISOString();
  return {
    id: newId('comic'),
    title,
    updatedAt: now,
    savedAt: now,
    metadata: blankMetadata(pageSize),
    pages: [{ id: 'page-cover', number: 0, title: 'Cover', panels: [createPanel()] }],
  };
}

/** Fill in fields added after a project.json was written, so old projects stay loadable. */
export function normalizeProject(p: ComicProject): void {
  // style replaced outline (a synopsis stitched into every image's prompt was drowning it out): an
  // old project.json only has outline, so carry it over rather than lose it or fail to load. It's
  // likely far more than a STYLE paragraph should be; trim it down with metadata.setStyle.
  const legacy = p.metadata as unknown as { outline?: string };
  if (p.metadata.style === undefined && typeof legacy.outline === 'string') {
    p.metadata.style = legacy.outline;
  }
  p.metadata.style ??= '';
  delete legacy.outline;
  p.metadata.pageSize ??= { ...DEFAULT_PAGE_SIZE };
  for (const page of p.pages) {
    normalizePagePanels(page.panels);
    page.panels.flatMap((panel) => panel.bubbles).forEach((bubble) => (bubble.height ??= 20));
  }
}

/**
 * Throws if the value is not a usable ComicProject. Mirrors
 * public/schema/comic-project.schema.json and reports the failing path
 * (e.g. "project.pages[2].panels[0].layers[1]").
 */
export function assertValidProject(p: unknown): asserts p is ComicProject {
  const project = expectRecord(p, 'project');
  expectStrings(project, 'project', ['id', 'title', 'savedAt']);
  optionalString(project, 'project', 'updatedAt');
  expectArray(project.pages, 'project', 'pages').forEach((page, i) =>
    checkPage(page, `project.pages[${i}]`)
  );
  checkMetadata(project.metadata, 'project.metadata');
}

function checkMetadata(value: unknown, path: string): void {
  const m = expectRecord(value, path);
  // style replaced outline; normalizeProject migrates an old project.json that still has outline.
  if (m.style === undefined && m.outline === undefined) fail(path, 'expected string "style"');
  optionalString(m, path, 'style');
  optionalString(m, path, 'outline');
  if (m.pageSize !== undefined) checkPageSize(m.pageSize, `${path}.pageSize`);
  const characters = expectArray(m.characters, path, 'characters');
  const scenes = expectArray(m.scenes, path, 'scenes');
  const objects = expectArray(m.objects, path, 'objects');
  const media = expectArray(m.media, path, 'media');
  characters.forEach((c, i) => checkStoryEntry(c, `${path}.characters[${i}]`, 'sceneIds'));
  scenes.forEach((s, i) => checkStoryEntry(s, `${path}.scenes[${i}]`, 'characterIds'));
  objects.forEach((o, i) => checkStoryEntry(o, `${path}.objects[${i}]`, 'sceneIds'));
  media.forEach((item, i) => {
    const mediaPath = `${path}.media[${i}]`;
    const record = expectRecord(item, mediaPath);
    expectStrings(record, mediaPath, ['id', 'name', 'fileName', 'mimeType']);
    optionalString(record, mediaPath, 'thumbnailFileName');
    optionalString(record, mediaPath, 'subjectId');
    optionalString(record, mediaPath, 'sceneId');
  });
}

function checkPageSize(value: unknown, path: string): void {
  const size = expectRecord(value, path);
  expectStrings(size, path, ['label']);
  for (const key of ['widthIn', 'heightIn']) {
    if (!isFiniteNumber(size[key]) || size[key] <= 0) {
      fail(path, `"${key}" must be a positive number`);
    }
  }
}

function checkStoryEntry(value: unknown, path: string, linkField: string): void {
  const entry = expectRecord(value, path);
  expectStrings(entry, path, ['id', 'name', 'description']);
  for (const field of ['imageIds', linkField]) {
    expectArray(entry[field], path, field).forEach((id, i) => {
      if (typeof id !== 'string') fail(`${path}.${field}[${i}]`, 'expected string id');
    });
  }
}

function checkPage(value: unknown, path: string): void {
  const page = expectRecord(value, path);
  expectStrings(page, path, ['id', 'title']);
  optionalString(page, path, 'prompt');
  if (!Number.isInteger(page.number) || (page.number as number) < 0) {
    fail(path, '"number" must be a non-negative integer');
  }
  expectArray(page.panels, path, 'panels').forEach((panel, i) =>
    checkPanel(panel, `${path}.panels[${i}]`)
  );
}

function checkPanel(value: unknown, path: string): void {
  const panel = expectRecord(value, path);
  expectStrings(panel, path, ['id']);
  optionalString(panel, path, 'title');
  optionalString(panel, path, 'prompt');
  checkPanelRect(panel, path);
  expectArray(panel.layers, path, 'layers').forEach((layer, i) =>
    checkLayer(layer, `${path}.layers[${i}]`)
  );
  expectArray(panel.bubbles, path, 'bubbles').forEach((bubble, i) =>
    checkBubble(bubble, `${path}.bubbles[${i}]`)
  );
}

/** A panel's rectangle is optional (older projects lack it) but must be complete when present. */
function checkPanelRect(panel: Record<string, unknown>, path: string): void {
  const keys = ['x', 'y', 'width', 'height'];
  const present = keys.filter((key) => panel[key] !== undefined);
  if (present.length === 0) return;
  if (present.length < keys.length)
    fail(path, 'expected all of "x", "y", "width", "height", or none');
  expectNumbers(panel, path, keys);
  const { x, y, width, height } = panel as Record<string, number>;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 100.01 || y + height > 100.01) {
    fail(path, 'the panel must lie within the page (0-100%)');
  }
}

function checkLayer(value: unknown, path: string): void {
  const layer = expectRecord(value, path);
  expectStrings(layer, path, ['id', 'name']);
  if (layer.kind !== 'background' && layer.kind !== 'foreground') {
    fail(path, '"kind" must be "background" or "foreground"');
  }
  if (typeof layer.visible !== 'boolean') fail(path, 'expected boolean "visible"');
  expectNumbers(layer, path, ['x', 'y', 'width', 'rotation']);
  if (!isFiniteNumber(layer.opacity) || layer.opacity < 0 || layer.opacity > 1) {
    fail(path, '"opacity" must be a number between 0 and 1');
  }
  if (layer.flipX !== undefined && typeof layer.flipX !== 'boolean') {
    fail(path, '"flipX" must be a boolean');
  }
  if (layer.dirty !== undefined && typeof layer.dirty !== 'boolean') {
    fail(path, '"dirty" must be a boolean');
  }
  optionalString(layer, path, 'mediaId');
  if (layer.mediaHistory !== undefined) {
    expectArray(layer.mediaHistory, path, 'mediaHistory').forEach((id, i) => {
      if (typeof id !== 'string') fail(`${path}.mediaHistory[${i}]`, 'expected string id');
    });
  }
  optionalString(layer, path, 'subjectId');
  optionalString(layer, path, 'sceneId');
  optionalString(layer, path, 'prompt');
  if (
    layer.aspectRatio !== undefined &&
    !(isFiniteNumber(layer.aspectRatio) && layer.aspectRatio > 0)
  ) {
    fail(path, '"aspectRatio" must be a positive number');
  }
}

function checkBubble(value: unknown, path: string): void {
  const bubble = expectRecord(value, path);
  expectStrings(bubble, path, ['id', 'text']);
  if (!['speech', 'thought', 'shout', 'caption'].includes(bubble.kind as string)) {
    fail(path, '"kind" must be "speech", "thought", "shout", or "caption"');
  }
  expectNumbers(bubble, path, ['x', 'y', 'width']);
  if (bubble.height !== undefined && !(isFiniteNumber(bubble.height) && bubble.height > 0)) {
    fail(path, '"height" must be a positive number');
  }
  for (const key of ['tailX', 'tailY']) {
    if (bubble[key] !== undefined && !isFiniteNumber(bubble[key])) {
      fail(path, `expected finite number "${key}"`);
    }
  }
}

function fail(path: string, detail: string): never {
  throw new Error(`Invalid comic project at ${path}: ${detail}.`);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function expectRecord(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'expected an object');
  return v as Record<string, unknown>;
}

function expectArray(v: unknown, path: string, field: string): unknown[] {
  if (!Array.isArray(v)) fail(path, `expected array "${field}"`);
  return v;
}

function expectStrings(record: Record<string, unknown>, path: string, keys: string[]): void {
  for (const key of keys) {
    if (typeof record[key] !== 'string') fail(path, `expected string "${key}"`);
  }
}

function expectNumbers(record: Record<string, unknown>, path: string, keys: string[]): void {
  for (const key of keys) {
    if (!isFiniteNumber(record[key])) fail(path, `expected finite number "${key}"`);
  }
}

function optionalString(record: Record<string, unknown>, path: string, key: string): void {
  if (record[key] !== undefined && typeof record[key] !== 'string') {
    fail(path, `expected string "${key}"`);
  }
}
