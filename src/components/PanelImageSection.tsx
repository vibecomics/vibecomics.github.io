import { useState } from 'react';
import { cb } from '../ai/actions';
import { isPanelImageDirty } from '../ai/panelImage';
import type { MediaItem, Panel } from '../types/comic';
import AccordionItem from './AccordionItem';
import HelpSection from './HelpSection';
import MediaPicker from './MediaPicker';
import MediaThumb from './MediaThumb';
import Spinner from './Spinner';
import StyleField from './StyleField';
import { uploadImage } from './panelActions';
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
  const [picking, setPicking] = useState(false);
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
      // Collapsed, the body (and its warning) is hidden, so keep the state visible.
      badge={
        !open && image && dirty ? (
          <span className="badge text-bg-warning fw-normal">Out of date</span>
        ) : undefined
      }
    >
      {image && (
        <div className="form-check form-switch mb-2">
          <input
            id={`panel-image-visible-${panel.id}`}
            className="form-check-input"
            type="checkbox"
            role="switch"
            checked={image.visible}
            onChange={(e) => cb().panels.update(panel.id, { imageVisible: e.target.checked })}
          />
          <label className="form-check-label" htmlFor={`panel-image-visible-${panel.id}`}>
            Show the panel image{image.visible ? '' : ' (layers are shown)'}
          </label>
        </div>
      )}
      {!image && (
        <HelpSection title="What is a panel image?" open>
          <p className="mb-0">
            One picture of the whole panel, made after the background and layers are final so they
            share lighting and style. When it is shown it replaces the layers on the page; hide it
            to edit the layers again. Ask your AI assistant to make one, or set your own image.
          </p>
        </HelpSection>
      )}

      {image && dirty && (
        <div className="alert alert-warning py-1 px-2 small my-2" role="status">
          Out of date: the layers or panel prompt changed since this image was made. Ask your AI
          assistant for a new one{image.visible ? '' : ', or show the layers again'}.
        </div>
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

      <button
        className="btn btn-outline-secondary btn-sm"
        disabled={task.busy}
        onClick={() => setPicking(true)}
      >
        {task.busy && <Spinner />}
        {image ? 'Replace image' : 'Set panel image'}
      </button>
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

      <StyleField
        key={panel.id}
        id={`panel-prompt-${panel.id}`}
        label="Panel prompt"
        placeholder="Mood, action and lighting for the whole panel, e.g. golden hour, low sun from the left"
        value={panel.prompt ?? ''}
        rows={2}
        autoSave
        onSave={(text) => void cb().panels.update(panel.id, { prompt: text })}
      />
    </AccordionItem>
  );
}
