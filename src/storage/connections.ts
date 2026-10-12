/**
 * The set of storage connections live this session: Google Drive (at most one, memory-only token,
 * never persisted — see drive/driveClient.ts) and any number of S3-compatible buckets (any
 * self-hosted server, or real S3/R2/B2 — see s3/). An S3 connection's full config, *including its
 * credentials*, is remembered in this browser's localStorage, so it reconnects automatically on
 * the next page load (reconnectRememberedS3Connections, called once from App.tsx's startup
 * effect) the same way Drive's own persisted refresh token does. This is plaintext in
 * localStorage, not encrypted at rest: anyone with script execution on this origin (or physical
 * access to this browser profile) can read it. Acceptable for a self-hosted bucket on a trusted
 * network; narrow the bucket's own permissions if that's not the deployment.
 *
 * `activeBackend.ts` tracks which one of these backs the currently *open* project; this module
 * owns the backends themselves and the aggregated project list the project selector shows.
 */
import { driveBackend } from '../drive/driveClient';
import { checkS3Health, createS3Backend } from '../s3/s3Backend';
import { parseS3ConnectionString, s3ConnectionId, s3Label } from '../s3/s3Config';
import type { S3Credentials, S3TargetConfig } from '../s3/s3Config';
import type { StorageBackendImpl } from './backend';
import type { ProjectFolder } from './types';

const S3_TARGETS_KEY = 'vibecomics.storageS3Targets';
const S3_CREDENTIALS_KEY = 'vibecomics.storageS3Credentials';
const DRIVE_USED_KEY = 'vibecomics.driveUsed';
const DRIVE_CONNECTION_ID = 'drive';

export interface Connection {
  id: string;
  kind: 'drive' | 's3';
  /** Shown in the Settings connections list and as a tile badge. */
  label: string;
  backend: StorageBackendImpl;
}

/** A connection as shown in Settings: also covers a remembered S3 target that isn't live right now. */
export interface StorageConnectionInfo {
  id: string;
  kind: 'drive' | 's3';
  label: string;
  connected: boolean;
}

export interface RemoteProject extends ProjectFolder {
  connectionId: string;
  connectionLabel: string;
  connectionKind: 'drive' | 's3';
}

let connections: Connection[] = [];

/** Browser storage, which private windows and blocked site data can refuse: a refusal reads as empty. */
function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // The connection still works this session; it is just not remembered.
  }
}

/** Remembered S3 targets: endpoint+bucket+region only; credentials are kept separately below. */
function readRememberedS3Targets(): S3TargetConfig[] {
  const raw = readStored(S3_TARGETS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as S3TargetConfig[];
  } catch {
    return [];
  }
}

function writeRememberedS3Targets(targets: S3TargetConfig[]): void {
  writeStored(S3_TARGETS_KEY, JSON.stringify(targets));
}

/** Remembered S3 credentials, keyed by connection id. See the module doc comment re: plaintext storage. */
function readRememberedS3Credentials(): Record<string, S3Credentials> {
  const raw = readStored(S3_CREDENTIALS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, S3Credentials>;
  } catch {
    return {};
  }
}

function writeRememberedS3Credential(id: string, credentials: S3Credentials | null): void {
  const all = readRememberedS3Credentials();
  if (credentials) all[id] = credentials;
  else delete all[id];
  writeStored(S3_CREDENTIALS_KEY, JSON.stringify(all));
}

/** Whether Drive was connected in this browser before: a flag only, never a credential. */
function readDriveUsed(): boolean {
  return readStored(DRIVE_USED_KEY) === '1';
}

function writeDriveUsed(used: boolean): void {
  writeStored(DRIVE_USED_KEY, used ? '1' : null);
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
  writeDriveUsed(true);
  if (!getConnection(DRIVE_CONNECTION_ID)) {
    connections.push({
      id: DRIVE_CONNECTION_ID,
      kind: 'drive',
      label: driveBackend.label,
      backend: driveBackend,
    });
  }
}

