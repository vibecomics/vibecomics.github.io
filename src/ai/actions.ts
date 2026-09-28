/**
 * The window.ComicBuilder command API: a CLI for the whole VibeComics UI.
 *
 * Every UI control calls these same functions, so a human's clicks and an AI
 * agent's calls share one code path. The JSDoc on every node of the
 * `ComicBuilder` literal below is the single source of truth for the docs:
 * scripts/extract-docs.mjs turns it into src/ai/actions.docs.gen.ts (attached
 * as each node's toString() and rendered by ComicBuilder.help()) and
 * public/api.txt (the static API reference; public/llms.txt is the separate
 * how-to-build-a-comic guide, scripts/llms-guide.md).
 */

import type { DeviceCodeInfo } from '../drive/deviceOAuth';
import type { ProjectFolder } from '../drive/driveRest';
import { assertValidGeneratorConfig, createProvider } from '../generators/types';
import type { GeneratorConfig } from '../generators/types';
import { createPanel, defaultPointer } from '../state/layout';
import { lintProject } from '../state/lint';
import type { LintFinding } from '../state/lint';
import { assertValidProject, normalizeProject } from '../state/project';
import type { Bubble, ComicPage, ComicProject, Layer, MediaItem, PageSize } from '../types/comic';
import { errorMessage } from '../utils/errors';
import { newId } from '../utils/id';
import { ACTION_DOCS, HELP_TEXT } from './actions.docs.gen';
import {
  BUBBLE_KINDS,
  LAYER_KINDS,
  LAYER_MOVES,
  assertKind,
  assertScene,
  assertSubject,
  assertOptionalText,
  definedFields,
  imageSwapPatch,
  layerArtSize,
  mutate,
  panelItemsApi,
  panelsApi,
  pendingGenerations,
  requirePanel,
  requireProject,
  resolveLayerImage,
  snapshot,
  storyApi,
} from './builders';
import type { PendingGeneration } from './builders';
import type {
  ActionResult,
  BubbleInput,
  BubblePatch,
  ComicBuilderDeps,
  LayerInput,
  LayerUpdate,
} from './deps';
import { attachDocs } from './docs';
import {
  defaultEntryReferences,
  defaultLayerReferences,
  generateAllDirty,
  generateLayerImage,
  generateReferenceImage,
  getQueue,
  maxReferenceImages,
} from './generation';
import type { GenerationReference } from './generation';
import type { GeneratedImage, GenerationOutcome, QueueItem, ReferenceKind } from './generation';
import { buildLayerPrompt, buildReferencePrompt } from './prompt';

declare global {
  interface Window {
    ComicBuilder?: ComicBuilderApi;
  }
}

/**
 * Build the ComicBuilder action tree bound to the given deps. It uses no browser
 * APIs, so it runs in Node too (the CLI); the page installs it on `window`.
 */
