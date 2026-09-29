/**
 * The filesystem-backed storage this server exposes: a root directory holding one subdirectory per
 * comic project (mirroring the Drive backend's "one Drive folder per comic" shape). A project is
 * just plain files, the same as on Drive: its project.json and the image files, under their real
 * names, side by side.
 *
 * Layout:
 *   <root>/<project name>/
 *     project.json      - the comic project, written atomically
 *     <file name>       - one uploaded image per file, named exactly as project.json refers to it
 *     .trash/<file name> - files removed from the project, kept for recovery
 *
 * File names follow one rule (src/utils/fileName.ts): lowercase, dashes, no spaces, an extension.
 * A file is addressed by its project and name; a name is unique within a project, so an upload
 * that would replace a file is refused. A file's MIME type comes from its extension, and versions
 * (project.json's, for optimistic concurrency, and each file's) are the file's modification time.
 * The filesystem is the only state: nothing is cached or indexed, so files dropped into a project
 * folder by hand show up at once.
 *
 * No browser or HTTP APIs here: server.ts is the only thing that knows about requests/responses.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile as fsReadFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { isValidFileName } from '../src/utils/fileName.ts';

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

/** Thrown when an upload would replace a file that already has that name. Maps to HTTP 409. */
export class FileExistsError extends Error {}

const PROJECT_FILE = 'project.json';
const TRASH_DIR = '.trash';
const MAX_FILE_NAME_LENGTH = 255;

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

/** The MIME type a file is served with, from its extension. */
export function mimeTypeOf(fileName: string): string {
  return MIME_TYPES[path.extname(fileName).toLowerCase()] ?? 'application/octet-stream';
}

export interface ProjectFolder {
  id: string;
  name: string;
}

export interface FileMeta {
  /** The file's name again: a file is addressed by its project and name, and has no other id. */
  id: string;
  name: string;
  mimeType: string;
  version: string;
}

/** Reject anything in a name that could escape its directory or hide from a listing. */
function checkName(kind: string, name: unknown, maxLength: number): string {
  if (typeof name !== 'string') throw new BadRequestError(`${kind} must be a string.`);
  const trimmed = name.trim();
  if (!trimmed) throw new BadRequestError(`${kind} must not be empty.`);
  if (trimmed.length > maxLength) {
    throw new BadRequestError(`${kind} is too long (${maxLength} characters max).`);
  }
  if (trimmed === '.' || trimmed === '..') throw new BadRequestError(`${kind} is reserved.`);
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    throw new BadRequestError(`${kind} must not contain path separators.`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(trimmed)) {
    throw new BadRequestError(`${kind} must not contain control characters.`);
  }
  return trimmed;
}

/** Validate a project name and reject anything that could escape the root directory. */
export function sanitizeProjectName(name: unknown): string {
  return checkName('name', name, 200);
}

/**
 * Validate an uploaded file's name against the shared storage rule (lowercase words joined by
 * dashes, then an extension), which also keeps it clear of paths, hidden files and project.json.
 */
