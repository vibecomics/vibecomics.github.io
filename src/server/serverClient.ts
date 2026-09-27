/**
 * The page's connection to a self-hosted HTTP storage server: no OAuth, no token, just a base URL,
 * checked once with a health request. Unlike the Drive access token, the URL is not a secret, so it
 * is remembered in localStorage, but only to prefill the connect screen's URL field next time; it
 * never connects on its own. Every page load starts back at the connect screen.
 */
import type { StorageBackendImpl } from '../storage/backend';
import { createServerRest } from './serverRest';

const STORAGE_KEY = 'vibecomics.storageServerUrl';

let baseUrl: string | null = readStoredUrl();

function readStoredUrl(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeUrl(url: string | null): void {
  try {
    if (url) window.localStorage.setItem(STORAGE_KEY, url);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private browsing or a blocked site data setting: the connection still works this session.
  }
}

/** Strip a trailing slash and reject anything that is not a plain http(s) URL. */
function normalizeServerUrl(input: string): string {
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

/** The server URL connected to, or remembered from a previous session, or null. */
export function getServerUrl(): string | null {
  return baseUrl;
}

function hasServerAccess(): boolean {
  return baseUrl !== null;
}

/** Check that a server is reachable at this URL, then make it the active connection. */
export async function connectToServer(input: string): Promise<void> {
  const url = normalizeServerUrl(input);
  let res: Response;
  try {
    res = await fetch(`${url}/health`);
  } catch (e) {
    throw new Error(
      `Could not reach ${url}: ${e instanceof Error ? e.message : String(e)}. Is the server running?`
    );
  }
  if (!res.ok)
    throw new Error(`${url} answered with ${res.status}: is this a VibeComics storage server?`);
  baseUrl = url;
  storeUrl(url);
}

function disconnectServer(): void {
  baseUrl = null;
  storeUrl(null);
}

const rest = createServerRest({ getBaseUrl: getServerUrl });

/** This backend's `StorageBackendImpl`, registered in `storage/activeBackend.ts`. */
export const serverBackend: StorageBackendImpl = {
  label: 'the storage server',
  listProjectFolders: rest.listProjectFolders,
  ensureProjectFolder: rest.ensureProjectFolder,
  uploadImage: rest.uploadImage,
  trashFile: rest.trashFile,
  downloadFile: rest.downloadFile,
  saveProjectJson: rest.saveProjectJson,
  loadProjectFile: rest.loadProjectFile,
  fileUrl: (fileId) => `${getServerUrl()}/files/${encodeURIComponent(fileId)}`,
  hasAccess: hasServerAccess,
  disconnect: disconnectServer,
};
