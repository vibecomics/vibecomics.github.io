import { useState } from 'react';
import Modal from './Modal';
import { cb } from '../ai/actions';
import {
  defaultReferenceNote,
  initialPromptText,
  insertPartText,
  joinPromptParts,
  removePartText,
} from '../ai/prompt';
import type { GenerationReference, PromptPart } from '../ai/prompt';
import type { ComicProject, MediaItem } from '../types/comic';
import { uploadImage } from './panelActions';
import { TrashIcon } from './Icons';
import MediaPicker from './MediaPicker';
import MediaThumb from './MediaThumb';
import Spinner from './Spinner';
import { useMediaUrl } from './useMediaUrl';
import { useTask } from './useTask';

export interface Generated extends MediaItem {
  aspectRatio?: number;
}

/** One item's outcome from a bulk generation (see the `bulk` prop). */
export interface BulkResult {
  id: string;
  /** Shown in the results list, e.g. a variation's name. */
  label: string;
  ok: boolean;
  error?: string;
}

interface CommonProps {
  title: string;
  /** For looking up a manually-added reference's subject/scene, to prefill its note (see
   * defaultReferenceNote). */
  project: ComicProject;
  /** The character/object/scene this generation is of, if any — so a manually-added reference of
   * that same entry gets a note that doesn't just restate its own name (see defaultReferenceNote). */
  currentEntryId?: string;
  /** The labeled pieces the prompt is stitched from (Style, Panel, Layer prompt, ...): each is shown
   * collapsed, expandable to edit or drop on its own, instead of one large block of text. */
  getDefaultPromptParts: () => PromptPart[];
  /** The reference images sent by default; the user can remove some, add others and annotate each. */
  getDefaultReferences: () => GenerationReference[];
  /** Shows the prompt as one editable text box with a button per part (Style, Character, ...) that
   * inserts or removes that part's text; any part can be toggled off. Without this, the parts are
   * shown as an expandable list. The parts named in `coreLabels` start in the prompt even when there
   * are reference images; otherwise every part does. */
  promptButtons?: { coreLabels: readonly string[] };
  /** Every image in the project: what the user can pick references from. */
  media: MediaItem[];
  onClose: () => void;
}

/** The usual flow: generate one image, preview it, then either accept it or discard it and try again. */
interface SingleProps extends CommonProps {
  bulk?: undefined;
  onGenerate: (prompt: string, references: GenerationReference[]) => Promise<Generated>;
  /**
   * Called with a generated image, `primary` false the instant generation succeeds (before the user
   * does anything else — so the image is attached and never lost even if the tab is closed or
   * reloaded right away) and again with `primary` true if the user then clicks "Use this image" to
   * promote it to the layer's/entry's active image.
   */
  onUse: (result: Generated, opts: { primary: boolean }) => void;
}

/** Generates one image per item in a single click instead of the usual generate-preview-accept flow
 * for one image: each item auto-commits itself (there's no one to preview a batch for, same as
 * generate.dirty), so there's no onGenerate/onUse — the dialog just shows which items succeeded.
 * Used for the entry-level "Generate all variations" action. */
interface BulkProps extends CommonProps {
  bulk: {
    /** e.g. "3 variations", shown on the Generate button. */
    label: string;
    onGenerateAll: (prompt: string, references: GenerationReference[]) => Promise<BulkResult[]>;
  };
  onGenerate?: undefined;
  onUse?: undefined;
}

type Props = SingleProps | BulkProps;

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
 * and try again (or, in `bulk` mode, generate one image per item in a click, each auto-committing
 * itself). Used for layer/background art and story-bible reference images alike. */
