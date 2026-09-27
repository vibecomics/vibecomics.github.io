import { useEffect, useMemo, useState } from 'react';
import { settled } from '../state/merge';
import type { Conflict, Side } from '../state/merge';
import type { ComicProject } from '../types/comic';
import ConflictDot from './ConflictDot';
import PageSheet from './PageSheet';

const VIEWS: Array<{ side: Side; label: string }> = [
  { side: 'base', label: 'Base' },
  { side: 'ours', label: 'Ours' },
  { side: 'theirs', label: 'Theirs' },
];

interface Props {
  /** The project as it is open now (ours, plus everything that merged cleanly). */
  project: ComicProject;
  conflicts: Conflict[];
  /** Go to where a conflict is (its tab and page). */
  onShow: (conflict: Conflict) => void;
  onResolve: (conflict: Conflict, side: Side) => void;
}

/**
 * The footer that shows what clashes with changes made elsewhere. It shows one
 * conflict at a time, and takes the editor to where it is; Base, Ours and Theirs
 * show how each version looks (for a conflict on a page, that page as it would be
 * if that side were kept), and the menu picks the one to keep.
 */
export default function ConflictBar({ project, conflicts, onShow, onResolve }: Props) {
  const [index, setIndex] = useState(0);
  const [view, setView] = useState<Side>('ours');
  const [choice, setChoice] = useState<Side>('ours');
  const at = Math.min(index, conflicts.length - 1);
  const conflict = conflicts[at];

  // Whenever another conflict comes up, go to where it is and start from our side.
  useEffect(() => {
    setView('ours');
    setChoice('ours');
    onShow(conflict);
    // Only when the conflict changes: onShow is a new function on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflict]);

  const shown = useMemo(() => settled(project, conflict, view), [project, conflict, view]);
  const { pageId } = conflict.where;
  const page = pageId ? shown.pages.find((p) => p.id === pageId) : undefined;

  return (
    <section
      className="conflict-bar border-top border-danger border-2 bg-body flex-shrink-0"
      aria-label="Conflict"
      style={{ maxHeight: '45vh', overflowY: 'auto' }}
    >
      <div className="d-flex align-items-center gap-2 px-3 py-2 border-bottom">
        <ConflictDot />
        <strong className="small flex-shrink-0">
          {conflicts.length > 1 ? `Conflict ${at + 1} of ${conflicts.length}` : 'Conflict'}
        </strong>
        {conflicts.length > 1 && (
          <div className="btn-group btn-group-sm flex-shrink-0" role="group" aria-label="Conflicts">
            <button
              type="button"
              className="btn btn-outline-secondary"
              aria-label="Previous conflict"
              disabled={at === 0}
              onClick={() => setIndex(at - 1)}
            >
              ‹
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary"
              aria-label="Next conflict"
              disabled={at === conflicts.length - 1}
              onClick={() => setIndex(at + 1)}
            >
              ›
            </button>
          </div>
        )}
        <span className="small text-truncate" style={{ minWidth: 0 }} title={conflict.label}>
          {conflict.label}
        </span>
      </div>

      <div className="d-flex flex-column flex-md-row gap-3 p-3">
        <div className="flex-grow-1" style={{ minWidth: 0 }}>
          <div className="btn-group btn-group-sm mb-2" role="group" aria-label="Version to look at">
            {VIEWS.map(({ side, label }) => (
              <button
                key={side}
                type="button"
                className={`btn ${view === side ? 'btn-dark' : 'btn-outline-secondary'}`}
                aria-pressed={view === side}
                onClick={() => setView(side)}
              >
                {label}
              </button>
            ))}
          </div>
          <pre
            className="small border rounded p-2 mb-2 bg-body-tertiary"
            style={{ whiteSpace: 'pre-wrap', maxHeight: 140, overflow: 'auto' }}
            aria-label={`${VIEWS.find((v) => v.side === view)!.label} version`}
          >
            {conflict.text[view]}
          </pre>
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <label className="small mb-0" htmlFor="conflict-choice">
              Keep
            </label>
            <select
              id="conflict-choice"
              className="form-select form-select-sm w-auto"
              value={choice}
              onChange={(e) => setChoice(e.target.value as Side)}
            >
              <option value="ours">Ours</option>
              <option value="theirs">Theirs</option>
              <option value="base">Base</option>
            </select>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => onResolve(conflict, choice)}
            >
              Resolve
            </button>
          </div>
        </div>

        {pageId && (
          <div className="flex-shrink-0 text-center small text-muted">
            <div className="conflict-preview d-flex" style={{ height: 200, width: 170 }}>
              {page ? (
                <PageSheet page={page} pageSize={shown.metadata.pageSize} />
              ) : (
                <div className="m-auto px-2">This page would not exist.</div>
              )}
            </div>
            <div>{page ? `Page ${page.number}` : 'Page'}, as it looks with this version</div>
          </div>
        )}
      </div>
    </section>
  );
}
