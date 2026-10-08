import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { cb } from '../ai/actions';
import { pendingGenerations, pendingReferenceGenerations } from '../ai/builders';
import type { LayerKind, StoryKind } from '../ai/builders';
import type { GenerationTarget, QueueItem } from '../ai/generation';
import { useMediaQuery } from '../utils/useViewport';
import { useProject } from './ProjectContext';
import { useBusy } from './useBusy';
import { useGenerationQueue } from './useGenerationStatus';

/** One checkbox in the "Generate" split button's dropdown: a story-bible list (reference art) or a
 * layer kind, each independently selectable so "Generate" can be pointed at just cast, or just
 * backgrounds, instead of everything dirty. */
type Category =
  | { group: 'reference'; kind: StoryKind; label: string }
  | { group: 'layer'; kind: LayerKind; label: string };

const CATEGORIES: Category[] = [
  { group: 'reference', kind: 'characters', label: 'Cast' },
  { group: 'reference', kind: 'objects', label: 'Props' },
  { group: 'reference', kind: 'scenes', label: 'Scenes' },
  { group: 'layer', kind: 'foreground', label: 'Layers' },
  { group: 'layer', kind: 'background', label: 'Backgrounds' },
];

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
 * or has finished since the queue was last cleared, plus a "Generate" split button that queues every
 * dirty item in the checked categories (cast, props, scenes, layers, backgrounds — see CATEGORIES);
 * all are checked by default, so a plain click still generates everything dirty. Unlike the old queue
 * dropdown, finished rows stay put until "Clear generated" removes them, so you can see what was
 * actually produced. Not modal: it stays open (no backdrop, no
 * click-outside-to-close) while you keep working elsewhere — e.g. switching tabs to start another
 * generation — closing only when its own × is clicked (or, on a phone, when a row is opened), so you
 * can watch a batch run while doing something else. Clicking a row takes you to what it was for.
 */
export default function GenerationPanel({ onClose, onShow }: Props) {
  const project = useProject();
  const pendingLayers = pendingGenerations(project);
  const pendingRefs = pendingReferenceGenerations(project);
  const dirtyCount = pendingLayers.length + pendingRefs.length;
  const queue = useGenerationQueue();
  const task = useBusy();
  const [menuOpen, setMenuOpen] = useState(false);
  // All checked by default, so a plain click still generates everything dirty, same as before.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(CATEGORIES.map((c) => c.kind))
  );
  const countOf = (category: Category) =>
    category.group === 'reference'
      ? pendingRefs.filter((r) => r.kind === category.kind).length
      : pendingLayers.filter((l) => l.kind === category.kind).length;
  const selectedStoryKinds = CATEGORIES.filter(
    (c): c is Category & { group: 'reference' } => c.group === 'reference' && selected.has(c.kind)
  ).map((c) => c.kind);
  const selectedLayerKinds = CATEGORIES.filter(
    (c): c is Category & { group: 'layer' } => c.group === 'layer' && selected.has(c.kind)
  ).map((c) => c.kind);
  const selectedCount =
    pendingRefs.filter((r) => selectedStoryKinds.includes(r.kind)).length +
    pendingLayers.filter((l) => selectedLayerKinds.includes(l.kind)).length;
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
        {/* position-relative anchors the dropdown below (the generate button row), so the menu can
            be sized to this row's full width instead of just its toggle's. */}
        <div className="position-relative flex-grow-1">
          <div className="d-flex" style={{ gap: 1 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm text-nowrap flex-grow-1 rounded-end-0"
              disabled={selectedCount === 0 || task.busy}
              title={
                dirtyCount === 0
                  ? 'Nothing is dirty — every layer, character, prop and scene already matches its prompt'
                  : selectedCount === 0
                    ? 'Nothing is checked in the dropdown — pick what to generate'
                    : `Generate images for the checked categories whose art no longer matches its prompt (${selectedCount})`
              }
              onClick={() =>
                void task.run(async () => {
                  // Reference art (cast/objects/scenes) first: a layer's or background's own
                  // generation reads whatever reference images its subject/scene currently has, so
                  // those should be fresh before any layer that might use them runs, not generated
                  // after or alongside it.
                  if (selectedStoryKinds.length)
                    await cb().generate.dirtyReferences(selectedStoryKinds);
                  if (selectedLayerKinds.length) await cb().generate.dirty(selectedLayerKinds);
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
              {task.busy
                ? 'Generating…'
                : `🪄 Generate${selectedCount > 0 ? ` (${selectedCount})` : ''}`}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm rounded-start-0 px-2"
              aria-label="Choose what to generate"
              aria-expanded={menuOpen}
              disabled={task.busy}
              onClick={() => setMenuOpen((o) => !o)}
            >
              ▾
            </button>
          </div>
          {menuOpen && (
            <>
              <div
                className="position-fixed top-0 start-0 w-100 h-100"
                style={{ zIndex: 999 }}
                onClick={() => setMenuOpen(false)}
              />
              {/* Opens upward and spans this row's full width: below/narrow would land under the
                  page (this is the panel's own footer) or get clipped to the caret's width. */}
              <ul
                className="dropdown-menu show w-100"
                data-bs-popper="static"
                style={{
                  top: 'auto',
                  bottom: '100%',
                  marginBottom: 4,
                  maxHeight: 260,
                  overflowY: 'auto',
                }}
              >
                {CATEGORIES.map((category) => {
                  const id = `generate-category-${category.kind}`;
                  const count = countOf(category);
                  // Nothing dirty in this category: check it off the list rather than letting it
                  // stay checked but inert, or unchecked and mistaken for a deliberate exclusion.
                  const empty = count === 0;
                  return (
                    <li key={category.kind} className="px-3 py-1">
                      <div className="form-check text-nowrap">
                        <input
                          type="checkbox"
                          className="form-check-input"
                          id={id}
                          checked={selected.has(category.kind)}
                          disabled={empty}
                          onChange={(e) =>
                            setSelected((s) => {
                              const next = new Set(s);
                              if (e.target.checked) next.add(category.kind);
                              else next.delete(category.kind);
                              return next;
                            })
                          }
                        />
                        <label
                          className={`form-check-label${empty ? ' text-muted' : ''}`}
                          htmlFor={id}
                        >
                          {category.label} ({count})
                        </label>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
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

  // On a phone, a 340px bar leaves most of the screen showing whatever was behind it; the panel
  // reads better as a full-screen sheet here, same as InspectorPane's phone layout.
  return createPortal(
    <aside
      className="position-fixed top-0 bottom-0 start-0 end-0 bg-body shadow d-flex flex-column"
      style={{ zIndex: 1041 }}
      aria-label="Generation queue"
    >
      {content}
    </aside>,
    document.body
  );
}
