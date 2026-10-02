import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { cb } from '../ai/actions';
import type { DeviceCodeInfo } from '../drive/driveClient';
import type { StorageConnectionInfo } from '../storage/connections';
import type { ProjectFolder } from '../storage/types';
import { PAGE_SIZE_PRESETS } from '../types/comic';
import ConnectSettings from './ConnectSettings';
import GeneratorSettings from './GeneratorSettings';
import Spinner from './Spinner';
import { useGeneratorConfig, useGeneratorConfigProblem } from './useGeneratorConfig';
import { useBusy } from './useBusy';
import { errorMessage } from '../utils/errors';

const kindLabel = (c: StorageConnectionInfo): string => (c.kind === 'drive' ? 'Google Drive' : c.label);

function NewProjectModal({
  connections,
  onClose,
}: {
  connections: StorageConnectionInfo[];
  onClose: () => void;
}) {
  const live = connections.filter((c) => c.connected);
  const defaultConnectionId = live.find((c) => c.kind === 'server')?.id ?? (live[0]?.id ?? '');
  const [name, setName] = useState('');
  const [sizeIndex, setSizeIndex] = useState(0);
  const [connectionId, setConnectionId] = useState(defaultConnectionId);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const trimmedName = name.trim();

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!trimmedName || creating) return;
    setCreating(true);
    setError('');
    try {
      // On success the app switches to the editor and this modal unmounts.
      await cb().storage.createProject(trimmedName, PAGE_SIZE_PRESETS[sizeIndex], connectionId);
    } catch (e) {
      setError(errorMessage(e));
      setCreating(false);
    }
  }

  return (
    <>
      <div
        className="modal show d-block"
        tabIndex={-1}
        role="dialog"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="modal-dialog">
          <form className="modal-content" onSubmit={(e) => void create(e)}>
            <div className="modal-header">
              <h2 className="modal-title h5 mb-0">New project</h2>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            <div className="modal-body">
              <label className="form-label" htmlFor="new-project-name">
                Project name
              </label>
              <input
                id="new-project-name"
                className="form-control"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
              />
              <label className="form-label mt-3" htmlFor="new-project-size">
                Page size
              </label>
              <select
                id="new-project-size"
                className="form-select"
                value={sizeIndex}
                onChange={(e) => setSizeIndex(Number(e.target.value))}
              >
                {PAGE_SIZE_PRESETS.map((preset, i) => (
                  <option key={preset.label} value={i}>
                    {preset.label}
                  </option>
                ))}
              </select>
              {live.length > 1 && (
                <>
                  <label className="form-label mt-3" htmlFor="new-project-connection">
                    Store in
                  </label>
                  <select
                    id="new-project-connection"
                    className="form-select"
                    value={connectionId}
                    onChange={(e) => setConnectionId(e.target.value)}
                  >
                    {live.map((c) => (
                      <option key={c.id} value={c.id}>
                        {kindLabel(c)}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {error && <div className="alert alert-danger mt-3 mb-0">{error}</div>}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={!trimmedName || creating}>
                {creating && (
                  <span
                    className="spinner-border spinner-border-sm me-2"
                    role="status"
                    aria-hidden="true"
                  />
                )}
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      </div>
      <div className="modal-backdrop show" />
    </>
  );
}

/** A one-line summary of the image generator and a button to configure it. */
function GeneratorSettingsCard() {
  const [editing, setEditing] = useState(false);
  const config = useGeneratorConfig();
  const problem = useGeneratorConfigProblem();
  const summary = config
    ? `${config.comfy.baseUrl}${config.comfy.workflowName ? ` · ${config.comfy.workflowName}` : ''}`
    : (problem ?? 'Not set up');

  return (
    <div className="col-12 col-sm-6 col-md-4">
      <div className="card h-100 shadow-sm">
        <div className="card-body d-flex flex-column">
          <h3 className="card-title h6">Image generator</h3>
          <p className={`small text-truncate${config ? '' : ' text-muted'}`} title={summary}>
            {summary}
          </p>
          <button
            className="btn btn-outline-secondary mt-auto align-self-start"
            onClick={() => setEditing(true)}
          >
            {config ? 'Edit' : 'Set up'}
          </button>
        </div>
      </div>
      {editing && <GeneratorSettings onClose={() => setEditing(false)} />}
    </div>
  );
}

/**
 * The app's start screen: one card per project across every connected storage location, plus a
 * dashed tile that creates a new one, and a Settings section below to connect storage and the
 * image generator.
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
  const [connections, setConnections] = useState<StorageConnectionInfo[]>([]);

  const refreshConnections = useCallback(() => {
    void cb().storage.listConnections().then(setConnections);
  }, []);

  // Re-read connections whenever the project list changes (after a connect/disconnect/create) or
  // a Drive device-code flow starts or finishes.
  useEffect(() => {
    refreshConnections();
  }, [projects, deviceCode, refreshConnections]);

  const liveCount = connections.filter((c) => c.connected).length;

  function open(folderId: string) {
    setOpeningId(folderId);
    void opening.run(() => cb().storage.openProject(folderId));
  }

  return (
    <div className="min-vh-100 bg-body-tertiary">
      <div className="container py-4">
        <h1 className="h4 mb-4">Your comics</h1>
        {projects.length === 0 && (
          <p className="text-muted">
            {liveCount === 0
              ? 'No storage connected yet. Connect Google Drive or a storage server below to see your comics.'
              : 'No comics yet here. Create one below.'}
          </p>
        )}
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
        <h1 className="h4 mt-5 mb-3">Settings</h1>
        <div className="row g-3">
          <ConnectSettings
            connections={connections}
            deviceCode={deviceCode}
            onChange={refreshConnections}
          />
          <GeneratorSettingsCard />
        </div>
      </div>
      {showNewModal && (
        <NewProjectModal connections={connections} onClose={() => setShowNewModal(false)} />
      )}
    </div>
  );
}
