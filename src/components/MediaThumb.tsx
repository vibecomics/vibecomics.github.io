import type { ReactNode } from 'react';
import type { MediaItem } from '../types/comic';
import { useMediaUrl } from './useMediaUrl';

interface Props {
  item: MediaItem;
  onRemove: () => void;
  /** Called when the image itself is clicked (e.g. to enlarge it). */
  onOpen?: () => void;
  /** The image button's tooltip/aria-label when onOpen is given; defaults to "Enlarge {name}". Pass
   * something else when onOpen does something other than enlarging, e.g. "Use as this layer's
   * image". */
  openTitle?: string;
  /** The image button's cursor when onOpen is given; defaults to 'zoom-in' (a magnifying glass),
   * which only makes sense when onOpen actually enlarges the image. Pass 'pointer' or similar when
   * it does something else, e.g. selecting the image rather than viewing it bigger. */
  openCursor?: string;
  /** Width in px; defaults to 72. */
  width?: number;
  /** When true, no explicit height is set — the thumbnail stretches to fill its flex parent's
   * height instead of forcing a square, e.g. to match a sibling's height in a row. */
  fillHeight?: boolean;
  /** What the remove button shows; defaults to "×" (a plain removal from whatever list this
   * thumbnail is in). Pass something more specific, e.g. 🔗, where onRemove means something
   * more particular than a plain removal, such as unlinking an image from a layer. */
  removeGlyph?: ReactNode;
  /** The remove button's tooltip; defaults to "Remove from this entry". */
  removeTitle?: string;
}

/** A thumbnail of a media item (square by default), with a button to remove it. */
export default function MediaThumb({
  item,
  onRemove,
  onOpen,
  openTitle,
  openCursor = 'zoom-in',
  width = 72,
  fillHeight = false,
  removeGlyph = <>&times;</>,
  removeTitle = 'Remove from this entry',
}: Props) {
  const { url, failed, error } = useMediaUrl(item);

  return (
    <div className="position-relative" style={{ width, ...(fillHeight ? {} : { height: width }) }}>
      {url ? (
        <button
          type="button"
          className="p-0 border-0 bg-transparent w-100 h-100"
          style={{ cursor: onOpen ? openCursor : undefined }}
          aria-label={openTitle ?? `Enlarge ${item.name}`}
          title={openTitle}
          disabled={!onOpen}
          onClick={onOpen}
        >
          <img
            src={url}
            alt=""
            title={item.name}
            className="img-thumbnail w-100 h-100"
            style={{ objectFit: 'cover' }}
          />
        </button>
      ) : (
        <div
          className="border rounded w-100 h-100 d-flex align-items-center justify-content-center text-muted small"
          title={error ?? undefined}
        >
          {failed ? 'Failed' : '…'}
        </div>
      )}
      <button
        type="button"
        className="btn btn-light btn-sm position-absolute top-0 end-0 m-1 p-0 lh-1 rounded-circle border"
        style={{ width: 20, height: 20 }}
        aria-label={`${removeTitle}: ${item.name}`}
        title={removeTitle}
        onClick={onRemove}
      >
        {removeGlyph}
      </button>
    </div>
  );
}
