import { cb } from '../ai/actions';
import type { Layer, MediaItem } from '../types/comic';
import { usePointerDrag } from '../utils/drag';
import type { Point } from '../utils/dragGhost';
import LayerDetails from './LayerDetails';
import { DeleteButton, ExpandButton } from './RowButtons';

interface Reorder {
  begin: (point: Point) => void;
  update: (point: Point) => void;
  commit: () => void;
  cancel: () => void;
  dragging: boolean;
}

interface Props {
  panelId: string;
  layer: Layer;
  media: MediaItem[];
  /** Highlighted on the page. */
  selected: boolean;
  /** Showing its details here. */
  expanded: boolean;
  onSelect: () => void;
  onToggleExpanded: () => void;
  rowRef?: (element: HTMLElement | null) => void;
  /** Present for layers that can be reordered by dragging the ≡ handle. */
  reorder?: Reorder;
}

/** One layer: click its name to select it on the page, the chevron to show or hide its details. */
export default function LayerRow({
  panelId,
  layer,
  media,
  selected,
  expanded,
  onSelect,
  onToggleExpanded,
  rowRef,
  reorder,
}: Props) {
  const handle = usePointerDrag<object>({
    start: (event) => {
      reorder?.begin(event);
      return reorder ? {} : null;
    },
    move: (event) => reorder?.update(event),
    end: () => reorder?.commit(),
    cancel: () => reorder?.cancel(),
  });
  const background = layer.kind === 'background';

  return (
    <div
      ref={rowRef}
      className={`border rounded p-2 mb-2${selected ? ' border-primary' : ''}${reorder?.dragging ? ' opacity-50' : ''}`}
    >
      <div className="d-flex align-items-center gap-2">
        {reorder && (
          <span
            className="text-muted px-1"
            style={{ cursor: 'grab', touchAction: 'none', userSelect: 'none' }}
            title="Drag to reorder"
            aria-label={`Reorder ${layer.name}`}
            {...handle}
          >
            ≡
          </span>
        )}
        <ExpandButton expanded={expanded} label={layer.name} onClick={onToggleExpanded} />
        <input
          type="checkbox"
          className="form-check-input mt-0"
          checked={layer.visible}
          title="Show or hide"
          aria-label={`Show ${layer.name}`}
          onChange={(e) => cb().layers.update(panelId, layer.id, { visible: e.target.checked })}
        />
        <button
          className="btn btn-link btn-sm p-0 text-start text-truncate flex-grow-1 text-decoration-none"
          onClick={onSelect}
        >
          {background ? 'Background' : layer.name}
          {(background || !layer.src) && (
            <span className="text-muted ms-2">{layer.src ? layer.name : 'no image'}</span>
          )}
        </button>
        <DeleteButton
          label={background ? 'background' : layer.name}
          onClick={() => cb().layers.delete(panelId, layer.id)}
        />
      </div>
      {expanded && <LayerDetails panelId={panelId} layer={layer} media={media} />}
    </div>
  );
}
