import { useState } from 'react';
import { cb } from '../ai/actions';
import type { MediaItem } from '../types/comic';
import GenerateButton from './GenerateButton';
import GenerateImageModal from './GenerateImageModal';
import ImageLightbox from './ImageLightbox';
import MediaPicker from './MediaPicker';
import MediaThumb from './MediaThumb';
import { uploadImage } from './panelActions';
import { useProject } from './ProjectContext';
import Spinner from './Spinner';
import { useReferenceGenerationStatus } from './useGenerationStatus';
import { useTask } from './useTask';

interface Props {
  kind: 'characters' | 'scenes' | 'objects';
  entryId: string;
  imageIds: string[];
  media: MediaItem[];
}

/** Reference images of a story-bible entry: thumbnails, then a row of buttons to upload, pick from
 * existing media, or generate a new one. */
export default function ReferenceImages({ kind, entryId, imageIds, media }: Props) {
  const task = useTask();
  const project = useProject();
  const [viewing, setViewing] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [generatingModal, setGeneratingModal] = useState(false);
  const items = imageIds.flatMap((id) => media.find((m) => m.id === id) ?? []);
  const status = useReferenceGenerationStatus(kind, entryId);
  const fileInputId = `reference-upload-${kind}-${entryId}`;

  function addImageId(id: string) {
    const current = cb()[kind].get(entryId)?.imageIds ?? [];
    if (current.includes(id)) return;
    cb()[kind].update(entryId, { imageIds: [...current, id] });
  }

  async function upload(files: File[]) {
    for (const file of files) {
      addImageId((await uploadImage(file)).id);
    }
  }

  function deleteMedia(item: MediaItem) {
    const message = `Delete "${item.name}"? It moves to the storage trash and is removed from every layer and reference that uses it.`;
    if (!window.confirm(message)) return;
    void task.run(async () => void (await cb().media.delete(item.id)));
  }

  return (
    <div className="mt-3">
      <div className="d-flex flex-wrap gap-2 align-items-center">
        {items.map((item, i) => (
          <MediaThumb
            key={item.id}
            item={item}
            onOpen={() => setViewing(i)}
            onRemove={() =>
              cb()[kind].update(entryId, { imageIds: imageIds.filter((id) => id !== item.id) })
            }
          />
        ))}
      </div>
      <div className="d-flex flex-wrap gap-2 mt-2">
        <label
          htmlFor={fileInputId}
          className={`btn btn-outline-secondary btn-sm mb-0${task.busy ? ' disabled' : ''}`}
        >
          {task.busy && <Spinner />}
          Upload
          <input
            id={fileInputId}
            type="file"
            accept="image/*"
            multiple
            className="d-none"
            disabled={task.busy}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length) void task.run(() => upload(files));
            }}
          />
        </label>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          disabled={task.busy}
          onClick={() => setPicking(true)}
        >
          Pick from media
        </button>
        <GenerateButton
          status={status}
          title="Generate a new reference image"
          onClick={() => setGeneratingModal(true)}
          onCancel={() => cb().generate.cancelReference(kind, entryId)}
        />
      </div>
      {generatingModal && (
        <GenerateImageModal
          title="Generate reference image"
          project={project}
          currentEntryId={entryId}
          getDefaultPromptParts={() => cb().generate.referencePromptParts(kind, entryId)}
          getDefaultReferences={() => cb().generate.entryReferences(kind, entryId)}
          media={media}
          onGenerate={(prompt, references) => cb()[kind].generateImage(entryId, prompt, references)}
          // No primary/non-primary distinction for a story-bible entry's reference images — they're
          // just a list — so every generated image is kept the same way, used or not. onUse fires
          // once as soon as generation succeeds and again on an explicit "Use this image" click;
          // addImageId ignores the second call if the image is already in the list.
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
      {viewing !== null && (
        <ImageLightbox
          items={items}
          start={viewing}
          onClose={() => setViewing(null)}
          onDelete={deleteMedia}
        />
      )}
      {task.error && <div className="text-danger small mt-2">{task.error}</div>}
    </div>
  );
}
