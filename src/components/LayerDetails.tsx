import { useState } from 'react';
import { cb } from '../ai/actions';
import { addToHistoryPatch } from '../ai/builders';
import type { LayerUpdate } from '../ai/deps';
import type { Layer, MediaItem } from '../types/comic';
import { uploadImage, setLayerMedia } from './panelActions';
import GenerateButton from './GenerateButton';
import GenerateImageModal from './GenerateImageModal';
import { TrashIcon } from './Icons';
import LayerHistoryStrip from './LayerHistoryStrip';
import MediaPicker from './MediaPicker';
import MediaSlot from './MediaSlot';
import { useProject } from './ProjectContext';
import SliderRow from './SliderRow';
import { useLayerGenerationStatus } from './useGenerationStatus';
import { useTask } from './useTask';

interface Props {
  panelId: string;
  layer: Layer;
  media: MediaItem[];
}

/** The editable properties of one layer: name, prompt, image and opacity. Place, size and turn it on the page. */
export default function LayerDetails({ panelId, layer, media }: Props) {
  const task = useTask();
  const update = (patch: LayerUpdate) => cb().layers.update(panelId, layer.id, patch);
  const [picking, setPicking] = useState(false);
  const [generatingModal, setGeneratingModal] = useState(false);
  const background = layer.kind === 'background';
  const status = useLayerGenerationStatus(panelId, layer.id);
  const project = useProject();
  const { characters, objects, scenes } = project.metadata;
  const known = [...characters, ...objects].some((entry) => entry.id === layer.subjectId);
  const sceneKnown = scenes.some((scene) => scene.id === layer.sceneId);
  // A foreground layer shows a character or object; a background is the setting of a scene.
  const linkedId = background ? layer.sceneId : layer.subjectId;

  return (
    <div className="mt-2">
      <input
        className="form-control form-control-sm mb-2"
        value={layer.name}
        aria-label="Layer name"
        onChange={(e) => update({ name: e.target.value })}
      />
      <textarea
        className="form-control form-control-sm mb-2"
        rows={3}
        value={layer.prompt ?? ''}
        placeholder="Prompt or description"
        aria-label="Layer prompt"
        autoFocus={!layer.prompt && !layer.mediaId}
        onChange={(e) => update({ prompt: e.target.value })}
      />
      {background ? (
        <select
          className="form-select form-select-sm mb-2"
          aria-label="The scene this background is set in"
          title="The media picker lists this scene's images first"
          value={layer.sceneId ?? ''}
          onChange={(e) => update({ sceneId: e.target.value || null })}
        >
          <option value="">Scene: none in particular</option>
          {layer.sceneId && !sceneKnown && (
            <option value={layer.sceneId}>Scene: a deleted scene</option>
          )}
          {scenes.map((scene) => (
            <option key={scene.id} value={scene.id}>
              Scene: {scene.name}
            </option>
          ))}
        </select>
      ) : (
        <select
          className="form-select form-select-sm mb-2"
          aria-label="What this layer shows"
          title="The media picker lists this character's or object's images first"
          value={layer.subjectId ?? ''}
          onChange={(e) => update({ subjectId: e.target.value || null })}
        >
          <option value="">Shows: nothing in particular</option>
          {layer.subjectId && !known && (
            <option value={layer.subjectId}>Shows: a deleted character or object</option>
          )}
          {characters.length > 0 && (
            <optgroup label="Characters">
              {characters.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  Shows: {entry.name}
                </option>
              ))}
            </optgroup>
          )}
          {objects.length > 0 && (
            <optgroup label="Objects">
              {objects.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  Shows: {entry.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      )}
      <div className="mb-2 d-flex align-items-start gap-2">
        <MediaSlot
          item={media.find((m) => m.id === layer.mediaId)}
          label={`${layer.mediaId ? 'Change' : 'Add'} ${background ? 'background' : 'layer'} image`}
          busy={task.busy}
          onClick={() => setPicking(true)}
        />
        <GenerateButton
          status={status}
          blockedReason={layer.prompt?.trim() ? undefined : 'Write a prompt first'}
          title="Generate a new image from this prompt"
          onClick={() => setGeneratingModal(true)}
        />
        {layer.mediaId && (
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={task.busy}
            title="Delete this image (it stops being this layer's image)"
            aria-label="Delete this layer's image"
            onClick={() =>
              void task.run(async () => void (await cb().media.delete(layer.mediaId!)))
            }
          >
            <TrashIcon />
          </button>
        )}
      </div>
      <LayerHistoryStrip
        historyIds={layer.mediaHistory ?? []}
        media={media}
        onRestore={(id) => update({ mediaId: id })}
        onDelete={(id) => void task.run(async () => void (await cb().media.delete(id)))}
      />
      {generatingModal && (
        <GenerateImageModal
          title={`Generate ${background ? 'background' : 'layer'} image`}
          project={project}
          getDefaultPromptParts={() => cb().generate.layerPromptParts(panelId, layer.id)}
          getDefaultReferences={() => cb().generate.layerReferences(panelId, layer.id)}
          media={media}
          onGenerate={(prompt, references) =>
            cb().generate.layer(panelId, layer.id, prompt, references)
          }
          onUse={(result, { primary }) =>
            update(
              primary
                ? { mediaId: result.id, aspectRatio: result.aspectRatio }
                : addToHistoryPatch(layer, result.id)
            )
          }
          onClose={() => setGeneratingModal(false)}
        />
      )}
      {picking && (
        <MediaPicker
          title={background ? 'Choose a background image' : 'Choose a layer image'}
          media={media}
          prefer={
            background
              ? { kind: 'background', aspectRatio: cb().panels.size(panelId)?.aspectRatio }
              : { kind: 'layer' }
          }
          subjectId={linkedId}
          currentId={layer.mediaId}
          onUpload={(file) =>
            void task.run(async () =>
              setLayerMedia(
                panelId,
                layer.id,
                await uploadImage(
                  file,
                  background ? { sceneId: layer.sceneId } : { subjectId: layer.subjectId }
                )
              )
            )
          }
          onPick={(item) => void task.run(() => setLayerMedia(panelId, layer.id, item))}
          onClose={() => setPicking(false)}
        />
      )}
      {task.error && <div className="text-danger small mb-2">{task.error}</div>}
      <SliderRow
        label="Opacity"
        value={layer.opacity}
        min={0}
        max={1}
        step={0.05}
        onChange={(opacity) => update({ opacity })}
      />
    </div>
  );
}
