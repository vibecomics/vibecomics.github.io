import type { ReactNode } from 'react';
import BottomSheet from './BottomSheet';
import type { Snap } from './sheetSnaps';

interface Props {
  /** True on a wide screen: the inspector is a pane; otherwise a bottom sheet. */
  wide: boolean;
  snap: Snap;
  onSnapChange: (snap: Snap) => void;
  /** What the sheet's handle bar says. */
  summary: ReactNode;
  children: ReactNode;
}

/**
 * Where the panel inspector lives: a pane on the right of the page on wide
 * screens, and a draggable bottom sheet on narrow ones. One instance is
 * rendered either way.
 */
export default function InspectorPane({ wide, snap, onSnapChange, summary, children }: Props) {
  return wide ? (
    <aside className="inspector col-md-4 col-xl-3 bg-body border-start overflow-auto">
      {children}
    </aside>
  ) : (
    <BottomSheet snap={snap} onSnapChange={onSnapChange} title={summary}>
      {children}
    </BottomSheet>
  );
}
