/**
 * Connections to self-hosted HTTP storage servers: no OAuth, no token, just a base URL, checked
 * once with a health request. Several can be connected at once (see storage/connections.ts, which
 * remembers their URLs and creates one backend instance per URL via `createServerBackend`).
 */
import type { StorageBackendImpl } from '../storage/backend';
import { createServerRest } from './serverRest';

/** Strip a trailing slash and reject anything that is not a plain http(s) URL. */
export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Enter a server URL.');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`"${trimmed}" is not a valid URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('The server URL must start with http:// or https://.');
  }
  return trimmed;
}

/** Check that a server answers GET /health at this (already-normalized) URL. Throws if not. */
export async function checkServerHealth(
  url: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl(`${url}/health`);
  } catch (e) {
    throw new Error(
      `Could not reach ${url}: ${e instanceof Error ? e.message : String(e)}. Is the server running?`
    );
  }
  if (!res.ok)
    throw new Error(`${url} answered with ${res.status}: is this a VibeComics storage server?`);
}

/** One connected server's `StorageBackendImpl`, bound to a fixed (already-normalized) URL. */
export function createServerBackend(url: string): StorageBackendImpl {
  let connected = true;
  const rest = createServerRest({ getBaseUrl: () => (connected ? url : null) });
  return {
    label: url,
    listProjectFolders: rest.listProjectFolders,
    ensureProjectFolder: rest.ensureProjectFolder,
    uploadImage: rest.uploadImage,
    trashFile: rest.trashFile,
    downloadFile: rest.downloadFile,
    findFileByName: rest.findFileByName,
    saveProjectJson: rest.saveProjectJson,
    loadProjectFile: rest.loadProjectFile,
    hasAccess: () => connected,
    disconnect: () => {
      connected = false;
    },
  };
}
