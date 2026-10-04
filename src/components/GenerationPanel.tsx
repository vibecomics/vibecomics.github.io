import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { cb } from '../ai/actions';
import { dirtyLayerRefs, dirtyVariationRefs } from '../ai/builders';
import type { GenerationTarget, QueueItem } from '../ai/generation';
import { useMediaQuery } from '../utils/useViewport';
import { useProject } from './ProjectContext';
import { useBusy } from './useBusy';
import { useGenerationQueue } from './useGenerationStatus';

interface Props {
  onClose: () => void;
  /** Shows where a generation was for: its layer, or its cast or scene entry. */
  onShow: (target: GenerationTarget) => void;
}

function QueueRow({ item, onShow }: { item: QueueItem; onShow: () => void }) {
  const active = item.status === 'queued' || item.status === 'running';
  return (
    <li
      className="list-group-item d-flex align-items-start gap-2"
      role="button"
      tabIndex={0}
      title="Show where this was generated"
      style={{ cursor: 'pointer' }}
      onClick={onShow}
      onKeyDown={(e) => {
        // Only when the row itself has focus, not a button inside it (the cancel ×).
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onShow();
        }
      }}
    >
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
          onClick={(e) => {
            e.stopPropagation();
            cb().generate.cancelQueueItem(item.id);
          }}
        >
          &times;
        </button>
      )}
    </li>
  );
}

/**
 * The right-side panel opened by the toolbar's 🪄 button: every generation that's queued, running,
 * or has finished since the queue was last cleared, plus one "Generate all" button that queues every
 * dirty layer *and* every dirty story-bible reference (cast, objects, scenes) together — there is no
 * separate button per category, since from here "dirty" just means "needs a new image," regardless of
 * what it's for. Unlike the old queue dropdown, finished rows stay put until "Clear generated" removes
 * them, so you can see what was actually produced. Not modal: it stays open (no backdrop, no
 * click-outside-to-close) while you keep working elsewhere — e.g. switching tabs to start another
 * generation — closing only when its own × is clicked (or, on a phone, when a row is opened), so you
 * can watch a batch run while doing something else. Clicking a row takes you to what it was for.
 */
export default function GenerationPanel({ onClose, onShow }: Props) {
  const project = useProject();
  const dirtyCount = dirtyLayerRefs(project).length + dirtyVariationRefs(project).length;
  const queue = useGenerationQueue();
  const task = useBusy();
  // A full-width flex sibling would squeeze the comic page to nothing on a phone, so there it's an
  // overlay instead (see the wide/narrow split below) — the same trade-off InspectorPane makes.
  const wide = useMediaQuery('(min-width: 768px)');
  const completedCount = queue.filter((i) => i.status === 'done' || i.status === 'error').length;
  const activeCount = queue.filter((i) => i.status === 'queued' || i.status === 'running').length;

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
              <QueueRow
                key={item.id}
                item={item}
                onShow={() => {
                  onShow(item.target);
                  // The panel covers the editor on a phone, so close it to show what was picked.
                  if (!wide) onClose();
                }}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="border-top px-3 py-2 d-flex align-items-center gap-2 flex-wrap">
        <button
          type="button"
          className="btn btn-primary btn-sm text-nowrap"
          disabled={dirtyCount === 0 || task.busy}
          title={
            dirtyCount === 0
              ? 'Nothing is dirty — every layer, character, object and scene already matches its prompt'
              : `Generate images for every layer, background and story-bible reference (cast, objects, scenes) whose art no longer matches its prompt (${dirtyCount})`
          }
          onClick={() =>
            void task.run(async () => {
              // Reference art (cast/objects/scenes) first: a layer's or background's own generation
              // reads whatever reference images its subject/scene currently has, so those should be
              // fresh before any layer that might use them runs, not generated after or alongside it.
              await cb().generate.dirtyReferences();
              await cb().generate.dirty();
            })
          }
        >
          {task.busy && (
            <span
              className="spinner-border spinner-border-sm me-1"
              role="status"
              aria-label="Generating"
            />
          )}
          {task.busy ? 'Generating…' : `🪄 Generate all${dirtyCount > 0 ? ` (${dirtyCount})` : ''}`}
        </button>
        {activeCount > 0 && (
          <button
            type="button"
            className="btn btn-outline-danger btn-sm text-nowrap"
            title="Cancel everything still queued or running, not just one row"
            onClick={() => cb().generate.cancelAll()}
          >
            Stop all
          </button>
        )}
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
