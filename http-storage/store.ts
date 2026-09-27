/**
 * The filesystem-backed storage this server exposes: a root directory holding one subdirectory per
 * comic project (mirroring the Drive backend's "one Drive folder per comic" shape), each with a
 * project.json and a `files/` directory of uploaded media blobs.
 *
 * Layout:
 *   <root>/.files-index.json  - { [fileId]: projectName }, so a file can be read or trashed by its id
 *                                alone, without knowing its project - mirrors Drive, where a file id
 *                                is globally addressable regardless of which folder holds it.
 *   <root>/<project name>/
 *     project.json      - the comic project, written atomically
 *     .meta.json         - { projectVersion, files: { [id]: { name, mimeType, size, createdAt } } }
 *     files/<id>          - one uploaded blob per id (opaque, generated - never a user-supplied name)
 *     .trash/<id>         - blobs removed from `files/` and from meta.files, kept for recovery
 *
 * No browser or HTTP APIs here: server.ts is the only thing that knows about requests/responses.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile as fsReadFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

/** Thrown for a project or file that does not exist. Maps to HTTP 404. */
export class NotFoundError extends Error {}

/** Thrown when a request is malformed (bad name, missing header, ...). Maps to HTTP 400. */
export class BadRequestError extends Error {}

/**
 * Thrown when a caller's `expectVersion` no longer matches project.json, i.e. somebody else saved
 * since it was loaded. Maps to HTTP 412 (mirrors the optimistic-concurrency check the Drive backend
 * does with its own file version).
 */
export class ConflictError extends Error {
  currentVersion: string | null;
  constructor(currentVersion: string | null) {
    super('project.json was changed by someone else since it was loaded.');
    this.currentVersion = currentVersion;
  }
}

const PROJECT_FILE = 'project.json';
const META_FILE = '.meta.json';
const FILES_DIR = 'files';
const TRASH_DIR = '.trash';
const INDEX_FILE = '.files-index.json';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FileIndex = Record<string, string>;

export interface ProjectFolder {
  id: string;
  name: string;
}

export interface FileMeta {
  id: string;
  name: string;
  mimeType: string;
  version: string;
}

interface StoredFileEntry {
  name: string;
  mimeType: string;
  version: string;
  size: number;
  createdAt: string;
}

interface ProjectMeta {
  projectVersion: number;
  files: Record<string, StoredFileEntry>;
}

/** Validate a project name and reject anything that could escape the root directory. */
export function sanitizeProjectName(name: unknown): string {
  if (typeof name !== 'string') throw new BadRequestError('name must be a string.');
  const trimmed = name.trim();
  if (!trimmed) throw new BadRequestError('name must not be empty.');
  if (trimmed.length > 200) throw new BadRequestError('name is too long (200 characters max).');
  if (trimmed === '.' || trimmed === '..') throw new BadRequestError('name is reserved.');
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    throw new BadRequestError('name must not contain path separators.');
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(trimmed))
    throw new BadRequestError('name must not contain control characters.');
  return trimmed;
}

function sanitizeFileId(id: unknown): string {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new BadRequestError('invalid file id.');
  return id;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
}

/** Write `data` to `filePath` atomically: write to a temp file in the same directory, then rename. */
async function writeFileAtomic(filePath: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  const handle = await open(tmp, 'w');
  try {
    await handle.writeFile(data);
  } finally {
    await handle.close();
  }
  await rename(tmp, filePath);
}

export interface SaveFileInput {
  fileName: string | undefined;
  mimeType: string | undefined;
  buffer: Buffer;
}

export interface ProjectJsonResult {
  json: unknown;
  version: string;
}

