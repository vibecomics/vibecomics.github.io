import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MediaItem } from '../types/comic';
import { TrashIcon } from './Icons';
import { loadBlobUrl } from './mediaImages';

interface Props {
  items: MediaItem[];
  /** Index of the image to open on. */
  start: number;
  onClose: () => void;
  /** Deletes the image outright (not just from whatever list opened this lightbox). Omit to hide the
   * delete button, e.g. where the caller has no way to remove media. */
  onDelete?: (item: MediaItem) => void;
}

/** A full-size popup over the page for a set of images, with prev/next arrows when there are several. */
export default function ImageLightbox({ items, start, onClose, onDelete }: Props) {
  const [index, setIndex] = useState(Math.min(start, items.length - 1));
  const [loaded, setLoaded] = useState<{ id: string; url: string | null } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const item = items[index];
  const many = items.length > 1;

  function step(by: number) {
    setIndex((i) => (i + by + items.length) % items.length);
  }

  useEffect(() => {
    if (!item) return;
    let current = true;
    loadBlobUrl(item).then(
      (url) => current && setLoaded({ id: item.id, url }),
      () => current && setLoaded({ id: item.id, url: null })
    );
    return () => {
      current = false;
    };
  }, [item]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') setIndex((i) => (i - 1 + items.length) % items.length);
      else if (e.key === 'ArrowRight') setIndex((i) => (i + 1) % items.length);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items.length, onClose]);

  // The entry can lose images while the popup is open (removed elsewhere): close when none are left.
  useEffect(() => {
    if (!item) onClose();
  }, [item, onClose]);

  if (!item) return null;
  const state = loaded?.id === item.id ? loaded : null;

  return createPortal(
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={item.name}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <button
        ref={closeRef}
        type="button"
        className="lightbox-btn lightbox-close"
        aria-label="Close"
        title="Close"
        onClick={onClose}
      >
        &times;
      </button>
      {onDelete && (
        <button
          type="button"
          className="lightbox-btn lightbox-delete"
          aria-label={`Delete ${item.name}`}
          title="Delete this image"
          onClick={() => onDelete(item)}
        >
          <TrashIcon />
        </button>
      )}
      {many && (
        <button
          type="button"
          className="lightbox-btn lightbox-prev"
          aria-label="Previous image"
          title="Previous image"
          onClick={() => step(-1)}
        >
          &lsaquo;
        </button>
      )}
      {state?.url ? (
        <img className="lightbox-img" src={state.url} alt={item.name} />
      ) : (
        <div className="lightbox-status">{state ? 'Could not load image' : 'Loading…'}</div>
      )}
      {many && (
        <button
          type="button"
          className="lightbox-btn lightbox-next"
          aria-label="Next image"
          title="Next image"
          onClick={() => step(1)}
        >
          &rsaquo;
        </button>
      )}
      <div className="lightbox-caption">
        {item.name}
        {many && ` (${index + 1} / ${items.length})`}
      </div>
    </div>,
    document.body
  );
}
