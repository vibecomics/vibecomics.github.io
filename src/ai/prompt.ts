import type { ComicProject, Layer, StoryEntry } from '../types/comic';
import { findPanel, layerArtSize } from './builders';

export type ReferenceKind = 'characters' | 'objects' | 'scenes';

/** One labeled piece of a stitched prompt (e.g. "Style", "Panel", "Layer prompt"), so a UI can show,
 * edit or drop each piece on its own instead of one opaque block of text. */
export interface PromptPart {
  label: string;
  text: string;
}

/** The layer (or background) prompt parts the generate dialog starts with even when there are reference
 * images; every part can still be toggled off there. */
export const CORE_LAYER_PARTS = ['Layer prompt', 'Technical requirements'] as const;

/** Trims every part's text and drops any that end up empty — what a raw list of (label, maybe-empty
 * text) pairs becomes before it's shown (buildLayerPromptParts/buildReferencePromptParts) or sent to
 * a generator (joinPromptParts). */
function keepNonEmpty(parts: { label: string; text: string | undefined }[]): PromptPart[] {
  return parts.flatMap(({ label, text }) => (text?.trim() ? [{ label, text: text.trim() }] : []));
}

const PART_SEPARATOR = '\n\n';

/** The starting text for the generate dialog's prompt buttons: the core parts, plus every other part
 * when there are no reference images to carry the look instead. */
export function initialPromptText(
  parts: PromptPart[],
  coreLabels: readonly string[],
  hasReferences: boolean
): string {
  return joinPromptParts(parts.filter((part) => coreLabels.includes(part.label) || !hasReferences));
}

/** Adds one part's text to the prompt, placed after the nearest earlier part already in it (or before
 * the nearest later one), so the prompt keeps its parts in their stitching order. */
export function insertPartText(text: string, parts: PromptPart[], part: PromptPart): string {
  const piece = part.text.trim();
  const index = parts.findIndex((p) => p.label === part.label);
  const inPrompt = (p: PromptPart) => {
    const t = p.text.trim();
    return t && text.includes(t) ? t : undefined;
  };
  for (let j = index - 1; j >= 0; j--) {
    const t = inPrompt(parts[j]);
    if (t) {
      const end = text.indexOf(t) + t.length;
      return text.slice(0, end) + PART_SEPARATOR + piece + text.slice(end);
    }
  }
  for (let j = index + 1; j < parts.length; j++) {
    const t = inPrompt(parts[j]);
    if (t) {
      const start = text.indexOf(t);
      return text.slice(0, start) + piece + PART_SEPARATOR + text.slice(start);
    }
  }
  return text.trim() ? piece + PART_SEPARATOR + text : piece;
}

