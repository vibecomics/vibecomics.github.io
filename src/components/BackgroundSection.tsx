import { cb } from '../ai/actions';
import type { MediaItem, Panel } from '../types/comic';
import AccordionItem from './AccordionItem';
import HelpSection from './HelpSection';
import LayerRow from './LayerRow';
import type { Selection } from './selection';

interface Props {
  panel: Panel;
  media: MediaItem[];
  selection: Selection;
  onSelect: (selection: Selection) => void;
  /** Whether the section's content is shown; it can be collapsed to just its heading. */
  open: boolean;
  onToggleOpen: () => void;
}

/** The panel's background: a button to set one, or a row for the one that is set. */
export default function BackgroundSection({
  panel,
  media,
  selection,
  onSelect,
  open,
  onToggleOpen,
}: Props) {
  const background = panel.layers.find((layer) => layer.kind === 'background');

  /** Add an empty background, open it, and let the user type its prompt or pick an image; unlike a
   * foreground layer there's only ever one, so this replaces the whole "set a background" step. */
  function addBackground() {
    const layer = cb().layers.add(panel.id, { kind: 'background', prompt: '' });
    onSelect({ panelId: panel.id, layerId: layer.id });
  }

  return (
    <AccordionItem title="Background" open={open} onToggle={onToggleOpen}>
      {!background && (
        <HelpSection title="What is the background?" open>
          <p className="mb-0">
            The setting behind everything else in the panel. Write a prompt and generate one, or set
            an existing image.
          </p>
        </HelpSection>
      )}
      {background ? (
        <LayerRow
          panelId={panel.id}
          layer={background}
          media={media}
          selected={selection.layerId === background.id}
          collapsible={false}
          onSelect={() =>
            onSelect({
              panelId: panel.id,
              layerId: selection.layerId === background.id ? undefined : background.id,
            })
          }
        />
      ) : (
        <button className="btn btn-outline-secondary btn-sm" onClick={addBackground}>
          Set background
        </button>
      )}
    </AccordionItem>
  );
}
