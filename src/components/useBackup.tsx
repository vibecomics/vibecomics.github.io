import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { cb } from '../ai/actions';
import type { DeviceCodeInfo } from '../drive/driveClient';
import { getBackupStatus, setBackupStatus, subscribeBackupStatus } from '../storage/backupStatus';
import { errorMessage } from '../utils/errors';
import BackupStatusModal from './BackupStatusModal';
import { ConnectDriveModal, ConnectServerModal } from './ConnectModals';
import { CloudUploadIcon, FloppyDiskIcon } from './Icons';

type Kind = 'drive' | 'server';

interface Props {
  /** The open project's own storage connection; there is nothing to back up to without one. */
  backendKind: Kind | null;
  deviceCode: DeviceCodeInfo | null;
  /** True while a save is running, so starting a backup never races it. */
  disabled: boolean;
}

export interface Backup {
  label: string;
  icon: ReactNode;
  isError: boolean;
  disabled: boolean;
  onSelect: () => void;
  /** The connect/status dialogs this backup may need. Render these *outside* whatever triggers
   * onSelect (e.g. a dropdown menu item) — see useBackup's own doc comment for why. */
  modals: ReactNode;
}

/** The other kind of storage from the one backing the open project right now. */
function otherKind(backendKind: Kind): Kind {
  return backendKind === 'drive' ? 'server' : 'drive';
}

/**
 * Backs up the open project to the *other* kind of storage: Drive when the project lives on an HTTP
 * storage server, or a server when it lives on Drive. One-way, manual only. If that other storage is
 * not connected yet, selecting it shows the same connect dialog Settings uses, then backs up as soon
 * as that connection is live.
 *
 * Returns null when there's nothing to back up to (no project open). The caller is meant to put
 * `onSelect`/`label`/`icon` on a menu item (e.g. inside EditorNavbar's hamburger dropdown) but render
 * the returned `modals` *outside* that menu, as an always-mounted sibling: a dropdown typically
 * unmounts its items the instant one is selected (closing itself), which would tear down the
 * connect/status dialog's state before it ever got to render if the modals lived inside it too.
 *
 * While a backup is running (or just finished), `label` shows a live percentage instead of "Back up
 * to …", and `onSelect` opens a popup with the live count or, once done, a summary and every file
 * that didn't make it — same as selecting it again later, once the first backup has run.
 */
export function useBackup({ backendKind, deviceCode, disabled }: Props): Backup | null {
  const target = backendKind ? otherKind(backendKind) : null;
  const status = useSyncExternalStore(subscribeBackupStatus, getBackupStatus);
  const [showDriveModal, setShowDriveModal] = useState(false);
  const [showServerModal, setShowServerModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [error, setError] = useState('');

  // The device flow ended (approved, denied or expired) once App.tsx clears deviceCode; if this
  // hook started it, pick the backup back up here instead of leaving the user to retry.
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

  return {
    label,
    icon:
      status?.state === 'running' ? (
        <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
      ) : status?.state === 'done' ? (
        <span aria-hidden="true">✓</span>
      ) : status?.state === 'error' ? (
        <span aria-hidden="true">!</span>
      ) : target === 'drive' ? (
        <CloudUploadIcon />
      ) : (
        <FloppyDiskIcon />
      ),
    isError: Boolean(error) || status?.state === 'error',
    disabled: !hasRun && disabled,
    onSelect: () => (hasRun ? setShowStatusModal(true) : void start()),
    modals: (
      <>
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
    ),
  };
}
