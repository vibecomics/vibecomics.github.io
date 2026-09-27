import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cb } from '../ai/actions';
import type { MediaItem } from '../types/comic';
import { errorMessage } from '../utils/errors';
import { ExternalIcon, TrashIcon } from './Icons';
import { openInNewTab } from './mediaImages';
import { groupMedia, pageOfGroups, pageOfItem, type MediaPreference } from './mediaOrder';
import { useMediaInfos } from './useMediaInfos';
import { useMediaUrl } from './useMediaUrl';

interface Props {
  title: string;
  /** Every image uploaded to the project. */
  media: MediaItem[];
  /** Decides which images are listed first. */
  prefer: MediaPreference;
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
  const { url, failed, error } = useMediaUrl(item);
  return (
    <div className="media-tile-wrap">
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
 * suit `prefer` come first, a page at a time; a button uploads a new one. Each thumbnail can be
 * opened full size in a new tab or deleted. Picking or uploading closes the popup.
 */
export default function MediaPicker({
  title,
  media,
  prefer,
  currentId,
  onUpload,
  onPick,
  onClose,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { infos, ready } = useMediaInfos(media);
  // Until every image's shape is known they are listed as they come; then they are sorted into groups.
  const groups = ready ? groupMedia(media, infos, prefer) : [{ title: 'Images', items: media }];
  // Opens on the page that holds the current image, then follows the arrows.
  const shown = pageOfGroups(groups, page ?? pageOfItem(groups, currentId));

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
              <button
                type="button"
                className="btn btn-outline-primary btn-sm mb-3"
                onClick={() => fileInput.current?.click()}
              >
                Upload new image…
              </button>
              {error && <div className="text-danger small mb-3">{error}</div>}
              {media.length === 0 && (
                <p className="text-muted mb-0">No images uploaded to this project yet.</p>
              )}
              {media.length > 0 && !ready && <p className="text-muted small">Sorting images…</p>}
              {shown.groups.map((group) => (
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
            </div>
            {shown.pages > 1 && (
              <div className="modal-footer justify-content-between">
                <span className="text-muted small">{media.length} images</span>
                <nav className="d-flex align-items-center gap-2" aria-label="Pages of images">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    disabled={shown.page === 0}
                    onClick={() => setPage(shown.page - 1)}
                  >
                    Previous
                  </button>
                  <span className="small">
                    Page {shown.page + 1} of {shown.pages}
                  </span>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    disabled={shown.page === shown.pages - 1}
                    onClick={() => setPage(shown.page + 1)}
                  >
                    Next
                  </button>
                </nav>
              </div>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
