/**
 * Google Drive integration: OAuth 2.0 entirely client-side, no backend.
 *
 * Scope is `drive.file`, so the app only sees files and folders it created.
 * The access token lives only in this module's memory (never web storage,
 * cookies or the URL), so reloading the page drops it and one click
 * reconnects.
 *
 * The only way in is the OAuth device flow (RFC 8628, `requestDeviceAccess`):
 * it works from injected scripts (no popup, no user gesture), which is what
 * lets both a human and an AI assistant use the same "connect with a code"
 * button. It needs the device client's secret, which ships in the bundle by
 * design: Google's device-client model assumes distributed apps cannot keep
 * secrets, and the secret only identifies the client.
 */

import { getGoogleDeviceClientId, getGoogleDeviceClientSecret } from '../config';
import type { StorageBackendImpl } from '../storage/backend';
import { driveFileUrl } from '../utils/driveUrl';
import { pollDeviceOnce, revokeToken, startDeviceFlow } from './deviceOAuth';
import type { DeviceCodeInfo } from './deviceOAuth';
import { createDriveRest } from './driveRest';

// driveRest.ts's own exports (ProjectChangedError, ProjectFileMissingError, ProjectFolder) are
// generic enough that callers import them straight from there; this module re-exports only what is
// Drive-specific.
export type { ProjectFolder } from './driveRest';
export type { DeviceCodeInfo } from './deviceOAuth';

const TOKEN_EXPIRY_MARGIN_MS = 60_000;

/** True when this build has a Google device OAuth client, so "Connect with Google Drive" can work. */
export function isDriveConfigured(): boolean {
  return getGoogleDeviceClientId() !== null && getGoogleDeviceClientSecret() !== null;
}

// ---------------------------------------------------------------------------
// Access token
// ---------------------------------------------------------------------------

let token: { value: string; expiresAt: number } | null = null;

function storeToken(value: string, expiresInSeconds: number | string | undefined): void {
  token = { value, expiresAt: Date.now() + (Number(expiresInSeconds) || 3600) * 1000 };
}

/** The access token, or null when missing or about to expire. */
function getAccessToken(): string | null {
  return token && token.expiresAt > Date.now() + TOKEN_EXPIRY_MARGIN_MS ? token.value : null;
}

function hasDriveAccess(): boolean {
  return getAccessToken() !== null;
}

/** Revoke the grant at Google and drop the token. */
async function disconnectDrive(): Promise<void> {
  cancelDeviceAccess();
  const revoked = token;
  token = null;
  if (revoked) await revokeToken(revoked.value);
}

// ---------------------------------------------------------------------------
// OAuth device flow (RFC 8628)
// ---------------------------------------------------------------------------

const DEVICE_EXPIRED_MESSAGE = 'The device code expired before approval. Start over.';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function pollDeviceToken(
  client: { clientId: string; clientSecret: string },
  deviceCode: string,
  intervalSeconds: number,
  expiresInSeconds: number,
  signal: AbortSignal
): Promise<void> {
  const deadline = Date.now() + expiresInSeconds * 1000;
  for (;;) {
    if (signal.aborted) throw new Error('Device authorization was cancelled.');
    if (Date.now() >= deadline) throw new Error(DEVICE_EXPIRED_MESSAGE);
    await sleep(intervalSeconds * 1000);

    const result = await pollDeviceOnce(client, deviceCode);
    if (result.status === 'granted') {
      storeToken(result.accessToken, result.expiresIn);
      return;
    }
    if (result.status === 'failed') throw new Error(result.message);
    if (result.slowDown) intervalSeconds += 5;
  }
}

let activeDevicePoll: { promise: Promise<void>; cancel: () => void } | null = null;

function cancelDeviceAccess(): void {
  activeDevicePoll?.cancel();
  activeDevicePoll = null;
}

/**
 * Start the device flow: resolves promptly with the URL and code to show the
 * user while the token is polled for in the background (see
 * `awaitDeviceAccess`). Starting a new flow cancels any previous one.
 */
export async function requestDeviceAccess(): Promise<DeviceCodeInfo> {
  const clientId = getGoogleDeviceClientId();
  const clientSecret = getGoogleDeviceClientSecret();
  if (!clientId || !clientSecret) {
    throw new Error('Device connect is not configured (missing Google device OAuth client).');
  }
  cancelDeviceAccess();

  const grant = await startDeviceFlow(clientId);
  const controller = new AbortController();
  const promise = pollDeviceToken(
    { clientId, clientSecret },
    grant.deviceCode,
    grant.intervalSeconds,
    grant.info.expiresInSeconds,
    controller.signal
  );
  promise.catch(() => undefined); // awaiters still see the rejection
  activeDevicePoll = { promise, cancel: () => controller.abort() };
  return grant.info;
}

/** Resolves once the pending device authorization completes; rejects on denial, expiry or cancel. */
export function awaitDeviceAccess(): Promise<void> {
  if (!activeDevicePoll) throw new Error('No device authorization in progress.');
  return activeDevicePoll.promise;
}

// ---------------------------------------------------------------------------
// Drive API
// ---------------------------------------------------------------------------

const drive = createDriveRest({ getToken: getAccessToken });

/** This backend's `StorageBackendImpl`, registered in `storage/activeBackend.ts`. */
export const driveBackend: StorageBackendImpl = {
  label: 'Google Drive',
  listProjectFolders: drive.listProjectFolders,
  ensureProjectFolder: drive.ensureProjectFolder,
  uploadImage: drive.uploadImage,
  trashFile: drive.trashFile,
  downloadFile: drive.downloadFile,
  saveProjectJson: drive.saveProjectJson,
  loadProjectFile: drive.loadProjectFile,
  fileUrl: driveFileUrl,
  hasAccess: hasDriveAccess,
  disconnect: disconnectDrive,
};
