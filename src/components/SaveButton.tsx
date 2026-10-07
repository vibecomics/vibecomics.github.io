import { cb } from '../ai/actions';
import type { SaveState } from '../state/useProjectSaver';
import { CloudUploadIcon, FloppyDiskIcon } from './Icons';

interface Props {
  state: SaveState;
  /** True when there are changes not yet written to storage. */
  dirty: boolean;
  /** The open project's own storage connection: a Drive project shows a cloud icon instead of a floppy disk. */
  backendKind: 'drive' | 'server' | null;
}

/** Saves now; it shows a spinner while saving. Floppy disk for an HTTP storage project, cloud for a Drive one. */
export default function SaveButton({ state, dirty, backendKind }: Props) {
  const saving = state === 'saving';
  const title = saving
    ? 'Saving…'
    : state === 'conflict'
      ? 'Changes made elsewhere clash with yours: choose which to keep at the bottom'
      : state === 'error'
        ? 'Save failed. Click to retry'
        : dirty
          ? 'Save now'
          : 'All changes saved';

  return (
    <span title={title}>
      <button
        type="button"
        className={`btn btn-sm d-flex align-items-center justify-content-center ${
          state === 'error' || state === 'conflict' ? 'btn-danger' : 'btn-outline-light'
        }`}
        style={{ width: 36, height: 31 }}
        disabled={saving || !dirty}
        aria-label="Save now"
        onClick={() => void cb().storage.save()}
      >
        {saving ? (
          <span className="spinner-border spinner-border-sm" role="status" aria-label="Saving" />
        ) : backendKind === 'drive' ? (
          <CloudUploadIcon />
        ) : (
          <FloppyDiskIcon />
        )}
      </button>
    </span>
  );
}
