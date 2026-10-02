/**
 * The set of storage connections live this session: Google Drive (at most one, memory-only token,
 * never persisted — see drive/driveClient.ts) and any number of self-hosted HTTP storage servers
 * (no secret, so their URLs are remembered in localStorage and reconnected automatically on load).
 *
 * `activeBackend.ts` tracks which one of these backs the currently *open* project; this module
 * owns the backends themselves and the aggregated project list the project selector shows.
 */
import { driveBackend } from '../drive/driveClient';
import { checkServerHealth, createServerBackend, normalizeServerUrl } from '../server/serverClient';
import type { StorageBackendImpl } from './backend';
import type { ProjectFolder } from './types';

const SERVER_URLS_KEY = 'vibecomics.storageServerUrls';
const LEGACY_SERVER_URL_KEY = 'vibecomics.storageServerUrl';
const DRIVE_CONNECTION_ID = 'drive';
const serverConnectionId = (url: string): string => `server:${url}`;

export interface Connection {
  id: string;
  kind: 'drive' | 'server';
  /** Shown in the Settings connections list and as a tile badge. */
  label: string;
  backend: StorageBackendImpl;
}

/** A connection as shown in Settings: also covers a remembered server URL that isn't live right now. */
export interface StorageConnectionInfo {
  id: string;
  kind: 'drive' | 'server';
  label: string;
  connected: boolean;
}

export interface RemoteProject extends ProjectFolder {
  connectionId: string;
  connectionLabel: string;
  connectionKind: 'drive' | 'server';
}

let connections: Connection[] = [];

function readRememberedServerUrls(): string[] {
  try {
    const raw = window.localStorage.getItem(SERVER_URLS_KEY);
    if (raw) return JSON.parse(raw) as string[];
    const legacy = window.localStorage.getItem(LEGACY_SERVER_URL_KEY);
    return legacy ? [legacy] : [];
  } catch {
    return [];
  }
}

function writeRememberedServerUrls(urls: string[]): void {
  try {
    window.localStorage.setItem(SERVER_URLS_KEY, JSON.stringify(urls));
    window.localStorage.removeItem(LEGACY_SERVER_URL_KEY);
  } catch {
    // Private browsing or blocked site data: the connection still works this session.
  }
}

export function getConnection(id: string): Connection | undefined {
  return connections.find((c) => c.id === id);
}

/** Every connection with a live backend right now. */
export function listConnections(): Connection[] {
  return connections;
}

/** Register the (already-authorized) Drive backend as a connection. */
export function connectDriveConnection(): void {
  if (!getConnection(DRIVE_CONNECTION_ID)) {
    connections.push({
      id: DRIVE_CONNECTION_ID,
      kind: 'drive',
      label: driveBackend.label,
      backend: driveBackend,
    });
  }
}

/** Health-check a server URL and add (or reuse) it as a live connection, remembering its URL. */
export async function connectServerConnection(url: string): Promise<Connection> {
  const normalized = normalizeServerUrl(url);
  await checkServerHealth(normalized);
  const id = serverConnectionId(normalized);
  let connection = getConnection(id);
  if (!connection) {
    connection = {
      id,
      kind: 'server',
      label: normalized,
      backend: createServerBackend(normalized),
    };
    connections.push(connection);
  }
  const remembered = readRememberedServerUrls();
  if (!remembered.includes(normalized)) writeRememberedServerUrls([...remembered, normalized]);
  return connection;
}

/**
 * Disconnect a live connection, and (for a server) forget its remembered URL too — the same id
 * scheme means this also "removes" a remembered-but-currently-unreachable server that never
 * reconnected, without needing a separate action.
 */
export async function disconnectConnection(id: string): Promise<void> {
  const connection = getConnection(id);
  if (connection) {
    await connection.backend.disconnect();
    connections = connections.filter((c) => c.id !== id);
  }
  if (id.startsWith('server:')) {
    const url = id.slice('server:'.length);
    writeRememberedServerUrls(readRememberedServerUrls().filter((u) => u !== url));
  }
}

/** On app start: try reconnecting every remembered server URL; a dead one is skipped, not fatal. */
export async function reconnectRememberedServers(): Promise<void> {
  await Promise.all(
    readRememberedServerUrls().map((url) => connectServerConnection(url).catch(() => undefined))
  );
}

/** Every known connection for Settings: live ones, plus remembered server URLs that aren't live. */
export function listConnectionInfo(): StorageConnectionInfo[] {
  const live = connections.map((c): StorageConnectionInfo => ({
    id: c.id,
    kind: c.kind,
    label: c.label,
    connected: true,
  }));
  const liveIds = new Set(live.map((c) => c.id));
  const offline = readRememberedServerUrls()
    .filter((url) => !liveIds.has(serverConnectionId(url)))
    .map((url): StorageConnectionInfo => ({
      id: serverConnectionId(url),
      kind: 'server',
      label: url,
      connected: false,
    }));
  return [...live, ...offline];
}

/** Lower wins: a server's project shadows a Drive project of the same name. */
const KIND_PRIORITY: Record<Connection['kind'], number> = { server: 0, drive: 1 };

/**
 * Every project folder across every live connection, tagged with where it came from. When a name
 * exists in more than one connection, the higher-priority one (a server over Drive) is kept; a real
 * merge across locations is future work (the goal is to store one project in several places at
 * once), this just picks which copy to show for now.
 */
export async function listAllProjects(): Promise<RemoteProject[]> {
  const perConnection = await Promise.all(
    connections.map(async (c): Promise<RemoteProject[]> => {
      try {
        const folders = await c.backend.listProjectFolders();
        return folders.map((f) => ({
          ...f,
          connectionId: c.id,
          connectionLabel: c.label,
          connectionKind: c.kind,
        }));
      } catch {
        // One dead connection should not blank the whole list.
        return [];
      }
    })
  );

  const byName = new Map<string, RemoteProject>();
  for (const project of perConnection.flat()) {
    const current = byName.get(project.name);
    if (!current || KIND_PRIORITY[project.connectionKind] < KIND_PRIORITY[current.connectionKind]) {
      byName.set(project.name, project);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
