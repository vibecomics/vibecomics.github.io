import { useEffect, useState } from 'react';
import { cb } from '../ai/actions';
import type { DeviceCodeInfo } from '../drive/driveClient';
import type { StorageConnectionInfo } from '../storage/connections';
import { errorMessage } from '../utils/errors';
import { ConnectDriveModal, ConnectServerModal } from './ConnectModals';
import Spinner from './Spinner';
import { useBusy } from './useBusy';

interface Props {
  connections: StorageConnectionInfo[];
  deviceCode: DeviceCodeInfo | null;
  /** Called after a connect/disconnect that this card already knows succeeded, for a snappier
   * refresh than waiting on the next `connections` prop update. */
  onChange: () => void;
}

/**
 * The Settings "Storage" section: the storage that is connected now, with a Disconnect button for
 * each, and below it the "Add" buttons. Each opens a popup that walks through connecting: Google
 * Drive via the OAuth device-code flow (see drive/driveClient.ts), or a self-hosted HTTP storage
 * server (see http-storage/) by its URL. Any number of servers can be added.
 */
export default function ConnectSettings({ connections, deviceCode, onChange }: Props) {
  const [showDriveModal, setShowDriveModal] = useState(false);
  const [showServerModal, setShowServerModal] = useState(false);
  const [error, setError] = useState('');
  const device = useBusy();
  const disconnecting = useBusy();
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const live = connections.filter((c) => c.connected);
  const drive = live.find((c) => c.kind === 'drive');

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
          <h3 className="card-title h5">Storage</h3>

          <div className="border-bottom pb-3 mb-3">
            {live.length > 0 ? (
              <ul className="list-group list-group-flush">
                {live.map((c) => (
                  <li
                    key={c.id}
                    className="list-group-item border-0 d-flex align-items-center justify-content-between px-0"
                  >
                    <span className="text-truncate">{c.label}</span>
                    <span className="d-flex gap-2 flex-shrink-0">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger"
                        disabled={disconnecting.busy}
                        onClick={() => void disconnect(c.id)}
                      >
                        {disconnecting.busy && disconnectingId === c.id && <Spinner />}
                        Disconnect
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted small mb-0">Nothing connected yet.</p>
            )}
          </div>

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
