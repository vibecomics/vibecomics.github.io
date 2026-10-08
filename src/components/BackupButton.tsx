import { useEffect, useState, useSyncExternalStore } from 'react';
import { cb } from '../ai/actions';
import type { DeviceCodeInfo } from '../drive/driveClient';
import { getBackupStatus, setBackupStatus, subscribeBackupStatus } from '../storage/backupStatus';
import type { BackupStatus } from '../storage/backupStatus';
import { errorMessage } from '../utils/errors';
import { ConnectDriveModal, ConnectServerModal } from './ConnectModals';
import { CloudUploadIcon, FloppyDiskIcon } from './Icons';
import Modal from './Modal';

type Kind = 'drive' | 'server';

interface Props {
  /** The open project's own storage connection; there is nothing to back up to without one. */
  backendKind: Kind | null;
  deviceCode: DeviceCodeInfo | null;
  /** True while a save is running, so starting a backup never races it. */
  disabled: boolean;
}

/** The other kind of storage from the one backing the open project right now. */
function otherKind(backendKind: Kind): Kind {
  return backendKind === 'drive' ? 'server' : 'drive';
}

/** What a finished (or failed) backup looked like: counts, and every file that didn't make it. */
function BackupStatusModal({
  status,
  onClose,
  onRunAgain,
}: {
  status: BackupStatus;
  onClose: () => void;
  onRunAgain: () => void;
}) {
  const title =
    status.state === 'running'
      ? `Backing up to ${status.label}`
      : status.state === 'done'
        ? `Backed up to ${status.label}`
        : `Backup to ${status.label} failed`;
  const percent = status.total > 0 ? Math.round((status.done / status.total) * 100) : 0;

  return (
    <Modal
      title={title}
      label={title}
      onClose={onClose}
      footer={
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          {status.state !== 'running' && (
            <button type="button" className="btn btn-primary" onClick={onRunAgain}>
              Run again
            </button>
          )}
        </div>
      }
    >
      {status.state === 'running' && (
        <>
          <p className="mb-2">
            {status.total > 0
              ? `${status.done} of ${status.total} files copied…`
              : 'Listing files…'}
          </p>
          <div
            className="progress"
            role="progressbar"
            aria-valuenow={status.done}
            aria-valuemin={0}
            aria-valuemax={status.total || 1}
          >
            <div className="progress-bar" style={{ width: `${percent}%` }} />
          </div>
        </>
      )}
      {status.state === 'done' && status.summary && (
        <>
          <p className="mb-2">
            {status.summary.copied} file{status.summary.copied === 1 ? '' : 's'} copied,{' '}
            {status.summary.skipped} already up to date.
          </p>
          {status.summary.missing.length > 0 && (
            <>
              <p className="mb-1 text-danger">
                {status.summary.missing.length} file
                {status.summary.missing.length === 1 ? '' : 's'} this project refers to no longer
                exist in storage, so they were not backed up:
              </p>
              <ul className="small mb-0">
                {status.summary.missing.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {status.state === 'error' && (
        <div className="alert alert-danger py-2 small mb-0">{status.error}</div>
      )}
    </Modal>
  );
}

/**
 * The hamburger menu item that copies the open project to the *other* kind of storage: Drive when
 * the project lives on an HTTP storage server, or a server when it lives on Drive. One-way, manual
 * only. If that other storage is not connected yet, it shows the same connect dialog Settings uses,
 * then backs up as soon as that connection is live.
 *
 * While a backup is running (or just finished), the item's label shows a live percentage instead of
 * "Back up to …", and selecting it opens a popup with the live count or, once done, a summary and
 * every file that didn't make it — same as selecting it again later, once the first backup has run.
 */
export default function BackupButton({ backendKind, deviceCode, disabled }: Props) {
  const target = backendKind ? otherKind(backendKind) : null;
  const status = useSyncExternalStore(subscribeBackupStatus, getBackupStatus);
  const [showDriveModal, setShowDriveModal] = useState(false);
  const [showServerModal, setShowServerModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [error, setError] = useState('');

  // The device flow ended (approved, denied or expired) once App.tsx clears deviceCode; if this
  // button started it, pick the backup back up here instead of leaving the user to retry.
  useEffect(() => {
    if (deviceCode !== null || !connectingDrive) return;
    setConnectingDrive(false);
    setShowDriveModal(false);
    void runBackup('drive');
    // runBackup is stable across renders (it only closes over cb()); re-running this effect on
    // every render would re-fire the chained backup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceCode]);

  async function runBackup(kind: Kind) {
    setError('');
    try {
      const connections = await cb().storage.listConnections();
      const live = connections.find((c) => c.kind === kind && c.connected);
      if (!live) {
        setError(
          `Could not back up: ${kind === 'drive' ? 'Google Drive' : 'the storage server'} is not connected.`
        );
        return;
      }
      await cb().storage.backupTo(live.id);
      // Success/failure, and every count, already landed in the shared backup status store.
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function start() {
    if (!target) return;
    setError('');
    const connections = await cb().storage.listConnections();
    if (connections.some((c) => c.kind === target && c.connected)) {
      void runBackup(target);
      return;
    }
    if (target === 'drive') {
      setConnectingDrive(true);
      setShowDriveModal(true);
      void cb()
        .storage.connectWithDevice()
        .catch((e: unknown) => {
          setError(errorMessage(e));
          setConnectingDrive(false);
          setShowDriveModal(false);
        });
    } else {
      setShowServerModal(true);
    }
  }

  async function connectServer(url: string) {
    await cb().storage.connectWithServer(url);
    setShowServerModal(false);
    void runBackup('server');
  }

  function closeStatusModal() {
    setShowStatusModal(false);
    if (status && status.state !== 'running') setBackupStatus(null);
  }

  function runAgain() {
    setBackupStatus(null);
    setShowStatusModal(false);
    void start();
  }

  if (!target) return null;

  const hasRun = status !== null;
  const percent = status && status.total > 0 ? Math.round((status.done / status.total) * 100) : 0;
  const label = error
    ? error
    : status?.state === 'running'
      ? `Backing up… ${percent}%`
      : status?.state === 'done'
        ? 'Backup finished — click for details'
        : status?.state === 'error'
          ? 'Backup failed — click for details'
          : target === 'drive'
            ? 'Back up to Google Drive'
            : 'Back up to HTTP storage';
  const isError = Boolean(error) || status?.state === 'error';

  return (
    <>
      <li>
        <button
          type="button"
          className={`dropdown-item d-flex align-items-center gap-2${isError ? ' text-danger' : ''}`}
          disabled={!hasRun && disabled}
          onClick={() => (hasRun ? setShowStatusModal(true) : void start())}
        >
          {status?.state === 'running' ? (
            <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
          ) : status?.state === 'done' ? (
            <span aria-hidden="true">✓</span>
          ) : status?.state === 'error' ? (
            <span aria-hidden="true">!</span>
          ) : target === 'drive' ? (
            <CloudUploadIcon />
          ) : (
            <FloppyDiskIcon />
          )}
          {label}
        </button>
      </li>
      {showDriveModal && (
        <ConnectDriveModal
          deviceCode={deviceCode}
          waiting={connectingDrive}
          onClose={() => {
            setShowDriveModal(false);
            setConnectingDrive(false);
          }}
        />
      )}
      {showServerModal && (
        <ConnectServerModal onConnect={connectServer} onClose={() => setShowServerModal(false)} />
      )}
      {showStatusModal && status && (
        <BackupStatusModal status={status} onClose={closeStatusModal} onRunAgain={runAgain} />
      )}
    </>
  );
}
