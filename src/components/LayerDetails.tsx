import { useState } from 'react';
import { cb } from '../ai/actions';
import { addToHistoryPatch } from '../ai/builders';
import type { LayerUpdate } from '../ai/deps';
import type { Layer, MediaItem } from '../types/comic';
import { uploadImage, setLayerMedia } from './panelActions';
import GenerateButton from './GenerateButton';
import GenerateImageModal from './GenerateImageModal';
import LayerImageStrip, { type LayerImage } from './LayerImageStrip';
import MediaPicker from './MediaPicker';
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
  const linkedEntry = background
    ? scenes.find((s) => s.id === layer.sceneId)
    : [...characters, ...objects].find((e) => e.id === layer.subjectId);
  const variationKnown = linkedEntry?.variations.some((v) => v.id === layer.variationId) ?? false;
  // In the media registry's own order (it only ever grows), so an image keeps its slot in the strip
  // when it's selected or unselected; the current one is flagged, not moved to the front.
  const ownIds = new Set([layer.mediaId, ...(layer.mediaHistory ?? [])]);
  const images: LayerImage[] = media
    .filter((item) => ownIds.has(item.id))
    .map((item) => ({ item, current: item.id === layer.mediaId }));

  /** The layer as it is right now: `layer` is the snapshot this render was given, which can be stale
   * by the time a modal's callback runs (a generation may have just set its image). */
  const live = () => cb().layers.get(panelId, layer.id) ?? layer;

  /** Unlinks one image from the layer — the current image is cleared (it moves to history), a
   * history image is dropped from history — without deleting it from the project (contrast
   * media.delete, which would remove it everywhere it's used). */
  function unlinkImage(id: string) {
    const current = live();
    if (id === current.mediaId) {
      update({ mediaId: null });
    } else {
      update({ mediaHistory: (current.mediaHistory ?? []).filter((h) => h !== id) });
    }
  }

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
      <div className="d-flex gap-2 mb-2">
        {background ? (
          <select
            className="form-select form-select-sm flex-grow-1"
            aria-label="The scene this background is set in"
            title="The media picker lists this scene's images first"
            value={layer.sceneId ?? ''}
            onChange={(e) => update({ sceneId: e.target.value || null })}
          >
            <option value="">None in particular</option>
            {layer.sceneId && !sceneKnown && <option value={layer.sceneId}>A deleted scene</option>}
            {scenes.map((scene) => (
              <option key={scene.id} value={scene.id}>
                {scene.name}
              </option>
            ))}
          </select>
        ) : (
          <select
            className="form-select form-select-sm flex-grow-1"
            aria-label="What this layer shows"
            title="The media picker lists this character's or object's images first"
            value={layer.subjectId ?? ''}
            onChange={(e) => update({ subjectId: e.target.value || null })}
          >
            <option value="">Nothing in particular</option>
            {layer.subjectId && !known && (
              <option value={layer.subjectId}>A deleted character or object</option>
            )}
            {characters.length > 0 && (
              <optgroup label="Characters">
                {characters.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </optgroup>
            )}
            {objects.length > 0 && (
              <optgroup label="Objects">
                {objects.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        )}
        <select
          className="form-select form-select-sm flex-grow-1"
          aria-label="Which variation of it to use as reference"
          title="That variation's images become the default reference sent when generating this layer"
          value={layer.variationId ?? ''}
          disabled={!linkedEntry || linkedEntry.variations.length === 0}
          onChange={(e) => update({ variationId: e.target.value || null })}
        >
          <option value="">No variation</option>
          {layer.variationId && !variationKnown && (
            <option value={layer.variationId}>A deleted variation</option>
          )}
          {linkedEntry?.variations.map((variation) => (
            <option key={variation.id} value={variation.id}>
              {variation.name}
            </option>
          ))}
        </select>
      </div>
      <div className="mb-2">
        <LayerImageStrip
          images={images}
          busy={task.busy}
          addLabel={`${layer.mediaId ? 'Change' : 'Add'} ${background ? 'background' : 'layer'} image`}
          onSelect={(id) => update({ mediaId: id })}
          onUnlink={unlinkImage}
          onAdd={() => setPicking(true)}
        />
      </div>
      {generatingModal && (
        <GenerateImageModal
          title={`Generate ${background ? 'background' : 'layer'} image`}
          project={project}
          currentEntryId={linkedId}
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
                : addToHistoryPatch(live(), result.id)
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
      <div className="d-flex align-items-center gap-2">
        <GenerateButton
          status={status}
          blockedReason={layer.prompt?.trim() ? undefined : 'Write a prompt first'}
          title="Generate a new image from this prompt"
          onClick={() => setGeneratingModal(true)}
          onCancel={() => cb().generate.cancelLayer(panelId, layer.id)}
        />
        <div className="flex-grow-1">
          <SliderRow
            label="Opacity"
            value={layer.opacity}
            min={0}
            max={1}
            step={0.05}
            onChange={(opacity) => update({ opacity })}
          />
        </div>
      </div>
    </div>
  );
}
