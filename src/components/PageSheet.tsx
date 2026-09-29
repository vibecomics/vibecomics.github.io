import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, RefObject } from 'react';
import { cb } from '../ai/actions';
import { findDividers, moveEdge, rectOf } from '../state/layout';
import type { Divider, Rect } from '../state/layout';
import type { ComicPage, PageSize } from '../types/comic';
import { usePointerDrag } from '../utils/drag';
import { pointerPercent } from '../utils/geometry';
import type { Point } from '../utils/geometry';
import { useElementSize } from '../utils/useElementSize';
import CutHandle from './CutHandle';
import { FIT_VIEW, PANEL_ZOOM_SCALE, clampView, viewForRect } from './pageView';
import type { PageView } from './pageView';
import PanelView from './PanelView';
import type { Selection } from './selection';

interface PageEditing {
  selection: Selection;
  onSelect: (selection: Selection) => void;
  /** A tap (a press that barely moves) anywhere on the page area, including on layers and bubbles. */
  onTap?: () => void;
}

interface Props {
  page: ComicPage;
  pageSize: PageSize;
  editing?: PageEditing;
  /** Zoom/pan state, lifted so a toolbar elsewhere can drive it. Uncontrolled (fit) if omitted. */
  view?: PageView;
  onViewChange?: (view: PageView) => void;
}

/** Screen pixels a press may move and still count as a tap. */
const TAP_SLOP_PX = 6;

const contains = (r: Rect, p: Point) =>
  p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;

interface DividerHandleProps {
  divider: Divider;
  committed: Rect[];
  sheetRef: RefObject<HTMLDivElement | null>;
  onPreview: (rects: Rect[] | null) => void;
  onCommit: (value: number) => void;
}

/** The draggable line between panels; dragging resizes every panel that touches it. */
function DividerHandle({ divider, committed, sheetRef, onPreview, onCommit }: DividerHandleProps) {
  const vertical = divider.orientation === 'vertical';
  const valueAt = (event: { clientX: number; clientY: number }) => {
    const at = pointerPercent(sheetRef.current!, event);
    return vertical ? at.x : at.y;
  };

  const drag = usePointerDrag<{ value: number }>({
    start: () => ({ value: divider.coordinate }),
    move: (event, state) => {
      state.value = valueAt(event);
      onPreview(moveEdge(committed, divider.panelIndex, divider.edge, state.value));
    },
    end: (_, state) => {
      onPreview(null);
      onCommit(state.value);
    },
    cancel: () => onPreview(null),
  });

  const style: CSSProperties = vertical
    ? {
        left: `${divider.coordinate}%`,
        top: `${divider.start}%`,
        height: `${divider.end - divider.start}%`,
      }
    : {
        top: `${divider.coordinate}%`,
        left: `${divider.start}%`,
        width: `${divider.end - divider.start}%`,
      };
  return <div className={`divider-handle ${divider.orientation}`} style={style} {...drag} />;
}

/**
 * A page at its real aspect ratio with its panels laid out on it. When
 * `editing`, this is the one place everything is edited:
 * - click a panel to highlight it; its layers and bubbles can then be moved
 *   and resized here (and edited in the inspector);
 * - the highlighted panel has scissors on its left edge and top edge: drag
 *   one along the panel and let go over it to cut it (nothing else cuts);
 * - drag the lines between panels to resize them.
 */
