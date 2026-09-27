import { parseProject } from '../ai/storageDeps';
import type { ComicProject } from '../types/comic';
import { loadProjectFile } from './activeBackend';

/** Load, validate and normalize the project in a project folder, with its storage version. */
export async function loadProject(
  folderId: string
): Promise<{ project: ComicProject; version: string | null }> {
  const file = await loadProjectFile(folderId);
  return { project: parseProject(file.json), version: file.version };
}
