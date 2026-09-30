import { useState } from 'react';
import { cb } from '../ai/actions';
import DropdownMenu from './DropdownMenu';
import GenerateDirtyModal from './GenerateDirtyModal';
import { useProject } from './ProjectContext';
import { useBusy } from './useBusy';
import { useGenerationQueue } from './useGenerationStatus';

/** A dropdown showing the generation queue: what's running and what's waiting its turn. */
function QueueButton() {
  const [open, setOpen] = useState(false);
  const queue = useGenerationQueue();

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      align="end"
      toggle={
        <>
          ✨
          {queue.length > 0 && (
            <span className="badge bg-light text-dark ms-1">{queue.length}</span>
          )}
        </>
      }
      toggleClassName="btn btn-sm btn-outline-light d-flex align-items-center justify-content-center"
      toggleLabel="Generation queue"
    >
      {queue.length === 0 ? (
        <li className="px-3 py-2 text-muted small">Nothing generating</li>
      ) : (
        queue.map((item) => (
          <li key={item.id} className="px-3 py-1 small d-flex align-items-center gap-2">
            {item.status === 'running' ? (
              <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
            ) : (
              <span style={{ width: '1rem' }} />
            )}
            <span className={item.status === 'queued' ? 'text-muted' : ''}>{item.label}</span>
          </li>
        ))
      )}
    </DropdownMenu>
  );
}

interface Props {
  dirtyCount: number;
}

/** The generation queue, and, once something is dirty, a button to
 * generate it all. Always visible (not tucked in the mobile-only hamburger menu). */
export default function GeneratorButton({ dirtyCount }: Props) {
  const [showDirty, setShowDirty] = useState(false);
  const task = useBusy();
  const project = useProject();

  return (
    <>
      {dirtyCount > 0 && (
        <button
          type="button"
          className="btn btn-sm btn-outline-light text-nowrap"
          disabled={task.busy}
          onClick={() => setShowDirty(true)}
        >
          {task.busy && (
            <span
              className="spinner-border spinner-border-sm me-1"
              role="status"
              aria-label="Generating"
            />
          )}
          {task.busy ? 'Generating…' : `✨ Generate (${dirtyCount})`}
        </button>
      )}
      {showDirty && (
        <GenerateDirtyModal
          project={project}
          onClose={() => setShowDirty(false)}
          onGenerate={() => {
            setShowDirty(false);
            void task.run(() => cb().generate.dirty());
          }}
        />
      )}
      <QueueButton />
    </>
  );
}
