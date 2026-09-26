import { useRef } from 'react';
import type { RefObject } from 'react';
import type { LayerPatch } from '../ai/deps';
import type { Layer } from '../types/comic';
import { usePointerDrag } from '../utils/drag';
import { CORNERS, clamp, pointerPercent, round1 } from '../utils/geometry';
import type { Point } from '../utils/geometry';
import CornerHandle from './CornerHandle';
import { FlipIcon } from './Icons';
import { useDriveImage } from './useDriveImage';

interface LayerEditing {
  selected: boolean;
  /** Show a change while dragging, without touching the project. */
  onPreview: (patch: LayerPatch) => void;
  onCommit: (patch: LayerPatch) => void;
  onFlip: () => void;
}

interface Props {
  layer: Layer;
  canvasRef: RefObject<HTMLDivElement | null>;
  editing?: LayerEditing;
  /**
   * Draws only the outline and handles, with the image invisible. Pairs with a
   * clipped copy of the layer so the selected layer's handles stay reachable
   * outside the panel while its image is still clipped.
   */
  controlsOnly?: boolean;
}

const SNAP_DEGREES = 15;
const SNAP_TOLERANCE = 3;

/** Turns the selected layer about its centre; snaps to multiples of 15°. */
function RotateHandle({
  boxRef,
  editing,
}: {
  boxRef: RefObject<HTMLDivElement | null>;
  editing: LayerEditing;
}) {
  const drag = usePointerDrag<{ latest?: LayerPatch }>({
    start: () => ({}),
    move: (event, state) => {
      const box = boxRef.current!.getBoundingClientRect();
      const angle =
        (Math.atan2(
          event.clientY - (box.top + box.bottom) / 2,
          event.clientX - (box.left + box.right) / 2
        ) *
          180) /
          Math.PI +
        90;
      const nearest = Math.round(angle / SNAP_DEGREES) * SNAP_DEGREES;
      const snapped = Math.abs(angle - nearest) < SNAP_TOLERANCE ? nearest : angle;
      const rotation = ((((snapped + 180) % 360) + 360) % 360) - 180;
      state.latest = { rotation: Math.round(rotation) };
      editing.onPreview(state.latest);
    },
    end: (_, state) => state.latest && editing.onCommit(state.latest),
  });
  return <div className="rotate-handle" title="Rotate" {...drag} />;
}

/**
 * One layer of a panel. A background fills the panel without stretching; a
 * foreground layer is a box at x/y/width whose height follows its image. While
 * editing, a layer without an image shows a dashed placeholder, and the
 * selected layer can be dragged to move, resized by its corners, and turned
 * by its rotate handle.
 */
export default function LayerBox({ layer, canvasRef, editing, controlsOnly }: Props) {
  const src = useDriveImage(layer.src);
  const boxRef = useRef<HTMLDivElement>(null);

  const toPanel = (event: { clientX: number; clientY: number }) =>
    pointerPercent(canvasRef.current!, event);

  const moveDrag = usePointerDrag<{ from: Point; x: number; y: number; latest?: LayerPatch }>({
    start: (event) => (editing?.selected ? { from: toPanel(event), x: layer.x, y: layer.y } : null),
    move: (event, state) => {
      const at = toPanel(event);
      state.latest = {
        x: round1(state.x + at.x - state.from.x),
        y: round1(state.y + at.y - state.from.y),
      };
      editing?.onPreview(state.latest);
    },
    end: (_, state) => state.latest && editing?.onCommit(state.latest),
  });

  if (layer.kind === 'background') {
    return src ? (
      <img
        src={src}
        alt={layer.name}
        className="panel-layer background"
        style={{ opacity: layer.opacity, transform: layer.flipX ? 'scaleX(-1)' : undefined }}
        draggable={false}
      />
    ) : null;
  }
  if (!src && !editing) return null;

  /** Scale about the box's centre by how much farther the pointer is from it than at the start. */
  const distanceFromCentre = (event: { clientX: number; clientY: number }, centre: Point) => {
    const canvas = canvasRef.current!.getBoundingClientRect();
    const at = toPanel(event);
    return Math.hypot(
      ((at.x - centre.x) * canvas.width) / 100,
      ((at.y - centre.y) * canvas.height) / 100
    );
  };

  return (
    <div
      ref={boxRef}
      data-layer-id={layer.id}
      className={`panel-layer-box${editing?.selected ? ' selected' : ''}${controlsOnly ? ' controls-only' : ''}`}
      style={{
        left: `${layer.x}%`,
        top: `${layer.y}%`,
        width: `${layer.width}%`,
        transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
      }}
      {...moveDrag}
    >
      {src ? (
        <img
          src={src}
          alt={layer.name}
          className="panel-layer"
          style={{ opacity: layer.opacity, transform: layer.flipX ? 'scaleX(-1)' : undefined }}
          draggable={false}
        />
      ) : (
        <div className="layer-placeholder" style={{ aspectRatio: layer.aspectRatio ?? 1 }}>
          {layer.prompt || layer.name}
        </div>
      )}
      {editing?.selected && <RotateHandle boxRef={boxRef} editing={editing} />}
      {editing?.selected && (
        <button
          type="button"
          className="flip-handle"
          title="Flip horizontally"
          aria-label="Flip horizontally"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={editing.onFlip}
        >
          <FlipIcon />
        </button>
      )}
      {editing?.selected &&
        CORNERS.map((corner) => (
          <CornerHandle
            key={corner}
            corner={corner}
            start={(event) => {
              const canvas = canvasRef.current!.getBoundingClientRect();
              const height = (boxRef.current!.offsetHeight / canvas.height) * 100;
              const centre = { x: layer.x + layer.width / 2, y: layer.y + height / 2 };
              return {
                centre,
                height,
                width: layer.width,
                distance: distanceFromCentre(event, centre) || 1,
                latest: undefined as LayerPatch | undefined,
              };
            }}
            move={(event, state) => {
              const width = clamp(
                state.width * (distanceFromCentre(event, state.centre) / state.distance),
                5,
                300
              );
              const height = (state.height * width) / state.width;
              state.latest = {
                width: round1(width),
                x: round1(state.centre.x - width / 2),
                y: round1(state.centre.y - height / 2),
              };
              editing.onPreview(state.latest);
            }}
            end={(_, state) => state.latest && editing.onCommit(state.latest)}
          />
        ))}
    </div>
  );
}