export function sanitizeFileName(name: unknown): string {
  if (typeof name !== 'string') throw new BadRequestError('file name must be a string.');
  if (name.length > MAX_FILE_NAME_LENGTH || !isValidFileName(name)) {
    throw new BadRequestError(
      `file name "${name}" must be lowercase letters and digits joined by dashes, with an image extension (like my-image.png).`
    );
  }
  return name;
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

/** A file's version: its modification time, which changes whenever it is rewritten. */
async function versionOf(filePath: string): Promise<string | null> {
  try {
    return (await stat(filePath, { bigint: true })).mtimeNs.toString();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

/**
 * Write `data` to `filePath` atomically: write to a hidden temp file in the same directory, then
 * rename. The temp file is hidden so a listing never shows it.
 */
async function writeFileAtomic(filePath: string, data: string | Uint8Array): Promise<void> {
  const tmp = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-${process.pid}-${randomUUID()}`
  );
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
  buffer: Buffer;
}

export interface ProjectJsonResult {
  json: unknown;
  version: string;
}

export function createStore(root: string) {
  const projectDir = (name: string) => path.join(root, name);
  const projectJsonPath = (name: string) => path.join(projectDir(name), PROJECT_FILE);
  const trashDir = (name: string) => path.join(projectDir(name), TRASH_DIR);

  async function requireProject(name: string): Promise<void> {
    if (!(await exists(projectDir(name)))) {
      throw new NotFoundError(`No project folder named "${name}".`);
    }
  }

  /** The path of an existing image in a project, or NotFoundError. */
  async function requireFile(rawProject: unknown, rawFile: unknown) {
    const project = sanitizeProjectName(rawProject);
    // A name that breaks the naming rule cannot be stored, so it is simply not there.
    if (typeof rawFile !== 'string' || !isValidFileName(rawFile)) {
      throw new NotFoundError(`No file "${String(rawFile)}" in "${project}".`);
    }
    const fileName = rawFile;
    const filePath = path.join(projectDir(project), fileName);
    const version = await versionOf(filePath);
    if (version === null) throw new NotFoundError(`No file "${fileName}" in "${project}".`);
    return { project, fileName, filePath, version };
  }

  return {
    root,

    /** Create the root directory if it does not exist yet. */
    async init(): Promise<void> {
      await mkdir(root, { recursive: true });
    },

    /** List project folders, sorted by name. */
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
      await mkdir(projectDir(name), { recursive: true });
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
      return { json: JSON.parse(raw), version: (await versionOf(projectJsonPath(name))) ?? '' };
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
      await mkdir(projectDir(name), { recursive: true });
      const current = await versionOf(projectJsonPath(name));
      if (current !== null && expectVersion != null && current !== String(expectVersion)) {
        throw new ConflictError(current);
      }
      await writeFileAtomic(projectJsonPath(name), JSON.stringify(json, null, 2));
      return (await versionOf(projectJsonPath(name))) ?? '';
    },

    /** List the image files of a project: those with a valid file name (not project.json, hidden files or the trash). */
    async listFiles(rawName: unknown): Promise<FileMeta[]> {
      const name = sanitizeProjectName(rawName);
      await requireProject(name);
      const entries = await readdir(projectDir(name), { withFileTypes: true });
      const files = entries
        .filter((e) => e.isFile() && isValidFileName(e.name))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));
      return Promise.all(files.map((file) => this.statFile(name, file)));
    },

    /** A file's metadata, or NotFoundError. */
    async statFile(rawProject: unknown, rawFile: unknown): Promise<FileMeta> {
      const { fileName, version } = await requireFile(rawProject, rawFile);
      return { id: fileName, name: fileName, mimeType: mimeTypeOf(fileName), version };
    },

    /** Store an uploaded image under its own name; refused if the project already has that name. */
    async saveFile(
      rawProject: unknown,
      { fileName: rawFile, buffer }: SaveFileInput
    ): Promise<FileMeta> {
      if (typeof rawFile !== 'string' || !rawFile.trim()) {
        throw new BadRequestError('X-File-Name header is required.');
      }
      const project = sanitizeProjectName(rawProject);
      const fileName = sanitizeFileName(rawFile);
      await mkdir(projectDir(project), { recursive: true });
      const filePath = path.join(projectDir(project), fileName);
      if (await exists(filePath)) {
        throw new FileExistsError(`"${project}" already has a file named "${fileName}".`);
      }
      await writeFileAtomic(filePath, buffer);
      return this.statFile(project, fileName);
    },

    /** Read back an uploaded image's bytes and metadata. */
    async readFile(
      rawProject: unknown,
      rawFile: unknown
    ): Promise<{ buffer: Buffer; meta: FileMeta }> {
      const { fileName, filePath, version } = await requireFile(rawProject, rawFile);
      return {
        buffer: await fsReadFile(filePath),
        meta: { id: fileName, name: fileName, mimeType: mimeTypeOf(fileName), version },
      };
    },

    /** Move a file to its project's trash (recoverable there) and drop it from the file listing. */
    async trashFile(rawProject: unknown, rawFile: unknown): Promise<void> {
      const { project, fileName, filePath } = await requireFile(rawProject, rawFile);
      await mkdir(trashDir(project), { recursive: true });
      // A name can be trashed again after a re-upload: keep the older copy too.
      let target = path.join(trashDir(project), fileName);
      if (await exists(target)) {
        const { name, ext } = path.parse(fileName);
        target = path.join(trashDir(project), `${name}.${Date.now()}${ext}`);
      }
      await rename(filePath, target);
    },

    /** Permanently delete a project folder and everything in it. Used by tests and admin cleanup. */
    async deleteProject(rawName: unknown): Promise<void> {
      const name = sanitizeProjectName(rawName);
      await requireProject(name);
      await rm(projectDir(name), { recursive: true, force: true });
    },
  };
}

export type Store = ReturnType<typeof createStore>;
