import type { MediaItem } from '../types/comic';
import Spinner from './Spinner';
import { useMediaUrl } from './useMediaUrl';

interface Props {
  /** The registered image shown, or undefined while the layer has none yet. */
  item?: MediaItem;
  /** Names the button for screen readers, e.g. "Change background image". */
  label: string;
  busy: boolean;
  onClick: () => void;
}

/** The image a layer uses, as a thumbnail that opens the media picker when clicked. */
export default function MediaSlot({ item, label, busy, onClick }: Props) {
  const { url } = useMediaUrl(item ?? null);
  return (
    <button
      type="button"
      className="media-slot checker"
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={onClick}
    >
      {url ? (
        <img src={url} alt="" />
      ) : (
        <span className="text-muted small">{item ? '…' : 'Add image'}</span>
      )}
      {busy && (
        <span className="media-slot-busy">
          <Spinner />
        </span>
      )}
    </button>
  );
}
