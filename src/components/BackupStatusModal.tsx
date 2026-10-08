import type { BackupStatus } from '../storage/backupStatus';
import Modal from './Modal';

/** What a finished (or failed) backup looked like: counts, and every file that didn't make it. */
export default function BackupStatusModal({
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
