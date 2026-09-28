import { useState } from 'react';
import { cb } from '../ai/actions';
import DropdownMenu from './DropdownMenu';
import GeneratorSettings from './GeneratorSettings';
import { useBusy } from './useBusy';
import { useGenerationQueue } from './useIsGenerating';

function GearIcon() {
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
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1M12.5 12.5l-1.1-1.1M4.6 4.6 3.5 3.5" />
    </svg>
  );
}

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
          ✨{queue.length > 0 && <span className="badge bg-light text-dark ms-1">{queue.length}</span>}
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

/** Generator settings (gear icon), the generation queue, and, once something is dirty, a button to
 * generate it all. Always visible (not tucked in the mobile-only hamburger menu). */
export default function GeneratorButton({ dirtyCount }: Props) {
  const [showSettings, setShowSettings] = useState(false);
  const task = useBusy();

  return (
    <>
      {dirtyCount > 0 && (
        <button
          type="button"
          className="btn btn-sm btn-outline-light text-nowrap"
          disabled={task.busy}
          onClick={() => void task.run(() => cb().generate.dirty())}
        >
          {task.busy && (
            <span className="spinner-border spinner-border-sm me-1" role="status" aria-label="Generating" />
          )}
          {task.busy ? 'Generating…' : `✨ Generate (${dirtyCount})`}
        </button>
      )}
      <QueueButton />
      <button
        type="button"
        className="btn btn-sm btn-outline-light d-flex align-items-center justify-content-center"
        style={{ width: 36, height: 31 }}
        title="Generator settings"
        aria-label="Generator settings"
        onClick={() => setShowSettings(true)}
      >
        <GearIcon />
      </button>
      {showSettings && <GeneratorSettings onClose={() => setShowSettings(false)} />}
    </>
  );
}
