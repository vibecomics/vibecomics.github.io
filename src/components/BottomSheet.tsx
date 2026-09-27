import { useState } from 'react';
import type { ReactNode } from 'react';
import { usePointerDrag } from '../utils/drag';
import { clamp } from '../utils/geometry';
import { useViewportHeight } from '../utils/useViewport';
import { SNAPS } from './sheetSnaps';
import type { Snap } from './sheetSnaps';

/** A press that moves less than this many pixels is a tap, not a drag. */
const TAP_SLOP_PX = 5;
/** Dragging this far (as a fraction of the gap) toward the next height moves the sheet there. */
const SETTLE_FRACTION = 0.3;

interface Props {
  /** The height it rests at; the owner holds this so other parts of the screen can close the sheet. */
  snap: Snap;
  onSnapChange: (snap: Snap) => void;
  /** Always visible on the handle bar. */
  title: ReactNode;
  children: ReactNode;
}

/**
 * A sheet docked under its neighbour, with three heights: closed (just the
 * handle bar), half and full. Drag the handle bar to resize it (on release it settles on a
 * height), or tap it to open or close. The neighbour takes whatever room is left.
 */
export default function BottomSheet({ snap, onSnapChange: setSnap, title, children }: Props) {
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const viewport = useViewportHeight();

  const half = Math.min(viewport * 0.4, 320);
  // Leave the page a usable strip above the sheet.
  const full = Math.max(half, Math.min(viewport * 0.6, viewport - 380));
  const heights: Record<Snap, number> = { closed: 0, half, full };
  const height = dragHeight ?? heights[snap];

  const heightAfter = (drag: { startY: number; startHeight: number }, clientY: number) =>
    clamp(drag.startHeight + drag.startY - clientY, 0, full);
  /** Where a drag that started at `from` and ended at height `h` settles: past 30% of the way to the next height moves there. */
  const settle = (from: Snap, h: number): Snap => {
    let i = SNAPS.indexOf(from);
    const up = h > heights[from];
    while (up && i < SNAPS.length - 1) {
      const gap = heights[SNAPS[i + 1]] - heights[SNAPS[i]];
      if (h < heights[SNAPS[i]] + gap * SETTLE_FRACTION) break;
      i++;
    }
    while (!up && i > 0) {
      const gap = heights[SNAPS[i]] - heights[SNAPS[i - 1]];
      if (h > heights[SNAPS[i]] - gap * SETTLE_FRACTION) break;
      i--;
    }
    return SNAPS[i];
  };

  const drag = usePointerDrag<{ startY: number; startHeight: number; moved: boolean }>({
    start: (event) => ({ startY: event.clientY, startHeight: heights[snap], moved: false }),
    move: (event, state) => {
      if (Math.abs(event.clientY - state.startY) > TAP_SLOP_PX) state.moved = true;
      if (state.moved) setDragHeight(heightAfter(state, event.clientY));
    },
    end: (event, state) => {
      if (state.moved) setSnap(settle(snap, heightAfter(state, event.clientY)));
      else setSnap(snap === 'closed' ? 'half' : 'closed');
      setDragHeight(null);
    },
    cancel: () => setDragHeight(null),
  });

  return (
    <div className="border-top bg-body shadow-sm">
      <div
        className="px-3 pt-1 pb-2"
        style={{ touchAction: 'none', cursor: 'grab' }}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Drag to resize the panel sheet"
        {...drag}
      >
        <span
          className="d-block mx-auto mb-1 bg-secondary-subtle rounded-pill"
          style={{ width: 36, height: 4 }}
        />
        <span className="d-block fw-semibold text-truncate">{title}</span>
      </div>
      <div
        id="bottom-sheet-body"
        className={`sheet-body${dragHeight !== null ? ' dragging' : ''}${height === 0 ? ' closed' : ''}`}
        style={{ height }}
        inert={height === 0}
      >
        <div className="inspector">{children}</div>
      </div>
    </div>
  );
}
