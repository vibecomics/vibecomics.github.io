import { useState } from 'react';
import type { FormEvent } from 'react';
import { cb } from '../ai/actions';
import type { StorageConnectionInfo } from '../storage/connections';
import { PAGE_SIZE_PRESETS } from '../types/comic';
import { errorMessage } from '../utils/errors';
import Modal from './Modal';
import PageSizeOptions from './PageSizeOptions';

const FORM_ID = 'new-project-form';

export default function NewProjectModal({
  connections,
  onClose,
}: {
  connections: StorageConnectionInfo[];
  onClose: () => void;
}) {
  const live = connections.filter((c) => c.connected);
  const defaultConnectionId = live.find((c) => c.kind === 'server')?.id ?? live[0]?.id ?? '';
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
    <Modal
      title="New project"
      label="New project"
      onClose={onClose}
      footer={
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form={FORM_ID}
            className="btn btn-primary"
            disabled={!trimmedName || creating}
          >
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
      }
    >
      <form id={FORM_ID} onSubmit={(e) => void create(e)}>
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
          <PageSizeOptions />
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
                  {c.label}
                </option>
              ))}
            </select>
          </>
        )}
        {error && <div className="alert alert-danger mt-3 mb-0">{error}</div>}
      </form>
    </Modal>
  );
}
