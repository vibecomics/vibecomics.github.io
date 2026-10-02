import { useState } from 'react';
import { cb } from '../ai/actions';
import type { MediaItem, Variation } from '../types/comic';
import GenerateIconButton from './GenerateIconButton';
import GenerateImageModal from './GenerateImageModal';
import type { BulkResult } from './GenerateImageModal';
import ImageLightbox from './ImageLightbox';
import { useProject } from './ProjectContext';
import { useReferenceGenerationStatus } from './useGenerationStatus';
import { useTask } from './useTask';
import VariationRow from './VariationRow';

interface Props {
  kind: 'characters' | 'scenes' | 'objects';
  entryId: string;
  imageIds: string[];
  variations: Variation[];
  media: MediaItem[];
}

/** Reference images of a story-bible entry, organized as one tab per variation (pose/state; see the
 * Variation type) — there is no other way to add reference art, so every image belongs to one. Each
 * tab's title is the variation's name, editable in place; the last tab adds a new one. The 🪄 button
 * to the right of the tabs generates one image for every variation in one click. */
export default function ReferenceImages({ kind, entryId, imageIds, variations, media }: Props) {
  const task = useTask();
  const project = useProject();
  // The id of the image open in the lightbox, not an index: prev/next cycles across every image
  // this entry has, across every variation, whichever thumbnail was clicked to open it.
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [generatingModal, setGeneratingModal] = useState(false);
  const [activeVariationId, setActiveVariationId] = useState<string | null>(
    () => variations[0]?.id ?? null
  );
  // Which variation (if any) each image belongs to, so the lightbox can say "Front view" etc. and
  // offer to make an older image of a variation the active one again (see promoteImage).
  const allImages = [
    ...imageIds.flatMap((id) => {
      const item = media.find((m) => m.id === id);
      return item ? [{ item, variation: null as Variation | null }] : [];
    }),
    ...variations.flatMap((v) =>
      v.imageIds.flatMap((id) => {
        const item = media.find((m) => m.id === id);
        return item ? [{ item, variation: v }] : [];
      })
    ),
  ];
  const lightboxItems = allImages.map((a) => a.item);
  const lightboxLabels = allImages.map((a) => (a.variation ? a.variation.name : 'Reference image'));
  // The active image of a variation is the last one in its imageIds (see VariationRow); offering to
  // "use" it again would be a no-op, so hide the button for it.
  const lightboxCanUse = allImages.map(
    (a) => a.variation !== null && a.variation.imageIds.at(-1) !== a.item.id
  );
  const status = useReferenceGenerationStatus(kind, entryId);
  const activeVariation =
    variations.find((v) => v.id === activeVariationId) ?? variations[0] ?? null;

  function deleteMedia(item: MediaItem) {
    const message = `Delete "${item.name}"? It moves to the storage trash and is removed from every layer and reference that uses it.`;
    if (!window.confirm(message)) return;
    void task.run(async () => void (await cb().media.delete(item.id)));
  }

  /** Makes `item` the active image of the variation it belongs to again, by moving it to the end of
   * that variation's imageIds (the convention VariationRow and layer-reference defaults read). */
  function promoteImage(item: MediaItem) {
    const owner = allImages.find((a) => a.item.id === item.id)?.variation;
    if (!owner) return;
    const ids = owner.imageIds.filter((id) => id !== item.id);
    ids.push(item.id);
    cb().variations.update(kind, entryId, owner.id, { imageIds: ids });
  }

  function addVariation() {
    const created = cb().variations.add(kind, entryId, { name: 'New variation' });
    setActiveVariationId(created.id);
  }

  function renameVariation(variation: Variation, name: string) {
    const trimmed = name.trim();
    if (trimmed && trimmed !== variation.name) {
      cb().variations.update(kind, entryId, variation.id, { name: trimmed });
    }
  }

  function deleteVariation(variation: Variation) {
    if (!window.confirm(`Delete the "${variation.name}" variation?`)) return;
    cb().variations.delete(kind, entryId, variation.id);
    if (activeVariationId === variation.id) {
      const remaining = variations.filter((v) => v.id !== variation.id);
      setActiveVariationId(remaining[0]?.id ?? null);
    }
  }

  return (
    <div className="mt-3">
      <div className="d-flex align-items-end gap-2 mb-2">
        <ul className="nav nav-tabs flex-grow-1 mb-0">
          {variations.map((variation) => {
            const isActive = variation.id === activeVariation?.id;
            const dirtyDot = variation.dirty && (
              <button
                type="button"
                className="btn btn-link text-warning text-decoration-none p-0 ms-1"
                style={{ fontSize: '0.55rem', lineHeight: 1 }}
                title="The prompt changed since this image was made; click to mark it as up to date"
                aria-label="Prompt changed since the image was made; click to mark it as up to date"
                onClick={(e) => {
                  e.stopPropagation();
                  cb().variations.update(kind, entryId, variation.id, { dirty: false });
                }}
              >
                ●
              </button>
            );
            return (
              <li className="nav-item" key={variation.id}>
                {isActive ? (
                  <span className="nav-link active d-inline-flex align-items-center">
                    <input
                      key={variation.id}
                      className="variation-tab-name-input"
                      style={{ width: `${Math.max(4, variation.name.length)}ch` }}
                      defaultValue={variation.name}
                      aria-label="Variation name"
                      autoFocus
                      onFocus={(e) => e.target.select()}
                      onBlur={(e) => {
                        const value = e.target.value;
                        renameVariation(variation, value);
                        if (!value.trim()) e.target.value = variation.name;
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    />
                    {dirtyDot}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="nav-link d-inline-flex align-items-center"
                    onClick={() => setActiveVariationId(variation.id)}
                  >
                    {variation.name || 'Untitled'}
                    {dirtyDot}
                  </button>
                )}
              </li>
            );
          })}
          <li className="nav-item">
            <button
              type="button"
              className="nav-link"
              aria-label="Add a variation"
              title="Add a variation"
              onClick={addVariation}
            >
              +
            </button>
          </li>
        </ul>
        {variations.length > 0 && (
          <GenerateIconButton
            status={status}
            title="Generate one image for every variation"
            all
            onClick={() => setGeneratingModal(true)}
            onCancel={() => cb().generate.cancelReference(kind, entryId)}
          />
        )}
      </div>

      {activeVariation ? (
        <VariationRow
          key={activeVariation.id}
          kind={kind}
          entryId={entryId}
          variation={activeVariation}
          media={media}
          onOpenImage={setViewingId}
          onDelete={() => deleteVariation(activeVariation)}
        />
      ) : (
        <p className="text-muted small">No variations yet — click + to add one.</p>
      )}

      {generatingModal && (
        <GenerateImageModal
          title="Generate reference images"
          project={project}
          currentEntryId={entryId}
          getDefaultPromptParts={() => cb().generate.referencePromptParts(kind, entryId)}
          getDefaultReferences={() => cb().generate.entryReferences(kind, entryId)}
          media={media}
          bulk={{
            label: `${variations.length} variation${variations.length === 1 ? '' : 's'}`,
            onGenerateAll: async (prompt, references) => {
              const outcomes = await cb().generate.allVariations(kind, entryId, prompt, references);
              return outcomes.map((o): BulkResult => ({
                id: o.variationId,
                label: variations.find((v) => v.id === o.variationId)?.name ?? o.variationId,
                ok: o.ok,
                error: o.error,
              }));
            },
          }}
          onClose={() => setGeneratingModal(false)}
        />
      )}
      {viewingId !== null && (
        <ImageLightbox
          items={lightboxItems}
          labels={lightboxLabels}
          canUse={lightboxCanUse}
          start={Math.max(
            0,
            lightboxItems.findIndex((item) => item.id === viewingId)
          )}
          onClose={() => setViewingId(null)}
          onDelete={deleteMedia}
          onUse={promoteImage}
        />
      )}
      {task.error && <div className="text-danger small mt-2">{task.error}</div>}
    </div>
  );
}