/** Removes one part's text from the prompt along with the separator that joined it in. */
export function removePartText(text: string, piece: string): string {
  for (const candidate of [PART_SEPARATOR + piece, piece + PART_SEPARATOR, piece]) {
    const at = text.indexOf(candidate);
    if (at !== -1) return text.slice(0, at) + text.slice(at + candidate.length);
  }
  return text;
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
 * establishing shot of the place itself, since that art is meant to be a background, so it always
 * rules out characters, people, animals or monsters — the entry's own description never has to say
 * so. A character or object gets a single isolated view with clean, well-defined outlines ready for a
 * clean cutout — never several poses baked into one turnaround sheet, which confuses later prompting
 * that references it; an object additionally always rules out people or human figures, since a prop
 * entry is never a person (a character might be an animal rather than a person, so that kind gets no
 * such blanket rule). These rule-outs are a backstop, not the main defense: the main defense is
 * styleAddendum (below) never putting figure-only language — the actual source of unwanted people —
 * into an object's or scene's prompt in the first place. Use variations (see Variation) to get more
 * than one pose or state, each its own image: buildReferencePromptParts appends the chosen
 * variation's own prompt (e.g. "Front view") as the last part, saying which view to draw. */
function referenceTechnical(kind: ReferenceKind): string {
  if (kind === 'scenes') {
    return 'Establishing reference image for this setting: a clear, well-lit view of the location itself, no characters, people, animals or monsters in it, matching the description exactly.';
  }
  const subject = kind === 'characters' ? 'Character' : 'Object';
  const isObject = kind === 'objects';
  const noPeople = isObject ? ', no people or human figures in it' : '';
  const variety = isObject ? 'views' : 'poses';
  return (
    `${subject} reference image: a single, clear view of the ${subject.toLowerCase()}${noPeople}, with ` +
    'clean, well-defined outlines ready for a clean cutout, on a flat, solid pure-white background ' +
    '(#FFFFFF): no scene, no gradient, no drop shadow or cast shadow, no ground plane or floor line, ' +
    `no border, no vignette, no baked-in text. Not a multi-view turnaround sheet or a grid of ${variety} ` +
    '— pick one clear view and draw only that.'
  );
}

const ENTRY_LABEL: Record<ReferenceKind, string> = {
  characters: 'Character',
  objects: 'Object',
  scenes: 'Scene',
};

/** The kind-specific addendum to Style (metadata.characterStyle/sceneStyle) a reference-art or layer
 * prompt stitches in right after the shared Style paragraph: design language that only makes sense
 * for a figure (characters) or background-specific rendering notes (scenes). An object gets none —
 * there's currently no object-specific style language, and leaving the slot empty rather than
 * inventing content for it is the point: a kind only gets what's actually true of it. */
function styleAddendum(project: ComicProject, kind: ReferenceKind): string | undefined {
  if (kind === 'characters') return project.metadata.characterStyle;
  if (kind === 'scenes') return project.metadata.sceneStyle;
  return undefined;
}

const STYLE_ADDENDUM_LABEL: Record<ReferenceKind, string> = {
  characters: 'Character style',
  objects: 'Object style',
  scenes: 'Scene style',
};

/** The labeled parts of a story-bible entry's reference art prompt: Style, the kind's style addendum
 * (see styleAddendum — omitted for an object), its description (labeled by kind), the kind-appropriate
 * technical requirements (see referenceTechnical), then, when `variationId` names one of the entry's
 * variations, that variation's own prompt last (e.g. "Front view, facing the camera directly.") — the
 * most specific instruction, so it lands right before generation. */
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
    { label: STYLE_ADDENDUM_LABEL[kind], text: styleAddendum(project, kind) },
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

/** A layer's style-addendum label, matching STYLE_ADDENDUM_LABEL: "Character style" for a character
 * foreground, "Scene style" for a background, nothing for an object foreground (no object-specific
 * style language exists). */
function layerStyleAddendum(project: ComicProject, label: string): string | undefined {
  if (label === 'Character') return project.metadata.characterStyle;
  if (label === 'Scene') return project.metadata.sceneStyle;
  return undefined;
}

/**
 * The labeled parts of a layer's (or background's) image prompt: Style, the kind's style addendum
 * (see layerStyleAddendum — omitted for an object), the linked entry's description (a background's
 * scene, or a foreground layer's character/object), the layer prompt, then a technical requirements
 * line. The page and panel prompts are deliberately left out of both: they narrate the whole panel
 * (people, action), so on a background they got drawn into the scene, and on a foreground any setting
 * language makes this model draw a full scene instead of an isolated cutout (an earlier test of a
 * "for context only, do not draw it" scene description didn't prevent that for foregrounds; a
 * disclaimer on page/panel prompts for backgrounds hasn't been tried).
 *
 * Keeping an object's or scene's prompt free of figure-only language (never putting characterStyle
 * into either, and never putting a character description into a background) is the main defense
 * against an unwanted person showing up — not the "no people"/"no characters" rule-outs in the
 * technical line below, which exist only as a backstop.
 */
export function buildLayerPromptParts(
  project: ComicProject,
  panelId: string,
  layerId: string
): PromptPart[] {
  const panel = findPanel(project, panelId);
  const layer = panel?.layers.find((l) => l.id === layerId);
  if (!panel || !layer) throw new Error(`Layer "${layerId}" not found.`);
  const isForeground = layer.kind === 'foreground';

  const subject = layerSubject(project, layer);
  const label = subjectLabel(project, layer);
  const isObject = isForeground && label === 'Object';

  const size = layerArtSize(project, panelId, layerId);
  const technical = isObject
    ? 'A single image of one view only with clean, well-defined outlines ready for a clean cutout, on a flat, solid pure-white background (#FFFFFF): no scene, no gradient, no drop shadow or cast shadow, no ground plane or floor line, no border, no vignette, no baked-in text, no people, no hands. Not a multi-view turnaround sheet or a grid of views, even if a reference image shows the subject from several angles — pick one view and draw only that.'
    : isForeground
      ? 'A single image of one pose only with clean, well-defined outlines ready for a clean cutout, on a flat, solid pure-white background (#FFFFFF): no scene, no gradient, no drop shadow or cast shadow, no ground plane or floor line, no border, no vignette, no baked-in text. Not a multi-view turnaround sheet or a grid of poses, even if a reference image shows the subject from several angles — pick one pose and draw only that.'
      : `Full-bleed background image, aspect ratio ${size?.aspectRatio ?? 1}:1, no border, no characters, people, animals or monsters in it — a pure setting, nothing else is drawn on it.`;

  const style = { label: 'Style', text: project.metadata.style };
  const styleAddendumPart = { label: `${label} style`, text: layerStyleAddendum(project, label) };
  const subjectPart = { label, text: subject?.description };
  const layerPart = { label: 'Layer prompt', text: layer.prompt };
  const technicalPart = { label: 'Technical requirements', text: technical };

  return keepNonEmpty([style, styleAddendumPart, subjectPart, layerPart, technicalPart]);
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
