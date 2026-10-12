import { useState } from 'react';
import type { FormEvent } from 'react';
import type { DeviceCodeInfo } from '../drive/driveClient';
import { buildS3ConnectionString } from '../s3/s3Config';
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

/**
 * Connect an S3-compatible bucket (self-hosted, or real AWS S3/R2/B2) by its endpoint,
 * credentials and bucket. The assembled connection string, credentials included, is remembered
 * in this browser (see storage/connections.ts) so it reconnects automatically next time — this
 * form only needs filling in once per bucket, per browser.
 */
export function ConnectS3Modal({
  onConnect,
  onClose,
}: {
  onConnect: (connectionString: string) => Promise<void>;
  onClose: () => void;
}) {
  const [host, setHost] = useState('');
  const [bucket, setBucket] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [region, setRegion] = useState('us-east-1');
  const [tls, setTls] = useState(false);
  const [error, setError] = useState('');
  const connecting = useBusy();

  const valid = host.trim() && bucket.trim() && accessKeyId.trim();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setError('');
    try {
      const connectionString = buildS3ConnectionString(
        {
          host: host.trim(),
          bucket: bucket.trim(),
          region: region.trim(),
          forcePathStyle: true,
          tls,
        },
        { accessKeyId: accessKeyId.trim(), secretAccessKey: secretAccessKey.trim() }
      );
      await connecting.run(() => onConnect(connectionString));
    } catch (e2) {
      setError(errorMessage(e2));
    }
  }

  return (
    <Modal
      title="Connect an S3-compatible bucket"
      label="Connect an S3-compatible bucket"
      onClose={onClose}
    >
      <form onSubmit={(e) => void submit(e)}>
        <label className="form-label" htmlFor="s3-host">
          Endpoint host
        </label>
        <input
          id="s3-host"
          className="form-control"
          placeholder="192.168.1.10:9000"
          value={host}
          autoFocus
          onChange={(e) => setHost(e.target.value)}
          disabled={connecting.busy}
        />
        <p className="form-text">
          A self-hosted server's host:port, or a real S3/R2/B2 endpoint's host.
        </p>
        <label className="form-label" htmlFor="s3-bucket">
          Bucket
        </label>
        <input
          id="s3-bucket"
          className="form-control"
          value={bucket}
          onChange={(e) => setBucket(e.target.value)}
          disabled={connecting.busy}
        />
        <label className="form-label mt-3" htmlFor="s3-access-key">
          Access key ID
        </label>
        <input
          id="s3-access-key"
          className="form-control"
          value={accessKeyId}
          onChange={(e) => setAccessKeyId(e.target.value)}
          disabled={connecting.busy}
        />
        <label className="form-label mt-3" htmlFor="s3-secret-key">
          Secret access key <span className="text-muted">(optional)</span>
        </label>
        <input
          id="s3-secret-key"
          type="password"
          className="form-control"
          value={secretAccessKey}
          onChange={(e) => setSecretAccessKey(e.target.value)}
          disabled={connecting.busy}
        />
        <p className="form-text">
          Leave blank if this key was set up with no secret. Remembered in this browser so you won't
          need to re-enter it next time.
        </p>
        <label className="form-label mt-3" htmlFor="s3-region">
          Region
        </label>
        <input
          id="s3-region"
          className="form-control"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          disabled={connecting.busy}
        />
        <div className="form-check mt-3">
          <input
            id="s3-tls"
            type="checkbox"
            className="form-check-input"
            checked={tls}
            onChange={(e) => setTls(e.target.checked)}
            disabled={connecting.busy}
          />
          <label className="form-check-label" htmlFor="s3-tls">
            Use HTTPS
          </label>
        </div>
        {error && <div className="alert alert-danger py-2 small mt-3">{error}</div>}
        <div className="d-flex justify-content-end gap-2 mt-3">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={connecting.busy || !valid}>
            {connecting.busy && <Spinner />}
            Connect
          </button>
        </div>
      </form>
    </Modal>
  );
}
