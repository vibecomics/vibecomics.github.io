import { useState } from 'react';
import { cb } from '../ai/actions';
import type { LayerUpdate } from '../ai/deps';
import type { Layer, MediaItem } from '../types/comic';
import { uploadImage, setLayerMedia } from './panelActions';
import MediaPicker from './MediaPicker';
import MediaSlot from './MediaSlot';
import { useProject } from './ProjectContext';
import SliderRow from './SliderRow';
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
  const background = layer.kind === 'background';
  const { characters, objects, scenes } = useProject().metadata;
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
        autoFocus={!layer.prompt && !layer.src}
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
      <div className="mb-2">
        <MediaSlot
          src={layer.src}
          item={media.find((m) => m.id === layer.mediaId)}
          label={`${layer.src ? 'Change' : 'Add'} ${background ? 'background' : 'layer'} image`}
          busy={task.busy}
          onClick={() => setPicking(true)}
        />
      </div>
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
