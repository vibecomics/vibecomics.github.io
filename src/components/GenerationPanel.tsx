import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { cb } from '../ai/actions';
import { dirtyLayerRefs } from '../ai/builders';
import type { QueueItem } from '../ai/generation';
import { useMediaQuery } from '../utils/useViewport';
import { useProject } from './ProjectContext';
import { useBusy } from './useBusy';
import { useGenerationQueue } from './useGenerationStatus';

interface Props {
  onClose: () => void;
}

function QueueRow({ item }: { item: QueueItem }) {
  const active = item.status === 'queued' || item.status === 'running';
  return (
    <li className="list-group-item d-flex align-items-start gap-2">
      <span className="mt-1" style={{ width: '1rem', flexShrink: 0 }}>
        {item.status === 'running' && (
          <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
        )}
        {item.status === 'queued' && '⏳'}
        {item.status === 'done' && <span className="text-success">✓</span>}
        {item.status === 'error' && <span className="text-danger">⚠</span>}
      </span>
      <span className="flex-grow-1">
        <span className={item.status === 'queued' ? 'text-muted' : ''}>{item.label}</span>
        {item.status === 'error' && <div className="small text-danger">{item.error}</div>}
      </span>
      {active && (
        <button
          type="button"
          className="btn btn-link btn-sm p-0 text-danger lh-1"
          title={`Cancel this ${item.status === 'running' ? 'generation' : 'queued generation'}`}
          aria-label={`Cancel ${item.label}`}
          onClick={() => cb().generate.cancelQueueItem(item.id)}
        >
          &times;
        </button>
      )}
    </li>
  );
}

/**
 * The right-side panel opened by the toolbar's 🪄 button: every generation that's queued, running,
 * or has finished since the queue was last cleared, plus a button to queue every dirty layer. Unlike
 * the old queue dropdown, finished rows stay put until "Clear generated" removes them, so you can see
 * what was actually produced. Not modal: it stays open (no backdrop, no click-outside-to-close) while
 * you keep working elsewhere — e.g. switching tabs to start another generation — closing only when
 * its own × is clicked, so you can watch a batch run while doing something else.
 */
export default function GenerationPanel({ onClose }: Props) {
  const dirtyCount = dirtyLayerRefs(useProject()).length;
  const queue = useGenerationQueue();
  const task = useBusy();
  // A full-width flex sibling would squeeze the comic page to nothing on a phone, so there it's an
  // overlay instead (see the wide/narrow split below) — the same trade-off InspectorPane makes.
  const wide = useMediaQuery('(min-width: 768px)');
  const completedCount = queue.filter((i) => i.status === 'done' || i.status === 'error').length;

  const content: ReactNode = (
    <>
      <div className="d-flex align-items-center justify-content-between border-bottom px-3 py-2">
        <h2 className="h6 mb-0">🪄 Generation</h2>
        <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
      </div>

      <div className="flex-grow-1 overflow-auto">
        {queue.length === 0 ? (
          <p className="text-muted small px-3 py-2 mb-0">Nothing queued or generated yet.</p>
        ) : (
          <ul className="list-group list-group-flush">
            {queue.map((item) => (
              <QueueRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </div>

      <div className="border-top px-3 py-2 d-flex align-items-center gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm text-nowrap"
          disabled={dirtyCount === 0 || task.busy}
          title={
            dirtyCount === 0
              ? 'Nothing is dirty — every layer already matches its prompt'
              : `Generate images for every layer whose art no longer matches its prompt (${dirtyCount})`
          }
          onClick={() => void task.run(() => cb().generate.dirty())}
        >
          {task.busy && (
            <span
              className="spinner-border spinner-border-sm me-1"
              role="status"
              aria-label="Generating"
            />
          )}
          {task.busy ? 'Generating…' : `🪄 Generate${dirtyCount > 0 ? ` (${dirtyCount})` : ''}`}
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm ms-auto"
          disabled={completedCount === 0}
          title="Clear finished rows (done or failed) from this list"
          aria-label="Clear generated"
          onClick={() => cb().generate.clearCompletedQueueItems()}
        >
          🧹
        </button>
      </div>
    </>
  );

  if (wide) {
    // A normal flex sibling of the tab content (see EditorScreen), not an overlay: it reserves its
    // own width instead of covering whatever was on the right, so nothing behind it becomes
    // unclickable while it's open.
    return (
      <aside
        className="bg-body border-start d-flex flex-column"
        style={{ width: 340, flexShrink: 0 }}
        aria-label="Generation queue"
      >
        {content}
      </aside>
    );
  }

  return createPortal(
    <aside
      className="position-fixed top-0 bottom-0 end-0 bg-body border-start shadow d-flex flex-column"
      style={{ zIndex: 1041, width: 340, maxWidth: '90vw' }}
      aria-label="Generation queue"
    >
      {content}
    </aside>,
    document.body
  );
}
