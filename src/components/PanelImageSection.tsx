import { useState } from 'react';
import { cb } from '../ai/actions';
import { isPanelImageDirty } from '../ai/panelImage';
import { buildPanelImagePromptParts, defaultPanelReferences } from '../ai/panelBrief';
import { joinPromptParts } from '../ai/prompt';
import type { MediaItem, Panel } from '../types/comic';
import AccordionItem from './AccordionItem';
import GenerateImageModal from './GenerateImageModal';
import HelpSection from './HelpSection';
import MediaPicker from './MediaPicker';
import MediaThumb from './MediaThumb';
import PromptGenerateField from './PromptGenerateField';
import Spinner from './Spinner';
import { uploadImage } from './panelActions';
import { useProject } from './ProjectContext';
import { usePanelGenerationStatus } from './useGenerationStatus';
import { useTask } from './useTask';

interface Props {
  panel: Panel;
  media: MediaItem[];
  open: boolean;
  onToggleOpen: () => void;
}

/**
 * The panel's own cohesive image. While it is shown, it takes the layers' place on the page (they
 * are collapsed below this section); hiding it brings the layers back. It says when it is out of
 * date, and holds the panel prompt (direction for the whole panel) used to make it.
 */
export default function PanelImageSection({ panel, media, open, onToggleOpen }: Props) {
  const task = useTask();
  const project = useProject();
  const status = usePanelGenerationStatus(panel.id);
  const [picking, setPicking] = useState(false);
  const [generatingModal, setGeneratingModal] = useState(false);
  const image = panel.image;
  const item = image && media.find((m) => m.id === image.mediaId);
  const dirty = isPanelImageDirty(panel);
  const hasBackground = panel.layers.some((l) => l.kind === 'background' && l.visible);
  const hasLayers = panel.layers.some((l) => l.kind === 'foreground' && l.visible);
  const set = (getItem: () => Promise<MediaItem> | MediaItem) =>
    void task.run(async () => void cb().panels.update(panel.id, { mediaId: (await getItem()).id }));

  return (
    <AccordionItem
      title="Panel image"
      open={open}
      onToggle={onToggleOpen}
      badge={
        image && dirty ? (
          <span
            className="text-warning"
            style={{ fontSize: '0.55rem', lineHeight: 1 }}
            title="Out of date: the layers or panel prompt changed since this image was made"
            aria-label="Out of date: the layers or panel prompt changed since this image was made"
          >
            ●
          </span>
        ) : undefined
      }
      actions={
        image ? (
          <div
            className="form-check form-switch mb-0 d-flex align-items-center"
            title={
              image.visible ? 'Showing the panel image (layers are hidden)' : 'Showing the layers'
            }
          >
            <label className="visually-hidden" htmlFor={`panel-image-visible-${panel.id}`}>
              Show the panel image
            </label>
            <input
              id={`panel-image-visible-${panel.id}`}
              className="form-check-input"
              type="checkbox"
              role="switch"
              checked={image.visible}
              onChange={(e) => cb().panels.update(panel.id, { imageVisible: e.target.checked })}
            />
          </div>
        ) : undefined
      }
    >
      {!image && (
        <HelpSection title="What is a panel image?" open>
          <p className="mb-0">
            One picture of the whole panel, made after the background and layers are final so they
            share lighting and style. When it is shown it replaces the layers on the page; hide it
            to edit the layers again. Generate one, or set your own image.
          </p>
        </HelpSection>
      )}

      {image && item && (
        <div className="my-2">
          <MediaThumb
            item={item}
            width={120}
            removeTitle="Remove the panel image (the layers show again)"
            onRemove={() => cb().panels.update(panel.id, { mediaId: null })}
          />
        </div>
      )}
      {!image && !hasBackground && !hasLayers && (
        <div className="text-muted small my-2">
          No background or layers yet: a panel prompt alone is enough, but they make the panel image
          stronger.
        </div>
      )}
      {!image && (hasBackground || hasLayers) && (!hasBackground || !hasLayers) && (
        <div className="text-muted small my-2">
          No {hasBackground ? 'layers' : 'background'} yet: it can still be made, but adding{' '}
          {hasBackground ? 'layers' : 'a background'} makes it stronger.
        </div>
      )}

      <PromptGenerateField
        key={panel.id}
        className="mb-2"
        value={panel.prompt ?? ''}
        onCommit={(text) => cb().panels.update(panel.id, { prompt: text })}
        placeholder="Mood, action and lighting for the whole panel, e.g. golden hour, low sun from the left"
        ariaLabel="Panel prompt"
        rows={2}
        status={status}
        generateTitle="Generate a new panel image"
        dirty={dirty}
        onGenerate={() => setGeneratingModal(true)}
        onCancel={() => cb().generate.cancel({ type: 'panel', panelId: panel.id })}
      />
      <button
        className="btn btn-outline-secondary btn-sm mb-2"
        disabled={task.busy}
        onClick={() => setPicking(true)}
      >
        {task.busy && <Spinner />}
        {image ? 'Replace image' : 'Set panel image'}
      </button>
      {generatingModal && (
        <GenerateImageModal
          title="Generate panel image"
          project={project}
          getDefaults={() => {
            const parts = buildPanelImagePromptParts(project, panel.id);
            return {
              prompt: joinPromptParts(parts),
              parts,
              references: defaultPanelReferences(project, panel.id),
              maxReferenceImages: cb().generate.maxReferenceImages(),
            };
          }}
          media={media}
          onGenerate={(prompt, references) =>
            cb().generate.run({ type: 'panel', panelId: panel.id }, prompt, references)
          }
          onUse={(result, { primary }) => {
            // generate.run already attaches the first image automatically; a later one (not yet
            // the panel's own image) waits for this explicit "Use this image" click, same as a layer.
            if (primary) void cb().panels.update(panel.id, { mediaId: result.id });
          }}
          onClose={() => setGeneratingModal(false)}
        />
      )}
      {picking && (
        <MediaPicker
          title="Choose the panel image"
          media={media}
          prefer={{ kind: 'background', aspectRatio: cb().panels.get(panel.id)?.size.aspectRatio }}
          currentId={image?.mediaId}
          onUpload={(file) => set(() => uploadImage(file))}
          onPick={(picked) => set(() => picked)}
          onClose={() => setPicking(false)}
        />
      )}
      {task.error && <div className="text-danger small mt-2">{task.error}</div>}
    </AccordionItem>
  );
}
