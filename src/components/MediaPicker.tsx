import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cb } from '../ai/actions';
import type { MediaItem } from '../types/comic';
import { errorMessage } from '../utils/errors';
import { ExternalIcon, TrashIcon } from './Icons';
import { openInNewTab } from './mediaImages';
import {
  groupMedia,
  MEDIA_BATCH_SIZE,
  firstOfGroups,
  initialCount,
  searchMedia,
  searchTextByMedia,
  subjectOf,
  type MediaShapePreference,
} from './mediaOrder';
import { useProject } from './ProjectContext';
import { useMediaInfos } from './useMediaInfos';
import { useSeen } from './useInView';
import { useMediaUrl } from './useMediaUrl';

interface Props {
  title: string;
  /** Every image uploaded to the project. */
  media: MediaItem[];
  /** Decides which images are listed first. */
  prefer: MediaShapePreference;
  /** The character or object the image is for: its art is listed first. */
  subjectId?: string;
  /** The image in use now, marked in the grid. */
  currentId?: string;
  onUpload: (file: File) => void;
  onPick: (item: MediaItem) => void;
  onClose: () => void;
}

interface TileProps {
  item: MediaItem;
  current: boolean;
  deleting: boolean;
  onPick: (item: MediaItem) => void;
  onPreview: (item: MediaItem) => void;
  onDelete: (item: MediaItem) => void;
}

function Tile({ item, current, deleting, onPick, onPreview, onDelete }: TileProps) {
  // The image is fetched only once its tile has scrolled into view.
  const [ref, seen] = useSeen<HTMLDivElement>();
  const { url, failed, error } = useMediaUrl(seen ? item : null);
  return (
    <div className="media-tile-wrap" ref={ref}>
      <button
        type="button"
        className={`media-tile${current ? ' current' : ''}`}
        aria-pressed={current}
        title={error ? `${item.name}: ${error}` : item.name}
        disabled={deleting}
        onClick={() => onPick(item)}
      >
        <span className="media-tile-image checker">
          {url ? (
            <img src={url} alt="" />
          ) : (
            <span className="text-muted small">{failed ? 'Failed' : '…'}</span>
          )}
        </span>
        <span className="media-tile-name">{item.name}</span>
      </button>
      <div className="media-tile-actions">
        <button
          type="button"
          className="btn btn-light btn-sm"
          aria-label={`Open ${item.name} in a new tab`}
          title="Open full size in a new tab"
          onClick={() => onPreview(item)}
        >
          <ExternalIcon />
        </button>
        <button
          type="button"
          className="btn btn-light btn-sm text-danger"
          aria-label={`Delete ${item.name}`}
          title="Delete this image"
          disabled={deleting}
          onClick={() => onDelete(item)}
        >
          {deleting ? (
            <span
              className="spinner-border spinner-border-sm"
              role="status"
              aria-label="Deleting"
            />
          ) : (
            <TrashIcon />
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * A popup showing every uploaded image as a thumbnail, so an image is picked by sight. Images that
 * suit `prefer` come first, more loading as the list is scrolled; a button uploads a new one. Each thumbnail can be
 * opened full size in a new tab or deleted. Picking or uploading closes the popup.
 */
export default function MediaPicker({
  title,
  media,
  prefer,
  subjectId,
  currentId,
  onUpload,
  onPick,
  onClose,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  // How many images are listed; null until the first list is known, then it only grows.
  const [count, setCount] = useState<number | null>(null);
  const more = useRef<HTMLDivElement>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const project = useProject();
  const { infos, ready } = useMediaInfos(media);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text), 150);
    return () => clearTimeout(timer);
  }, [text]);
  const searchText = useMemo(() => searchTextByMedia(project), [project]);
  const subject = useMemo(() => subjectOf(project, subjectId), [project, subjectId]);
  const found = searchMedia(media, searchText, query);
  // Until every image's shape is known the subject's art is listed first and the rest as they come;
  // then the rest is sorted into groups.
  const groups = groupMedia(found, ready ? infos : null, { ...prefer, subject });
  // Opens with the current image on screen; scrolling to the bottom lists more.
  const listed = count ?? initialCount(groups, currentId);
  const shown = firstOfGroups(groups, listed);
  const hasMore = listed < found.length;

  useEffect(() => {
    const end = more.current;
    if (!hasMore || !end || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setCount(listed + MEDIA_BATCH_SIZE);
      }
    });
    observer.observe(end);
    return () => observer.disconnect();
  }, [hasMore, listed]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  function pick(item: MediaItem) {
    onClose();
    onPick(item);
  }

  function preview(item: MediaItem) {
    try {
      setError(null);
      openInNewTab(item);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function remove(item: MediaItem) {
    const message = `Delete "${item.name}"? It moves to the Drive trash and is removed from every layer and reference that uses it.`;
    if (!window.confirm(message)) return;
    setError(null);
    setDeletingId(item.id);
    try {
      await cb().media.delete(item.id);
    } catch (e) {
      setError(`Could not delete: ${errorMessage(e)}`);
    } finally {
      setDeletingId(null);
    }
  }

  return createPortal(
    <>
      <div className="modal-backdrop show" />
      <div
        className="modal d-block"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="modal-dialog modal-lg modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="modal-title h5">{title}</h2>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            <div className="modal-body">
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                className="d-none"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  onClose();
                  onUpload(file);
                }}
              />
              <div className="d-flex gap-2 mb-3">
                <input
                  type="search"
                  className="form-control form-control-sm"
                  placeholder="Search by image, character, object or layer name"
                  aria-label="Search images"
                  autoFocus
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setCount(MEDIA_BATCH_SIZE);
                  }}
                />
                <button
                  type="button"
                  className="btn btn-outline-primary btn-sm text-nowrap"
                  onClick={() => fileInput.current?.click()}
                >
                  Upload new image…
                </button>
              </div>
              {error && <div className="text-danger small mb-3">{error}</div>}
              {media.length === 0 && (
                <p className="text-muted mb-0">No images uploaded to this project yet.</p>
              )}
              {media.length > 0 && found.length === 0 && (
                <p className="text-muted">No images match “{query.trim()}”.</p>
              )}
              {media.length > 0 && !ready && <p className="text-muted small">Sorting images…</p>}
              {shown.map((group) => (
                <section key={group.title} className="mb-3" aria-label={group.title}>
                  <h3 className="h6 text-muted">{group.title}</h3>
                  <div className="media-grid">
                    {group.items.map((item) => (
                      <Tile
                        key={item.id}
                        item={item}
                        current={item.id === currentId}
                        deleting={item.id === deletingId}
                        onPick={pick}
                        onPreview={preview}
                        onDelete={(target) => void remove(target)}
                      />
                    ))}
                  </div>
                </section>
              ))}
              {hasMore && <div ref={more} style={{ height: 1 }} aria-hidden="true" />}
            </div>
            <div className="modal-footer justify-content-start">
              <span className="text-muted small">
                {found.length === media.length
                  ? `${media.length} images`
                  : `${found.length} of ${media.length} images`}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
