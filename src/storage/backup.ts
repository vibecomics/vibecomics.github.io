/**
 * Copy a whole project (project.json and the media files it names) from one connection to another,
 * on demand — the manual "back up to Drive" / "back up to HTTP storage" buttons. The target
 * project folder is found (or created) by name, the same lookup `ensureProjectFolder` already does
 * everywhere else, so backing up twice overwrites the same folder instead of making a second one.
 *
 * Both sides' files are listed once each (one request, not one per file), and a file already on
 * the target with the same byte size as the one on the source is left alone — a backup rerun only
 * moves what actually changed. Size matching is a cheap stand-in for a full content check: two
 * different images sharing an exact byte count is very unlikely, and re-running the backup after
 * deleting the target folder always gets a clean full copy if that heuristic is ever in doubt.
 */
import type { StorageBackendImpl } from './backend';
import type { ComicProject } from '../types/comic';

/** How many files to copy at once: enough to hide network latency without hammering either side. */
const CONCURRENCY = 6;

/** Every file name a project's media registry points to (images and their thumbnails). */
function mediaFileNames(project: ComicProject): Set<string> {
  const names = new Set<string>();
  for (const item of project.metadata.media) {
    names.add(item.fileName);
    if (item.thumbnailFileName) names.add(item.thumbnailFileName);
  }
  return names;
}

/**
 * Run `task` over `items`, at most `concurrency` of them in flight at once. As soon as one task
 * throws, every worker stops picking up new items (though whichever single item each worker already
 * had in flight still finishes) and the first error is re-thrown — so a failure stops the batch
 * promptly instead of letting the rest run to completion as pointless, uncoordinated work.
 */
async function withConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  let failure: { error: unknown } | undefined;
  async function worker(): Promise<void> {
    while (!failure) {
      const index = next++;
      if (index >= items.length) return;
      try {
        await task(items[index]);
      } catch (error) {
        failure = { error };
        return;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (failure) throw failure.error;
}

/** How many of a backup's files were actually moved vs. left alone because they were unchanged. */
export interface BackupSummary {
  copied: number;
  skipped: number;
  /** Media files the project refers to that no longer exist on the source — backed up without them. */
  missing: string[];
}

/**
 * Back up `project` (open from `sourceFolderId` on `source`, named `folderName`) to `target`:
 * every media file that is missing or a different size on the target is copied over (replacing a
 * same-named file already there), then project.json is written last, unconditionally overwriting
 * whatever was there. `onProgress`, when given, is called once up front with the file count and
 * then again after each one finishes, so a caller can show a running count on a long backup.
 *
 * A file the project refers to but that is no longer actually on the source (a pre-existing data
 * problem, not something this backup causes) is skipped and listed in the summary's `missing`,
 * rather than failing the whole backup — project.json still ends up referring to it, exactly as it
 * already does on the source. A failure writing to the *target*, in contrast, aborts the whole
 * backup without writing project.json: that is this backup's own doing, and finishing with
 * project.json pointing at files that silently failed to copy would leave the target inconsistent.
 */
export async function backupProject(
  source: StorageBackendImpl,
  target: StorageBackendImpl,
  sourceFolderId: string,
  folderName: string,
  project: ComicProject,
  onProgress?: (copied: number, total: number) => void
): Promise<BackupSummary> {
  const targetFolder = await target.ensureProjectFolder(folderName);

  const [sourceFiles, targetFiles] = await Promise.all([
    source.listFolderFiles(sourceFolderId),
    target.listFolderFiles(targetFolder.id),
  ]);
  const sourceByName = new Map(sourceFiles.map((f) => [f.name, f]));
  const targetByName = new Map(targetFiles.map((f) => [f.name, f]));

  const unchanged = (fileName: string): boolean => {
    const there = targetByName.get(fileName);
    const here = sourceByName.get(fileName);
    return (
      there !== undefined &&
      here !== undefined &&
      there.size !== undefined &&
      there.size === here.size
    );
  };

  const allNames = [...mediaFileNames(project)];
  const toCopy = allNames.filter((fileName) => !unchanged(fileName));
  const skipped = allNames.length - toCopy.length;
  const missing: string[] = [];

  let copied = 0;
  onProgress?.(copied, toCopy.length);

  await withConcurrency(toCopy, CONCURRENCY, async (fileName) => {
    let blob: Blob;
    try {
      blob = await source.downloadFile(sourceFolderId, fileName);
    } catch {
      missing.push(fileName);
      copied++;
      onProgress?.(copied, toCopy.length);
      return;
    }
    if (targetByName.has(fileName)) {
      await target.trashFile(targetFolder.id, fileName);
    }
    await target.uploadImage(
      targetFolder.id,
      new File([blob], fileName, { type: blob.type }),
      fileName
    );
    copied++;
    onProgress?.(copied, toCopy.length);
  });

  await target.saveProjectJson(targetFolder.id, project);
  return { copied: copied - missing.length, skipped, missing };
}
