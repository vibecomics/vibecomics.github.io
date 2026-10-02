import type { ComicProject, Layer, StoryEntry } from '../types/comic';
import { findPanel, layerArtSize } from './builders';

export type ReferenceKind = 'characters' | 'objects' | 'scenes';

/** One labeled piece of a stitched prompt (e.g. "Style", "Panel", "Layer prompt"), so a UI can show,
 * edit or drop each piece on its own instead of one opaque block of text. */
export interface PromptPart {
  label: string;
  text: string;
}

/** Trims every part's text and drops any that end up empty — what a raw list of (label, maybe-empty
 * text) pairs becomes before it's shown (buildLayerPromptParts/buildReferencePromptParts) or sent to
 * a generator (joinPromptParts). */
function keepNonEmpty(parts: { label: string; text: string | undefined }[]): PromptPart[] {
  return parts.flatMap(({ label, text }) => (text?.trim() ? [{ label, text: text.trim() }] : []));
}

/** Joins prompt parts into the single string a generator takes, in order, dropping any with no text.
 * Reproduces the equivalent buildLayerPrompt/buildReferencePrompt string, and is also what a UI (see
 * GenerateImageModal) uses to assemble its edited parts before generating. */
export function joinPromptParts(parts: PromptPart[]): string {
  return keepNonEmpty(parts)
    .map((part) => part.text)
    .join('\n\n');
}

/** The technical requirements line for a story-bible entry's reference art: a scene gets an
 * establishing shot of the place itself, since that art is meant to be a background. A character or
 * object gets a single isolated view — never several poses baked into one turnaround sheet, which
 * confuses later prompting that references it. Use variations (see Variation) to get more than one
 * pose or state, each its own image: buildReferencePromptParts appends the chosen variation's own
 * prompt (e.g. "Front view") as the last part, saying which view to draw. */
function referenceTechnical(kind: ReferenceKind): string {
  if (kind === 'scenes') {
    return 'Establishing reference image for this setting: a clear, well-lit view of the location itself, no characters, animals or monsters in it, matching the description exactly.';
  }
  const subject = kind === 'characters' ? 'Character' : 'Object';
  return (
    `${subject} reference image: a single, clear view of the ${subject.toLowerCase()}, on a flat, ` +
    'solid pure-white background (#FFFFFF): no scene, no gradient, no drop shadow or cast shadow, ' +
    'no ground plane or floor line, no border, no vignette, no baked-in text. Not a multi-view ' +
    'turnaround sheet or a grid of poses — pick one clear view and draw only that.'
  );
}

const ENTRY_LABEL: Record<ReferenceKind, string> = {
  characters: 'Character',
  objects: 'Object',
  scenes: 'Scene',
};

/** The labeled parts of a story-bible entry's reference art prompt: Style, its description (labeled
 * by kind), the kind-appropriate technical requirements (see referenceTechnical), then, when
 * `variationId` names one of the entry's variations, that variation's own prompt last (e.g. "Front
 * view, facing the camera directly.") — the most specific instruction, so it lands right before
 * generation. */
export function buildReferencePromptParts(
  project: ComicProject,
  kind: ReferenceKind,
  id: string,
  variationId?: string
): PromptPart[] {
  const entry = project.metadata[kind].find((e) => e.id === id);
  if (!entry) throw new Error(`"${id}" not found in ${kind}.`);
  const variation = variationId ? entry.variations.find((v) => v.id === variationId) : undefined;
  if (variationId && !variation) {
    throw new Error(`Variation "${variationId}" not found on "${id}".`);
  }
  return keepNonEmpty([
    { label: 'Style', text: project.metadata.style },
    { label: ENTRY_LABEL[kind], text: entry.description },
    { label: 'Technical requirements', text: referenceTechnical(kind) },
    { label: 'Variation', text: variation?.prompt },
  ]);
}

/** Stitches the prompt for a story-bible entry's reference art (see buildReferencePromptParts). */
export function buildReferencePrompt(
  project: ComicProject,
  kind: ReferenceKind,
  id: string,
  variationId?: string
): string {
  return joinPromptParts(buildReferencePromptParts(project, kind, id, variationId));
}

/** The story-bible entry a layer shows: a character or object (foreground) or a scene (background). */
export function layerSubject(project: ComicProject, layer: Layer): StoryEntry | undefined {
  return layer.kind === 'foreground'
    ? [...project.metadata.characters, ...project.metadata.objects].find(
        (e) => e.id === layer.subjectId
      )
    : project.metadata.scenes.find((s) => s.id === layer.sceneId);
}

/** What to label a layer's linked story-bible entry: "Scene" for a background, else "Character" or
 * "Object" depending on which list the subject is in. */
function subjectLabel(project: ComicProject, layer: Layer): string {
  if (layer.kind === 'background') return 'Scene';
  return project.metadata.objects.some((o) => o.id === layer.subjectId) ? 'Object' : 'Character';
}

