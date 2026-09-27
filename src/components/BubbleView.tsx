import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { BubblePatch } from '../ai/deps';
import type { Bubble } from '../types/comic';
import { usePointerDrag } from '../utils/drag';
import { CORNERS, clamp, pointerPercent, resizeBox, round1 } from '../utils/geometry';
import type { Point } from '../utils/geometry';
import { burstPoints, pointerShape } from './bubbleShape';
import CornerHandle from './CornerHandle';

const INK = '#111';
const MIN_FONT_PX = 5;
const MAX_FONT_PX = 60;
/** Padding as a share of the bubble's own size; a thought bubble's text must fit inside its ellipse. */
const PADDING: Record<Bubble['kind'], [x: number, y: number]> = {
  speech: [0.05, 0.06],
  thought: [0.16, 0.14],
  shout: [0.21, 0.21],
  caption: [0.04, 0.06],
};

interface BubbleEditing {
  selected: boolean;
  onSelect: () => void;
  /** Show a change while dragging, without touching the project. */
  onPreview: (patch: BubblePatch) => void;
  onCommit: (patch: BubblePatch) => void;
}

interface Props {
  bubble: Bubble;
  canvasRef: RefObject<HTMLDivElement | null>;
  canvasSize: { width: number; height: number };
  editing?: BubbleEditing;
}

/** Set the largest font size at which the text still fits inside the bubble. */
function fitText(box: HTMLElement, text: HTMLElement, kind: Bubble['kind']) {
  const [padX, padY] = PADDING[kind].map(
    (share, i) => share * (i ? box.offsetHeight : box.offsetWidth)
  );
  box.style.padding = `${padY}px ${padX}px`;
  const availableHeight = box.clientHeight - 2 * padY;
  if (availableHeight <= 0) return;

  let low = MIN_FONT_PX;
  let high = MAX_FONT_PX;
  for (let i = 0; i < 9; i++) {
    const size = (low + high) / 2;
    box.style.fontSize = `${size}px`;
    if (text.offsetHeight <= availableHeight) low = size;
    else high = size;
  }
  box.style.fontSize = `${low}px`;
}

/** Draws the wedge (speech, shout) or trail of circles (thought) from a bubble to its pointer tip. */
function Pointer({ bubble, canvasSize }: { bubble: Bubble; canvasSize: Props['canvasSize'] }) {
  if (bubble.kind === 'caption' || bubble.tailX === undefined || bubble.tailY === undefined) {
    return null;
  }
  const tip = {
    x: (bubble.tailX / 100) * canvasSize.width,
    y: (bubble.tailY / 100) * canvasSize.height,
  };
  const shape = pointerShape(
    {
      x: (bubble.x / 100) * canvasSize.width,
      y: (bubble.y / 100) * canvasSize.height,
      width: (bubble.width / 100) * canvasSize.width,
      height: (bubble.height / 100) * canvasSize.height,
    },
    tip,
    bubble.kind === 'shout'
  );
  if (!shape) return null;

  const path = (points: Point[]) => points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
  return (
    <svg
      className="bubble-pointer"
      width={canvasSize.width}
      height={canvasSize.height}
      aria-hidden="true"
    >
      {bubble.kind !== 'thought' ? (
        <>
          <path
            d={`${path([shape.inner[0], shape.base[0], tip, shape.base[1], shape.inner[1]])} Z`}
            fill="#fff"
          />
          <path
            d={path([shape.base[0], tip, shape.base[1]])}
            fill="none"
            stroke={INK}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        </>
      ) : (
        [0.3, 0.62, 0.9].map((t, i) => (
          <circle
            key={t}
            cx={shape.edge.x + (tip.x - shape.edge.x) * t}
            cy={shape.edge.y + (tip.y - shape.edge.y) * t}
            r={[7, 5, 3.5][i]}
            fill="#fff"
            stroke={INK}
            strokeWidth={2}
          />
        ))
      )}
    </svg>
  );
}

/** The spiky outline of a shout, stretched over the bubble's box. */
function Burst() {
  const points = burstPoints()
    .map((p) => `${p.x},${p.y}`)
    .join(' ');
  return (
    <svg
      className="bubble-burst"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polygon
        points={points}
        fill="#fff"
        stroke={INK}
        strokeWidth={2.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * One bubble of a panel; its text is scaled to fit. When editable, the bubble
 * can be dragged and resized by its corners, and its pointer tip dragged too.
 */
export default function BubbleView({ bubble, canvasRef, canvasSize, editing }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  const width = (bubble.width / 100) * canvasSize.width;
  const height = (bubble.height / 100) * canvasSize.height;
  useLayoutEffect(() => {
    if (boxRef.current && textRef.current && width > 0)
      fitText(boxRef.current, textRef.current, bubble.kind);
  }, [bubble.text, bubble.kind, width, height]);

  const toPanel = (event: { clientX: number; clientY: number }) =>
    pointerPercent(canvasRef.current!, event);

  const moveDrag = usePointerDrag<{ from: Point; latest?: BubblePatch }>({
    start: (event) => {
      if (!editing) return null;
      editing.onSelect();
      return { from: toPanel(event) };
    },
    move: (event, state) => {
      const at = toPanel(event);
      state.latest = {
        x: clamp(round1(bubble.x + at.x - state.from.x), 0, 100 - bubble.width),
        y: clamp(round1(bubble.y + at.y - state.from.y), 0, 100 - bubble.height),
      };
      state.from = at;
      editing?.onPreview({ ...state.latest });
    },
    end: (_, state) => state.latest && editing?.onCommit(state.latest),
  });

  const tailDrag = usePointerDrag<{ latest?: BubblePatch }>({
    start: () => (editing ? {} : null),
    move: (event, state) => {
      const at = toPanel(event);
      state.latest = { tailX: clamp(round1(at.x), 0, 100), tailY: clamp(round1(at.y), 0, 100) };
      editing?.onPreview(state.latest);
    },
    end: (_, state) => state.latest && editing?.onCommit(state.latest),
  });

  const hasPointer =
    bubble.kind !== 'caption' && bubble.tailX !== undefined && bubble.tailY !== undefined;

  return (
    <>
      <div
        ref={boxRef}
        className={`bubble ${bubble.kind}${editing ? ' editable' : ''}${editing?.selected ? ' selected' : ''}`}
        style={{
          left: `${bubble.x}%`,
          top: `${bubble.y}%`,
          width: `${bubble.width}%`,
          height: `${bubble.height}%`,
        }}
        {...moveDrag}
      >
        {bubble.kind === 'shout' && <Burst />}
        <span ref={textRef} className="bubble-text">
          {bubble.text}
        </span>
        {editing?.selected &&
          CORNERS.map((corner) => (
            <CornerHandle
              key={corner}
              corner={corner}
              start={(event) => ({
                from: toPanel(event),
                box: { x: bubble.x, y: bubble.y, width: bubble.width, height: bubble.height },
                latest: undefined as BubblePatch | undefined,
              })}
              move={(event, state) => {
                const at = toPanel(event);
                state.latest = resizeBox(
                  state.box,
                  corner,
                  at.x - state.from.x,
                  at.y - state.from.y
                );
                editing.onPreview(state.latest);
              }}
              end={(_, state) => state.latest && editing.onCommit(state.latest)}
            />
          ))}
      </div>
      <Pointer bubble={bubble} canvasSize={canvasSize} />
      {editing?.selected && hasPointer && (
        <div
          className="tail-handle"
          style={{ left: `${bubble.tailX}%`, top: `${bubble.tailY}%` }}
          title="Aim the pointer"
          {...tailDrag}
        />
      )}
    </>
  );
}
