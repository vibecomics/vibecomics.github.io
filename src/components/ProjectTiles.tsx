import { useState } from 'react';
import { cb } from '../ai/actions';
import type { DeviceCodeInfo } from '../drive/driveClient';
import type { ProjectFolder } from '../storage/types';
import NewProjectModal from './NewProjectModal';
import SettingsSection from './SettingsSection';
import Spinner from './Spinner';
import { useStorageConnections } from './useStorageConnections';
import { useBusy } from './useBusy';

/**
 * The app's project list: one card per project across every connected storage location, plus a
 * dashed tile that creates a new one, and the storage and settings folded away below. With no
 * projects the app shows the first-run screen instead (see NuxScreen).
 */
export default function ProjectTiles({
  projects,
  deviceCode,
}: {
  projects: ProjectFolder[];
  deviceCode: DeviceCodeInfo | null;
}) {
  const [showNewModal, setShowNewModal] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const opening = useBusy();
  const { connections, refreshConnections } = useStorageConnections(projects, deviceCode);

  const liveCount = connections.filter((c) => c.connected).length;

  function open(folderId: string) {
    setOpeningId(folderId);
    void opening.run(() => cb().storage.openProject(folderId));
  }

  return (
    <div className="min-vh-100 bg-body-tertiary">
      <div className="container py-4">
        <h1 className="h4 mb-4">Your comics</h1>
        <div className="row g-3">
          {projects.map((folder) => (
            <div
              className="col-12 col-sm-6 col-md-4"
              key={`${folder.connectionId ?? ''}:${folder.id}`}
            >
              <div className="card h-100 shadow-sm">
                <div className="card-body d-flex flex-column">
                  {folder.connectionLabel && (
                    <span className="badge text-bg-secondary align-self-start mb-2 text-truncate">
                      {folder.connectionLabel}
                    </span>
                  )}
                  <h2 className="card-title h6 text-truncate">{folder.name}</h2>
                  <button
                    className="btn btn-primary mt-auto align-self-start"
                    disabled={opening.busy}
                    onClick={() => open(folder.id)}
                  >
                    {opening.busy && openingId === folder.id && <Spinner />}
                    Open
                  </button>
                </div>
              </div>
            </div>
          ))}
          <div className="col-12 col-sm-6 col-md-4">
            <button
              className="card h-100 w-100 shadow-sm border-2 text-center p-4"
              style={{ borderStyle: 'dashed', minHeight: 120 }}
              disabled={liveCount === 0}
              title={liveCount === 0 ? 'Connect a storage location in Settings first.' : undefined}
              onClick={() => setShowNewModal(true)}
            >
              <span className="h1 mb-1">+</span>
              <span className="fw-semibold">New project</span>
            </button>
          </div>
        </div>
        <SettingsSection
          connections={connections}
          deviceCode={deviceCode}
          onChange={refreshConnections}
        />
      </div>
      {showNewModal && (
        <NewProjectModal connections={connections} onClose={() => setShowNewModal(false)} />
      )}
    </div>
  );
}
