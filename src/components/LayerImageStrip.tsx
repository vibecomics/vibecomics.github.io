import { useState } from 'react';
import type { MediaItem } from '../types/comic';
import { useElementSize } from '../utils/useElementSize';
import MediaThumb from './MediaThumb';
import Spinner from './Spinner';

const THUMB = 64;
const GAP = 8;
const MIN_STEP = 22;

export interface LayerImage {
  item: MediaItem;
  /** Whether this is the layer's current image (the rest are its history). */
  current: boolean;
}

interface Props {
  /** Every image this layer (or background) has, in a fixed order; the current one is flagged. */
  images: LayerImage[];
  busy: boolean;
  /** Label for the trailing "+" tile, e.g. "Add background image". */
  addLabel: string;
  /** Makes this image the layer's current one. */
  onSelect: (id: string) => void;
  /** Unlinks this one image from the layer — the current image is cleared (it moves to history), a
   * history image is dropped from history — without deleting it from the project. */
  onUnlink: (id: string) => void;
  /** Opens the media picker, to add a new image some other way (upload, pick existing art). */
  onAdd: () => void;
}

/**
 * Every image a layer (or background) has — its current image plus its history — as one row: side
 * by side when they fit, overlapping like a fanned hand of cards when they don't (measured against
 * the row's own width, via useElementSize). Hovering a thumbnail brings it to the front, so an
 * overlapped one is never stuck unreachable behind its neighbor. Click a thumbnail to make it the
 * layer's current image; its own corner button unlinks it from the layer without touching the
 * project's media registry (contrast a straight delete, which would remove it everywhere it's
 * used). A trailing "+" tile opens the media picker to add or change the image some other way.
 */
export default function LayerImageStrip({
  images,
  busy,
  addLabel,
  onSelect,
  onUnlink,
  onAdd,
}: Props) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const slots = images.length + 1; // the trailing "+" tile takes a slot too
  const natural = THUMB * slots + GAP * (slots - 1);
  const step =
    slots <= 1 || size.width === 0 || natural <= size.width
      ? THUMB + GAP
      : Math.max(MIN_STEP, (size.width - THUMB) / (slots - 1));

  return (
    <div ref={ref} className="layer-image-strip" style={{ height: THUMB }}>
      {images.map(({ item, current }, i) => (
        <div
          key={item.id}
          className={current ? 'layer-image-strip-slot is-current' : 'layer-image-strip-slot'}
          style={{ left: i * step, zIndex: hoveredId === item.id ? images.length + 1 : i }}
          onMouseEnter={() => setHoveredId(item.id)}
          onMouseLeave={() => setHoveredId((id) => (id === item.id ? null : id))}
        >
          <MediaThumb
            item={item}
            width={THUMB}
            onOpen={() => onSelect(item.id)}
            openTitle={
              current
                ? `${item.name} — this layer's current image`
                : `Use "${item.name}" as this layer's image`
            }
            openCursor="pointer"
            onRemove={() => onUnlink(item.id)}
            removeGlyph="🔗"
            removeTitle="Unlink this image from the layer (it stays in the project)"
          />
        </div>
      ))}
      <button
        type="button"
        className="layer-image-strip-add checker"
        style={{ left: images.length * step, width: THUMB, height: THUMB, zIndex: images.length }}
        disabled={busy}
        title={addLabel}
        aria-label={addLabel}
        onClick={onAdd}
      >
        {busy ? <Spinner /> : '+'}
      </button>
    </div>
  );
}
