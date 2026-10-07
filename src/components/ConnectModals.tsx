import { useState } from 'react';
import type { FormEvent } from 'react';
import type { DeviceCodeInfo } from '../drive/driveClient';
import { errorMessage } from '../utils/errors';
import Modal from './Modal';
import Spinner from './Spinner';
import { useBusy } from './useBusy';

/** Connect Google Drive via the OAuth device flow: a code and URL to approve from any device. */
export function ConnectDriveModal({
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
export function ConnectServerModal({
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
