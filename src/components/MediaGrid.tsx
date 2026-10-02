import { useEffect, useMemo, useRef, useState } from 'react';
import { cb } from '../ai/actions';
import type { MediaItem } from '../types/comic';
import { errorMessage } from '../utils/errors';
import { ExternalIcon, TrashIcon } from './Icons';
import ImageLightbox from './ImageLightbox';
import { openInNewTab } from './mediaImages';
import {
  groupMedia,
  MEDIA_BATCH_SIZE,
  firstOfGroups,
  mediaUseCounts,
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
  /** Every image uploaded to the project. */
  media: MediaItem[];
  /** Decides which images are listed first. */
  prefer: MediaShapePreference;
  /** The character or object the image is for: its art is listed first. */
  subjectId?: string;
  /** The image in use now, marked in the grid. */
  currentId?: string;
  /** Adds an "Upload new image…" button; the caller decides what happens with the file. */
  onUpload?: (file: File) => void;
  /** Makes a tile clickable to choose it. Omit for a view-only grid, where a tile opens the image
   * full size instead. */
  onPick?: (item: MediaItem) => void;
  /** Focuses the search box as soon as the grid mounts (for a picker that just opened). */
  autoFocusSearch?: boolean;
  /** Hides the built-in "N images" line, for a caller that renders its own from `onCounts`. */
  showCount?: boolean;
  /** How many images match the search, and the total, reported on every change. */
  onCounts?: (found: number, total: number) => void;
}

interface TileProps {
  item: MediaItem;
  current: boolean;
  /** How many places the image is used in. */
  uses: number;
  deleting: boolean;
  onPick?: (item: MediaItem) => void;
  /** Opens this image full size, with prev/next across the grid (see ImageLightbox). Used for the
   * tile's main click when there's no onPick (a view-only grid, e.g. the Media tab). */
  onOpen: (item: MediaItem) => void;
  onPreview: (item: MediaItem) => void;
  onDelete: (item: MediaItem) => void;
}

function Tile({ item, current, uses, deleting, onPick, onOpen, onPreview, onDelete }: TileProps) {
  // The image is fetched only once its tile has scrolled into view.
  const [ref, seen] = useSeen<HTMLDivElement>();
  const { url, failed, error } = useMediaUrl(seen ? item : null);
  return (
    <div className="media-tile-wrap" ref={ref}>
      <button
        type="button"
        className={`media-tile${current ? ' current' : ''}`}
        aria-pressed={onPick ? current : undefined}
        title={error ? `${item.name}: ${error}` : item.name}
        disabled={deleting}
        onClick={() => (onPick ? onPick(item) : onOpen(item))}
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
      {uses > 0 && (
        <span
          className="media-tile-uses"
          title={`Used in ${uses} place${uses === 1 ? '' : 's'}`}
          aria-label={`Used in ${uses} place${uses === 1 ? '' : 's'}`}
        >
          {uses}
        </span>
      )}
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
 * Every uploaded image as a thumbnail, grouped and searchable, with a button to upload a new one.
 * Each thumbnail can be opened full size in a new tab or deleted; with `onPick` it can also be
 * chosen, which is what turns this into a picker. The core of both MediaPicker (a popup that picks
 * an image for one slot) and the project's Media tab (a view of every image, to browse and delete).
 */
export default function MediaGrid({
  media,
  prefer,
  subjectId,
  currentId,
  onUpload,
  onPick,
  autoFocusSearch,
  showCount = true,
  onCounts,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  // How many images are listed; null until the first list is known, then it only grows.
  const [count, setCount] = useState<number | null>(null);
  const more = useRef<HTMLDivElement>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The id of the image open in the lightbox (view-only grids, e.g. the Media tab): prev/next
  // cycles across every image currently shown in the grid, not just the one clicked.
  const [viewingId, setViewingId] = useState<string | null>(null);
  const project = useProject();
  const { infos, ready } = useMediaInfos(media);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text), 150);
    return () => clearTimeout(timer);
  }, [text]);
  const useCounts = useMemo(() => mediaUseCounts(project), [project]);
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
    onCounts?.(found.length, media.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found.length, media.length]);

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

  function preview(item: MediaItem) {
    try {
      setError(null);
      openInNewTab(item);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function remove(item: MediaItem) {
    const message = `Delete "${item.name}"? It moves to the storage trash and is removed from every layer and reference that uses it.`;
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

  return (
    <div>
      {onUpload && (
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="d-none"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onUpload(file);
          }}
        />
      )}
      <div className="d-flex gap-2 mb-3">
        <input
          type="search"
          className="form-control form-control-sm"
          placeholder="Search by image, character, object or layer name"
          aria-label="Search images"
          autoFocus={autoFocusSearch}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setCount(MEDIA_BATCH_SIZE);
          }}
        />
        {onUpload && (
          <button
            type="button"
            className="btn btn-outline-primary btn-sm text-nowrap"
            onClick={() => fileInput.current?.click()}
          >
            Upload new image…
          </button>
        )}
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
                uses={useCounts.get(item.id) ?? 0}
                deleting={item.id === deletingId}
                onPick={onPick}
                onOpen={(target) => setViewingId(target.id)}
                onPreview={preview}
                onDelete={(target) => void remove(target)}
              />
            ))}
          </div>
        </section>
      ))}
      {hasMore && <div ref={more} style={{ height: 1 }} aria-hidden="true" />}
      {showCount && (
        <span className="text-muted small">
          {found.length === media.length
            ? `${media.length} images`
            : `${found.length} of ${media.length} images`}
        </span>
      )}
      {viewingId !== null && (
        <ImageLightbox
          items={shown.flatMap((group) => group.items)}
          start={Math.max(
            0,
            shown.flatMap((group) => group.items).findIndex((item) => item.id === viewingId)
          )}
          onClose={() => setViewingId(null)}
          onDelete={(item) => void remove(item)}
        />
      )}
    </div>
  );
}
