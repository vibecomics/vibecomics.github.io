/// <reference types="node" />
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  BadRequestError,
  ConflictError,
  createStore,
  FileExistsError,
  NotFoundError,
} from './store.ts';

async function withStore(
  run: (store: ReturnType<typeof createStore>, root: string) => Promise<void>
) {
  const root = await mkdtemp(path.join(tmpdir(), 'http-storage-test-'));
  try {
    await run(createStore(root), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const upload = (store: ReturnType<typeof createStore>, fileName: string, text = 'bytes') =>
  store.saveFile('Demo', { fileName, buffer: Buffer.from(text) });

test('an uploaded file is stored and read back under its own name, typed by its extension', () =>
  withStore(async (store, root) => {
    const saved = await upload(store, 'ash-sword.png', 'abc');
    assert.equal(saved.name, 'ash-sword.png');
    assert.equal(saved.mimeType, 'image/png');
    const { buffer, meta } = await store.readFile('Demo', 'ash-sword.png');
    assert.equal(buffer.toString(), 'abc');
    assert.equal(meta.version, saved.version);
    assert.deepEqual(await readdir(path.join(root, 'Demo')), ['ash-sword.png']);
  }));

test('a name that is already taken is refused, and the first file is left alone', () =>
  withStore(async (store) => {
    await upload(store, 'a.png', 'first');
    await assert.rejects(upload(store, 'a.png', 'second'), FileExistsError);
    assert.equal((await store.readFile('Demo', 'a.png')).buffer.toString(), 'first');
  }));

test('names that break the naming rule, or would leave the folder, are refused', () =>
  withStore(async (store) => {
    await store.ensureProject('Demo');
    for (const bad of [
      'A.png',
      'a b.png',
      '../a.png',
      'a/b.png',
      'project.json',
      '.hidden.png',
      'a',
    ]) {
      await assert.rejects(upload(store, bad), BadRequestError, bad);
    }
    assert.deepEqual(await store.listFiles('Demo'), []);
  }));

test('looking up a name that cannot exist finds nothing, rather than failing', () =>
  withStore(async (store) => {
    await store.ensureProject('Demo');
    await assert.rejects(store.statFile('Demo', 'Not A Name'), NotFoundError);
    await assert.rejects(store.readFile('Demo', 'missing.png'), NotFoundError);
  }));

test('listFiles shows the project images only', () =>
  withStore(async (store) => {
    await upload(store, 'b.png');
    await upload(store, 'a.thumb.jpg');
    await store.saveProjectJson('Demo', { title: 'x' });
    const names = (await store.listFiles('Demo')).map((f) => f.name);
    assert.deepEqual(names, ['a.thumb.jpg', 'b.png']);
  }));

test('a trashed file leaves the project, keeps its bytes, and its name can be used again', () =>
  withStore(async (store, root) => {
    await upload(store, 'a.png', 'old');
    await store.trashFile('Demo', 'a.png');
    await assert.rejects(store.readFile('Demo', 'a.png'), NotFoundError);
    await upload(store, 'a.png', 'new');
    await store.trashFile('Demo', 'a.png');
    assert.equal((await readdir(path.join(root, 'Demo', '.trash'))).length, 2);
  }));

test('project.json is versioned: a save with a stale version is refused', () =>
  withStore(async (store) => {
    const v1 = await store.saveProjectJson('Demo', { n: 1 });
    const v2 = await store.saveProjectJson('Demo', { n: 2 }, v1);
    assert.notEqual(v1, v2);
    await assert.rejects(store.saveProjectJson('Demo', { n: 3 }, v1), ConflictError);
    assert.deepEqual(await store.getProjectJson('Demo'), { json: { n: 2 }, version: v2 });
  }));

test('a project name cannot leave the storage folder', () =>
  withStore(async (store) => {
    await assert.rejects(store.ensureProject('../evil'), BadRequestError);
    await assert.rejects(store.getProjectJson('a/b'), BadRequestError);
  }));