export default function GenerateImageModal(props: Props) {
  const {
    title,
    project,
    currentEntryId,
    getDefaultPromptParts,
    getDefaultReferences,
    promptButtons,
    media,
    bulk,
    onClose,
  } = props;
  const [parts, setParts] = useState(getDefaultPromptParts);
  // Collapsed by default (a stitched prompt can be long); expanded state is keyed by label rather
  // than index so it survives a part being deleted.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [references, setReferences] = useState(getDefaultReferences);
  // The whole prompt, for the prompt-button layout (the list layout derives it from `parts`).
  const [text, setText] = useState(() =>
    promptButtons ? initialPromptText(parts, promptButtons.coreLabels, references.length > 0) : ''
  );
  const [picking, setPicking] = useState(false);
  const max = cb().generate.maxReferenceImages();
  const [result, setResult] = useState<Generated | null>(null);
  const [bulkResults, setBulkResults] = useState<BulkResult[] | null>(null);
  const task = useTask();

  const prompt = promptButtons ? text : joinPromptParts(parts);

  function togglePromptPart(part: PromptPart) {
    setText((current) => {
      const piece = part.text.trim();
      return current.includes(piece)
        ? removePartText(current, piece)
        : insertPartText(current, parts, part);
    });
  }

  function togglePart(label: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function updatePartText(i: number, text: string) {
    setParts((current) => current.map((part, j) => (j === i ? { ...part, text } : part)));
  }

  function removePart(i: number) {
    setParts((current) => current.filter((_, j) => j !== i));
  }

  function addReference(mediaId: string) {
    setReferences((current) => {
      if (current.some((r) => r.mediaId === mediaId)) return current;
      const note = defaultReferenceNote(project, mediaId, currentEntryId);
      return [...current, note ? { mediaId, note } : { mediaId }];
    });
    setPicking(false);
  }

  function generate() {
    if (props.bulk) {
      setBulkResults(null);
      void task.run(async () => setBulkResults(await props.bulk.onGenerateAll(prompt, references)));
      return;
    }
    setResult(null);
    void task.run(async () => {
      const generated = await props.onGenerate(prompt, references);
      // Attach it the moment it exists, before the user can do anything else (including closing the
      // tab) — never leave a generated image sitting unattached, waiting on a later action.
      props.onUse(generated, { primary: false });
      setResult(generated);
    });
  }

  function useResult() {
    if (!result || props.bulk) return;
    props.onUse(result, { primary: true });
    onClose();
  }

  return (
    <>
      <Modal
        title={
          <>
            {bulk ? '🪄' : '✨'} {title}
          </>
        }
        label={title}
        wide
        onClose={onClose}
        footer={
          <div className="modal-footer">
            {bulk ? (
              bulkResults ? (
                <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
                  Done
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={task.busy || !prompt.trim()}
                  onClick={generate}
                >
                  {task.busy && <Spinner />}🪄 Generate {bulk.label}
                </button>
              )
            ) : result ? (
              <>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  disabled={task.busy}
                  onClick={generate}
                >
                  {task.busy && <Spinner />}✨ Regenerate
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={useResult}>
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
        }
      >
        {promptButtons ? (
          <div className="mb-3">
            <label className="form-label small">Prompt</label>
            <div className="d-flex flex-wrap gap-2 mb-2">
              {parts.map((part) => {
                const piece = part.text.trim();
                const selected = text.includes(piece);
                return (
                  <button
                    key={part.label}
                    type="button"
                    className={`btn btn-sm ${selected ? 'btn-primary' : 'btn-outline-secondary'}`}
                    aria-pressed={selected}
                    title={`${selected ? 'Remove' : 'Insert'} the ${part.label} text`}
                    onClick={() => togglePromptPart(part)}
                  >
                    {selected && '✓ '}
                    {part.label}
                  </button>
                );
              })}
            </div>
            <textarea
              className="form-control form-control-sm w-100"
              rows={8}
              value={text}
              aria-label="Prompt"
              onChange={(e) => setText(e.target.value)}
            />
          </div>
        ) : (
          <>
            <label className="form-label small">
              Prompt <span className="text-muted">({parts.length} parts stitched together)</span>
            </label>
            <div className="mb-3">
              {parts.length === 0 && (
                <div className="text-muted small mb-2">
                  Every part of the prompt was removed — there's nothing to generate from.
                </div>
              )}
              {parts.map((part, i) => {
                const isOpen = expanded.has(part.label);
                return (
                  <div key={part.label} className="mb-1">
                    <div className="d-flex align-items-center">
                      <button
                        type="button"
                        className="btn btn-link btn-sm flex-grow-1 text-start text-decoration-none d-flex align-items-center gap-2 px-2 py-1"
                        style={{ minWidth: 0 }}
                        onClick={() => togglePart(part.label)}
                        aria-expanded={isOpen}
                      >
                        <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                        <strong className="small text-nowrap">{part.label}</strong>
                        {!isOpen && (
                          <span className="text-muted small text-truncate" style={{ minWidth: 0 }}>
                            {part.text}
                          </span>
                        )}
                      </button>
                      {isOpen && (
                        <button
                          type="button"
                          className="btn btn-link btn-sm p-0 me-2 text-secondary d-flex align-items-center"
                          title={`Remove "${part.label}" from the prompt`}
                          aria-label={`Remove "${part.label}" from the prompt`}
                          onClick={() => removePart(i)}
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </div>
                    {isOpen && (
                      <div className="px-2 pb-2">
                        <textarea
                          className="form-control form-control-sm w-100"
                          rows={4}
                          value={part.text}
                          aria-label={`${part.label} text`}
                          onChange={(e) => updatePartText(i, e.target.value)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
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
                <textarea
                  className="form-control form-control-sm flex-grow-1"
                  style={{ height: 72, resize: 'none' }}
                  value={ref.note ?? ''}
                  placeholder="What should the generator take from this image? e.g. “match this exact outfit”, “use the pose only”, “ignore the background”"
                  aria-label={
                    i >= max
                      ? `Note about reference image ${i + 1} (not used — over the limit)`
                      : `Note about reference image ${i + 1}`
                  }
                  onChange={(e) =>
                    setReferences(
                      references.map((r, j) => (j === i ? { ...r, note: e.target.value } : r))
                    )
                  }
                />
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
        {!bulk && result && <Preview item={result} />}
        {bulk && bulkResults && (
          <ul className="list-unstyled mb-2">
            {bulkResults.map((r) => (
              <li key={r.id} className={r.ok ? 'text-body' : 'text-danger'}>
                {r.ok ? '✓' : '✗'} {r.label}
                {!r.ok && r.error ? ` — ${r.error}` : ''}
              </li>
            ))}
          </ul>
        )}
        {task.error && <div className="text-danger small mb-2">{task.error}</div>}
      </Modal>
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
    </>
  );
}
