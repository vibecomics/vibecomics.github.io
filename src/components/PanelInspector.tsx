import { cb } from '../ai/actions';
import type { ComicPage, MediaItem, Panel } from '../types/comic';
import BackgroundSection from './BackgroundSection';
import BubblesSection from './BubblesSection';
import HelpSection from './HelpSection';
import LayersSection from './LayersSection';
import { TrashIcon } from './Icons';
import type { Selection } from './selection';
import { useExpansion } from './useExpansion';

interface Props {
  page: ComicPage;
  panel: Panel;
  media: MediaItem[];
  selection: Selection;
  onSelect: (selection: Selection) => void;
}

/** Everything you can do to the highlighted panel: delete it and edit its content. */
export default function PanelInspector({ page, panel, media, selection, onSelect }: Props) {
  const expansion = useExpansion();
  const size = cb().panels.size(panel.id);
  const hasContent = panel.layers.length > 0 || panel.bubbles.length > 0;
  const onlyPanel = page.panels.length === 1;

  return (
    <div className="p-3">
      <div className="d-flex justify-content-between align-items-start mb-3">
        <div>
          <div className="fw-semibold d-none d-md-block">
            Panel {page.panels.indexOf(panel) + 1}
          </div>
          <div className="text-muted small">
            {size && `${size.widthIn}″ × ${size.heightIn}″ · ratio ${size.aspectRatio}`}
          </div>
        </div>
        <button
          className="btn btn-outline-secondary btn-sm text-nowrap flex-shrink-0"
          disabled={onlyPanel}
          title={onlyPanel ? 'A page needs at least one panel' : 'Delete this panel'}
          aria-label="Delete this panel"
          onClick={() => {
            if (!hasContent || window.confirm('Delete this panel and everything in it?')) {
              cb().panels.delete(panel.id);
            }
          }}
        >
          <TrashIcon />
        </button>
      </div>

      {panel.layers.length === 0 && (
        <HelpSection title="What is a panel?" open>
          <p className="mb-0">
            A panel is one box on the page. To split it, click and drag the scissors on its edge,
            then let go over the panel to cut it in two.
          </p>
        </HelpSection>
      )}
      <BubblesSection
        panel={panel}
        selection={selection}
        onSelect={onSelect}
        expansion={expansion}
      />
      <LayersSection
        panel={panel}
        media={media}
        selection={selection}
        onSelect={onSelect}
        expansion={expansion}
      />
      <BackgroundSection
        panel={panel}
        media={media}
        selection={selection}
        onSelect={onSelect}
        expansion={expansion}
      />
    </div>
  );
}
