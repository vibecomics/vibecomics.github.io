/**
 * S3 calls implementing the same shape as driveRest.ts/the old serverRest.ts: a project folder,
 * project.json with optimistic-concurrency versioning, media files inside it. S3 has no real
 * folders or atomic rename, so:
 *   - a "project folder" is a key prefix, made visible even when empty by a zero-byte
 *     `<project>/.vibecomics-keep` marker (ensureProjectFolder)
 *   - "no overwrite on upload" and "optimistic-concurrency save" both use native conditional
 *     PutObject (IfNoneMatch '*' / IfMatch <etag>) — supported by AWS S3 since 2024 and by most
 *     self-hosted S3-compatible servers, so there is no read-then-write race (verify your chosen
 *     server supports conditional writes before relying on this)
 *   - trashing a file is CopyObject-then-DeleteObject (S3 has no move)
 * No browser APIs: the S3Client is injected (getClient), so this runs in the browser and the CLI.
 */
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';
import { ProjectChangedError, ProjectFileMissingError } from '../storage/types';
import type { ProjectFile, ProjectFolder, StoredFile } from '../storage/types';
import { isValidFileName } from '../utils/fileName';
import { mimeTypeOf } from '../utils/mimeType';
import { sanitizeProjectName } from '../utils/projectName';

export interface S3RestOptions {
  /** The connected client, or null when disconnected. */
  getClient: () => S3Client | null;
  bucket: string;
}

const KEEP_FILE = '.vibecomics-keep';
const PROJECT_FILE = 'project.json';
const TRASH_PREFIX = '.trash/';

