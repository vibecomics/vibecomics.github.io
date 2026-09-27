import { useState } from 'react';
import { cb } from '../ai/actions';
import type { DeviceCodeInfo } from '../drive/driveClient';
import { getServerUrl } from '../server/serverClient';
import Spinner from './Spinner';
import { useBusy } from './useBusy';

/** Gate shown until storage is connected: the app has nowhere else to load or save a comic. */
export default function SplashScreen({ deviceCode }: { deviceCode: DeviceCodeInfo | null }) {
  const [serverUrl, setServerUrl] = useState(() => getServerUrl() ?? '');
  const device = useBusy();
  const server = useBusy();
  // The code flow keeps working after the code is shown: it waits for the approval.
  const deviceWaiting = device.busy || deviceCode !== null;

  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center bg-body-tertiary p-3">
      <div className="card shadow" style={{ maxWidth: 540, width: '100%' }}>
        <div className="card-body p-4">
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt=""
            width={64}
            height={64}
            className="mb-3"
          />
          <h1 className="card-title h4 mb-3">Pick where to store your comic</h1>

          <h2 className="h6 text-uppercase text-muted mt-4 mb-2">Google Drive</h2>
          <p className="card-text small">Keeps your comic in a folder on your own Google Drive.</p>
          <button
            className="btn btn-primary btn-lg w-100"
            // The app reports a failed connect in a toast.
            disabled={deviceWaiting || server.busy}
            onClick={() =>
              void device.run(() =>
                cb()
                  .storage.connectWithDevice()
                  .catch(() => undefined)
              )
            }
          >
            {deviceWaiting && <Spinner />}
            Connect with Google Drive
          </button>
          {deviceCode && (
            <div className="alert alert-info mt-3">
              <p className="mb-1">
                <strong>On your phone or another browser, go to:</strong>
              </p>
              <p>
                <a href={deviceCode.url} target="_blank" rel="noreferrer">
                  {deviceCode.url}
                </a>
              </p>
              <p className="mb-1">Enter this code:</p>
              <p className="display-6 fw-bold text-center">{deviceCode.code}</p>
              <p className="mb-0 text-muted">
                Expires in {Math.round(deviceCode.expiresInSeconds / 60)} minutes. This page
                connects automatically once approved.
              </p>
            </div>
          )}

          <hr className="my-4" />

          <h2 className="h6 text-uppercase text-muted mb-2">Your own server</h2>
          <p className="card-text small">
            Connect to a storage server you run yourself (<code>http-storage/</code> in the
            project).
          </p>
          <form
            className="d-flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void server.run(() =>
                cb()
                  .storage.connectWithServer(serverUrl)
                  .catch(() => undefined)
              );
            }}
          >
            <input
              type="url"
              className="form-control"
              placeholder="http://localhost:8081"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              disabled={server.busy || deviceWaiting}
              aria-label="Storage server URL"
            />
            <button
              type="submit"
              className="btn btn-outline-primary flex-shrink-0"
              disabled={server.busy || deviceWaiting || !serverUrl.trim()}
            >
              {server.busy && <Spinner />}
              Connect
            </button>
          </form>

          <p className="text-center text-muted small mt-4 mb-0">
            <a href={`${import.meta.env.BASE_URL}pages/privacy.html`}>Privacy Policy</a>
            {' · '}
            <a href={`${import.meta.env.BASE_URL}pages/tos.html`}>Terms of Service</a>
            {' · '}
            <a href="https://github.com/nparashuram/vibecomic/" target="_blank" rel="noreferrer">
              GitHub
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
