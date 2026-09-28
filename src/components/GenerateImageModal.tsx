import { useState } from 'react';
import { createPortal } from 'react-dom';
import { cb } from '../ai/actions';
import type { GenerationReference } from '../ai/prompt';
import type { MediaItem } from '../types/comic';
import { uploadImage } from './panelActions';
import MediaPicker from './MediaPicker';
import MediaThumb from './MediaThumb';
import Spinner from './Spinner';
import { useMediaUrl } from './useMediaUrl';
import { useTask } from './useTask';

export interface Generated extends MediaItem {
  aspectRatio?: number;
}

interface Props {
  title: string;
  getDefaultPrompt: () => string;
  /** The reference images sent by default; the user can remove some, add others and annotate each. */
  getDefaultReferences: () => GenerationReference[];
  /** Every image in the project: what the user can pick references from. */
  media: MediaItem[];
  onGenerate: (prompt: string, references: GenerationReference[]) => Promise<Generated>;
  /** Called when the user accepts the generated image. */
  onUse: (result: Generated) => void;
  onClose: () => void;
}

function Preview({ item }: { item: MediaItem }) {
  const { url, failed } = useMediaUrl(item);
  return (
    <div
      className="checker rounded d-flex align-items-center justify-content-center mb-2"
      style={{ minHeight: 200 }}
    >
      {url ? (
        <img src={url} alt="" style={{ maxWidth: '100%', maxHeight: 320 }} />
      ) : (
        <span className="text-muted small">{failed ? 'Failed to load' : '…'}</span>
      )}
    </div>
  );
}

/** Generate an image from an editable prompt: generate, preview, then either accept it or discard it
 * and try again. Used for layer/background art and story-bible reference images alike. */
export default function GenerateImageModal({
  title,
  getDefaultPrompt,
  getDefaultReferences,
  media,
  onGenerate,
  onUse,
  onClose,
}: Props) {
  const [prompt, setPrompt] = useState(getDefaultPrompt);
  const [references, setReferences] = useState(getDefaultReferences);
  const [picking, setPicking] = useState(false);
  const max = cb().generate.maxReferenceImages();
  const [result, setResult] = useState<Generated | null>(null);
  const task = useTask();

  function addReference(mediaId: string) {
    setReferences((current) =>
      current.some((r) => r.mediaId === mediaId) ? current : [...current, { mediaId }]
    );
    setPicking(false);
  }

  function generate() {
    setResult(null);
    void task.run(async () => {
      setResult(await onGenerate(prompt, references));
    });
  }

  return createPortal(
    <>
      <div className="modal-backdrop show" />
      <div
        className="modal d-block"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="modal-dialog modal-lg modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="modal-title h5">✨ {title}</h2>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            <div className="modal-body">
              <label className="form-label small">Prompt</label>
              <textarea
                className="form-control form-control-sm mb-2"
                rows={8}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
              <label className="form-label small">
                Reference images{' '}
                <span className="text-muted">
                  ({Math.min(references.length, max)} of {max} used)
                </span>
              </label>
              {max === 0 && (
                <div className="text-muted small mb-2">
                  This generator's workflow has no reference image inputs.
                </div>
              )}
              <div className="d-flex flex-column gap-2 mb-2">
                {references.map((ref, i) => {
                  const item = media.find((m) => m.id === ref.mediaId);
                  return (
                    <div
                      key={ref.mediaId}
                      className={`d-flex gap-2 align-items-start${i >= max ? ' opacity-50' : ''}`}
                    >
                      {item ? (
                        <MediaThumb
                          item={item}
                          onRemove={() => setReferences(references.filter((_, j) => j !== i))}
                        />
                      ) : (
                        <span className="text-muted small">Missing image</span>
                      )}
                      <div className="flex-grow-1">
                        <div className="small text-muted">
                          Image {i + 1}
                          {i >= max && ' — not used (over the limit)'}
                        </div>
                        <input
                          className="form-control form-control-sm"
                          value={ref.note ?? ''}
                          placeholder="Say something about this image (optional), e.g. “use this outfit”"
                          aria-label={`Note about reference image ${i + 1}`}
                          onChange={(e) =>
                            setReferences(
                              references.map((r, j) =>
                                j === i ? { ...r, note: e.target.value } : r
                              )
                            )
                          }
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm mb-3"
                disabled={max === 0}
                onClick={() => setPicking(true)}
              >
                + Add reference image
              </button>
              {result && <Preview item={result} />}
              {task.error && <div className="text-danger small mb-2">{task.error}</div>}
            </div>
            <div className="modal-footer">
              {result ? (
                <>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    disabled={task.busy}
                    onClick={generate}
                  >
                    {task.busy && <Spinner />}✨ Regenerate
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      onUse(result);
                      onClose();
                    }}
                  >
                    Use this image
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={task.busy || !prompt.trim()}
                  onClick={generate}
                >
                  {task.busy && <Spinner />}✨ Generate
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {picking && (
        <MediaPicker
          title="Choose a reference image"
          media={media}
          prefer={{ kind: 'layer' }}
          onUpload={(file) => void task.run(async () => addReference((await uploadImage(file)).id))}
          onPick={(item) => addReference(item.id)}
          onClose={() => setPicking(false)}
        />
      )}
    </>,
    document.body
  );
}
