import { useState } from 'react';
import { cb } from '../ai/actions';
import type { ComicPage, MediaItem, Panel } from '../types/comic';
import BackgroundSection from './BackgroundSection';
import BubblesSection from './BubblesSection';
import HelpSection from './HelpSection';
import LayersSection from './LayersSection';
import PanelImageSection from './PanelImageSection';
import { TrashIcon } from './Icons';
import type { Selection } from './selection';
import { useExpansion } from './useExpansion';

type Section = 'image' | 'bubbles' | 'layers' | 'background';

interface Props {
  page: ComicPage;
  panel: Panel;
  media: MediaItem[];
  selection: Selection;
  onSelect: (selection: Selection) => void;
  /** Zooms the page view: `by(1)` in, `by(-1)` out. */
  zoom: { canIn: boolean; canOut: boolean; by: (direction: 1 | -1) => void };
}

/** Everything you can do to the highlighted panel: delete it and edit its content. */
export default function PanelInspector({ page, panel, media, selection, onSelect, zoom }: Props) {
  const expansion = useExpansion();
  const size = cb().panels.get(panel.id)?.size ?? null;
  const hasContent = panel.layers.length > 0 || panel.bubbles.length > 0;
  const onlyPanel = page.panels.length === 1;
  // Any number of sections can be open. A shown panel image takes the layers' place on the page, so
  // it starts open and Layers closed; with no (or a hidden) panel image, Layers starts open.
  // Clicking a header toggles that section; the choice is kept for this panel only.
  const panelImageShown = panel.image?.visible === true;
  const [chosen, setChosen] = useState<{ panelId: string; open: Section[] } | null>(null);
  const openSections: Section[] =
    chosen?.panelId === panel.id ? chosen.open : panelImageShown ? ['image'] : ['layers'];
  const isOpen = (section: Section) => openSections.includes(section);
  const toggle = (section: Section) =>
    setChosen({
      panelId: panel.id,
      open: isOpen(section)
        ? openSections.filter((s) => s !== section)
        : [...openSections, section],
    });

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
        <div className="d-flex gap-2 flex-shrink-0">
          <div className="btn-group btn-group-sm" role="group" aria-label="Zoom">
            <button
              className="btn btn-outline-secondary"
              title="Zoom out"
              aria-label="Zoom out"
              disabled={!zoom.canOut}
              onClick={() => zoom.by(-1)}
            >
              −
            </button>
            <button
              className="btn btn-outline-secondary"
              title="Zoom in"
              aria-label="Zoom in"
              disabled={!zoom.canIn}
              onClick={() => zoom.by(1)}
            >
              +
            </button>
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
      </div>

      {panel.layers.length === 0 && (
        <HelpSection title="What is a panel?" open>
          <p className="mb-0">
            A panel is one box on the page. To split it, click and drag the scissors on its edge,
            then let go over the panel to cut it in two.
          </p>
        </HelpSection>
      )}
      <div className="accordion mb-3">
        <PanelImageSection
          panel={panel}
          media={media}
          open={isOpen('image')}
          onToggleOpen={() => toggle('image')}
        />
        <BubblesSection
          panel={panel}
          selection={selection}
          onSelect={onSelect}
          expansion={expansion}
          open={isOpen('bubbles')}
          onToggleOpen={() => toggle('bubbles')}
        />
        <LayersSection
          panel={panel}
          media={media}
          selection={selection}
          onSelect={onSelect}
          expansion={expansion}
          open={isOpen('layers')}
          onToggleOpen={() => toggle('layers')}
        />
        <BackgroundSection
          panel={panel}
          media={media}
          selection={selection}
          onSelect={onSelect}
          open={isOpen('background')}
          onToggleOpen={() => toggle('background')}
        />
      </div>
    </div>
  );
}
