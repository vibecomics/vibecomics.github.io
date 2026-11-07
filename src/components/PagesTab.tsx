import { useEffect, useState } from 'react';
import { cb } from '../ai/actions';
import type { ComicPage, MediaItem, PageSize } from '../types/comic';
import { formatPageLabel } from '../types/comic';
import { usePersistentChoice } from '../utils/usePersistentChoice';
import { useMediaQuery } from '../utils/useViewport';
import InspectorPane from './InspectorPane';
import PageButtons from './PageButtons';
import PageSheet from './PageSheet';
import { FIT_VIEW, MAX_SCALE, MIN_SCALE, ZOOM_STEP } from './pageView';
import type { PageView } from './pageView';
import { SNAPS } from './sheetSnaps';
import type { Snap } from './sheetSnaps';
import PanelInspector from './PanelInspector';
import { resolveSelection } from './selection';
import type { Selection } from './selection';

interface Props {
  pages: ComicPage[];
  pageIndex: number;
  pageSize: PageSize;
  media: MediaItem[];
  /** Pages (by id) with a conflict: their number gets a dot. */
  conflictPageIds: Set<string>;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}

/** What the phone sheet's handle bar says: the page and the highlighted panel. */
const sheetTitle = (page: ComicPage, panelNumber: number | null) =>
  panelNumber ? `Page ${page.number}, Panel ${panelNumber}` : `Page ${page.number}`;

function AddPageButton({ className }: { className: string }) {
  return (
    <button
      className={`btn btn-sm btn-outline-primary ${className}`}
      title="Add page"
      aria-label="Add page"
      onClick={() => cb().page.add()}
    >
      +
    </button>
  );
}

/** Page number rail (left on desktop, in the bottom sheet on mobile), the selected page, and the inspector of its highlighted panel. */
export default function PagesTab({
  pages,
  pageIndex,
  pageSize,
  media,
  conflictPageIds,
  selection,
  onSelect,
}: Props) {
  const wide = useMediaQuery('(min-width: 768px)');
  const [snap, setSnap] = usePersistentChoice<Snap>('comic-builder:sheet', SNAPS, 'half');
  const [view, setView] = useState<PageView>(FIT_VIEW);
  const zoomBy = (delta: number) =>
    setView((v) => ({ ...v, scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale + delta)) }));

  const page = pages[pageIndex];
  const panels = page?.panels ?? [];
  const { panel, current } = resolveSelection(page, selection);

  // Delete or Backspace removes the selected layer or bubble (unless typing in a field or in a popup).
  const panelId = panel?.id;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (
        (event.target as HTMLElement).closest(
          'input, textarea, select, [contenteditable], [role="dialog"]'
        )
      )
        return;
      if (!panelId) return;
      if (current.layerId) cb().layers.delete(panelId, current.layerId);
      else if (current.bubbleId) cb().bubbles.delete(panelId, current.bubbleId);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [panelId, current.layerId, current.bubbleId]);

  const pageStrip = (
    <div className="d-md-none d-flex align-items-center gap-2 border-top bg-body py-2 px-3">
      <div className="d-flex flex-grow-1 gap-2" style={{ minWidth: 0, overflowX: 'auto' }}>
        <PageButtons
          pages={pages}
          pageIndex={pageIndex}
          className="px-3 flex-shrink-0"
          axis="x"
          conflictPageIds={conflictPageIds}
        />
      </div>
      <AddPageButton className="px-3 flex-shrink-0" />
    </div>
  );

  return (
    <div className="d-flex flex-column flex-grow-1" style={{ minHeight: 0, minWidth: 0 }}>
      <div className="d-flex flex-grow-1" style={{ minHeight: 0 }}>
        <div
          className="d-none d-md-flex flex-column border-end bg-body py-2"
          style={{ width: 64, flexShrink: 0 }}
        >
          <div
            className="d-flex flex-column flex-grow-1"
            style={{ minHeight: 0, overflowY: 'auto' }}
          >
            <PageButtons
              pages={pages}
              pageIndex={pageIndex}
              className="mx-2 mb-1 px-0"
              axis="y"
              conflictPageIds={conflictPageIds}
            />
          </div>
          <AddPageButton className="mx-2 mt-2 px-0" />
        </div>

        <main
          className="flex-grow-1 d-flex flex-column flex-md-row"
          style={{ minWidth: 0, minHeight: 0 }}
        >
          {page ? (
            <>
              <section
                className="flex-grow-1 d-flex flex-column"
                style={{ minWidth: 0, minHeight: 0 }}
              >
                <PageSheet
                  page={page}
                  pageSize={pageSize}
                  view={view}
                  onViewChange={setView}
                  editing={{
                    selection: current,
                    onSelect,
                    // On a narrow screen a tap on the page dismisses the sheet, to show the art.
                    onTap: () => {
                      if (!wide) setSnap('closed');
                    },
                    // On a narrow screen, swiping left shows the next page and right the previous one.
                    onSwipe: (direction) => {
                      const target = pageIndex - direction;
                      if (!wide && target >= 0 && target < pages.length) cb().page.select(target);
                    },
                  }}
                />
              </section>
              <InspectorPane
                wide={wide}
                snap={snap}
                onSnapChange={setSnap}
                footer={pageStrip}
                summary={sheetTitle(page, panel ? panels.indexOf(panel) + 1 : null)}
              >
                <div className="d-none d-md-flex align-items-center justify-content-between px-3 pt-3">
                  <h2 className="h6 text-truncate mb-0">{formatPageLabel(page)}</h2>
                  <div className="d-flex align-items-center gap-1">
                    <span aria-hidden="true">🔍</span>
                    <div className="btn-group btn-group-sm" role="group" aria-label="Zoom">
                      <button
                        className="btn btn-outline-secondary"
                        title="Zoom out"
                        aria-label="Zoom out"
                        disabled={view.scale <= MIN_SCALE}
                        onClick={() => zoomBy(-ZOOM_STEP)}
                      >
                        ➖
                      </button>
                      <button
                        className="btn btn-outline-secondary"
                        title="Zoom in"
                        aria-label="Zoom in"
                        disabled={view.scale >= MAX_SCALE}
                        onClick={() => zoomBy(ZOOM_STEP)}
                      >
                        ➕
                      </button>
                    </div>
                  </div>
                </div>
                {panel ? (
                  <PanelInspector
                    page={page}
                    panel={panel}
                    media={media}
                    selection={current}
                    onSelect={onSelect}
                  />
                ) : (
                  <p className="text-muted p-3 mb-0 d-none d-md-block">No panel selected</p>
                )}
              </InspectorPane>
            </>
          ) : (
            <p className="text-muted p-3">No pages yet.</p>
          )}
        </main>
      </div>

      {!page && pageStrip}
    </div>
  );
}
