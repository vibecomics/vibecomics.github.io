import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MediaItem } from '../types/comic';
import MediaGrid from './MediaGrid';
import type { MediaShapePreference } from './mediaOrder';

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
  const [counts, setCounts] = useState({ found: 0, total: 0 });

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
              <MediaGrid
                media={media}
                prefer={prefer}
                subjectId={subjectId}
                currentId={currentId}
                autoFocusSearch
                showCount={false}
                onCounts={(found, total) => setCounts({ found, total })}
                onUpload={(file) => {
                  onClose();
                  onUpload(file);
                }}
                onPick={(item) => {
                  onClose();
                  onPick(item);
                }}
              />
            </div>
            <div className="modal-footer justify-content-start">
              <span className="text-muted small">
                {counts.found === counts.total
                  ? `${counts.total} images`
                  : `${counts.found} of ${counts.total} images`}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
