import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { cb } from '../ai/actions';
import type { DeviceCodeInfo } from '../drive/driveClient';
import type { StorageConnectionInfo } from '../storage/connections';
import { errorMessage } from '../utils/errors';
import Modal from './Modal';
import Spinner from './Spinner';
import { useBusy } from './useBusy';

interface Props {
  connections: StorageConnectionInfo[];
  deviceCode: DeviceCodeInfo | null;
  /** Called after a connect/disconnect that this card already knows succeeded, for a snappier
   * refresh than waiting on the next `connections` prop update. */
  onChange: () => void;
}

/** Connect Google Drive via the OAuth device flow: a code and URL to approve from any device. */
function ConnectDriveModal({
  deviceCode,
  waiting,
  onClose,
}: {
  deviceCode: DeviceCodeInfo | null;
  waiting: boolean;
  onClose: () => void;
}) {
  return (
    <Modal title="Connect Google Drive" label="Connect Google Drive" onClose={onClose}>
      {deviceCode ? (
        <>
          <p className="mb-1">
            <strong>On your phone or another browser, go to:</strong>
          </p>
          <p>
            <a href={deviceCode.url} target="_blank" rel="noreferrer">
              {deviceCode.url}
            </a>
          </p>
          <p className="mb-1">Enter this code:</p>
          <p className="h3 fw-bold text-center">{deviceCode.code}</p>
          <p className="mb-0 text-muted small">
            Expires in {Math.round(deviceCode.expiresInSeconds / 60)} minutes. This closes
            automatically once approved.
          </p>
        </>
      ) : (
        <p className="d-flex align-items-center gap-2 mb-0 text-muted">
          <Spinner />
          {waiting ? 'Starting…' : 'Preparing to connect…'}
        </p>
      )}
    </Modal>
  );
}

/** Connect a self-hosted HTTP storage server (see http-storage/) by its base URL. */
function ConnectServerModal({
  onConnect,
  onClose,
}: {
  onConnect: (url: string) => Promise<void>;
  onClose: () => void;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const connecting = useBusy();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setError('');
    try {
      await connecting.run(() => onConnect(url));
    } catch (e2) {
      setError(errorMessage(e2));
    }
  }

  return (
    <Modal
      title="Connect an HTTP storage server"
      label="Connect an HTTP storage server"
      onClose={onClose}
    >
      <form onSubmit={(e) => void submit(e)}>
        <label className="form-label" htmlFor="storage-server-url">
          Server URL
        </label>
        <input
          id="storage-server-url"
          type="url"
          className="form-control"
          placeholder="http://localhost:8081"
          value={url}
          autoFocus
          onChange={(e) => setUrl(e.target.value)}
          disabled={connecting.busy}
        />
        <p className="form-text">The address of a running http-storage/ server.</p>
        {error && <div className="alert alert-danger py-2 small">{error}</div>}
        <div className="d-flex justify-content-end gap-2 mt-3">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={connecting.busy || !url.trim()}
          >
            {connecting.busy && <Spinner />}
            Connect
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * The Settings "Storage" section: what's already connected (live, or a remembered server URL that
 * failed to reconnect on load, with Reconnect/Remove) separate from adding something new — each of
 * the two "Add" buttons opens a popup that walks through connecting: Google Drive via the OAuth
 * device-code flow (see drive/driveClient.ts), or a self-hosted HTTP storage server (see
 * http-storage/) by its URL. Any number of servers can be added.
 */
export default function ConnectSettings({ connections, deviceCode, onChange }: Props) {
  const [showDriveModal, setShowDriveModal] = useState(false);
  const [showServerModal, setShowServerModal] = useState(false);
  const [error, setError] = useState('');
  const device = useBusy();
  const reconnecting = useBusy();
  const disconnecting = useBusy();
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const drive = connections.find((c) => c.kind === 'drive');

  // Close the Drive popup once the device flow finishes, one way or another (App.tsx clears
  // deviceCode in both cases); a success shows up as a new row via the connections prop.
  useEffect(() => {
    if (deviceCode === null) setShowDriveModal(false);
  }, [deviceCode]);

  function startDrive() {
    setError('');
    setShowDriveModal(true);
    void device.run(() =>
      cb()
        .storage.connectWithDevice()
        .catch((e: unknown) => {
          setError(errorMessage(e));
          setShowDriveModal(false);
        })
    );
  }

  async function connectServer(url: string) {
    await cb().storage.connectWithServer(url);
    setShowServerModal(false);
    onChange();
  }

  async function reconnect(url: string) {
    setError('');
    try {
      await reconnecting.run(() => cb().storage.connectWithServer(url));
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function disconnect(id: string) {
    setError('');
    setDisconnectingId(id);
    try {
      await disconnecting.run(() => cb().storage.disconnectConnection(id));
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="col-12">
      <div className="card shadow-sm">
        <div className="card-body">
          <h3 className="card-title h6">Storage</h3>

          <h4 className="small text-uppercase text-muted mb-2">Connected</h4>
          {connections.length > 0 ? (
            <ul className="list-group list-group-flush mb-3">
              {connections.map((c) => (
                <li
                  key={c.id}
                  className="list-group-item d-flex align-items-center justify-content-between px-0"
                >
                  <span className="text-truncate">
                    {c.label}
                    {!c.connected && <span className="text-muted small ms-2">(not connected)</span>}
                  </span>
                  <span className="d-flex gap-2 flex-shrink-0">
                    {!c.connected && (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        disabled={reconnecting.busy}
                        onClick={() =>
                          c.kind === 'drive' ? startDrive() : void reconnect(c.label)
                        }
                      >
                        {reconnecting.busy && <Spinner />}
                        Reconnect
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-danger"
                      disabled={disconnecting.busy}
                      onClick={() => void disconnect(c.id)}
                    >
                      {disconnecting.busy && disconnectingId === c.id && <Spinner />}
                      {c.connected ? 'Disconnect' : 'Remove'}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted small mb-3">Nothing connected yet.</p>
          )}

          <h4 className="small text-uppercase text-muted mb-2">Add storage</h4>
          <div className="d-flex gap-2 flex-wrap">
            {!drive && (
              <button type="button" className="btn btn-outline-primary" onClick={startDrive}>
                + Add Google Drive
              </button>
            )}
            <button
              type="button"
              className="btn btn-outline-primary"
              onClick={() => setShowServerModal(true)}
            >
              + Add HTTP storage
            </button>
          </div>

          {error && <div className="alert alert-danger py-2 small mt-3 mb-0">{error}</div>}
        </div>
      </div>

      {showDriveModal && (
        <ConnectDriveModal
          deviceCode={deviceCode}
          waiting={device.busy}
          onClose={() => setShowDriveModal(false)}
        />
      )}
      {showServerModal && (
        <ConnectServerModal onConnect={connectServer} onClose={() => setShowServerModal(false)} />
      )}
    </div>
  );
}