/** Health-check an S3 target and add (or reuse) it as a live connection, remembering it (config
 * and credentials both) so it reconnects automatically next load. */
async function establishS3Connection(
  config: S3TargetConfig,
  credentials: S3Credentials
): Promise<Connection> {
  await checkS3Health(config, credentials);
  const id = s3ConnectionId(config);
  let connection = getConnection(id);
  if (!connection) {
    connection = {
      id,
      kind: 's3',
      label: s3Label(config),
      backend: createS3Backend(config, credentials),
    };
    connections.push(connection);
  }
  const remembered = readRememberedS3Targets();
  if (!remembered.some((t) => s3ConnectionId(t) === id)) {
    writeRememberedS3Targets([...remembered, config]);
  }
  writeRememberedS3Credential(id, credentials);
  return connection;
}

/** Parse an S3 connection string and connect it (see establishS3Connection). */
export async function connectS3Connection(connectionString: string): Promise<Connection> {
  const { config, credentials } = parseS3ConnectionString(connectionString);
  return establishS3Connection(config, credentials);
}

/** On app start: try reconnecting every remembered S3 target that also has remembered
 * credentials; a dead or now-invalid one is skipped, not fatal (it just stays "offline"). */
export async function reconnectRememberedS3Connections(): Promise<void> {
  const creds = readRememberedS3Credentials();
  await Promise.all(
    readRememberedS3Targets().map((config) => {
      const id = s3ConnectionId(config);
      const credentials = creds[id];
      if (!credentials || getConnection(id)) return undefined;
      return establishS3Connection(config, credentials).catch(() => undefined);
    })
  );
}

/**
 * Disconnect a live connection, and (for S3) forget its remembered target and credentials too —
 * the same id scheme means this also "removes" a remembered-but-currently-offline target, without
 * needing a separate action.
 */
export async function disconnectConnection(id: string): Promise<void> {
  const connection = getConnection(id);
  if (connection) {
    await connection.backend.disconnect();
    connections = connections.filter((c) => c.id !== id);
  }
  if (id.startsWith('s3:')) {
    writeRememberedS3Targets(readRememberedS3Targets().filter((t) => s3ConnectionId(t) !== id));
    writeRememberedS3Credential(id, null);
  }
  if (id === DRIVE_CONNECTION_ID) writeDriveUsed(false);
}

/** Every known connection for Settings: live ones, plus remembered S3 targets that aren't live
 * yet (reconnectRememberedS3Connections handles most of those at startup; one still showing
 * offline here means that attempt failed, e.g. the server was unreachable). */
export function listConnectionInfo(): StorageConnectionInfo[] {
  const live = connections.map((c): StorageConnectionInfo => ({
    id: c.id,
    kind: c.kind,
    label: c.label,
    connected: true,
  }));
  const liveIds = new Set(live.map((c) => c.id));
  const offline = readRememberedS3Targets()
    .filter((t) => !liveIds.has(s3ConnectionId(t)))
    .map((t): StorageConnectionInfo => ({
      id: s3ConnectionId(t),
      kind: 's3',
      label: s3Label(t),
      connected: false,
    }));
  const offlineDrive: StorageConnectionInfo[] =
    readDriveUsed() && !liveIds.has(DRIVE_CONNECTION_ID)
      ? [{ id: DRIVE_CONNECTION_ID, kind: 'drive', label: 'Google Drive', connected: false }]
      : [];
  return [...live, ...offlineDrive, ...offline];
}

/** Lower wins: an S3 project shadows a Drive project of the same name. */
const KIND_PRIORITY: Record<Connection['kind'], number> = { s3: 0, drive: 1 };

/**
 * Every project folder across every live connection, tagged with where it came from. When a name
 * exists in more than one connection, the higher-priority one (S3 over Drive) is kept; a real
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
