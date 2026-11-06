import { useRef, useState } from 'react';
import { cb } from '../ai/actions';
import { useDragGhost } from '../utils/dragGhost';
import type { Point } from '../utils/dragGhost';
import { moved, slotAt } from '../utils/reorder';
import type { MediaItem, Panel } from '../types/comic';
import AccordionItem from './AccordionItem';
import HelpSection from './HelpSection';
import LayerRow from './LayerRow';
import type { Selection } from './selection';
import type { Expansion } from './useExpansion';

interface Props {
  panel: Panel;
  media: MediaItem[];
  selection: Selection;
  onSelect: (selection: Selection) => void;
  expansion: Expansion;
  /** Whether the section's content is shown; it can be collapsed to just its heading. */
  open: boolean;
  onToggleOpen: () => void;
}

/** The panel's layers, top of the stack first. Drag a row's ≡ handle to reorder. */
export default function LayersSection({
  panel,
  media,
  selection,
  onSelect,
  expansion,
  open,
  onToggleOpen,
}: Props) {
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const midpoints = useRef<Array<{ id: string; mid: number }>>([]);
  const ghost = useDragGhost();

  const foreground = panel.layers.filter((layer) => layer.kind !== 'background');
  const topFirst = [...foreground].reverse();
  const allOpen = foreground.length > 0 && foreground.every((layer) => expansion.isOpen(layer.id));
  const shown = drag ? moved(topFirst, drag.id, drag.over) : topFirst;

  function begin(id: string, point: Point) {
    midpoints.current = topFirst.map((layer) => {
      const box = rows.current.get(layer.id)!.getBoundingClientRect();
      return { id: layer.id, mid: (box.top + box.bottom) / 2 };
    });
    ghost.start(rows.current.get(id)!, point);
    setDrag({ id, over: topFirst.findIndex((layer) => layer.id === id) });
  }

  function update(id: string, point: Point) {
    ghost.move(point);
    const others = midpoints.current.filter((row) => row.id !== id);
    setDrag({
      id,
      over: slotAt(
        others.map((row) => row.mid),
        point.clientY
      ),
    });
  }

  function cancel() {
    ghost.stop();
    setDrag(null);
  }

  function commit() {
    if (drag) {
      const from = topFirst.findIndex((layer) => layer.id === drag.id);
      if (drag.over !== from) {
        const slot = foreground[foreground.length - 1 - drag.over];
        cb().layers.move(panel.id, drag.id, panel.layers.indexOf(slot));
      }
    }
    cancel();
  }

  /** Add an empty layer, open it, and let the user type its prompt; the image comes after. */
  function addLayer() {
    const layer = cb().layers.add(panel.id, {
      name: `Layer ${foreground.length + 1}`,
      prompt: '',
      aspectRatio: 1,
      x: 25,
      y: 25,
      width: 50,
    });
    onSelect({ panelId: panel.id, layerId: layer.id });
    expansion.setAll([layer.id], true);
  }

  return (
    <AccordionItem title="Layers" open={open} onToggle={onToggleOpen}>
      {foreground.length === 0 && (
        <HelpSection title="What are layers?" open>
          <p className="mb-0">
            The characters, props and effects placed on this panel. Stacked from the bottom up, each
            one can be moved, resized and reused.
          </p>
        </HelpSection>
      )}
      <div className="d-flex justify-content-between align-items-center my-2">
        <button className="btn btn-outline-secondary btn-sm" onClick={addLayer}>
          Add layer
        </button>
        {foreground.length > 0 && (
          <button
            className="btn btn-link btn-sm p-0 text-decoration-none flex-shrink-0"
            onClick={() =>
              expansion.setAll(
                foreground.map((l) => l.id),
                !allOpen
              )
            }
          >
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        )}
      </div>
      {/* Rows keep their place in the DOM while one is dragged (moving it would drop the pointer capture); `order` shows the new sequence. */}
      <div className="d-flex flex-column">
        {topFirst.map((layer) => (
          <div key={layer.id} style={{ order: shown.indexOf(layer) }}>
            <LayerRow
              panelId={panel.id}
              layer={layer}
              media={media}
              selected={selection.layerId === layer.id}
              expanded={expansion.isOpen(layer.id)}
              onSelect={() =>
                onSelect({
                  panelId: panel.id,
                  layerId: selection.layerId === layer.id ? undefined : layer.id,
                })
              }
              onToggleExpanded={() => expansion.toggle(layer.id)}
              rowRef={(element) => {
                if (element) rows.current.set(layer.id, element);
                else rows.current.delete(layer.id);
              }}
              reorder={{
                begin: (point) => begin(layer.id, point),
                update: (point) => update(layer.id, point),
                commit,
                cancel,
                dragging: drag?.id === layer.id,
              }}
            />
          </div>
        ))}
      </div>
    </AccordionItem>
  );
}
