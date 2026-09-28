import type { MediaItem } from '../types/comic';
import { TrashIcon } from './Icons';
import { useMediaUrl } from './useMediaUrl';

interface ThumbProps {
  item: MediaItem;
  onRestore: () => void;
  onDelete: () => void;
}

function Thumb({ item, onRestore, onDelete }: ThumbProps) {
  const { url } = useMediaUrl(item);
  return (
    <div className="position-relative">
      <button
        type="button"
        className="media-slot checker"
        style={{ width: '2.5rem', height: '2.5rem' }}
        title="Restore this image"
        aria-label={`Restore previous image "${item.name}"`}
        onClick={onRestore}
      >
        {url && <img src={url} alt="" />}
      </button>
      <button
        type="button"
        className="btn btn-light btn-sm position-absolute top-0 end-0 p-0 d-flex align-items-center justify-content-center"
        style={{ width: '1.1rem', height: '1.1rem', transform: 'translate(35%, -35%)' }}
        title="Delete this image"
        aria-label={`Delete previous image "${item.name}"`}
        onClick={onDelete}
      >
        <TrashIcon />
      </button>
    </div>
  );
}

interface Props {
  historyIds: string[];
  media: MediaItem[];
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}

/** A layer's previous images, most recent first: click one to restore it, or its trash icon to
 * delete it (it's removed from the project entirely, not just this layer's history). */
export default function LayerHistoryStrip({ historyIds, media, onRestore, onDelete }: Props) {
  const items = historyIds.map((id) => media.find((m) => m.id === id)).filter((m) => m !== undefined);
  if (items.length === 0) return null;
  return (
    <div className="d-flex gap-1 mb-2" aria-label="Previous images">
      {items.map((item) => (
        <Thumb key={item.id} item={item} onRestore={() => onRestore(item.id)} onDelete={() => onDelete(item.id)} />
      ))}
    </div>
  );
}