export default function PageSheet({
  page,
  pageSize,
  editing,
  view: controlledView,
  onViewChange,
}: Props) {
  const [sheetRef, sheetSize] = useElementSize<HTMLDivElement>();
  const pressStart = useRef<Point | null>(null);
  const [resizePreview, setResizePreview] = useState<Rect[] | null>(null);
  const [internalView, setInternalView] = useState<PageView>(FIT_VIEW);
  const [panning, setPanning] = useState(false);
  const view = controlledView ?? internalView;
  const setView = onViewChange ?? setInternalView;

  // A new page always opens at fit scale.
  useEffect(() => {
    setView(FIT_VIEW);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  // Keeps the view within its zoom/pan limits as the sheet (re)sizes, e.g. on window resize.
  useEffect(() => {
    if (!sheetSize.width || !sheetSize.height) return;
    const clamped = clampView(view, sheetSize.width, sheetSize.height);
    if (clamped.scale !== view.scale || clamped.tx !== view.tx || clamped.ty !== view.ty) {
      setView(clamped);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, sheetSize.width, sheetSize.height]);

  const committed = useMemo(() => page.panels.map(rectOf), [page.panels]);
  const rects = resizePreview ?? committed;
  const dividers = useMemo(() => (editing ? findDividers(rects) : []), [editing, rects]);

  // Double-click a panel to zoom in on it (centered); double-click again to zoom back out.
  const handleDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!sheetRef.current) return;
    const index = rects.findIndex((r) => contains(r, pointerPercent(sheetRef.current!, event)));
    if (index < 0) return;
    setView(
      view.scale > 1
        ? FIT_VIEW
        : viewForRect(rects[index], PANEL_ZOOM_SCALE, sheetSize.width, sheetSize.height)
    );
  };

  // A click (a press that does not move) highlights the panel under it, or the layer in the highlighted panel.
  // A press that moves, while zoomed in, pans the page instead.
  const sheetDrag = usePointerDrag<{
    index: number;
    layerId?: string;
    from: Point;
    moved: boolean;
    startTx: number;
    startTy: number;
  }>({
    start: (event) => {
      if (!editing) return null;
      const index = rects.findIndex((r) => contains(r, pointerPercent(sheetRef.current!, event)));
      if (index < 0) return null;
      const layerId = (event.target as HTMLElement).closest<HTMLElement>('[data-layer-id]')?.dataset
        .layerId;
      return {
        index,
        layerId,
        from: { x: event.clientX, y: event.clientY },
        moved: false,
        startTx: view.tx,
        startTy: view.ty,
      };
    },
    move: (event, state) => {
      if (Math.hypot(event.clientX - state.from.x, event.clientY - state.from.y) > TAP_SLOP_PX) {
        state.moved = true;
      }
      if (state.moved && view.scale > 1) {
        setPanning(true);
        setView({
          scale: view.scale,
          tx: state.startTx + (event.clientX - state.from.x),
          ty: state.startTy + (event.clientY - state.from.y),
        });
      }
    },
    end: (_, state) => {
      setPanning(false);
      if (state.moved) return;
      const panel = page.panels[state.index];
      const layerId = editing?.selection.panelId === panel.id ? state.layerId : undefined;
      editing?.onSelect({ panelId: panel.id, layerId });
    },
    cancel: () => setPanning(false),
  });

  // Outside editing (e.g. the preview screen), a press that moves just pans — there's nothing to select.
  const panDrag = usePointerDrag<{ from: Point; startTx: number; startTy: number }>({
    start: (event) => {
      if (editing || view.scale <= 1) return null;
      setPanning(true);
      return { from: { x: event.clientX, y: event.clientY }, startTx: view.tx, startTy: view.ty };
    },
    move: (event, state) => {
      setView({
        scale: view.scale,
        tx: state.startTx + (event.clientX - state.from.x),
        ty: state.startTy + (event.clientY - state.from.y),
      });
    },
    end: () => setPanning(false),
    cancel: () => setPanning(false),
  });

  const selection = editing?.selection;
  const selectedPanel = page.panels.find((panel) => panel.id === selection?.panelId);
  // Paint the highlighted panel last so whatever spills out of it stays visible.
  const paintOrder = page.panels
    .map((panel, i) => ({ panel, i }))
    .sort(
      (a, b) =>
        Number(selection?.panelId === a.panel.id) - Number(selection?.panelId === b.panel.id)
    );
  return (
    <div
      className="page-area"
      onPointerDownCapture={
        editing
          ? (event) => (pressStart.current = { x: event.clientX, y: event.clientY })
          : undefined
      }
      onPointerUpCapture={
        editing
          ? (event) => {
              const start = pressStart.current;
              pressStart.current = null;
              const moved = start && Math.hypot(event.clientX - start.x, event.clientY - start.y);
              // Pressing the scissors is not a tap on the page.
              const onScissors = (event.target as Element).closest('[data-scissors]');
              if (moved !== null && moved !== undefined && moved < TAP_SLOP_PX && !onScissors) {
                editing.onTap?.();
              }
            }
          : undefined
      }
    >
      <div
        ref={sheetRef}
        className={`page-sheet${editing ? ' editing' : ''}${view.scale > 1 ? ' zoomed' : ''}${panning ? ' panning' : ''}`}
        style={
          {
            '--page-ratio': pageSize.widthIn / pageSize.heightIn,
            transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
          } as CSSProperties
        }
        onDoubleClick={handleDoubleClick}
        {...(editing ? sheetDrag : panDrag)}
      >
        {paintOrder.map(({ panel, i }) => {
          const r = rects[i];
          const selected = selection?.panelId === panel.id;
          return (
            <div
              key={panel.id}
              className={`page-panel${selected ? ' selected' : ''}`}
              style={{
                left: `${r.x}%`,
                top: `${r.y}%`,
                width: `${r.width}%`,
                height: `${r.height}%`,
              }}
            >
              <PanelView
                panel={panel}
                number={editing ? i + 1 : undefined}
                editing={
                  selected && editing
                    ? {
                        selectedLayerId: selection.layerId ?? null,
                        selectedBubbleId: selection.bubbleId ?? null,
                        onSelectBubble: (bubbleId) =>
                          editing.onSelect({ panelId: panel.id, bubbleId }),
                      }
                    : undefined
                }
              />
            </div>
          );
        })}

        {editing &&
          selectedPanel &&
          (['horizontal', 'vertical'] as const).map((axis) => (
            <CutHandle
              key={`${selectedPanel.id}-${axis}`}
              axis={axis}
              rect={rects[page.panels.indexOf(selectedPanel)]}
              sheetRef={sheetRef}
              onCut={(position) => {
                cb().panels.split(selectedPanel.id, axis, position);
                editing.onSelect({ panelId: selectedPanel.id });
              }}
            />
          ))}

        {dividers.map((divider) => (
          <DividerHandle
            key={`${divider.orientation}-${divider.panelIndex}-${divider.edge}`}
            divider={divider}
            committed={committed}
            sheetRef={sheetRef}
            onPreview={setResizePreview}
            onCommit={(value) =>
              cb().panels.resize(page.panels[divider.panelIndex].id, divider.edge, value)
            }
          />
        ))}
      </div>
    </div>
  );
}
