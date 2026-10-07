/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBlankProject } from '../state/project';
import type { ComicProject, MediaItem } from '../types/comic';
import { backupProject } from './backup';
import type { StorageBackendImpl } from './backend';
import { ProjectFileMissingError } from './types';
import type { ProjectFile, ProjectFolder, StoredFile } from './types';

/** A minimal in-memory StorageBackendImpl, enough to exercise backupProject's logic. */
function fakeBackend(label: string): StorageBackendImpl & {
  folders: Map<string, string>;
  files: Map<string, Map<string, { mimeType: string; bytes: string }>>;
  projectJson: Map<string, unknown>;
  trashed: string[];
  downloadCount: Map<string, number>;
} {
  const folders = new Map<string, string>(); // id -> name
  const files = new Map<string, Map<string, { mimeType: string; bytes: string }>>();
  const projectJson = new Map<string, unknown>();
  const trashed: string[] = [];
  const downloadCount = new Map<string, number>();

  const folderIdByName = (name: string) => [...folders.entries()].find(([, n]) => n === name)?.[0];

  return {
    label,
    folders,
    files,
    projectJson,
    trashed,
    downloadCount,
    async listProjectFolders(): Promise<ProjectFolder[]> {
      return [...folders.entries()].map(([id, name]) => ({ id, name }));
    },
    async ensureProjectFolder(name: string): Promise<ProjectFolder> {
      const existing = folderIdByName(name);
      if (existing) return { id: existing, name };
      const id = `${label}-folder-${folders.size + 1}`;
      folders.set(id, name);
      files.set(id, new Map());
      return { id, name };
    },
    async uploadImage(folderId: string, file: File, name?: string): Promise<StoredFile> {
      const fileName = name ?? file.name;
      const bytes = Buffer.from(await file.arrayBuffer()).toString('base64');
      files.get(folderId)!.set(fileName, { mimeType: file.type, bytes });
      return { name: fileName, mimeType: file.type };
    },
    async trashFile(folderId: string, fileName: string): Promise<void> {
      trashed.push(`${folderId}/${fileName}`);
      files.get(folderId)?.delete(fileName);
    },
    async downloadFile(folderId: string, fileName: string): Promise<Blob> {
      downloadCount.set(fileName, (downloadCount.get(fileName) ?? 0) + 1);
      const stored = files.get(folderId)?.get(fileName);
      if (!stored) throw new Error(`No file named "${fileName}" in this project.`);
      return new Blob([Buffer.from(stored.bytes, 'base64')], { type: stored.mimeType });
    },
    async findFileByName(folderId: string, name: string): Promise<StoredFile | undefined> {
      const stored = files.get(folderId)?.get(name);
      return stored ? { name, mimeType: stored.mimeType } : undefined;
    },
    async listFolderFiles(folderId: string): Promise<StoredFile[]> {
      return [...(files.get(folderId) ?? new Map()).entries()].map(([name, stored]) => ({
        name,
        mimeType: stored.mimeType,
        size: Buffer.from(stored.bytes, 'base64').length,
      }));
    },
    async saveProjectJson(folderId: string, project: unknown): Promise<string | null> {
      projectJson.set(folderId, project);
      return 'v1';
    },
    async loadProjectFile(folderId: string): Promise<ProjectFile> {
      if (!projectJson.has(folderId)) {
        throw new ProjectFileMissingError('No project.json found.');
      }
      return { json: projectJson.get(folderId), version: 'v1' };
    },
    hasAccess: () => true,
    disconnect: () => undefined,
  };
}

function projectWithMedia(title: string): { project: ComicProject; items: MediaItem[] } {
  const project = createBlankProject(title);
  const items: MediaItem[] = [
    { id: 'm1', name: 'Hero', fileName: 'hero.png', mimeType: 'image/png' },
    {
      id: 'm2',
      name: 'Scene',
      fileName: 'scene.png',
      mimeType: 'image/png',
      thumbnailFileName: 'scene.thumb.png',
    },
  ];
  project.metadata.media = items;
  return { project, items };
}

test('backupProject creates the target folder and copies every media file and its thumbnail', async () => {
  const source = fakeBackend('source');
  const target = fakeBackend('target');
  const { project } = projectWithMedia('My Comic');
  const folder = await source.ensureProjectFolder('My Comic');
  await source.uploadImage(folder.id, new File(['hero-bytes'], 'hero.png', { type: 'image/png' }));
  await source.uploadImage(
    folder.id,
    new File(['scene-bytes'], 'scene.png', { type: 'image/png' })
  );
  await source.uploadImage(
    folder.id,
    new File(['thumb-bytes'], 'scene.thumb.png', { type: 'image/png' })
  );

  const summary = await backupProject(source, target, folder.id, 'My Comic', project);

  assert.deepEqual(summary, { copied: 3, skipped: 0, missing: [] });
  const targetFolder = (await target.listProjectFolders())[0];
  assert.ok(targetFolder, 'target folder was created');
  assert.equal(targetFolder.name, 'My Comic');
  const stored = target.files.get(targetFolder.id)!;
  assert.deepEqual([...stored.keys()].sort(), ['hero.png', 'scene.png', 'scene.thumb.png'].sort());
  assert.equal(target.projectJson.get(targetFolder.id), project);
});

