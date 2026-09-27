/**
 * Checks a project for problems that do not stop it from opening but make it wrong or hard to work
 * with: references to things that no longer exist, images that disagree with the layers using them,
 * names that are duplicated or say nothing. Pure and read-only, so the editor, the API and the CLI
 * all use it. `assertValidProject` (project.ts) is the other check: it decides whether a file can
 * be opened at all, while lint never blocks opening or saving.
 */
import type { ComicProject, Layer } from '../types/comic';
import { driveFileIdFromUrl } from '../utils/driveUrl';
import type { Where } from './merge';

export type LintSeverity = 'error' | 'warning' | 'info';

/** Where a finding is: the editor tab, page and panel (as for a merge conflict), plus what exactly. */
export interface LintWhere extends Where {
  layerId?: string;
  /** A character, object or scene. */
  entityId?: string;
  mediaId?: string;
}

/** An API call that fixes a finding. Only ever clears or unlinks something: never deletes or renames. */
export interface LintFix {
  /** e.g. "layers.update". */
  call: string;
  args: unknown[];
}

export interface LintFinding {
  /** Stable name of the rule, e.g. "dangling-subject". */
  code: string;
  severity: LintSeverity;
  /** Says what is wrong, naming things by name and id. */
  message: string;
  where: LintWhere;
  fix?: LintFix;
}

type Kind = 'characters' | 'objects' | 'scenes';
const KIND_LABEL = { characters: 'Character', objects: 'Object', scenes: 'Scene' } as const;
const KIND_TAB = { characters: 'cast', objects: 'cast', scenes: 'scenes' } as const;

/** Names an auto-numbered layer gets; they say nothing about what the layer holds. */
const DEFAULT_LAYER_NAME = /^layer( \d+)?$/i;
/** File names a camera, a screenshot tool or a generator gives: they say nothing about the picture. */
const JUNK_MEDIA_NAME =
  /^(image|img|photo|pic|dsc|screenshot|untitled|unnamed|download)[-_ ()\d]*(\.\w+)?$/i;

const normalized = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
const quoted = (name: string) => `"${name}"`;
const withoutIds = (list: string[], gone: Set<string>) => list.filter((id) => !gone.has(id));
const ORDER: Record<LintSeverity, number> = { error: 0, warning: 1, info: 2 };

interface Placed {
  layer: Layer;
  pageId: string;
  panelId: string;
  label: string;
}