export function createS3Rest({ getClient, bucket }: S3RestOptions) {
  function requireClient(): S3Client {
    const client = getClient();
    if (!client) throw new Error('Not connected to S3 storage.');
    return client;
  }

  const errorName = (e: unknown): string | undefined =>
    e instanceof Error ? ((e as { name?: string }).name ?? e.constructor.name) : undefined;
  const isNotFound = (e: unknown) => errorName(e) === 'NotFound' || errorName(e) === 'NoSuchKey';
  const isPreconditionFailed = (e: unknown) => errorName(e) === 'PreconditionFailed';

  const projectKey = (folderId: string, name: string) => `${sanitizeProjectName(folderId)}/${name}`;
  const projectJsonKey = (folderId: string) => `${sanitizeProjectName(folderId)}/${PROJECT_FILE}`;

  return {
    /** Every project folder: the top-level key prefixes, visible once they have at least one key. */
    async listProjectFolders(): Promise<ProjectFolder[]> {
      const client = requireClient();
      const names = new Set<string>();
      let continuationToken: string | undefined;
      do {
        const res = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Delimiter: '/',
            ContinuationToken: continuationToken,
          })
        );
        for (const p of res.CommonPrefixes ?? []) {
          if (p.Prefix) names.add(p.Prefix.replace(/\/$/, ''));
        }
        continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (continuationToken);
      return [...names].sort((a, b) => a.localeCompare(b)).map((name) => ({ id: name, name }));
    },

    /** Find or create the project folder: writes a marker key so an empty project still shows up. */
    async ensureProjectFolder(rawName: string): Promise<ProjectFolder> {
      const name = sanitizeProjectName(rawName);
      const client = requireClient();
      const keepKey = `${name}/${KEEP_FILE}`;
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: keepKey }));
      } catch (e) {
        if (!isNotFound(e)) throw e;
        await client.send(
          new PutObjectCommand({ Bucket: bucket, Key: keepKey, Body: new Uint8Array(0) })
        );
      }
      return { id: name, name };
    },

    /** Upload under its own name; refused (no overwrite) via a conditional PutObject. */
    async uploadImage(folderId: string, file: File, name?: string): Promise<StoredFile> {
      const client = requireClient();
      const fileName = name || file.name;
      const key = projectKey(folderId, fileName);
      const body = new Uint8Array(await file.arrayBuffer());
      try {
        const res = await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: mimeTypeOf(fileName),
            IfNoneMatch: '*',
          })
        );
        return {
          name: fileName,
          mimeType: mimeTypeOf(fileName),
          version: res.ETag ?? undefined,
          size: body.byteLength,
        };
      } catch (e) {
        if (isPreconditionFailed(e)) {
          throw new Error(`"${folderId}" already has a file named "${fileName}".`);
        }
        throw e;
      }
    },

    /** The file named `name` in the project folder, or undefined when there is none. */
    async findFileByName(folderId: string, name: string): Promise<StoredFile | undefined> {
      const client = requireClient();
      try {
        const res = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: projectKey(folderId, name) })
        );
        return {
          name,
          mimeType: res.ContentType ?? mimeTypeOf(name),
          version: res.ETag ?? undefined,
          size: res.ContentLength,
        };
      } catch (e) {
        if (isNotFound(e)) return undefined;
        throw e;
      }
    },

    /** Every file directly inside the project folder, in one call. */
    async listFolderFiles(folderId: string): Promise<StoredFile[]> {
      const client = requireClient();
      const prefix = `${sanitizeProjectName(folderId)}/`;
      const files: StoredFile[] = [];
      let continuationToken: string | undefined;
      do {
        const res = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            Delimiter: '/',
            ContinuationToken: continuationToken,
          })
        );
        for (const obj of res.Contents ?? []) {
          const name = obj.Key?.slice(prefix.length) ?? '';
          if (!isValidFileName(name)) continue; // skips the keep marker and project.json
          files.push({
            name,
            mimeType: mimeTypeOf(name),
            version: obj.ETag ?? undefined,
            size: obj.Size,
          });
        }
        continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (continuationToken);
      return files.sort((a, b) => a.name.localeCompare(b.name));
    },

    /** Move a file to its project's trash (recoverable there). Already-gone counts as trashed. */
    async trashFile(folderId: string, fileName: string): Promise<void> {
      const client = requireClient();
      const name = sanitizeProjectName(folderId);
      const sourceKey = projectKey(folderId, fileName);
      let targetKey = `${name}/${TRASH_PREFIX}${fileName}`;
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: targetKey }));
        // A name can be trashed again after a re-upload: keep the older copy too.
        targetKey = `${name}/${TRASH_PREFIX}${Date.now()}-${fileName}`;
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
      try {
        await client.send(
          new CopyObjectCommand({
            Bucket: bucket,
            Key: targetKey,
            CopySource: `${encodeURIComponent(bucket)}/${encodeURIComponent(sourceKey)}`,
          })
        );
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: sourceKey }));
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
    },

    async downloadFile(folderId: string, fileName: string): Promise<Blob> {
      const client = requireClient();
      const key = projectKey(folderId, fileName);
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const bytes = await res.Body!.transformToByteArray();
      // transformToByteArray()'s Uint8Array can be backed by a SharedArrayBuffer, which Blob's
      // constructor type rejects: copy into a plain ArrayBuffer-backed one.
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return new Blob([copy], { type: res.ContentType ?? mimeTypeOf(fileName) });
    },

    /**
     * Create or overwrite project.json and return its new version (the S3 ETag). When
     * `expectVersion` is given, a conditional PutObject (IfMatch) refuses the write with a
     * ProjectChangedError if project.json has changed since — atomic, no read-then-write race.
     */
    async saveProjectJson(
      folderId: string,
      project: unknown,
      expectVersion?: string | null
    ): Promise<string | null> {
      const client = requireClient();
      const key = projectJsonKey(folderId);
      try {
        const res = await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: new TextEncoder().encode(JSON.stringify(project, null, 2)),
            ContentType: 'application/json',
            ...(expectVersion != null && { IfMatch: expectVersion }),
          })
        );
        return res.ETag ?? null;
      } catch (e) {
        if (isPreconditionFailed(e)) {
          const current = await client
            .send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
            .catch(() => undefined);
          throw new ProjectChangedError(current?.ETag ?? null);
        }
        throw e;
      }
    },

    /** Read project.json, with the version (ETag) it has now. */
    async loadProjectFile(folderId: string): Promise<ProjectFile> {
      const client = requireClient();
      const key = projectJsonKey(folderId);
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const text = await res.Body!.transformToString();
        return { json: JSON.parse(text), version: res.ETag ?? null };
      } catch (e) {
        if (isNotFound(e)) {
          throw new ProjectFileMissingError('No project.json found in this project yet.');
        }
        throw e;
      }
    },
  };
}

export type S3Rest = ReturnType<typeof createS3Rest>;