test('backupProject overwrites a same-named folder instead of creating a second one', async () => {
  const source = fakeBackend('source');
  const target = fakeBackend('target');
  const { project } = projectWithMedia('My Comic');
  const sourceFolder = await source.ensureProjectFolder('My Comic');
  // Different length than the target's current copy, so it is treated as changed.
  await source.uploadImage(
    sourceFolder.id,
    new File(['new-hero-bytes-v2'], 'hero.png', { type: 'image/png' })
  );
  await source.uploadImage(sourceFolder.id, new File(['v2'], 'scene.png', { type: 'image/png' }));
  await source.uploadImage(
    sourceFolder.id,
    new File(['v2'], 'scene.thumb.png', { type: 'image/png' })
  );

  // The target already has a same-named folder with an older, differently-sized "hero.png".
  const existingTargetFolder = await target.ensureProjectFolder('My Comic');
  await target.uploadImage(
    existingTargetFolder.id,
    new File(['old-hero-v1'], 'hero.png', { type: 'image/png' })
  );

  const summary = await backupProject(source, target, sourceFolder.id, 'My Comic', project);

  assert.deepEqual(summary, { copied: 3, skipped: 0, missing: [] });
  const folders = await target.listProjectFolders();
  assert.equal(folders.length, 1, 'no second folder was created');
  const stored = target.files.get(existingTargetFolder.id)!;
  const hero = await (await target.downloadFile(existingTargetFolder.id, 'hero.png')).text();
  assert.equal(
    hero,
    'new-hero-bytes-v2',
    'the old file was replaced, not left alongside a duplicate'
  );
  assert.ok(stored.has('scene.png'));
  assert.ok(stored.has('scene.thumb.png'));
});

test('backupProject skips a file already on the target with the same byte size', async () => {
  const source = fakeBackend('source');
  const target = fakeBackend('target');
  const { project } = projectWithMedia('My Comic');
  const sourceFolder = await source.ensureProjectFolder('My Comic');
  await source.uploadImage(
    sourceFolder.id,
    new File(['12345678'], 'hero.png', { type: 'image/png' })
  );
  await source.uploadImage(sourceFolder.id, new File(['v2'], 'scene.png', { type: 'image/png' }));
  await source.uploadImage(
    sourceFolder.id,
    new File(['v2'], 'scene.thumb.png', { type: 'image/png' })
  );

  const targetFolder = await target.ensureProjectFolder('My Comic');
  // Same byte length as source's "hero.png" (8 bytes), different content: the size-based check
  // treats this as unchanged and leaves it alone.
  await target.uploadImage(
    targetFolder.id,
    new File(['ABCDEFGH'], 'hero.png', { type: 'image/png' })
  );

  const progressCalls: Array<[number, number]> = [];
  const summary = await backupProject(
    source,
    target,
    sourceFolder.id,
    'My Comic',
    project,
    (done, total) => progressCalls.push([done, total])
  );

  assert.deepEqual(summary, { copied: 2, skipped: 1, missing: [] });
  assert.equal(source.downloadCount.get('hero.png'), undefined, 'hero.png was never downloaded');
  const hero = await (await target.downloadFile(targetFolder.id, 'hero.png')).text();
  assert.equal(hero, 'ABCDEFGH', "the target's copy was left untouched");
  assert.equal(source.downloadCount.get('scene.png'), 1, 'the new file was still copied');
  assert.deepEqual(progressCalls[0], [0, 2], 'reports the total up front');
  assert.deepEqual(
    progressCalls[progressCalls.length - 1],
    [2, 2],
    'reports completion at the end'
  );
});

test('backupProject skips (not aborts on) a referenced file that no longer exists on the source', async () => {
  const source = fakeBackend('source');
  const target = fakeBackend('target');
  const { project } = projectWithMedia('My Comic');
  const folder = await source.ensureProjectFolder('My Comic');
  // "hero.png" is never uploaded to source: it is referenced by the project but missing in storage,
  // a pre-existing data problem. "scene.png"/"scene.thumb.png" are fine.
  await source.uploadImage(folder.id, new File(['v2'], 'scene.png', { type: 'image/png' }));
  await source.uploadImage(folder.id, new File(['v2'], 'scene.thumb.png', { type: 'image/png' }));

  const summary = await backupProject(source, target, folder.id, 'My Comic', project);

  assert.deepEqual(summary, { copied: 2, skipped: 0, missing: ['hero.png'] });
  const targetFolder = (await target.listProjectFolders())[0];
  assert.ok(target.projectJson.has(targetFolder.id), 'project.json was still written');
  const stored = target.files.get(targetFolder.id)!;
  assert.deepEqual([...stored.keys()].sort(), ['scene.png', 'scene.thumb.png']);
});

test('backupProject stops without writing project.json when a copy to the target itself fails', async () => {
  const source = fakeBackend('source');
  const target = fakeBackend('target');
  const { project } = projectWithMedia('My Comic');
  const folder = await source.ensureProjectFolder('My Comic');
  await source.uploadImage(folder.id, new File(['v2'], 'hero.png', { type: 'image/png' }));
  await source.uploadImage(folder.id, new File(['v2'], 'scene.png', { type: 'image/png' }));
  await source.uploadImage(folder.id, new File(['v2'], 'scene.thumb.png', { type: 'image/png' }));

  const realUpload = target.uploadImage.bind(target);
  target.uploadImage = (folderId, file, name) => {
    if (name === 'scene.png') throw new Error('simulated upload failure');
    return realUpload(folderId, file, name);
  };

  await assert.rejects(() => backupProject(source, target, folder.id, 'My Comic', project));
  assert.equal(target.projectJson.size, 0, 'project.json is written last, so it was never reached');
});
