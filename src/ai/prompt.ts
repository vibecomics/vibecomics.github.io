import type { ComicProject } from '../types/comic';
import { findPanel, layerArtSize } from './builders';

export type ReferenceKind = 'characters' | 'objects' | 'scenes';

/** The technical requirements line for a story-bible entry's reference art: characters and objects
 * get an isolated multi-angle turnaround (so later generations have more than one angle to match);
 * a scene gets an establishing shot of the place itself, since that art is meant to be a background. */
function referenceTechnical(kind: ReferenceKind): string {
  if (kind === 'scenes') {
    return 'Establishing reference image for this setting: a clear, well-lit view of the location itself, no characters, animals or monsters in it, matching the description exactly.';
  }
  const subject = kind === 'characters' ? 'Character' : 'Object';
  return (
    `${subject} reference turnaround sheet: the same ${subject.toLowerCase()} shown from a few clear ` +
    'angles (front view, back view, and a side or three-quarter view), consistent design, proportions ' +
    'and colors across every view, on a plain solid white background: no scene, no shadow, no border, ' +
    'no baked-in text, no duplicate labels.'
  );
}

/** Stitches the prompt for a story-bible entry's reference art: STYLE, its description, then the
 * kind-appropriate technical requirements (see referenceTechnical). */
export function buildReferencePrompt(
  project: ComicProject,
  kind: ReferenceKind,
  id: string
): string {
  const entry = project.metadata[kind].find((e) => e.id === id);
  if (!entry) throw new Error(`"${id}" not found in ${kind}.`);
  return [project.metadata.style, entry.description, referenceTechnical(kind)]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Stitches the prompt for a layer's (or background's) image: STYLE, then, for a background, the
 * page and panel prompts and its scene (it's meant to depict that setting); for a foreground layer,
 * only its subject's description (not the page/panel prompts, and not its panel's background scene
 * either — any setting language anywhere in the prompt makes this model draw a full scene instead of
 * an isolated cutout, confirmed by testing a "for context only, do not draw it" scene description).
 * Then the layer prompt, then a technical requirements line.
 */
export function buildLayerPrompt(project: ComicProject, panelId: string, layerId: string): string {
  const panel = findPanel(project, panelId);
  const layer = panel?.layers.find((l) => l.id === layerId);
  if (!panel || !layer) throw new Error(`Layer "${layerId}" not found.`);
  const page = project.pages.find((p) => p.panels.some((pp) => pp.id === panelId));
  const isForeground = layer.kind === 'foreground';

  const subject = isForeground
    ? [...project.metadata.characters, ...project.metadata.objects].find(
        (e) => e.id === layer.subjectId
      )
    : project.metadata.scenes.find((s) => s.id === layer.sceneId);

  const size = layerArtSize(project, panelId, layerId);
  const technical = isForeground
    ? 'Foreground subject only, on a plain solid white background: no scene, no shadow, no border, no baked-in text.'
    : `Full-bleed background image, aspect ratio ${size?.aspectRatio ?? 1}:1, no border.`;

  const parts = isForeground
    ? [project.metadata.style, subject?.description, layer.prompt, technical]
    : [
        project.metadata.style,
        page?.prompt,
        panel.prompt,
        subject?.description,
        layer.prompt,
        technical,
      ];

  return parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join('\n\n');
}

/** A reference image chosen for one generation, with an optional note on how to use it. */
export interface GenerationReference {
  mediaId: string;
  note?: string;
}

/** Appends the user's notes about reference images, numbered by position ("Image 1" is the first
 * image sent to the generator), so the model can tell which image each note is about. */
export function appendReferenceNotes(prompt: string, references: GenerationReference[]): string {
  const lines = references.flatMap((r, i) =>
    r.note?.trim() ? [`Image ${i + 1}: ${r.note.trim()}`] : []
  );
  return lines.length ? `${prompt}\n\nAbout the reference images:\n${lines.join('\n')}` : prompt;
}