export function createStore(root: string) {
  const projectDir = (name: string) => path.join(root, name);
  const metaPath = (name: string) => path.join(projectDir(name), META_FILE);
  const projectJsonPath = (name: string) => path.join(projectDir(name), PROJECT_FILE);
  const filesDir = (name: string) => path.join(projectDir(name), FILES_DIR);
  const trashDir = (name: string) => path.join(projectDir(name), TRASH_DIR);
  const indexPath = path.join(root, INDEX_FILE);

  async function readMeta(name: string): Promise<ProjectMeta> {
    try {
      const raw = await fsReadFile(metaPath(name), 'utf8');
      const parsed = JSON.parse(raw) as Partial<ProjectMeta>;
      return { projectVersion: parsed.projectVersion ?? 0, files: parsed.files ?? {} };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { projectVersion: 0, files: {} };
      throw e;
    }
  }

  async function writeMeta(name: string, meta: ProjectMeta): Promise<void> {
    await writeFileAtomic(metaPath(name), JSON.stringify(meta));
  }

  async function requireProject(name: string): Promise<void> {
    if (!(await exists(projectDir(name)))) {
      throw new NotFoundError(`No project folder named "${name}".`);
    }
  }

  async function readIndex(): Promise<FileIndex> {
    try {
      return JSON.parse(await fsReadFile(indexPath, 'utf8')) as FileIndex;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw e;
    }
  }

  async function writeIndex(index: FileIndex): Promise<void> {
    await writeFileAtomic(indexPath, JSON.stringify(index));
  }

  /** The project a file id belongs to, or throws NotFoundError. */
  async function projectOfFile(id: string): Promise<string> {
    const project = (await readIndex())[id];
    if (!project) throw new NotFoundError(`No file "${id}".`);
    return project;
  }

  return {
    root,

    /** Create the root directory if it does not exist yet. */
    async init(): Promise<void> {
      await mkdir(root, { recursive: true });
    },

    /** List project folders, oldest-created first is not guaranteed - callers should sort by name. */
    async listProjects(): Promise<ProjectFolder[]> {
      await mkdir(root, { recursive: true });
      const entries = await readdir(root, { withFileTypes: true });
      const names = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));
      return names.map((name) => ({ id: name, name }));
    },

    /** Find or create the directory for a project. */
    async ensureProject(rawName: unknown): Promise<ProjectFolder & { created: boolean }> {
      const name = sanitizeProjectName(rawName);
      const created = !(await exists(projectDir(name)));
      await mkdir(filesDir(name), { recursive: true });
      return { id: name, name, created };
    },

    async projectExists(rawName: unknown): Promise<boolean> {
      return exists(projectDir(sanitizeProjectName(rawName)));
    },

    /** Read project.json and the version it currently has. */
    async getProjectJson(rawName: unknown): Promise<ProjectJsonResult> {
      const name = sanitizeProjectName(rawName);
      await requireProject(name);
      let raw: string;
      try {
        raw = await fsReadFile(projectJsonPath(name), 'utf8');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new NotFoundError(`No project.json in "${name}" yet.`);
        }
        throw e;
      }
      const meta = await readMeta(name);
      return { json: JSON.parse(raw), version: String(meta.projectVersion) };
    },

    /**
     * Create or overwrite project.json, creating the project folder first if needed. When
     * `expectVersion` is given, the write is refused with a ConflictError if project.json has
     * changed since (a version bumped by another writer).
     */
    async saveProjectJson(
      rawName: unknown,
      json: unknown,
      expectVersion?: string | string[] | undefined
    ): Promise<string> {
      const name = sanitizeProjectName(rawName);
      await mkdir(filesDir(name), { recursive: true });
      const meta = await readMeta(name);
      const hasFile = await exists(projectJsonPath(name));
      if (
        hasFile &&
        expectVersion != null &&
        String(meta.projectVersion) !== String(expectVersion)
      ) {
        throw new ConflictError(String(meta.projectVersion));
      }
      await writeFileAtomic(projectJsonPath(name), JSON.stringify(json, null, 2));
      meta.projectVersion = (meta.projectVersion ?? 0) + 1;
      await writeMeta(name, meta);
      return String(meta.projectVersion);
    },

    /** List the media files stored for a project (excludes trashed files). */
    async listFiles(rawName: unknown): Promise<FileMeta[]> {
      const name = sanitizeProjectName(rawName);
      await requireProject(name);
      const meta = await readMeta(name);
      return Object.entries(meta.files).map(([id, f]) => ({
        id,
        name: f.name,
        mimeType: f.mimeType,
        version: f.version,
      }));
    },

    /** Store a new uploaded blob under a fresh id and record its metadata. */
    async saveFile(
      rawName: unknown,
      { fileName, mimeType, buffer }: SaveFileInput
    ): Promise<FileMeta> {
      const name = sanitizeProjectName(rawName);
      if (typeof fileName !== 'string' || !fileName.trim()) {
        throw new BadRequestError('X-File-Name header is required.');
      }
      await mkdir(filesDir(name), { recursive: true });
      const id = randomUUID();
      await writeFileAtomic(path.join(filesDir(name), id), buffer);
      const meta = await readMeta(name);
      const entry: StoredFileEntry = {
        name: fileName,
        mimeType: mimeType || 'application/octet-stream',
        version: id,
        size: buffer.length,
        createdAt: new Date().toISOString(),
      };
      meta.files[id] = entry;
      await writeMeta(name, meta);
      const index = await readIndex();
      index[id] = name;
      await writeIndex(index);
      return { id, name: entry.name, mimeType: entry.mimeType, version: entry.version };
    },

    /** Read back an uploaded blob's bytes and metadata, by id alone (mirrors Drive's global file ids). */
    async readFile(rawId: unknown): Promise<{ buffer: Buffer; meta: FileMeta }> {
      const id = sanitizeFileId(rawId);
      const name = await projectOfFile(id);
      const meta = await readMeta(name);
      const entry = meta.files[id];
      if (!entry) throw new NotFoundError(`No file "${id}".`);
      const buffer = await fsReadFile(path.join(filesDir(name), id));
      return {
        buffer,
        meta: { id, name: entry.name, mimeType: entry.mimeType, version: entry.version },
      };
    },

    /** Move a file to its project's trash (recoverable there) and drop it from the file listing. */
    async trashFile(rawId: unknown): Promise<void> {
      const id = sanitizeFileId(rawId);
      const name = await projectOfFile(id);
      const meta = await readMeta(name);
      const entry = meta.files[id];
      if (!entry) throw new NotFoundError(`No file "${id}".`);
      await mkdir(trashDir(name), { recursive: true });
      await rename(path.join(filesDir(name), id), path.join(trashDir(name), id));
      delete meta.files[id];
      await writeMeta(name, meta);
      const index = await readIndex();
      delete index[id];
      await writeIndex(index);
    },

    /** Permanently delete a project folder and everything in it. Used by tests and admin cleanup. */
    async deleteProject(rawName: unknown): Promise<void> {
      const name = sanitizeProjectName(rawName);
      await requireProject(name);
      const meta = await readMeta(name);
      const index = await readIndex();
      for (const id of Object.keys(meta.files)) delete index[id];
      await writeIndex(index);
      await rm(projectDir(name), { recursive: true, force: true });
    },
  };
}

export type Store = ReturnType<typeof createStore>;
