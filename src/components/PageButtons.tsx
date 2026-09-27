import { useRef, useState } from 'react';
import type { Ref } from 'react';
import { cb } from '../ai/actions';
import type { ComicPage } from '../types/comic';
import { usePointerDrag } from '../utils/drag';
import { useDragGhost } from '../utils/dragGhost';
import type { Point } from '../utils/dragGhost';
import { moved, slotAt } from '../utils/reorder';
import ConflictDot from './ConflictDot';

/** Pixels a press must move before it is a drag; less, and it is a click that selects the page. */
const DRAG_SLOP_PX = 5;

interface ButtonProps {
  page: ComicPage;
  index: number;
  selected: boolean;
  className: string;
  /** The direction the buttons are laid out in: 'y' for the side rail, 'x' for the footer. */
  axis: 'x' | 'y';
  /** Where the button is shown, while pages are being reordered. */
  order: number;
  dragging: boolean;
  /** False for the cover, which stays first. */
  movable: boolean;
  /** True when something on this page clashes with changes made elsewhere. */
  conflicted: boolean;
  buttonRef: Ref<HTMLButtonElement>;
  reorder: {
    begin: (point: Point) => void;
    update: (point: Point) => void;
    commit: () => void;
    cancel: () => void;
  };
}

function PageButton({
  page,
  index,
  selected,
  className,
  axis,
  order,
  dragging,
  movable,
  conflicted,
  buttonRef,
  reorder,
}: ButtonProps) {
  // The click that ends a drag must not also select the page.
  const wasDragged = useRef(false);
  const handlers = usePointerDrag<{ x: number; y: number; active: boolean }>({
    start: (event) => (movable ? { x: event.clientX, y: event.clientY, active: false } : null),
    move: (event, state) => {
      if (!state.active) {
        if (Math.hypot(event.clientX - state.x, event.clientY - state.y) < DRAG_SLOP_PX) return;
        state.active = true;
        reorder.begin(event);
      }
      reorder.update(event);
    },
    end: (_, state) => {
      if (!state.active) return;
      wasDragged.current = true;
      reorder.commit();
    },
    cancel: reorder.cancel,
  });

  return (
    <button
      ref={buttonRef}
      title={page.title || undefined}
      className={`btn btn-sm position-relative ${selected ? 'btn-dark' : 'btn-outline-secondary'} ${className}${dragging ? ' opacity-50' : ''}`}
      style={{
        order,
        cursor: dragging ? 'grabbing' : undefined,
        // On the side rail a finger drags the page instead of scrolling the rail. The footer keeps
        // scrolling sideways under a finger; there, use the move buttons above the page.
        touchAction: movable && axis === 'y' ? 'none' : undefined,
      }}
      {...handlers}
      onPointerDown={(event) => {
        wasDragged.current = false;
        handlers.onPointerDown(event);
      }}
      onClick={() => {
        if (wasDragged.current) wasDragged.current = false;
        else cb().page.select(index);
      }}
    >
      {page.number}
      {conflicted && <ConflictDot className="position-absolute" style={{ top: 2, right: 2 }} />}
    </button>
  );
}

interface Props {
  pages: ComicPage[];
  pageIndex: number;
  className: string;
  axis: 'x' | 'y';
  /** Pages (by id) with a conflict: their button gets a dot. */
  conflictPageIds: Set<string>;
}

/**
 * The page number buttons. Click one to show the page; drag one along the row to
 * move the page (the cover, page 0, stays first). Buttons keep their place in the
 * DOM while one is dragged (moving it would drop the pointer capture); `order`
 * shows the new sequence.
 */
export default function PageButtons({ pages, pageIndex, className, axis, conflictPageIds }: Props) {
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null);
  const buttons = useRef(new Map<string, HTMLElement>());
  const midpoints = useRef<Array<{ id: string; mid: number }>>([]);
  const ghost = useDragGhost();

  const movable = pages.slice(1);
  const shown = drag ? [pages[0], ...moved(movable, drag.id, drag.over)] : pages;

  function begin(id: string, point: Point) {
    midpoints.current = movable.map((page) => {
      const box = buttons.current.get(page.id)!.getBoundingClientRect();
      return {
        id: page.id,
        mid: axis === 'y' ? (box.top + box.bottom) / 2 : (box.left + box.right) / 2,
      };
    });
    ghost.start(buttons.current.get(id)!, point);
    setDrag({ id, over: movable.findIndex((page) => page.id === id) });
  }

  function update(id: string, point: Point) {
    ghost.move(point);
    const pointer = axis === 'y' ? point.clientY : point.clientX;
    const others = midpoints.current.filter((entry) => entry.id !== id);
    setDrag({
      id,
      over: slotAt(
        others.map((entry) => entry.mid),
        pointer
      ),
    });
  }

  function cancel() {
    ghost.stop();
    setDrag(null);
  }

  function commit() {
    if (drag) {
      const from = pages.findIndex((page) => page.id === drag.id);
      const to = drag.over + 1; // over counts the pages after the cover
      if (to !== from) cb().page.move(from, to);
    }
    cancel();
  }

  return pages.map((page, index) => (
    <PageButton
      key={page.id}
      page={page}
      index={index}
      selected={index === pageIndex}
      className={className}
      axis={axis}
      order={shown.indexOf(page)}
      dragging={drag?.id === page.id}
      movable={index > 0}
      conflicted={conflictPageIds.has(page.id)}
      buttonRef={(element) => {
        if (element) buttons.current.set(page.id, element);
        else buttons.current.delete(page.id);
      }}
      reorder={{
        begin: (point) => begin(page.id, point),
        update: (point) => update(page.id, point),
        commit,
        cancel,
      }}
    />
  ));
}
