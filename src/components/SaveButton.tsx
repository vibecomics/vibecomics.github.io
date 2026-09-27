import { cb } from '../ai/actions';
import type { SaveState } from '../state/useProjectSaver';

interface Props {
  state: SaveState;
  /** True when there are changes not yet written to storage. */
  dirty: boolean;
}

function FloppyDiskIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 1.5h9.586a1 1 0 0 1 .707.293l1.414 1.414a1 1 0 0 1 .293.707V13.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" />
      <path d="M4.5 1.5v4h6v-4" />
      <rect x="4" y="9" width="8" height="5.5" />
    </svg>
  );
}

/** Floppy-disk button that saves now; it shows a spinner while saving. */
export default function SaveButton({ state, dirty }: Props) {
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
        ) : (
          <FloppyDiskIcon />
        )}
      </button>
    </span>
  );
}