/**
 * The labeled parts of a layer's (or background's) image prompt: Style, then, for a background, the
 * page and panel prompts and its scene (it's meant to depict that setting); for a foreground layer,
 * only its subject's description (not the page/panel prompts, and not its panel's background scene
 * either — any setting language anywhere in the prompt makes this model draw a full scene instead of
 * an isolated cutout, confirmed by testing a "for context only, do not draw it" scene description).
 * Then the layer prompt, then a technical requirements line.
 */
export function buildLayerPromptParts(
  project: ComicProject,
  panelId: string,
  layerId: string
): PromptPart[] {
  const panel = findPanel(project, panelId);
  const layer = panel?.layers.find((l) => l.id === layerId);
  if (!panel || !layer) throw new Error(`Layer "${layerId}" not found.`);
  const page = project.pages.find((p) => p.panels.some((pp) => pp.id === panelId));
  const isForeground = layer.kind === 'foreground';

  const subject = layerSubject(project, layer);

  const size = layerArtSize(project, panelId, layerId);
  const technical = isForeground
    ? 'A single image of one pose only, on a flat, solid pure-white background (#FFFFFF): no scene, no gradient, no drop shadow or cast shadow, no ground plane or floor line, no border, no vignette, no baked-in text. Not a multi-view turnaround sheet or a grid of poses, even if a reference image shows the subject from several angles — pick one pose and draw only that.'
    : `Full-bleed background image, aspect ratio ${size?.aspectRatio ?? 1}:1, no border.`;

  const style = { label: 'Style', text: project.metadata.style };
  const subjectPart = { label: subjectLabel(project, layer), text: subject?.description };
  const layerPart = { label: 'Layer prompt', text: layer.prompt };
  const technicalPart = { label: 'Technical requirements', text: technical };

  return keepNonEmpty(
    isForeground
      ? [style, subjectPart, layerPart, technicalPart]
      : [
          style,
          { label: 'Page', text: page?.prompt },
          { label: 'Panel', text: panel.prompt },
          subjectPart,
          layerPart,
          technicalPart,
        ]
  );
}

/** Stitches the prompt for a layer's (or background's) image (see buildLayerPromptParts). */
export function buildLayerPrompt(project: ComicProject, panelId: string, layerId: string): string {
  return joinPromptParts(buildLayerPromptParts(project, panelId, layerId));
}

/** A reference image chosen for one generation, with an optional note on how to use it. */
export interface GenerationReference {
  mediaId: string;
  note?: string;
}

/** Every reference-image id of a story-bible entry: its own (ungrouped) imageIds plus every
 * variation's, in that order. Used wherever "all the reference art this entry has" is wanted rather
 * than one specific variation's. */
export function allEntryImageIds(entry: StoryEntry): string[] {
  return [...entry.imageIds, ...entry.variations.flatMap((v) => v.imageIds)];
}

/**
 * A ready-made note for a reference image that is a story-bible entry's own reference art (its
 * `imageIds`, or one of its variations' `imageIds`, lists this mediaId). Checked against those lists
 * rather than the MediaItem's own `subjectId`/`sceneId` tag, since that tag is only set for art
 * generated or uploaded straight onto a layer — a character's own reference images are frequently
 * untagged even though they're unambiguously that character's art. Undefined for an image linked to
 * no entry (a plain upload, say) — the user writes their own note for those.
 *
 * Names the entry only when it's a *different* one than `currentEntryId` (the character/object/scene
 * this generation is of, when known) — e.g. a layer showing Ashwini that also references Cupcake's
 * art needs "this is Cupcake" to disambiguate, but a character's own reference sheet regenerating
 * from its own past art doesn't: the name carries no visual information and the entry's description
 * already says who they are, so restating it is just noise (and risks the model rendering it as
 * baked-in text).
 */
export function defaultReferenceNote(
  project: ComicProject,
  mediaId: string,
  currentEntryId?: string
): string | undefined {
  const character = project.metadata.characters.find((c) => allEntryImageIds(c).includes(mediaId));
  if (character) {
    return character.id === currentEntryId
      ? "Match this character's design exactly (face, proportions, outfit, colors)."
      : `This is ${character.name} — match this character's design exactly (face, proportions, outfit, colors).`;
  }
  const object = project.metadata.objects.find((o) => allEntryImageIds(o).includes(mediaId));
  if (object) {
    return object.id === currentEntryId
      ? "Match this object's design exactly."
      : `This is ${object.name} — match this object's design exactly.`;
  }
  const scene = project.metadata.scenes.find((s) => allEntryImageIds(s).includes(mediaId));
  if (scene) {
    return scene.id === currentEntryId
      ? 'Match this location exactly.'
      : `This is the reference for the "${scene.name}" setting — match this location.`;
  }
  return undefined;
}

/** Appends the user's notes about reference images, numbered by position ("Image 1" is the first
 * image sent to the generator), so the model can tell which image each note is about. */
export function appendReferenceNotes(prompt: string, references: GenerationReference[]): string {
  const lines = references.flatMap((r, i) =>
    r.note?.trim() ? [`Image ${i + 1}: ${r.note.trim()}`] : []
  );
  return lines.length ? `${prompt}\n\nAbout the reference images:\n${lines.join('\n')}` : prompt;
}
