import { useState } from 'react';
import { cb } from '../ai/actions';
import type { DeviceCodeInfo } from '../drive/driveClient';

/** Gate shown until Drive is connected: the app has nowhere else to load or save a comic. */
export default function SplashScreen({ deviceCode }: { deviceCode: DeviceCodeInfo | null }) {
  const [whyOpen, setWhyOpen] = useState(false);

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
          <h1 className="card-title h4 mb-3">Connect to Google Drive</h1>
          <p className="card-text">
            VibeComics keeps your comic — its pages, artwork, and project file — on your Google
            Drive. Nothing is ever uploaded to our servers.
          </p>
          <p className="card-text">Connect once per browser session to open the editor.</p>
          <button
            className="btn btn-link p-0 mb-3"
            onClick={() => setWhyOpen((open) => !open)}
            aria-expanded={whyOpen}
          >
            Why do we need this access?
          </button>
          <div className={`collapse${whyOpen ? ' show' : ''}`}>
            <div className="card card-body bg-body-tertiary small mb-3">
              <p>
                VibeComics is a static website: it has no server and no database of its own. Your
                comic's <code>project.json</code> and every artwork file live in a folder on{' '}
                <strong>your</strong> Google Drive, and the app reads and writes them directly from
                your browser.
              </p>
              <p>
                The app asks for the <code>drive.file</code> scope only, which means it can see and
                touch <strong>just</strong> the files and folders it created — it is blind to
                everything else on your Drive.
              </p>
              <p>
                Your access token is kept only in the page's memory and is never written to storage
                or cookies; reloading the page drops it, and one click reconnects. Disconnecting
                revokes the grant at Google entirely.
              </p>
              <p className="mb-0">
                <strong>If you can't connect, the app cannot work at all:</strong> there is nowhere
                else for it to load your comic from or save it to. The editor stays locked until
                Drive is connected.
              </p>
            </div>
          </div>
          <button
            className="btn btn-primary btn-lg w-100"
            onClick={() => void cb().storage.connect()}
          >
            Connect with Google Drive
          </button>
          <button
            className="btn btn-outline-primary w-100 mt-2"
            // The app reports a failed connect in a toast.
            onClick={() =>
              cb()
                .storage.connectWithDevice()
                .catch(() => undefined)
            }
          >
            Connect with a code (for AI assistants)
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
                The code expires in {Math.round(deviceCode.expiresInSeconds / 60)} minutes. This
                page connects automatically once you approve.
              </p>
            </div>
          )}
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