/** Every problem found in the project, errors first (then warnings, then info), each in project order. */
export function lintProject(project: ComicProject): LintFinding[] {
  const findings: LintFinding[] = [];
  const add = (finding: LintFinding) => void findings.push(finding);
  const { metadata } = project;

  const characters = metadata.characters;
  const objects = metadata.objects;
  const scenes = metadata.scenes;
  const media = metadata.media;
  const mediaById = new Map(media.map((item) => [item.id, item]));
  const mediaByFile = new Map(media.map((item) => [item.driveFileId, item]));
  const characterIds = new Set(characters.map((c) => c.id));
  const subjectIds = new Set([...characters, ...objects].map((e) => e.id));
  const sceneIds = new Set(scenes.map((s) => s.id));

  const layers: Placed[] = project.pages.flatMap((page) =>
    page.panels.flatMap((panel, panelIndex) =>
      panel.layers.map((layer) => ({
        layer,
        pageId: page.id,
        panelId: panel.id,
        label: `Layer ${quoted(layer.name)} (${layer.id}) on page ${page.number}${page.title ? ` ${quoted(page.title)}` : ''}, panel ${panelIndex + 1}`,
      }))
    )
  );
  const layerWhere = ({ layer, pageId, panelId }: Placed): LintWhere => ({
    tab: 'pages',
    pageId,
    panelId,
    layerId: layer.id,
  });

  // ---- ids ---------------------------------------------------------------------------------
  const duplicateIds = (label: string, entries: Array<{ id: string; where: LintWhere }>) => {
    const seen = new Set<string>();
    const reported = new Set<string>();
    for (const { id, where } of entries) {
      if (seen.has(id) && !reported.has(id)) {
        reported.add(id);
        add({
          code: 'duplicate-id',
          severity: 'error',
          message: `Two ${label} share the id ${id}, so anything pointing at it is ambiguous.`,
          where,
        });
      }
      seen.add(id);
    }
  };
  duplicateIds(
    'pages',
    project.pages.map((page) => ({ id: page.id, where: { tab: 'pages', pageId: page.id } }))
  );
  duplicateIds(
    'panels',
    project.pages.flatMap((page) =>
      page.panels.map((panel) => ({
        id: panel.id,
        where: { tab: 'pages' as const, pageId: page.id, panelId: panel.id },
      }))
    )
  );
  duplicateIds(
    'layers',
    layers.map((placed) => ({ id: placed.layer.id, where: layerWhere(placed) }))
  );
  duplicateIds(
    'bubbles',
    project.pages.flatMap((page) =>
      page.panels.flatMap((panel) =>
        panel.bubbles.map((bubble) => ({
          id: bubble.id,
          where: { tab: 'pages' as const, pageId: page.id, panelId: panel.id },
        }))
      )
    )
  );
  for (const kind of ['characters', 'objects', 'scenes'] as const) {
    duplicateIds(
      kind,
      metadata[kind].map((entry) => ({
        id: entry.id,
        where: { tab: KIND_TAB[kind], entityId: entry.id },
      }))
    );
  }
  duplicateIds(
    'images',
    media.map((item) => ({ id: item.id, where: { tab: 'pages' as const, mediaId: item.id } }))
  );

  // ---- layers ------------------------------------------------------------------------------
  for (const placed of layers) {
    const { layer, panelId, label } = placed;
    const where = layerWhere(placed);
    const background = layer.kind === 'background';
    const clear = (field: 'subjectId' | 'sceneId'): LintFix => ({
      call: 'layers.update',
      args: [panelId, layer.id, { [field]: null }],
    });

    if (layer.subjectId !== undefined && !subjectIds.has(layer.subjectId)) {
      add({
        code: 'dangling-subject',
        severity: 'error',
        message: `${label} shows ${layer.subjectId}, which is not a character or object (it may have been deleted).`,
        where,
        fix: clear('subjectId'),
      });
    } else if (layer.subjectId !== undefined && background) {
      add({
        code: 'subject-on-background',
        severity: 'warning',
        message: `${label} is a background but shows a character or object; a background is set in a scene (sceneId).`,
        where,
        fix: clear('subjectId'),
      });
    }
    if (layer.sceneId !== undefined && !sceneIds.has(layer.sceneId)) {
      add({
        code: 'dangling-scene',
        severity: 'error',
        message: `${label} is set in ${layer.sceneId}, which is not a scene (it may have been deleted).`,
        where,
        fix: clear('sceneId'),
      });
    } else if (layer.sceneId !== undefined && !background) {
      add({
        code: 'scene-on-foreground',
        severity: 'warning',
        message: `${label} is a foreground layer but has a scene; only a background is set in a scene (a foreground layer shows a character or object with subjectId).`,
        where,
        fix: clear('sceneId'),
      });
    }

    const registered = layer.mediaId === undefined ? undefined : mediaById.get(layer.mediaId);
    const fileId = layer.src ? driveFileIdFromUrl(layer.src) : null;
    if (layer.mediaId !== undefined && !registered) {
      add({
        code: 'missing-media',
        severity: 'error',
        message: `${label} uses image ${layer.mediaId}, which is not in the project's images. Pick another image with layers.update (mediaId).`,
        where,
      });
    } else if (registered && layer.src && fileId !== registered.driveFileId) {
      add({
        code: 'image-mismatch',
        severity: 'error',
        message: `${label} says it uses ${quoted(registered.name)} (${registered.id}) but its src is a different file.`,
        where,
        fix: { call: 'layers.update', args: [panelId, layer.id, { mediaId: registered.id }] },
      });
    } else if (layer.mediaId === undefined && fileId && !mediaByFile.has(fileId)) {
      add({
        code: 'unregistered-image',
        severity: 'error',
        message: `${label} shows a Drive file that is not in the project's images. Upload it with media.upload and set mediaId.`,
        where,
      });
    }

    if (!background && DEFAULT_LAYER_NAME.test(layer.name.trim())) {
      add({
        code: 'default-layer-name',
        severity: 'warning',
        message: `${label} still has a default name; a clear name ("Mara, running") makes it easy to find.`,
        where,
      });
    }
    if (!layer.src && !layer.prompt?.trim()) {
      add({
        code: 'empty-layer',
        severity: 'info',
        message: `${label} has no image and no prompt.`,
        where,
      });
    }
    if (!background && layer.subjectId === undefined && subjectIds.size > 0) {
      add({
        code: 'layer-without-subject',
        severity: 'info',
        message: `${label} does not say which character or object it shows (subjectId), so the media picker cannot list that subject's art first.`,
        where,
      });
    }
    if (background && layer.sceneId === undefined && sceneIds.size > 0) {
      add({
        code: 'background-without-scene',
        severity: 'info',
        message: `${label} does not say which scene it is set in (sceneId), so the media picker cannot list that scene's art first.`,
        where,
      });
    }
  }

  // ---- story bible -------------------------------------------------------------------------
  const mediaIds = new Set(media.map((item) => item.id));
  const usedBySubject = new Set(layers.flatMap(({ layer }) => layer.subjectId ?? []));
  const usedByScene = new Set(layers.flatMap(({ layer }) => layer.sceneId ?? []));
  const referenced = new Set<string>();

  for (const kind of ['characters', 'objects', 'scenes'] as Kind[]) {
    const links = kind === 'scenes' ? characterIds : sceneIds;
    const linkField = kind === 'scenes' ? 'characterIds' : 'sceneIds';
    const linkLabel = kind === 'scenes' ? 'characters' : 'scenes';
    for (const entry of metadata[kind]) {
      const label = `${KIND_LABEL[kind]} ${quoted(entry.name)} (${entry.id})`;
      const where: LintWhere = { tab: KIND_TAB[kind], entityId: entry.id };
      for (const id of entry.imageIds) referenced.add(id);

      const missingImages = new Set(entry.imageIds.filter((id) => !mediaIds.has(id)));
      if (missingImages.size > 0) {
        add({
          code: 'dangling-reference-image',
          severity: 'error',
          message: `${label} lists reference images that are not in the project's images: ${[...missingImages].join(', ')}.`,
          where,
          fix: {
            call: `${kind}.update`,
            args: [entry.id, { imageIds: withoutIds(entry.imageIds, missingImages) }],
          },
        });
      }
      const ids = (entry as unknown as Record<string, string[]>)[linkField];
      const missingLinks = new Set(ids.filter((id) => !links.has(id)));
      if (missingLinks.size > 0) {
        add({
          code: 'dangling-link',
          severity: 'error',
          message: `${label} points at ${linkLabel} that do not exist: ${[...missingLinks].join(', ')}.`,
          where,
          fix: {
            call: `${kind}.update`,
            args: [entry.id, { linkIds: withoutIds(ids, missingLinks) }],
          },
        });
      }

      const used = kind === 'scenes' ? usedByScene.has(entry.id) : usedBySubject.has(entry.id);
      if (used && !entry.description.trim()) {
        add({
          code: 'no-description',
          severity: 'warning',
          message: `${label} is used on a layer but has no description, so nothing tells an image generator what it looks like.`,
          where,
        });
      }
      if (used && entry.imageIds.length === 0) {
        add({
          code: 'no-reference-images',
          severity: 'warning',
          message: `${label} is used on a layer but has no reference images.`,
          where,
        });
      }
    }
  }

  // ---- names -------------------------------------------------------------------------------
  const nameGroups = (
    entries: Array<{ id: string; name: string; where: LintWhere; label: string }>,
    code: string,
    describe: (label: string, names: string) => string
  ) => {
    const groups = new Map<string, typeof entries>();
    for (const entry of entries) {
      const key = normalized(entry.name);
      if (key) groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      add({
        code,
        severity: 'warning',
        message: describe(
          quoted(group[0].name),
          group.map((entry) => `${entry.label} (${entry.id})`).join(', ')
        ),
        where: group[0].where,
      });
    }
  };
  for (const kind of ['characters', 'scenes'] as const) {
    nameGroups(
      metadata[kind].map((e) => ({
        id: e.id,
        name: e.name,
        label: KIND_LABEL[kind],
        where: { tab: KIND_TAB[kind], entityId: e.id },
      })),
      'duplicate-name',
      (name, names) => `More than one ${kind.replace(/s$/, '')} is called ${name}: ${names}.`
    );
  }
  nameGroups(
    [...characters, ...objects].map((e) => ({
      id: e.id,
      name: e.name,
      label: characterIds.has(e.id) ? 'Character' : 'Object',
      where: { tab: 'cast', entityId: e.id },
    })),
    'ambiguous-name',
    (name, names) => `A character and an object are both called ${name}, or two share it: ${names}.`
  );
  nameGroups(
    media.map((item) => ({
      id: item.id,
      name: item.name,
      label: 'Image',
      where: { tab: 'pages', mediaId: item.id },
    })),
    'duplicate-name',
    (name, names) =>
      `More than one image is called ${name}: ${names}. Rename them with media.update so search can tell them apart.`
  );

  // ---- images ------------------------------------------------------------------------------
  const placed = new Set<string>();
  for (const { layer } of layers) {
    if (layer.mediaId) placed.add(layer.mediaId);
    const file = layer.src ? driveFileIdFromUrl(layer.src) : null;
    const item = file ? mediaByFile.get(file) : undefined;
    if (item) placed.add(item.id);
  }
  const inReferences = new Map<string, Set<string>>();
  for (const entry of [...characters, ...objects, ...scenes]) {
    for (const id of entry.imageIds) {
      inReferences.set(id, (inReferences.get(id) ?? new Set()).add(entry.id));
    }
  }

  for (const item of media) {
    const label = `Image ${quoted(item.name)} (${item.id})`;
    const where: LintWhere = { tab: 'pages', mediaId: item.id };
    const clear = (field: 'subjectId' | 'sceneId'): LintFix => ({
      call: 'media.update',
      args: [item.id, { [field]: null }],
    });
    if (item.subjectId !== undefined && !subjectIds.has(item.subjectId)) {
      add({
        code: 'dangling-image-subject',
        severity: 'error',
        message: `${label} is art of ${item.subjectId}, which is not a character or object (it may have been deleted).`,
        where,
        fix: clear('subjectId'),
      });
    }
    if (item.sceneId !== undefined && !sceneIds.has(item.sceneId)) {
      add({
        code: 'dangling-image-scene',
        severity: 'error',
        message: `${label} is art of ${item.sceneId}, which is not a scene (it may have been deleted).`,
        where,
        fix: clear('sceneId'),
      });
    }
    for (const owner of [item.subjectId, item.sceneId]) {
      if (owner !== undefined && inReferences.get(item.id)?.has(owner)) {
        add({
          code: 'art-and-reference',
          severity: 'info',
          message: `${label} is both art of ${owner} and one of its reference images; the picker lists it as art. Decide which it is.`,
          where,
        });
      }
    }

    if (JUNK_MEDIA_NAME.test(item.name.trim())) {
      add({
        code: 'default-image-name',
        severity: 'warning',
        message: `${label} has a name that says nothing about the picture; media.update can rename it so search finds it.`,
        where,
      });
    }
    if (!item.thumbnailDriveFileId) {
      add({
        code: 'missing-thumbnail',
        severity: 'warning',
        message: `${label} has no thumbnail, so the editor downloads the full file to list it; add one with media.uploadThumbnail.`,
        where,
      });
    }
    const tagged = item.subjectId !== undefined || item.sceneId !== undefined;
    if (!placed.has(item.id) && !referenced.has(item.id) && !tagged) {
      add({
        code: 'unused-image',
        severity: 'warning',
        message: `${label} is not used on any layer, is not reference art, and is not tagged as art of anything.`,
        where,
      });
    }
  }

  return findings
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => ORDER[a.finding.severity] - ORDER[b.finding.severity] || a.index - b.index)
    .map(({ finding }) => finding);
}

/** The findings that are errors. */
export const lintErrors = (findings: LintFinding[]): LintFinding[] =>
  findings.filter((finding) => finding.severity === 'error');
