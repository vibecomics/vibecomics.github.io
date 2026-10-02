import { useState } from 'react';
import { cb } from '../ai/actions';
import type { MediaItem, Variation } from '../types/comic';
import GenerateIconButton from './GenerateIconButton';
import GenerateImageModal from './GenerateImageModal';
import IconButton from './IconButton';
import { TrashIcon } from './Icons';
import MediaPicker from './MediaPicker';
import MediaThumb from './MediaThumb';
import { uploadImage } from './panelActions';
import { useProject } from './ProjectContext';
import { useVariationGenerationStatus } from './useGenerationStatus';
import { useTask } from './useTask';

interface Props {
  kind: 'characters' | 'objects' | 'scenes';
  entryId: string;
  variation: Variation;
  media: MediaItem[];
  /** Opens the shared lightbox (owned by ReferenceImages) on this image, so prev/next there cycles
   * across every image the entry has, not just this variation's. */
  onOpenImage: (mediaId: string) => void;
  /** Deletes this whole variation (after confirming). */
  onDelete: () => void;
}

/** One variation's (pose/state's) content: its current image, its own prompt, and the three actions
 * on the right (delete this variation, pick an image from existing media, generate). */
export default function VariationRow({
  kind,
  entryId,
  variation,
  media,
  onOpenImage,
  onDelete,
}: Props) {
  const task = useTask();
  const project = useProject();
  const [picking, setPicking] = useState(false);
  const [generatingModal, setGeneratingModal] = useState(false);
  const status = useVariationGenerationStatus(kind, entryId, variation.id);
  // The most recently added image is what's shown; older ones stay reachable via the lightbox's
  // prev/next (see ReferenceImages' combined image list) rather than being discarded.
  const currentId = variation.imageIds.at(-1);
  const currentItem = currentId ? media.find((m) => m.id === currentId) : undefined;

  function addImageId(id: string) {
    const current = cb().variations.get(kind, entryId, variation.id)?.imageIds ?? [];
    if (current.includes(id)) return;
    cb().variations.update(kind, entryId, variation.id, { imageIds: [...current, id] });
  }

  return (
    <div className="d-flex gap-2 align-items-stretch">
      {currentItem ? (
        <div className="position-relative" style={{ flexShrink: 0 }}>
          <MediaThumb
            item={currentItem}
            width={72}
            fillHeight
            onOpen={() => onOpenImage(currentItem.id)}
            onRemove={() =>
              cb().variations.update(kind, entryId, variation.id, {
                imageIds: variation.imageIds.filter((id) => id !== currentItem.id),
              })
            }
          />
          {variation.imageIds.length > 1 && (
            <span
              className="badge bg-secondary position-absolute bottom-0 start-0 m-1"
              style={{ fontSize: '0.6rem' }}
              title={`${variation.imageIds.length} images for this variation; click the thumbnail to browse and pick one`}
            >
              {variation.imageIds.length}
            </span>
          )}
        </div>
      ) : (
        <div
          className="checker rounded d-flex align-items-center justify-content-center text-muted small text-center"
          style={{ width: 72, flexShrink: 0 }}
        >
          No image
        </div>
      )}
      <textarea
        className="form-control flex-grow-1"
        style={{ width: '100%', resize: 'vertical' }}
        rows={3}
        defaultValue={variation.prompt}
        placeholder="What makes this variation different, e.g. “Front view, facing the camera directly.”"
        aria-label="Variation prompt"
        onBlur={(e) => {
          if (e.target.value !== variation.prompt) {
            cb().variations.update(kind, entryId, variation.id, { prompt: e.target.value });
          }
        }}
      />
      <div className="d-flex flex-column gap-1" style={{ flexShrink: 0 }}>
        <IconButton
          label={`Delete the "${variation.name}" variation`}
          title={`Delete the "${variation.name}" variation`}
          onClick={onDelete}
        >
          <TrashIcon />
        </IconButton>
        <IconButton
          label="Pick from media"
          title="Pick from media"
          disabled={task.busy}
          onClick={() => setPicking(true)}
        >
          🖼
        </IconButton>
        <GenerateIconButton
          status={status}
          title={`Generate a new image for "${variation.name}"`}
          onClick={() => setGeneratingModal(true)}
          onCancel={() => cb().generate.cancelVariation(kind, entryId, variation.id)}
        />
      </div>
      {generatingModal && (
        <GenerateImageModal
          title={`Generate "${variation.name}"`}
          project={project}
          currentEntryId={entryId}
          getDefaultPromptParts={() =>
            cb().generate.variationPromptParts(kind, entryId, variation.id)
          }
          getDefaultReferences={() =>
            cb().generate.variationReferences(kind, entryId, variation.id)
          }
          media={media}
          onGenerate={(prompt, references) =>
            cb().generate.variationImage(kind, entryId, variation.id, prompt, references)
          }
          onUse={(result) => addImageId(result.id)}
          onClose={() => setGeneratingModal(false)}
        />
      )}
      {picking && (
        <MediaPicker
          title="Choose a reference image"
          media={media}
          prefer={kind === 'scenes' ? { kind: 'background' } : { kind: 'layer' }}
          onUpload={(file) => void task.run(async () => addImageId((await uploadImage(file)).id))}
          onPick={(item) => {
            addImageId(item.id);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
      {task.error && <div className="text-danger small mt-2">{task.error}</div>}
    </div>
  );
}