export function createComicBuilder(deps: ComicBuilderDeps) {
  const layers = panelItemsApi(deps, 'layers', 'Layer');
  const bubbles = panelItemsApi(deps, 'bubbles', 'Bubble');
  const panels = panelsApi(deps);
  const characters = storyApi(deps, 'characters');
  const scenes = storyApi(deps, 'scenes');
  const objects = storyApi(deps, 'objects');

  /** Shared by layers.update and generate.layer/dirty, which also need to set a layer's image. */
  function updateLayer(panelId: string, layerId: string, patch: LayerUpdate): Layer {
    if (patch.kind !== undefined) assertKind(patch.kind, LAYER_KINDS, 'Layer kind');
    const swapsImage = patch.mediaId !== undefined;
    let image: Partial<Layer> = {};
    if (swapsImage) {
      const project = requireProject(deps);
      resolveLayerImage(project, patch);
      const current = layers.get(panelId, layerId);
      if (!current) throw new Error(`Layer "${layerId}" not found.`);
      image = imageSwapPatch(current, patch.mediaId!);
    }
    const { subjectId, sceneId, ...rest } = patch;
    if (typeof subjectId === 'string') assertSubject(requireProject(deps), subjectId);
    if (typeof sceneId === 'string') assertScene(requireProject(deps), sceneId);
    // A new image satisfies whatever prompt asked for it, so it always clears dirty (image.dirty,
    // set above), even alongside a prompt change (that means "here is the new art for it").
    // Otherwise, touching the prompt or the linked scene/subject makes the current image stale
    // (dirty) unless that leaves no prompt at all to act on.
    const touchesPrompt =
      patch.prompt !== undefined || subjectId !== undefined || sceneId !== undefined;
    const dirty = swapsImage
      ? undefined
      : touchesPrompt
        ? Boolean((patch.prompt ?? layers.get(panelId, layerId)?.prompt ?? '').trim())
        : undefined;
    return layers.update(
      panelId,
      layerId,
      {
        ...rest,
        ...image,
        ...(dirty !== undefined && { dirty }),
        ...(typeof subjectId === 'string' && { subjectId }),
        ...(typeof sceneId === 'string' && { sceneId }),
      },
      [...(subjectId === null ? ['subjectId'] : []), ...(sceneId === null ? ['sceneId'] : [])]
    );
  }
  const setLayerMedia = (
    panelId: string,
    layerId: string,
    mediaId: string,
    aspectRatio?: number
  ): Layer =>
    updateLayer(panelId, layerId, { mediaId, ...(aspectRatio !== undefined && { aspectRatio }) });

  /**
   * Top-level command API for VibeComics: every UI control calls these same
   * functions (one code path, no drift). Namespaces: storage (connect to
   * Google Drive or a self-hosted HTTP server, project folders, project.json
   * IO), project (whole-project replace), page (navigation, preview, adding
   * pages), panels (page layout), layers, bubbles, metadata (story bible),
   * characters, scenes, objects, media. Reads return deep-cloned snapshots.
   * Changes are saved automatically within a minute (only when something
   * changed); storage.save() saves immediately. Everything except storage and
   * help() needs an open project: without one, page.count/select/current and
   * layers/bubbles list/get return 0 or null, and every other call throws
   * "No project is open".
   */
  const ComicBuilder = {
    /**
     * Render the full skill-style reference for this API: conventions plus every namespace and function with its description, parameters, and return value. This text is generated at build time from the JSDoc in src/ai/actions.ts, so it never drifts from the code.
     * @returns The complete API reference as plain text.
     */
    help: (): string => HELP_TEXT,

    /**
     * Project storage: either Google Drive or a self-hosted HTTP server (see
     * http-storage/), picked once per session on the connect screen. Whichever
     * is active, the app only sees folders and files it created there;
     * listProjects() is the complete list.
     */
    storage: {
      /**
       * Connect to Google Drive via the OAuth device flow. Resolves promptly
       * with { url, code, expiresInSeconds }: show the user the URL and code
       * (they open the URL on any device, a phone works, enter the code, and
       * approve). Then poll storage.status() until connected is true and
       * continue. If the user denies the request or the code expires,
       * status().connected simply stays false (the app shows the reason).
       * Rejects immediately if the device client is not configured. Works from
       * injected scripts: no popup, no user gesture needed, so the same button
       * works for a human or an AI assistant. The device client secret ships in
       * the app bundle by design (Google's device-client model: distributed
       * apps cannot keep secrets; scope stays limited to drive.file, and the
       * access token itself is memory-only).
       * @returns The verification URL, user code, and code expiry.
       */
      connectWithDevice: (): Promise<DeviceCodeInfo> => deps.connectStorageWithDevice(),

      /**
       * Connect to a self-hosted HTTP storage server at this base URL (see
       * http-storage/). The server has no login: this just checks it answers
       * GET /health, then makes it the active store. The URL is remembered
       * only to prefill the connect screen's field next time; it does not
       * reconnect on its own.
       * @param url - The server's base URL, e.g. "http://localhost:8081".
       * @returns A promise that resolves once connected; check storage.status().connected.
       */
      connectWithServer: (url: string): Promise<void> => deps.connectStorageWithServer(url),

      /**
       * Disconnect storage: save any unsaved changes, then drop the connection
       * (revoking the grant at Google, if that is what is connected) and return
       * to the connect screen. The next connect starts fresh.
       * @returns A promise that resolves when disconnection is complete.
       */
      disconnect: (): Promise<void> => deps.disconnectStorage(),

      /**
       * Report the storage connection state.
       * @returns { connected, configured }: connected means storage has a live connection; configured means Drive's device OAuth client is set (irrelevant once a server is connected).
       */
      status: (): { connected: boolean; configured: boolean } => deps.getStorageStatus(),

      /**
       * List every project folder in the active store (on Drive: files.list
       * under the drive.file scope, so the app is blind to everything else on
       * the user's Drive), sorted by name, at most 100.
       * @returns A promise resolving to [{ id, name }] of project folders.
       */
      listProjects: (): Promise<ProjectFolder[]> => deps.listStorageProjects(),

      /**
       * Create a new project and open it: create a project folder named after
       * it, write a blank project.json (a cover page with one panel, empty
       * metadata) into it, and show it in the editor. If a folder with that name
       * already exists, its project is opened instead and nothing is overwritten.
       * The project appears in listProjects().
       * @param name - The project name; becomes the project folder name.
       * @param pageSize - Optional { label, widthIn, heightIn } physical page
       *   dimensions (see the page size presets in the data model). Defaults to
       *   US Comic (6.625" × 10.25").
       * @returns A promise resolving to { id, name } of the new folder.
       */
      createProject: (name: string, pageSize?: PageSize): Promise<ProjectFolder> =>
        deps.createStorageProject(name, pageSize),

      /**
       * Open a project: load the folder's project.json into the editor. A
       * project with only its cover opens on the Style tab; one with more
       * pages opens on the Pages tab.
       * @param idOrName - The folder id from listProjects(), or the project/folder name.
       * @returns A promise resolving to { ok, error? }.
       */
      openProject: async (idOrName: string): Promise<ActionResult> => {
        const folders = await deps.listStorageProjects();
        const match =
          folders.find((f) => f.id === idOrName) ?? folders.find((f) => f.name === idOrName);
        return match
          ? deps.openStorageProject(match)
          : { ok: false, error: `No project folder "${idOrName}".` };
      },

      /**
       * Close the current project: save any unsaved changes, drop it from the
       * editor and return to the project tiles. If saving fails the project
       * stays open. Does not delete anything in storage.
       * @returns A promise that resolves once the project is closed or saving has failed.
       */
      closeProject: (): Promise<void> => deps.closeStorageProject(),

      /**
       * Go back to the project tiles page, refreshing the folder list.
       * The current project (if any) stays open in the background.
       * @returns A promise resolving to [{ id, name }] of project folders.
       */
      showProjects: (): Promise<ProjectFolder[]> => deps.showProjectTiles(),

      /**
       * Save right now. The app already saves by itself every minute when
       * there are changes; this only hurries it. Does nothing when everything
       * is already saved. Fails ({ ok: false }) when no project is open or
       * storage is not connected.
       *
       * If somebody else (another browser, the command line) saved the project
       * since it was opened, their changes are pulled and merged with yours
       * first, and the merged project is saved: changes to different things
       * (or different fields of one thing) just combine. If the two clash (the
       * same field changed differently, or something deleted on one side and
       * changed on the other), nothing is written: the app shows the conflicts at
       * the bottom of the editor for the user to settle, and this returns
       * { ok: false, error } naming them.
       * @returns A promise resolving to { ok, error? }: ok is true when nothing is left unsaved.
       */
      save: (): Promise<ActionResult> => deps.flushStorageSave(),
    },

    /**
     * Whole-project operations on the currently open project.
     */
    project: {
      /**
       * Replace the whole open project with validated JSON (object or JSON string).
       * Validation follows public/schema/comic-project.schema.json; the error
       * names the failing path (e.g. project.pages[2].panels[0].layers[1]).
       * Required: id, title, savedAt, pages and metadata (style, characters,
       * scenes, objects, media). A layer's image is set via mediaId (or omitted
       * for a layer that is only a prompt so far).
       * This is the primary editing path for bulk changes: read snapshots via
       * page/panels/layers/bubbles/metadata, modify client-side, load the result.
       * Geometry (x/y/width/rotation/opacity) is preserved exactly. Pages
       * without panels get one full-page panel, panels without a rectangle are
       * stacked as equal rows, and bubbles without a height get 20. The editor
       * returns to page 0.
       * @param data - A ComicProject object or its JSON string.
       * @returns { ok, error? }.
       */
      load: (data: ComicProject | string): ActionResult => {
        try {
          const parsed: unknown =
            typeof data === 'string' ? JSON.parse(data) : structuredClone(data);
          assertValidProject(parsed);
          normalizeProject(parsed);
          deps.replaceProject(parsed);
          deps.setStatus(`Project "${parsed.title}" loaded.`);
          return { ok: true };
        } catch (e) {
          return { ok: false, error: errorMessage(e) };
        }
      },

      /**
       * Check the open project for problems that do not stop it from opening but
       * make it wrong or hard to work with, and say how to fix each. Read-only.
       * Run it after a batch of edits and fix the errors first, then the
       * warnings, then run it again until no errors are left.
       *
       * Errors: references to something that does not exist (a layer's
       * subjectId, sceneId or mediaId, an image's subjectId or sceneId, a
       * character's, object's or scene's imageIds, sceneIds or characterIds),
       * and duplicate ids.
       * Warnings: two characters, scenes or images with the same name, a
       * character and an object with the same name, layers and images left with
       * a default name, an image with no thumbnail, an image used nowhere, and a
       * character, object or scene that is used on a layer but has no
       * description or reference images. Info: layers with no subject or
       * scene, layers with neither image nor prompt, an image that is both a
       * subject's art and its reference art.
       * @returns An array of findings, errors first: { code, severity: "error" | "warning" | "info", message, where: { tab, pageId?, panelId?, layerId?, entityId?, mediaId? }, fix? }. `fix`, when present, is a safe API call that only clears or unlinks something: { call: "layers.update", args: [panelId, layerId, { subjectId: null }] }; run it as ComicBuilder.<call>(...args). Findings without a fix need a decision: their message says what to do. An empty array means nothing was found. Throws when no project is open.
       */
      lint: (): LintFinding[] => lintProject(requireProject(deps)),
    },

    /**
     * Pages: navigation, preview, creating, reordering and their prompts.
     *
     * A page has a prompt: the intent of the whole page (what happens on it, its
     * mood and pacing), set with add or update. It is the first part of the
     * prompt for the image of every layer on the page (see the layers namespace
     * for how the parts are stitched together).
     *
     * HOW A PAGE IS BUILT. A page always starts with ONE panel that covers the
     * whole page (page.add() makes one, and a new project's cover has one).
     * There is no "add a panel" call: you get more panels by CUTTING that
     * panel up with the panels functions, then adjust the dividing lines with
     * panels.resize, then fill each panel with layers and bubbles. Every cut
     * keeps the original panel (its id, layers and bubbles) as the first part
     * and returns the new, empty parts, so cuts can be chained.
     *
     * Examples (each starts from a fresh page; page.add() returns the page,
     * and its single panel is panels[0]):
     *
     *   const [p] = page.add().panels;
     *   panels.splitEvenly(p.id, "horizontal", 3);          // three equal rows
     *
     *   const [p] = page.add().panels;
     *   const [top, bottom] = panels.split(p.id, "horizontal", 40);
     *   panels.split(bottom.id, "vertical", 50);            // wide top, two columns below
     *   panels.resize(top.id, "bottom", 45);                // then nudge a dividing line
     *
     *   const [p] = page.add().panels;
     *   const [left, right] = panels.split(p.id, "vertical", 60);
     *   panels.splitEvenly(right.id, "horizontal", 2);      // tall left, two stacked right
     *
     *   page.add();
     *   panels.splitAcross("horizontal", 33.3);             // tiers cut with lines across
     *   panels.splitAcross("horizontal", 66.6);             // the whole page
     */
    page: {
      /**
       * Show page i and return it. Pages are 0-based and displayed as 0, 1, 2, …
       * @param i - 0-based page index.
       * @returns A deep-cloned ComicPage snapshot (panels with layers and bubbles), or null when i is out of range or no project is open. Snapshots are read-only: mutating them changes nothing.
       */
      select: (i: number): ComicPage | null => {
        const project = deps.getProject();
        if (!project || !Number.isInteger(i) || i < 0 || i >= project.pages.length) return null;
        deps.setPageIndex(i);
        return snapshot(project.pages[i]);
      },

      /**
       * Number of pages in the open project.
       * @returns The page count, or 0 when no project is open.
       */
      count: (): number => deps.getProject()?.pages.length ?? 0,

      /**
       * The currently shown page.
       * @returns A deep-cloned ComicPage snapshot, or null when no project is open. Read-only.
       */
      current: (): ComicPage | null => {
        const project = deps.getProject();
        return project ? snapshot(project.pages[deps.getPageIndex()] ?? null) : null;
      },

      /**
       * Append a new page after the last page and show it. It starts with ONE
       * empty panel covering the whole page. To get more panels, cut it up: e.g.
       * panels.splitEvenly(panelId, "horizontal", 3) for three rows, or
       * panels.split(panelId, "vertical", 60) for a wide and a narrow panel
       * (see the panels namespace).
       * @param input - Optional { title, prompt } for the page. title defaults to empty; prompt is the page's intent (see update) and is unset by default.
       * @returns A deep-cloned snapshot of the new ComicPage (with its single panel).
       */
      add: (input?: { title?: string; prompt?: string }): ComicPage => {
        assertOptionalText(input?.title, 'title');
        assertOptionalText(input?.prompt, 'prompt');
        const page: ComicPage = {
          id: newId('page'),
          number: 0,
          title: input?.title ?? '',
          ...(input?.prompt !== undefined && { prompt: input.prompt }),
          panels: [createPanel()],
        };
        deps.updateProject((p) => {
          page.number = p.pages.length;
          p.pages.push(page);
        });
        deps.setPageIndex(page.number);
        return snapshot(page);
      },

      /**
       * Update a page's title or prompt. The prompt is the intent of the whole
       * page: what happens on it, its mood and pacing, and how the panels flow.
       * It is the first part stitched into the prompt for the image of every
       * layer on the page, ahead of the panel prompt and the layer prompt (see
       * the layers namespace). Only the given fields change; pass "" to clear a
       * prompt.
       * @param patch - { title?, prompt? }.
       * @param pageIndex - 0-based page index. Defaults to the current page.
       * @returns A deep-cloned snapshot of the updated ComicPage. Throws when the page is not found.
       */
      update: (patch: { title?: string; prompt?: string }, pageIndex?: number): ComicPage => {
        if (!patch || typeof patch !== 'object')
          throw new Error('patch must be { title?, prompt? }.');
        assertOptionalText(patch.title, 'title');
        assertOptionalText(patch.prompt, 'prompt');
        const project = requireProject(deps);
        const index = pageIndex ?? deps.getPageIndex();
        if (!Number.isInteger(index) || index < 0 || index >= project.pages.length) {
          throw new Error(`Page ${index} not found.`);
        }
        return snapshot(
          mutate(deps, (p) =>
            Object.assign(
              p.pages[index],
              definedFields({ title: patch.title, prompt: patch.prompt })
            )
          )
        );
      },

      /**
       * Move a page to a new position, e.g. move(3, 1) makes page 3 the first
       * page after the cover. The pages in between shift by one and every page is
       * renumbered (the number is the position). The cover (page 0) stays first:
       * only pages 1 and up can be moved, and only to positions 1 and up. The
       * page shown stays the same page, wherever it ends up.
       * @param from - 0-based position of the page to move (1 or more).
       * @param to - 0-based position it should end up at (1 or more, at most the last page).
       * @returns A deep-cloned snapshot of the moved ComicPage, with its new number. Throws when a position is not a page, or is the cover.
       */
      move: (from: number, to: number): ComicPage => {
        const project = requireProject(deps);
        const count = project.pages.length;
        for (const position of [from, to]) {
          if (!Number.isInteger(position) || position < 0 || position >= count) {
            throw new Error(`Page ${position} not found.`);
          }
        }
        if (from === 0 || to === 0) {
          throw new Error('The cover (page 0) stays first: only pages 1 and up can be moved.');
        }
        if (from === to) return snapshot(project.pages[from]);

        const shownId = project.pages[deps.getPageIndex()]?.id;
        const page = mutate(deps, (p) => {
          const [moved] = p.pages.splice(from, 1);
          p.pages.splice(to, 0, moved);
          p.pages.forEach((entry, index) => {
            entry.number = index;
          });
          return moved;
        });
        const shown = requireProject(deps).pages.findIndex((entry) => entry.id === shownId);
        if (shown >= 0) deps.setPageIndex(shown);
        return snapshot(page);
      },

      /**
       * Open preview mode: the current page shown on its own on a dark background,
       * without editing controls, for visual review. An agent can screenshot the
       * preview and show it to the user.
       */
      openPreview: (): void => deps.setPreview(true),

      /**
       * Close preview mode and return to the editor.
       */
      closePreview: (): void => deps.setPreview(false),
    },

    /**
     * The panels of a page. Panels are rectangles (x, y, width, height in % of
     * the page) that always tile the page with no gaps or overlaps, like a
     * comic layout, in any proportions.
     *
     * A page starts with ONE panel covering the whole page, and there is no
     * call that adds a panel out of nothing: you make new panels by cutting an
     * existing one. splitEvenly(id, "horizontal", 3) makes three rows;
     * split(id, "vertical", 60) makes a 60% / 40% pair; splitAcross(axis,
     * position) draws a line across the whole page and cuts every panel it
     * crosses. Each cut panel keeps its id, layers and bubbles as its first
     * (top/left) part, and the new empty parts are returned, so chain cuts on
     * what they return: `const [top, bottom] = panels.split(id, "horizontal",
     * 40); panels.split(bottom.id, "vertical", 50);`. Move a dividing line
     * afterwards with resize; delete a panel with delete (a neighbour stretches
     * over its space). See the page namespace for more examples.
     *
     * A panel has a prompt: its intent, set with update (see the layers
     * namespace for how it is combined with the page and layer prompts).
     *
     * A panel's aspect ratio follows from its rectangle and metadata.pageSize
     * (see size), so generate artwork at that ratio. The panel array is in the
     * order the panels were created (the numbers shown on the page): a new
     * panel is inserted right after the one it was cut from, so it is not
     * always left-to-right, top-to-bottom. Use x and y to tell where a panel
     * is.
     */
    panels: {
      /**
       * List the panels of a page in array order (the numbers shown on the page).
       * See the panels namespace note: use x and y for position.
       * @param pageIndex - 0-based page index. Defaults to the current page.
       * @returns Deep-cloned Panel snapshots (with rectangle, layers and bubbles). Read-only.
       */
      list: panels.list,

      /**
       * Get one panel.
       * @param panelId - The panel id.
       * @returns A deep-cloned Panel snapshot, or null when not found. Read-only.
       */
      get: panels.get,

      /**
       * The physical size of a panel on the printed page, from its rectangle
       * and the page size, and the pixel size to generate art at (150 dpi,
       * longest side at most 2048). A panel's background is best generated at
       * exactly this size and aspect ratio, so nothing is cropped or stretched.
       * @param panelId - The panel id.
       * @returns { widthIn, heightIn, aspectRatio, pixels: { width, height } }, or null when the panel is not found.
       */
      size: panels.size,

      /**
       * Cut a panel in two along one straight line. The original panel keeps
       * its id, layers and bubbles and becomes the top (horizontal) or left
       * (vertical) part; a new empty panel fills the rest. Layer and bubble
       * positions are percentages of their panel, so they scale with it.
       * Throws when either part would be smaller than 5% of the page.
       * @param panelId - The panel to cut.
       * @param axis - "horizontal" draws a horizontal line (top and bottom parts); "vertical" a vertical line (left and right parts).
       * @param position - Where the line falls, as a percentage (0-100) of the panel's height (horizontal) or width (vertical). Defaults to 50.
       * @returns The resulting panels: the original, then the new one.
       */
      split: panels.split,

      /**
       * Draw a straight line across the whole page and cut every panel it
       * crosses, like a guide: splitAcross("horizontal", 50) cuts the page into
       * a top and a bottom tier, cutting each panel the line passes through.
       * Each cut panel keeps its id, layers and bubbles as its first (top/left)
       * part; the new parts are empty. Panels the line misses or only touches
       * at an edge, and panels that would be left too small, are not cut.
       * Throws when nothing is cut.
       * @param axis - "horizontal" draws a horizontal line (cutting panels into top and bottom parts); "vertical" a vertical line (left and right parts).
       * @param position - Where the line falls, as a percentage (0-100) of the page height (horizontal) or width (vertical).
       * @param pageIndex - 0-based page index. Defaults to the current page.
       * @returns All panels of the page after the cut.
       */
      splitAcross: panels.splitAcross,

      /**
       * Cut a panel into equal parts, e.g. three horizontal panels with
       * splitEvenly(id, "horizontal", 3). The original keeps its id, layers and
       * bubbles as the first part; the others are new and empty.
       * @param panelId - The panel to cut.
       * @param axis - "horizontal" for stacked rows, "vertical" for side-by-side columns.
       * @param count - Number of parts, at least 2.
       * @returns The resulting panels: the original first, then the new ones.
       */
      splitEvenly: panels.splitEvenly,

      /**
       * Move one edge of a panel, i.e. drag a dividing line. The panels on the
       * other side of the line move with it so the page stays tiled: a
       * horizontal line spans the page and moves as one, while a vertical line
       * moves only the panels that touch it end to end (each row of panels has
       * its own vertical lines). The edge stops at the minimum panel size (5% of
       * the page); the outer edges of the page cannot be moved.
       * @param panelId - A panel touching the line.
       * @param edge - Which edge of that panel to move: "top", "bottom", "left" or "right".
       * @param position - The new position of the line, as a percentage (0-100) of the page height (top/bottom) or width (left/right).
       * @returns All panels of the page after the move.
       */
      resize: panels.resize,

      /**
       * Update a panel's title or prompt. The prompt is the intent of the panel:
       * the moment it shows, the camera, the mood, what it must get across. It
       * is stitched into the prompt for the image of every layer in the panel,
       * after the page prompt and before the layer prompt (see the layers
       * namespace). Only the given fields change; pass "" to clear a prompt.
       * @param panelId - The panel id.
       * @param patch - { title?, prompt? }.
       * @returns A deep-cloned snapshot of the updated Panel. Throws when not found.
       */
      update: panels.update,

      /**
       * Delete a panel. The neighbouring panel or panels that exactly cover one
       * of its edges stretch over its space; if none do, the space stays empty.
       * Its layers and bubbles are deleted with it. A page always keeps at least
       * one panel (throws when deleting the last one).
       * @param panelId - The panel id.
       * @returns True when a panel was removed, false when not found.
       */
      delete: panels.delete,
    },

    /**
     * Layers inside a panel, addressed by panel id (see the id fields of the
     * ComicPage snapshot from page.select). Layers composite bottom-to-top in
     * array order, so array order is the stacking order (see move). There is no
     * separate background field: the background is the layer whose kind is
     * "background"; it fills the whole panel without stretching (an image of a
     * different ratio is cropped), so its x/y/width are ignored. Generate it at
     * the size panels.size or layers.size reports. A panel should have one
     * background. Every other layer is a foreground layer, usually a PNG with a
     * transparent background containing just its subject (a character, a prop),
     * placed over the background. A layer has a prompt: what its art should
     * show, for whoever generates the image. It may exist with only a prompt
     * and get its image later.
     *
     * HOW THE PROMPT FOR AN IMAGE IS BUILT. The layer prompt is only one part,
     * and a background's image is built differently from a foreground layer's:
     *
     * - Background: the STYLE paragraph (metadata.style), the PAGE prompt
     *   (page.update), the PANEL prompt (panels.update), the SCENE description,
     *   then the LAYER prompt. It is meant to depict that page/panel/scene, so
     *   all of it belongs in the prompt.
     * - Foreground: only the STYLE paragraph, the character's or object's
     *   description, and the LAYER prompt. The page prompt, panel prompt, and
     *   the panel's background scene are all left out, even as "context only,
     *   do not draw it": most image generators draw the literal setting the
     *   moment any place or scene language appears anywhere in the prompt,
     *   caveat or not, which ruins an isolated cutout. So only the layer's own
     *   prompt says what this character is doing, never where.
     *
     * Each level says only what belongs to it, so the parts add up without
     * repeating or contradicting each other. Read them back with page.select
     * (page prompt), panels.get (panel prompt) and layers.get (layer prompt).
     *
     * DIRTY. A layer's `dirty` field says whether its image still matches its
     * prompt. add/update set it automatically: editing the prompt (or, for a
     * background, its scene; or, for a foreground layer, its subject) turns it
     * on; setting the image (mediaId) turns it off. Check layers.list or
     * layers.get for `dirty: true` to find which layers or backgrounds need a
     * new image generated for them, and regenerate just those, not the whole
     * panel. See the generate namespace to do this automatically with a
     * configured image generator.
     */
    layers: {
      /**
       * List the layers of a panel, bottom-to-top.
       * @param panelId - The panel id.
       * @returns Deep-cloned Layer snapshots, or null when the panel is not found. Read-only.
       */
      list: layers.list,

      /**
       * Get one layer.
       * @param panelId - The panel id.
       * @param layerId - The layer id.
       * @returns A deep-cloned Layer snapshot, or null when not found. Read-only.
       */
      get: layers.get,

      /**
       * Add a layer to a panel: a prompt, an image, or both. Foreground
       * layers are appended on top of the stack; a background layer goes to the
       * bottom (if the panel already has a background, delete it first, or swap
       * its image with update(), since both would be drawn). A layer can start with
       * only a prompt and get its image later with update(). Put what this
       * layer's art shows in `prompt` (write it before you generate the image,
       * so the plan is on record). It is the last part of the prompt for the
       * image: that prompt is stitched from the STYLE paragraph, the page
       * prompt, the panel prompt, the scene and character descriptions and this
       * layer prompt (see the layers namespace). Foreground images
       * should usually be PNGs with a transparent background.
       * @param panelId - The panel id.
       * @param input - { name?, prompt?, subjectId?, sceneId?, mediaId?, aspectRatio?, kind?, visible?, x?, y?, width?, rotation?, opacity?, flipX? }. mediaId must already be registered (from media.upload or media.list); omit it for a layer that is only a prompt so far. subjectId is the id of the character or object the layer shows (it must exist); the media picker lists that subject's art first. sceneId is the id of the scene a background layer is the setting of (it must exist); the picker lists that scene's art first. name defaults to the media's name, else "Layer" or "Background". x/y/width are % of panel size and rotation is in degrees; kind defaults to "foreground"; geometry defaults to x:0, y:0, width:100, rotation:0, opacity:1 (0-1), visible:true, flipX:false (true mirrors the image left to right). aspectRatio (width / height) shapes a layer that has no image yet; use layers.size to see what to generate. dirty is set automatically (true when there's a prompt and no image yet) unless you pass it explicitly.
       * @returns A deep-cloned snapshot of the new Layer.
       */
      add: (panelId: string, input: LayerInput): Layer => {
        const kind = input.kind ?? 'foreground';
        assertKind(kind, LAYER_KINDS, 'Layer kind');
        const project = requireProject(deps);
        const image = resolveLayerImage(project, input);
        if (input.subjectId !== undefined) assertSubject(project, input.subjectId);
        if (input.sceneId !== undefined) assertScene(project, input.sceneId);
        const media = project.metadata.media.find((m) => m.id === image.mediaId);
        return layers.add(
          panelId,
          {
            id: newId('layer'),
            visible: true,
            x: 0,
            y: 0,
            width: 100,
            rotation: 0,
            opacity: 1,
            ...definedFields(input),
            ...image,
            kind,
            dirty: input.dirty ?? (Boolean(input.prompt?.trim()) && !image.mediaId),
            name: input.name ?? media?.name ?? (kind === 'background' ? 'Background' : 'Layer'),
          },
          kind === 'background'
        );
      },

      /**
       * Update a layer: move (x/y), resize (width), rotate, change opacity or
       * visibility, flip it left to right (flipX), rename, edit its prompt, set what it shows (subjectId: a character or object id) or, for a background, the scene it is the setting of (sceneId), either null to clear it, or swap its image (mediaId).
       * Only the given fields change. dirty tracks itself: editing prompt,
       * subjectId or sceneId turns it on (off again if that leaves no prompt);
       * setting mediaId turns it off, even in the same call.
       * @param panelId - The panel id.
       * @param layerId - The layer id.
       * @param patch - Partial layer fields.
       * @returns A deep-cloned snapshot of the updated Layer. Throws when the panel or layer is not found.
       */
      update: updateLayer,

      /**
       * Flip a layer's image horizontally (mirror it left to right); calling it
       * again flips it back. Sets or clears the layer's flipX field.
       * @param panelId - The panel id.
       * @param layerId - The layer id.
       * @returns A deep-cloned snapshot of the updated Layer. Throws when the panel or layer is not found.
       */
      flip: (panelId: string, layerId: string): Layer => {
        const layer = layers.get(panelId, layerId);
        if (!layer) throw new Error(`Layer "${layerId}" not found.`);
        return layers.update(panelId, layerId, { flipX: !layer.flipX });
      },

      /**
       * Delete a layer from a panel.
       * @param panelId - The panel id.
       * @param layerId - The layer id.
       * @returns True when a layer was removed, false when not found.
       */
      delete: layers.delete,

      /**
       * The size a layer's art should be generated at. A background is the
       * panel's size; a foreground layer is layer.width % of the panel wide,
       * at its aspectRatio (default 1, so set aspectRatio first for a tall or
       * wide subject). Foreground art should usually be a PNG with a
       * transparent background.
       * @param panelId - The panel id.
       * @param layerId - The layer id.
       * @returns { widthIn, heightIn, aspectRatio, pixels: { width, height } }, or null when the panel or layer is not found.
       */
      size: (panelId: string, layerId: string) =>
        layerArtSize(requireProject(deps), panelId, layerId),

      /**
       * Change a layer's place in the stack. "up" and "down" move it one step;
       * "top" and "bottom" move it above or below every other layer; a number
       * puts it at that 0-based position counted from the bottom of the whole
       * stack (a background, if any, is position 0). Bubbles always stay above
       * all layers.
       * @param panelId - The panel id.
       * @param layerId - The layer id.
       * @param to - "top", "bottom", "up" (one step toward the top), "down", or a 0-based position from the bottom.
       * @returns The panel's layers, bottom-to-top, after the move. Throws when the panel or layer is not found.
       */
      move: (
        panelId: string,
        layerId: string,
        to: (typeof LAYER_MOVES)[number] | number
      ): Layer[] => {
        if (typeof to !== 'number') assertKind(to, LAYER_MOVES, 'Move');
        else if (!Number.isInteger(to)) throw new Error('Move position must be an integer.');
        return snapshot(
          mutate(deps, (p) => {
            const stack = requirePanel(p, panelId).layers;
            const from = stack.findIndex((l) => l.id === layerId);
            if (from < 0) throw new Error(`Layer "${layerId}" not found.`);
            const [layer] = stack.splice(from, 1);
            const target =
              typeof to === 'number'
                ? to
                : { top: stack.length, bottom: 0, up: from + 1, down: from - 1 }[to];
            stack.splice(Math.min(stack.length, Math.max(0, target)), 0, layer);
            return stack;
          })
        );
      },
    },

    /**
     * Speech/thought/shout/caption bubbles inside a panel, addressed by panel id.
     * Bubbles always render above all layers.
     */
    bubbles: {
      /**
       * List the bubbles of a panel.
       * @param panelId - The panel id.
       * @returns Deep-cloned Bubble snapshots, or null when the panel is not found. Read-only.
       */
      list: bubbles.list,

      /**
       * Get one bubble.
       * @param panelId - The panel id.
       * @param bubbleId - The bubble id.
       * @returns A deep-cloned Bubble snapshot, or null when not found. Read-only.
       */
      get: bubbles.get,

      /**
       * Add a bubble to a panel. Speech, thought and shout bubbles get a pointer
       * (tail) aimed at tailX/tailY, which by default sits below the
       * bubble; move it later with update(). Captions have no pointer. The
       * text is scaled to fit the bubble's width and height.
       * @param panelId - The panel id.
       * @param input - { kind?, text, x?, y?, width?, height?, tailX?, tailY? }. kind defaults to "speech"; x/y/width/height are % of panel size (x/y is the bubble's top-left corner; defaults 10, 10, 40, 20); tailX/tailY are the pointer's tip in % of panel size.
       * @returns A deep-cloned snapshot of the new Bubble.
       */
      add: (panelId: string, input: BubbleInput): Bubble => {
        assertKind(input.kind ?? 'speech', BUBBLE_KINDS, 'Bubble kind');
        const {
          kind = 'speech',
          x = 10,
          y = 10,
          width = 40,
          height = 20,
          tailX,
          tailY,
          text,
        } = input;
        return bubbles.add(panelId, {
          id: newId('bubble'),
          kind,
          x,
          y,
          width,
          height,
          ...(kind !== 'caption' && defaultPointer({ x, y, width, height })),
          ...definedFields({ tailX, tailY }),
          text,
        });
      },

      /**
       * Update a bubble: text, kind, position, size, or tail target.
       * Only the given fields change.
       * @param panelId - The panel id.
       * @param bubbleId - The bubble id.
       * @param patch - Partial bubble fields.
       * @returns A deep-cloned snapshot of the updated Bubble. Throws when the panel or bubble is not found.
       */
      update: (panelId: string, bubbleId: string, patch: BubblePatch): Bubble => {
        if (patch.kind !== undefined) assertKind(patch.kind, BUBBLE_KINDS, 'Bubble kind');
        return bubbles.update(panelId, bubbleId, patch);
      },

      /**
       * Delete a bubble from a panel.
       * @param panelId - The panel id.
       * @param bubbleId - The bubble id.
       * @returns True when a bubble was removed, false when not found.
       */
      delete: bubbles.delete,
    },

    /**
     * The project's story bible: the STYLE paragraph plus the media registry.
     * Use characters/scenes/objects for the individual entries.
     */
    metadata: {
      /**
       * Read the whole metadata block (style, characters, scenes, objects, media).
       * @returns A deep-cloned metadata snapshot. Read-only: mutate via the dedicated functions.
       */
      get: () => snapshot(requireProject(deps).metadata),

      /**
       * Set the STYLE paragraph: a short, fixed description of the visual style (medium, line,
       * palette, lighting, mood). Stitched, verbatim, into every image's prompt, so keep it to a
       * few sentences and change it only if the story calls for it. There is no separate synopsis
       * field: track story notes elsewhere, since stitching a whole synopsis into every prompt
       * would drown out what is unique to each image.
       * @param text - The new STYLE paragraph.
       * @returns { ok: true }.
       */
      setStyle: (text: string): ActionResult => {
        deps.updateProject((p) => {
          p.metadata.style = text;
        });
        return { ok: true };
      },

      /**
       * Set the physical page dimensions for the comic. Panels are stored as
       * percentages of the page, so they keep their layout but their aspect
       * ratios change with the page: regenerate art sized by panels.size.
       * @param pageSize - { label, widthIn, heightIn }, e.g. one of
       *   PAGE_SIZE_PRESETS from the data model.
       * @returns { ok, error? }.
       */
      setPageSize: (pageSize: PageSize): ActionResult => {
        if (
          !pageSize ||
          typeof pageSize.label !== 'string' ||
          !(pageSize.widthIn > 0) ||
          !(pageSize.heightIn > 0)
        ) {
          return { ok: false, error: 'pageSize needs { label, widthIn, heightIn }.' };
        }
        deps.updateProject((p) => {
          p.metadata.pageSize = { ...pageSize };
        });
        return { ok: true };
      },
    },

    /**
     * Characters in the story bible. A character's description sets its visual
     * look (appearance, outfit, distinctive features) plus continuity notes;
     * imageIds point at reference art in metadata.media (upload it with
     * media.upload). An LLM reads a character (description + images) together
     * with a scene to build image-generation prompts: copy the description
     * verbatim into every prompt involving the character, and pass its reference
     * images (media.download) to the generator, so it looks the same on every
     * page (see the continuity guide above). In update(), imageIds and
     * linkIds replace the existing lists (they are not appended to).
     */
    characters: {
      /**
       * List characters.
       * @returns [{ id, name }] for every character.
       */
      list: characters.list,

      /**
       * Get one character with its full description and image/scene links.
       * @param id - The character id.
       * @returns A deep-cloned Character snapshot, or null when not found. Read-only.
       */
      get: characters.get,

      /**
       * Create a character.
       * @param input - { name, description?, imageIds?, linkIds? }: linkIds are scene ids the character appears in.
       * @returns The new Character.
       */
      create: characters.create,

      /**
       * Update a character's name, description, or image/scene links.
       * Only the given fields change.
       * @param id - The character id.
       * @param patch - { name?, description?, imageIds?, linkIds? }.
       * @returns A deep-cloned snapshot of the updated Character. Throws when not found.
       */
      update: characters.update,

      /**
       * Delete a character. References from scenes are left dangling; clean
       * them with scenes.update if needed.
       * @param id - The character id.
       * @returns True when a character was removed, false when not found.
       */
      delete: characters.delete,

      /**
       * Generate a reference image for this character with the configured image generator (see the
       * generate namespace): built from the STYLE paragraph, this character's description and,
       * unless given, a default prompt for a multi-angle turnaround sheet (see
       * generate.referencePrompt) on a plain white background, using its existing reference images
       * (if any) so a new one stays consistent. Registers the image but does not add it to imageIds —
       * review it, then add it yourself with characters.update(id, { imageIds: [...] }), the same
       * "register, then link" split as media.upload.
       * @param id - The character id.
       * @param prompt - Optional prompt to use instead of the default (e.g. edited by a user before generating).
       * @param references - Optional reference images to send instead of the entry's own (see generate.entryReferences), each { mediaId, note? }; a note says how to use that image and is added to the prompt.
       * @returns A promise resolving to the new MediaItem.
       */
      generateImage: (
        id: string,
        prompt?: string,
        references?: GenerationReference[]
      ): Promise<MediaItem> => generateReferenceImage(deps, 'characters', id, prompt, references),
    },

    /**
     * Scenes/locations in the story bible. A scene's description covers the
     * setting, time of day, mood, and lighting — the other half (with a
     * character) of an image-generation prompt.
     */
    scenes: {
      /**
       * List scenes.
       * @returns [{ id, name }] for every scene.
       */
      list: scenes.list,

      /**
       * Get one scene with its full description and character/image links.
       * @param id - The scene id.
       * @returns A deep-cloned Scene snapshot, or null when not found. Read-only.
       */
      get: scenes.get,

      /**
       * Create a scene.
       * @param input - { name, description?, imageIds?, linkIds? }: linkIds are character ids appearing in the scene.
       * @returns The new Scene.
       */
      create: scenes.create,

      /**
       * Update a scene's name, description, or character/image links.
       * Only the given fields change.
       * @param id - The scene id.
       * @param patch - { name?, description?, imageIds?, linkIds? }.
       * @returns A deep-cloned snapshot of the updated Scene. Throws when not found.
       */
      update: scenes.update,

      /**
       * Delete a scene. References from characters/objects are left dangling;
       * clean them with characters.update / objects.update if needed.
       * @param id - The scene id.
       * @returns True when a scene was removed, false when not found.
       */
      delete: scenes.delete,

      /**
       * Generate a reference image for this scene with the configured image generator (see the
       * generate namespace): built from the STYLE paragraph, this scene's description and, unless
       * given, a default prompt for an establishing shot of the location itself (no characters; see
       * generate.referencePrompt), using its existing reference images (if any) so a new one stays
       * consistent. Registers the image but does not add it to imageIds — review it, then add it
       * yourself with scenes.update(id, { imageIds: [...] }), the same "register, then link" split as
       * media.upload.
       * @param id - The scene id.
       * @param prompt - Optional prompt to use instead of the default (e.g. edited by a user before generating).
       * @param references - Optional reference images to send instead of the entry's own (see generate.entryReferences), each { mediaId, note? }; a note says how to use that image and is added to the prompt.
       * @returns A promise resolving to the new MediaItem.
       */
      generateImage: (
        id: string,
        prompt?: string,
        references?: GenerationReference[]
      ): Promise<MediaItem> => generateReferenceImage(deps, 'scenes', id, prompt, references),
    },

    /**
     * Props/objects in the story bible. Same shape as characters: a visual
     * description plus reference art, linkable from scenes.
     */
    objects: {
      /**
       * List objects.
       * @returns [{ id, name }] for every object.
       */
      list: objects.list,

      /**
       * Get one object with its full description and image/scene links.
       * @param id - The object id.
       * @returns A deep-cloned ComicObject snapshot, or null when not found. Read-only.
       */
      get: objects.get,

      /**
       * Create an object.
       * @param input - { name, description?, imageIds?, linkIds? }: linkIds are scene ids where the object appears.
       * @returns The new ComicObject.
       */
      create: objects.create,

      /**
       * Update an object's name, description, or image/scene links.
       * Only the given fields change.
       * @param id - The object id.
       * @param patch - { name?, description?, imageIds?, linkIds? }.
       * @returns A deep-cloned snapshot of the updated ComicObject. Throws when not found.
       */
      update: objects.update,

      /**
       * Delete an object.
       * @param id - The object id.
       * @returns True when an object was removed, false when not found.
       */
      delete: objects.delete,

      /**
       * Generate a reference image for this object with the configured image generator (see the
       * generate namespace): built from the STYLE paragraph, this object's description and, unless
       * given, a default prompt for a multi-angle turnaround sheet (see generate.referencePrompt) on a
       * plain white background, using its existing reference images (if any) so a new one stays
       * consistent. Registers the image but does not add it to imageIds — review it, then add it
       * yourself with objects.update(id, { imageIds: [...] }), the same "register, then link" split as
       * media.upload.
       * @param id - The object id.
       * @param prompt - Optional prompt to use instead of the default (e.g. edited by a user before generating).
       * @param references - Optional reference images to send instead of the entry's own (see generate.entryReferences), each { mediaId, note? }; a note says how to use that image and is added to the prompt.
       * @returns A promise resolving to the new MediaItem.
       */
      generateImage: (
        id: string,
        prompt?: string,
        references?: GenerationReference[]
      ): Promise<MediaItem> => generateReferenceImage(deps, 'objects', id, prompt, references),
    },

    /**
     * The project's media registry: image files in the project's storage
     * folder (Drive, or a self-hosted server). Layers (via mediaId) and
     * characters/scenes/objects (via imageIds) refer to these entries instead
     * of raw URLs.
     */
    media: {
      /**
       * List every registered media file.
       * @returns Deep-cloned MediaItem snapshots. Read-only.
       */
      list: (): MediaItem[] => snapshot(requireProject(deps).metadata.media),

      /**
       * Get one media entry.
       * @param id - The media id.
       * @returns A deep-cloned MediaItem snapshot, or null when not found. Read-only. fileName is the image's internal storage reference, not something you can fetch yourself: use media.download(id) to read the image itself.
       */
      get: (id: string): MediaItem | null => {
        const item = requireProject(deps).metadata.media.find((m) => m.id === id);
        return item ? snapshot(item) : null;
      },

      /**
       * Read a registered image: the bytes of a media file, fetched from
       * storage and returned as a data URL. Use it to get reference images (a
       * character's imageIds, or a layer's mediaId) to pass to an image
       * generator that accepts reference or input images, so a new image can
       * match existing art. The counterpart of upload().
       * @param id - The media id (from media.list, characters.get(id).imageIds, or a layer's mediaId).
       * @returns A promise resolving to { name, mimeType, dataUrl }. Rejects when the media id is not found or storage is not connected.
       */
      download: (id: string) => deps.downloadStorageMedia(id),

      /**
       * Upload image bytes to the current project's storage folder and register
       * the file in metadata.media. All images live in the project's storage:
       * upload art and character reference images with this, then wire the
       * returned id into a layer (layers.add with mediaId) or a character /
       * scene / object (imageIds).
       *
       * Always send a thumbnail with the image. The editor's media picker
       * lists every image in the project as a thumbnail, and an image with
       * none has to be downloaded in full just to appear there: slow and
       * heavy once a project has many images, or large ones. So resize the
       * image yourself, where you already have its pixels, to about 256px on
       * the long side (keep the aspect ratio; PNG if the image has
       * transparency so cut-outs stay cut out, otherwise JPEG at about 85%
       * quality, typically 10-30 KB) and pass it as opts.thumbnailDataUrl. If
       * you leave it out, the browser makes one from the full image: that
       * works, but only after decoding the whole upload in the page, so a
       * thumbnail you already have is cheaper. Images uploaded without a
       * thumbnail can be fixed later with media.uploadThumbnail.
       * @param name - File name, e.g. "hero-front.png".
       * @param dataUrl - The image bytes as a data: URL (e.g. from a generated PNG).
       * @param opts - Optional { mimeType, thumbnailDataUrl, subjectId, sceneId }: mimeType defaults to "image/png"; thumbnailDataUrl is the image resized to about 256px on its long side, as a data: URL (PNG for transparent images, else JPEG). Strongly recommended. subjectId is the id of the character or object this image is art of (it must exist): the media picker lists a subject's art first. sceneId is the same for a scene (a background). Do not use either for reference art: put those ids in the character's or scene's imageIds.
       * @returns A promise resolving to the new MediaItem. Its thumbnailFileName is set when a thumbnail was stored; if it is missing, retry with media.uploadThumbnail.
       */
      upload: (
        name: string,
        dataUrl: string,
        opts?: {
          mimeType?: string;
          thumbnailDataUrl?: string;
          subjectId?: string;
          sceneId?: string;
        }
      ): Promise<MediaItem> => {
        if (opts?.subjectId !== undefined) assertSubject(requireProject(deps), opts.subjectId);
        if (opts?.sceneId !== undefined) assertScene(requireProject(deps), opts.sceneId);
        return deps.uploadStorageMedia(
          name,
          dataUrl,
          opts?.mimeType || 'image/png',
          opts?.thumbnailDataUrl,
          { subjectId: opts?.subjectId, sceneId: opts?.sceneId }
        );
      },

      /**
       * Rename an image or say what it shows. Only the registry entry changes:
       * the stored file keeps the name it was uploaded with.
       * @param id - The media id.
       * @param patch - { name?, subjectId?, sceneId? }: name is the new display name (not empty); subjectId is the id of the character or object the image is art of and sceneId the scene it is art of (each must exist), or null to clear it.
       * @returns A deep-cloned snapshot of the updated MediaItem. Throws when the media id is not found.
       */
      update: (
        id: string,
        patch: { name?: string; subjectId?: string | null; sceneId?: string | null }
      ): MediaItem => {
        const project = requireProject(deps);
        if (patch.name !== undefined && !patch.name.trim()) throw new Error('Name is required.');
        if (typeof patch.subjectId === 'string') assertSubject(project, patch.subjectId);
        if (typeof patch.sceneId === 'string') assertScene(project, patch.sceneId);
        return snapshot(
          mutate(deps, (p) => {
            const item = p.metadata.media.find((m) => m.id === id);
            if (!item) throw new Error(`Media "${id}" not found.`);
            if (patch.name !== undefined) item.name = patch.name.trim();
            if (typeof patch.subjectId === 'string') item.subjectId = patch.subjectId;
            else if (patch.subjectId === null) delete item.subjectId;
            if (typeof patch.sceneId === 'string') item.sceneId = patch.sceneId;
            else if (patch.sceneId === null) delete item.sceneId;
            return item;
          })
        );
      },

      /**
       * Upload the thumbnail of an image already in the registry, replacing
       * its old one. The editor shows the thumbnail instead of the full image
       * in lists and pickers, so the media picker does not have to download
       * every full image. Resize the image yourself and give it a small copy:
       * about 256px on the long side, PNG when the image has transparency
       * (so cut-outs stay cut out), else JPEG at about 85% quality. Use it for
       * images uploaded without a thumbnail, and to replace a poor one.
       * @param id - The media id.
       * @param dataUrl - The thumbnail bytes as a data: URL.
       * @returns A promise resolving to the updated MediaItem, whose thumbnailFileName is the new thumbnail's stable name. Rejects when the media id is not found.
       */
      uploadThumbnail: (id: string, dataUrl: string): Promise<MediaItem> =>
        deps.uploadStorageThumbnail(id, dataUrl),

      /**
       * Delete an image: its file and its thumbnail are trashed in storage
       * (recoverable there) and it leaves the registry. Anything using it
       * lets go of it: layers showing it stay but lose their image (they are
       * prompt-only layers again), and characters, scenes and objects drop it
       * from their imageIds.
       * @param id - The media id.
       * @returns A promise resolving to { layers, entries }: how many layers lost their image and how many story-bible entries lost a reference image. Rejects when the media id is not found or storage is not connected.
       */
      delete: (id: string): Promise<{ layers: number; entries: number }> =>
        deps.deleteStorageMedia(id),
    },

    /**
     * Generate art with the configured image generator (a self-hosted ComfyUI
     * instance; see setConfig): stitches a layer's prompt the same way the
     * layers namespace describes and pulls in its linked character's or
     * scene's reference images. layer() and the characters/scenes/objects
     * generateImage() functions only register the result, for you to preview
     * and commit yourself; dirty() (no one to preview a batch for) commits
     * each result as it goes. Only one generation request runs at a time,
     * even across overlapping calls (see queue()).
     */
    generate: {
      /**
       * Generate a new image for one layer (or background), regardless of
       * dirty. Registers the image but does not set it as the layer's image —
       * review it, then commit it yourself with layers.update(panelId,
       * layerId, { mediaId, aspectRatio }) (the previous image, if any, is
       * kept in the layer's history rather than discarded when you do; see
       * mediaHistory in the data model).
       * @param panelId - The panel id.
       * @param layerId - The layer id.
       * @param prompt - Optional prompt to use instead of the default (e.g. edited by a user before generating; see generate.layerPrompt).
       * @param references - Optional reference images to send instead of the defaults (see generate.layerReferences), each { mediaId, note? }; a note says how to use that image and is added to the prompt. Extras beyond generate.maxReferenceImages are ignored.
       * @returns A promise resolving to the new MediaItem, plus the aspect ratio the image actually came out at. Rejects when no generator is configured, or generation fails.
       */
      layer: (
        panelId: string,
        layerId: string,
        prompt?: string,
        references?: GenerationReference[]
      ): Promise<GeneratedImage> => generateLayerImage(deps, panelId, layerId, prompt, references),

      /**
       * The reference images generate.layer sends by default: those of the layer's character/object
       * (foreground) or scene (background).
       * @param panelId - The panel id.
       * @param layerId - The layer id.
       * @returns The references, in the order they're sent.
       */
      layerReferences: (panelId: string, layerId: string): GenerationReference[] =>
        defaultLayerReferences(deps, panelId, layerId),

      /**
       * The reference images characters/scenes/objects.generateImage sends by default: the entry's own images.
       * @param kind - Which story-bible list the entry is in.
       * @param id - The entry id.
       * @returns The references, in the order they're sent.
       */
      entryReferences: (
        kind: 'characters' | 'scenes' | 'objects',
        id: string
      ): GenerationReference[] => defaultEntryReferences(deps, kind, id),

      /** How many reference images the configured generator uses (0 if none is configured). */
      maxReferenceImages: (): number => maxReferenceImages(deps),

      /**
       * The default prompt for a layer's (or background's) image (what generate.layer uses when no
       * prompt is given). Read this to pre-fill an editable prompt before generating.
       * @param panelId - The panel id.
       * @param layerId - The layer id.
       * @returns The stitched prompt. Throws when the panel or layer is not found.
       */
      layerPrompt: (panelId: string, layerId: string): string =>
        buildLayerPrompt(requireProject(deps), panelId, layerId),

      /**
       * What generate.dirty() would generate, without generating anything:
       * every layer and background across the whole project whose dirty is
       * true. Call this first to see (and confirm) the work, then generate.dirty().
       * @returns One { pageId, panelId, layerId, page, panelTitle?, panelNumber, name, kind, prompt?, hasImage } per dirty item. hasImage is false for a layer with no image yet.
       */
      pending: (): PendingGeneration[] => pendingGenerations(requireProject(deps)),

      /**
       * Generate images for every layer and background across the whole
       * project whose dirty is true, one request at a time, committing each
       * result as its layer's image as it goes (unlike generate.layer, there's
       * no one to preview a batch for). A failure on one item does not stop
       * the rest.
       * @returns A promise resolving to one { pageId, panelId, layerId, ok, error? } per dirty item found when it started.
       */
      dirty: (): Promise<GenerationOutcome[]> => generateAllDirty(deps, setLayerMedia),

      /**
       * Read the image generator configuration. Per-machine, not part of the project.
       * @returns The current config, or null when none is set.
       */
      getConfig: (): GeneratorConfig | null => deps.getGeneratorConfig(),

      /**
       * Set the image generator configuration: currently a self-hosted
       * ComfyUI instance (provider: "comfy"): its base URL, a workflow
       * exported from it in "API format", and which node ids hold the
       * positive prompt, reference image(s), output and, optionally, size and seed.
       * @param config - { provider: "comfy", comfy: { baseUrl, workflow, nodes: { positivePromptNodeId, outputNodeId, referenceImageNodeIds?, sizeNodeId?, seedNodeId?, seedField? } } }.
       * @returns { ok, error? }.
       */
      setConfig: (config: GeneratorConfig): ActionResult => {
        try {
          assertValidGeneratorConfig(config);
        } catch (e) {
          return { ok: false, error: errorMessage(e) };
        }
        deps.setGeneratorConfig(config);
        return { ok: true };
      },

      /**
       * Check that the configured image generator is reachable.
       * @returns A promise resolving to { ok, error? }.
       */
      testConnection: async (): Promise<ActionResult> => {
        const config = deps.getGeneratorConfig();
        if (!config) return { ok: false, error: 'No image generator is configured.' };
        try {
          await createProvider(config, deps.generatorFetch).test();
          return { ok: true };
        } catch (e) {
          return { ok: false, error: errorMessage(e) };
        }
      },

      /**
       * The default prompt for a story-bible entry's reference image (what
       * characters.generateImage / scenes.generateImage / objects.generateImage use when no prompt is
       * given): the STYLE paragraph, the entry's description, and a technical requirements line (a
       * multi-angle turnaround sheet for a character or object; an establishing shot for a scene).
       * Read this to pre-fill an editable prompt before generating.
       * @param kind - "characters", "scenes", or "objects".
       * @param id - The entry's id.
       * @returns The stitched prompt. Throws when the entry is not found.
       */
      referencePrompt: (kind: ReferenceKind, id: string): string =>
        buildReferencePrompt(requireProject(deps), kind, id),

      /**
       * The generation queue right now: every layer, dirty-batch item and reference-image request
       * that's running or waiting its turn, in the order it will run (or is running). Empty when
       * nothing is generating.
       * @returns [{ id, label, status: "queued" | "running" }].
       */
      queue: (): QueueItem[] => getQueue(),
    },
  };

  return ComicBuilder;
}

type ComicBuilderApi = ReturnType<typeof createComicBuilder>;

/** Install the API on window, with the extracted JSDoc attached as each node's toString(). */
export function installComicBuilder(deps: ComicBuilderDeps): void {
  const api = createComicBuilder(deps);
  attachDocs(api, ACTION_DOCS, 'ComicBuilder');
  window.ComicBuilder = api;
}

export function uninstallComicBuilder(): void {
  delete window.ComicBuilder;
}

/** The installed window.ComicBuilder; every UI control calls through it. */
export function cb(): ComicBuilderApi {
  if (!window.ComicBuilder) throw new Error('ComicBuilder API is not installed yet.');
  return window.ComicBuilder;
}
