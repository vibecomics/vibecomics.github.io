/**
 * The window.ComicBuilder command API: a CLI for the whole VibeComics UI.
 *
 * Every UI control calls these same functions, so a human's clicks and an AI
 * agent's calls share one code path. The JSDoc on every node of the
 * `ComicBuilder` literal below is the single source of truth for the docs:
 * scripts/build/extract-docs.mjs turns it into src/ai/actions.docs.gen.ts (attached
 * as each node's toString() and rendered by ComicBuilder.help()) and
 * public/api.txt (the static API reference; public/llms.txt is the separate
 * how-to-build-a-comic guide, scripts/build/llms-guide.md).
 */

import type { DeviceCodeInfo } from '../drive/deviceOAuth';
import type { StorageConnectionInfo } from '../storage/connections';
import type { ProjectFolder } from '../storage/types';
import { createProvider } from '../generators/service';
import { assertValidGeneratorConfig, hasServiceUrl } from '../generators/types';
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
  STORY_KIND_NAMES,
  assertKind,
  assertScene,
  assertSubject,
  assertOptionalText,
  assertVariation,
  cascadeStyleDirty,
  cascadeCharacterStyleDirty,
  cascadeSceneStyleDirty,
  definedFields,
  imageSwapPatch,
  imageUnlinkPatch,
  layerArtSize,
  mutate,
  panelItemsApi,
  panelsApi,
  pendingGenerations,
  pendingPanelImages,
  pendingReferenceGenerations,
  requirePanel,
  requireProject,
  resolveLayerImage,
  snapshot,
  storyApi,
  variationsApi,
} from './builders';
import type {
  LayerKind,
  PendingGeneration,
  PendingPanelImage,
  PendingReference,
  StoryKind,
} from './builders';
import type {
  ActionResult,
  BubbleInput,
  BubblePatch,
  ComicBuilderDeps,
  LayerInput,
  LayerOrder,
  LayerUpdate,
  MetadataPatch,
  StoryEntryInput,
  StoryEntryPatch,
} from './deps';
import { attachDocs } from './docs';
import { panelBrief } from './panelBrief';
import type { PanelBrief } from './panelBrief';
import {
  cancelAllGenerations,
  cancelLayerGeneration,
  cancelQueueItem as cancelGenerationQueueItem,
  cancelReferenceGeneration,
  cancelVariationGeneration,
  cancelPanelGeneration,
  defaultEntryReferences,
  defaultLayerReferences,
  generateAllDirty,
  generateAllDirtyVariations,
  generateAllVariations,
  generateLayerImage,
  generatePanelImage,
  generateReferenceImage,
  generateVariationImage,
  getQueue,
  maxReferenceImages,
} from './generation';
import type { GenerationReference, GenerationTarget } from './generation';
import type {
  GeneratedImage,
  GenerationOutcome,
  QueueItem,
  VariationOutcome,
  VariationRefOutcome,
} from './generation';
import {
  buildLayerPrompt,
  buildLayerPromptParts,
  buildReferencePrompt,
  buildReferencePromptParts,
} from './prompt';
import type { PromptPart } from './prompt';
import { formatTarget, parseTarget } from './targets';
import type { AnyTarget } from './targets';

/** What generate.inspect returns for a layer or reference target. */
export interface PromptInspection {
  prompt: string;
  parts: PromptPart[];
  references: GenerationReference[];
  maxReferenceImages: number;
  /** The image service prompt (see generate.config), when one is set. */
  imageServicePrompt?: string;
}

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
  const story = {
    characters: storyApi(deps, 'characters'),
    scenes: storyApi(deps, 'scenes'),
    objects: storyApi(deps, 'objects'),
  };
  const storyOf = (kind: StoryKind) => {
    assertKind(kind, STORY_KIND_NAMES, 'Kind');
    return story[kind];
  };
  const variations = variationsApi(deps);

  /** Move a layer within its panel's stack (layers.update's `order`). */
  function moveLayer(panelId: string, layerId: string, to: LayerOrder): void {
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
    });
  }

  /** Shared by layers.update and generate.run/batch, which also need to set a layer's image. */
  function updateLayer(panelId: string, layerId: string, input: LayerUpdate): Layer {
    const { order, ...patch } = input;
    if (order !== undefined) {
      if (typeof order !== 'number') assertKind(order, LAYER_MOVES, 'Order');
      else if (!Number.isInteger(order)) throw new Error('Order must be an integer.');
    }
    if (patch.kind !== undefined) assertKind(patch.kind, LAYER_KINDS, 'Layer kind');
    const project = requireProject(deps);
    const current = layers.get(panelId, layerId);
    if (!current) throw new Error(`Layer "${layerId}" not found.`);
    const { subjectId, sceneId, variationId, mediaId, ...rest } = patch;
    const swapsImage = typeof mediaId === 'string';
    const unlinksImage = mediaId === null;
    let image: Partial<Layer> = {};
    if (swapsImage) {
      resolveLayerImage(project, { mediaId });
      image = imageSwapPatch(current, mediaId);
    } else if (unlinksImage) {
      image = imageUnlinkPatch(current);
    }
    if (typeof subjectId === 'string') assertSubject(project, subjectId);
    if (typeof sceneId === 'string') assertScene(project, sceneId);
    const subjectChanged = subjectId !== undefined && subjectId !== current.subjectId;
    const sceneChanged = sceneId !== undefined && sceneId !== current.sceneId;
    // A variation belongs to one specific entry, so switching to a different subject/scene (or
    // clearing it) invalidates the current one, unless this same call also gives a new one.
    const clearsVariation = (subjectChanged || sceneChanged) && variationId === undefined;
    if (typeof variationId === 'string') {
      const ownerId =
        typeof subjectId === 'string'
          ? subjectId
          : typeof sceneId === 'string'
            ? sceneId
            : current.kind === 'background'
              ? current.sceneId
              : current.subjectId;
      if (!ownerId) throw new Error('variationId needs a linked subjectId or sceneId.');
      assertVariation(project, ownerId, variationId);
    }
    // A new image satisfies whatever prompt asked for it, so it always clears dirty (image.dirty,
    // set above), even alongside a prompt change (that means "here is the new art for it").
    // Otherwise, touching the prompt, the linked scene/subject, or the chosen variation makes the
    // current image stale (dirty) unless that leaves no prompt at all to act on.
    const touchesPrompt =
      patch.prompt !== undefined ||
      subjectId !== undefined ||
      sceneId !== undefined ||
      variationId !== undefined;
    const dirty =
      swapsImage || unlinksImage
        ? undefined
        : touchesPrompt
          ? Boolean((patch.prompt ?? current.prompt ?? '').trim())
          : undefined;
    const updated = layers.update(
      panelId,
      layerId,
      {
        ...rest,
        ...image,
        ...(dirty !== undefined && { dirty }),
        ...(typeof subjectId === 'string' && { subjectId }),
        ...(typeof sceneId === 'string' && { sceneId }),
        ...(typeof variationId === 'string' && { variationId }),
      },
      [
        ...(subjectId === null ? ['subjectId'] : []),
        ...(sceneId === null ? ['sceneId'] : []),
        ...(variationId === null || clearsVariation ? ['variationId'] : []),
        ...(unlinksImage ? ['mediaId'] : []),
      ]
    );
    if (order === undefined) return updated;
    moveLayer(panelId, layerId, order);
    return layers.get(panelId, layerId) ?? updated;
  }
  const setLayerMedia = (
    panelId: string,
    layerId: string,
    mediaId: string,
    aspectRatio?: number
  ): Layer =>
    updateLayer(panelId, layerId, { mediaId, ...(aspectRatio !== undefined && { aspectRatio }) });

  // Only layer/reference targets get this overload's plain, synchronous PromptInspection: a panel
  // target is always the heavier async PanelBrief (see the implementation's own t.type === 'panel'
  // branch), so it must NOT match here even though GenerationTarget now includes it (for the
  // queue/focus machinery, which treats every kind of generation target alike).
  function inspect(
    target: Extract<GenerationTarget, { type: 'layer' } | { type: 'reference' }>
  ): PromptInspection;
  function inspect(
    target: string | AnyTarget,
    includeImages?: boolean
  ): PromptInspection | Promise<PanelBrief>;
  function inspect(
    target: string | AnyTarget,
    includeImages?: boolean
  ): PromptInspection | Promise<PanelBrief> {
    const t = parseTarget(target);
    const project = requireProject(deps);
    const max = maxReferenceImages(deps);
    const servicePrompt = deps.getGeneratorConfig()?.prompt?.trim();
    const extra = servicePrompt ? { imageServicePrompt: servicePrompt } : {};
    if (t.type === 'layer') {
      return {
        prompt: buildLayerPrompt(project, t.panelId, t.layerId),
        parts: buildLayerPromptParts(project, t.panelId, t.layerId),
        references: defaultLayerReferences(deps, t.panelId, t.layerId),
        maxReferenceImages: max,
        ...extra,
      };
    }
    if (t.type === 'reference') {
      return {
        prompt: buildReferencePrompt(project, t.kind, t.entryId, t.variationId),
        parts: buildReferencePromptParts(project, t.kind, t.entryId, t.variationId),
        references: defaultEntryReferences(deps, t.kind, t.entryId, t.variationId),
        maxReferenceImages: max,
        ...extra,
      };
    }
    if (t.type === 'panel') return panelBrief(deps, t.panelId, includeImages);
    throw new Error('Inspect one variation or entry at a time, not "/*".');
  }

  function configure(): GeneratorConfig | null;
  function configure(config: GeneratorConfig): ActionResult;
  function configure(config?: GeneratorConfig): GeneratorConfig | null | ActionResult {
    if (config === undefined) return deps.getGeneratorConfig();
    try {
      assertValidGeneratorConfig(config);
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
    deps.setGeneratorConfig(config);
    return { ok: true };
  }

  /**
   * Top-level command API for VibeComics: every UI control calls these same
   * functions (one code path, no drift). Namespaces: storage (connect to
   * Google Drive or an S3-compatible bucket, project folders, project.json
   * IO), project (whole-project replace and lint), page (navigation, preview,
   * adding pages), panels (page layout and panel image), layers, bubbles,
   * metadata (style and page size), reference (characters, scenes and objects),
   * variations, media, generate. Reads return deep-cloned snapshots.
   * Changes are saved automatically within a minute (only when something
   * changed); storage.save() saves immediately. Everything except storage and
   * help() needs an open project: without one, page.list/select and
   * layers/bubbles list/get return empty or null, and every other call throws
   * "No project is open".
   */
  const ComicBuilder = {
    /**
     * Render the full skill-style reference for this API: conventions plus every namespace and function with its description, parameters, and return value. This text is generated at build time from the JSDoc in src/ai/actions.ts, so it never drifts from the code.
     * @returns The complete API reference as plain text.
     */
    help: (): string => HELP_TEXT,

    /**
     * Project storage: either Google Drive or an S3-compatible bucket (any
     * self-hosted server, or real AWS S3/R2/B2), picked once per session on
     * the connect screen. Whichever is active, the app only sees folders and
     * files it created there; listProjects() is the complete list.
     */
    storage: {
      /**
       * Add a storage connection (it does not replace any already connected): Google Drive, or an
       * S3-compatible bucket (any self-hosted server, or real AWS S3/R2/B2). Several can be live at once.
       *
       * Drive uses the OAuth device flow and resolves promptly with { url, code, expiresInSeconds }:
       * show the user the URL and code (they open the URL on any device, a phone works, enter the code,
       * and approve), then poll storage.status() until Drive appears in `connections` with connected:
       * true. If the user denies the request or the code expires, it simply never appears (the app shows
       * the reason). Rejects immediately if the device client is not configured. Works from injected
       * scripts: no popup, no user gesture needed. The device client secret ships in the app bundle by
       * design (Google's device-client model: distributed apps cannot keep secrets; scope stays limited
       * to drive.file, and the access token itself is memory-only, so this must be run again after every
       * page reload).
       *
       * An S3 connection string just checks the bucket is reachable with these credentials (HeadBucket),
       * then adds it, and resolves to nothing. In the browser, the whole connection string (credentials
       * included) is remembered, so it reconnects automatically next page load: this only needs calling
       * once per bucket. The command line instead reads credentials fresh from the environment on every
       * run; only the endpoint and bucket are remembered in its state file.
       * @param target - "drive", or `s3://accessKeyId[:secretAccessKey]@host[:port]/bucket[?region=...&tls=1&pathStyle=0]`.
       * @returns For "drive", the verification URL, user code and code expiry; for a bucket, nothing once connected.
       */
      connect: (target: string): Promise<DeviceCodeInfo | void> =>
        target.trim().toLowerCase() === 'drive'
          ? deps.connectStorageWithDevice()
          : deps.connectStorageWithS3(target),

      /**
       * Disconnect storage. With an id (from storage.status()), drop just that connection: if it is
       * backing the open project, unsaved changes are saved first and the project is closed; a
       * remembered-but-not-yet-reconnected bucket is removed the same way. With no id, disconnect every
       * connection: save any unsaved changes, then drop them all (revoking the grant at Google, if Drive
       * is connected).
       * @param id - Optional connection id from storage.status(). Omit to disconnect everything.
       * @returns A promise that resolves once it is disconnected.
       */
      disconnect: async (id?: string): Promise<void> => {
        if (id === undefined) await deps.disconnectStorage();
        else await deps.disconnectStorageConnection?.(id);
      },

      /**
       * The storage connection state.
       * @returns { connected, configured, connections }: connected means at least one connection is live; configured means Drive's device OAuth client is set (irrelevant once a bucket is connected); connections lists every known one as [{ id, kind, label, connected }]: Google Drive when connected this session, and every S3-compatible bucket (connected now, including ones auto-reconnected from a previous session, or still "offline" when that auto-reconnect failed, e.g. the server is unreachable).
       */
      status: async (): Promise<{
        connected: boolean;
        configured: boolean;
        connections: StorageConnectionInfo[];
      }> => ({
        ...deps.getStorageStatus(),
        connections: (await deps.listStorageConnections?.()) ?? [],
      }),

      /**
       * List every project folder across every connected storage location
       * (on Drive: files.list under the drive.file scope, so the app is
       * blind to everything else on the user's Drive), sorted by name. When
       * a project of the same name exists in more than one connection, only
       * one is listed (an S3 bucket's copy is preferred over Drive's) —
       * each entry's connectionId/connectionLabel says where it
       * came from.
       * @param show - Also go back to the project tiles page in the app (the current project, if any, stays open in the background). Default false.
       * @returns A promise resolving to [{ id, name, connectionId, connectionLabel }] of project folders.
       */
      listProjects: (show?: boolean): Promise<ProjectFolder[]> =>
        show ? deps.showProjectTiles() : deps.listStorageProjects(),

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
       * @param connectionId - Which connection (from storage.status())
       *   to create it in. Required when more than one is connected; with
       *   exactly one, that one is used.
       * @returns A promise resolving to { id, name } of the new folder.
       */
      createProject: (
        name: string,
        pageSize?: PageSize,
        connectionId?: string
      ): Promise<ProjectFolder> => deps.createStorageProject(name, pageSize, connectionId),

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

      /**
       * Manually back up the open project to another connection: saves any
       * unsaved changes first, then copies project.json and every media file
       * it names to a folder of the same name on that connection, creating it
       * if needed or overwriting it if one already exists there. One-way and
       * on demand only — nothing is backed up automatically.
       * @param connectionId - The destination connection, from storage.status() (it must already be connected).
       * @returns A promise resolving to { ok, error? }.
       */
      backupTo: async (connectionId: string): Promise<ActionResult> =>
        (await deps.backupTo?.(connectionId)) ?? {
          ok: false,
          error: 'Backup is not supported in this session.',
        },
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
       * a default name, an image with no thumbnail, an image used nowhere, a
       * character, object or scene that is used on a layer but has no
       * description or reference images, a background layer with a subjectId
       * (subjects belong in a scene instead), and a foreground layer with a
       * sceneId (scenes only belong on a background). Info: layers with no subject or
       * scene, layers with neither image nor prompt, an image that is both a
       * subject's art and its reference art.
       * @returns An array of findings, errors first: { code, severity: "error" | "warning" | "info", message, where: { tab, pageId?, panelId?, layerId?, entityId?, mediaId? }, fix? }. `fix`, when present, is a safe API call that only clears or unlinks something: { call: "layers.update", args: [panelId, layerId, { subjectId: null }] }; run it as ComicBuilder.<call>(...args). Findings without a fix need a decision: their message says what to do. An empty array means nothing was found. Throws when no project is open.
       */
      lint: (): LintFinding[] => lintProject(requireProject(deps)),
    },

    /**
     * Pages: navigation, preview, creating, reordering and their titles.
     *
     * HOW A PAGE IS BUILT. A page always starts with ONE panel that covers the
     * whole page (page.add() makes one, and a new project's cover has one).
     * There is no "add a panel" call: you get more panels by CUTTING that
     * panel up with panels.split, then adjust the dividing lines with
     * panels.resize, then fill each panel with layers and bubbles. Every cut
     * keeps the original panel (its id, layers and bubbles) as the first part
     * and returns the new, empty parts, so cuts can be chained.
     *
     * Examples (each starts from a fresh page; page.add() returns the page,
     * and its single panel is panels[0]):
     *
     *   const [p] = page.add().panels;
     *   panels.split({ axis: "horizontal", panelId: p.id, count: 3 });   // three equal rows
     *
     *   const [p] = page.add().panels;
     *   const [top, bottom] = panels.split({ axis: "horizontal", panelId: p.id, position: 40 });
     *   panels.split({ axis: "vertical", panelId: bottom.id });          // wide top, two columns below
     *   panels.resize(top.id, "bottom", 45);                             // then nudge a dividing line
     *
     *   const [p] = page.add().panels;
     *   const [left, right] = panels.split({ axis: "vertical", panelId: p.id, position: 60 });
     *   panels.split({ axis: "horizontal", panelId: right.id, count: 2 }); // tall left, two stacked right
     *
     *   page.add();
     *   panels.split({ axis: "horizontal", position: 33.3 });            // tiers cut with lines across
     *   panels.split({ axis: "horizontal", position: 66.6 });            // the whole page
     */
    page: {
      /**
       * List the pages of the open project.
       * @returns [{ index, id, title, panels }] for every page, in order: index is the 0-based position (page 0 is the cover), panels is how many panels it has. The list's length is the page count. Empty when no project is open.
       */
      list: (): Array<{ index: number; id: string; title: string; panels: number }> =>
        (deps.getProject()?.pages ?? []).map((page, index) => ({
          index,
          id: page.id,
          title: page.title,
          panels: page.panels.length,
        })),

      /**
       * Show page i and return it, or, with no i, return the page that is shown now without changing
       * anything. Pages are 0-based and displayed as 0, 1, 2, …
       * @param i - 0-based page index to show. Omit to just read the current page.
       * @returns A deep-cloned ComicPage snapshot (panels with layers and bubbles), or null when i is out of range or no project is open. Snapshots are read-only: mutating them changes nothing.
       */
      select: (i?: number): ComicPage | null => {
        const project = deps.getProject();
        if (!project) return null;
        if (i === undefined) return snapshot(project.pages[deps.getPageIndex()] ?? null);
        if (!Number.isInteger(i) || i < 0 || i >= project.pages.length) return null;
        deps.setPageIndex(i);
        return snapshot(project.pages[i]);
      },

      /**
       * Append a new page after the last page and show it. It starts with ONE
       * empty panel covering the whole page. To get more panels, cut it up: e.g.
       * panels.split({ axis: "horizontal", panelId, count: 3 }) for three rows,
       * or panels.split({ axis: "vertical", panelId, position: 60 }) for a wide
       * and a narrow panel (see the panels namespace).
       * @param input - Optional { title } for the page. title defaults to empty.
       * @returns A deep-cloned snapshot of the new ComicPage (with its single panel).
       */
      add: (input?: { title?: string }): ComicPage => {
        assertOptionalText(input?.title, 'title');
        const page: ComicPage = {
          id: newId('page'),
          number: 0,
          title: input?.title ?? '',
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
       * Update a page's title. Only the given fields change.
       * @param patch - { title? }.
       * @param pageIndex - 0-based page index. Defaults to the current page.
       * @returns A deep-cloned snapshot of the updated ComicPage. Throws when the page is not found.
       */
      update: (patch: { title?: string }, pageIndex?: number): ComicPage => {
        if (!patch || typeof patch !== 'object') throw new Error('patch must be { title? }.');
        assertOptionalText(patch.title, 'title');
        const project = requireProject(deps);
        const index = pageIndex ?? deps.getPageIndex();
        if (!Number.isInteger(index) || index < 0 || index >= project.pages.length) {
          throw new Error(`Page ${index} not found.`);
        }
        return snapshot(
          mutate(deps, (p) => Object.assign(p.pages[index], definedFields({ title: patch.title })))
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
       * Open or close preview mode: the current page shown on its own on a dark background, without
       * editing controls, for visual review. An agent can screenshot the preview and show it to the user.
       * @param open - true (the default) opens preview mode, false closes it and returns to the editor.
       */
      preview: (open = true): void => deps.setPreview(open),
    },

    /**
     * The panels of a page. Panels are rectangles (x, y, width, height in % of
     * the page) that always tile the page with no gaps or overlaps, like a
     * comic layout, in any proportions.
     *
     * A page starts with ONE panel covering the whole page, and there is no
     * call that adds a panel out of nothing: you make new panels by cutting an
     * existing one with split. `split({ axis: "horizontal", panelId, count: 3 })`
     * makes three rows; `split({ axis: "vertical", panelId, position: 60 })`
     * makes a 60% / 40% pair; `split({ axis, position })` with no panelId draws
     * a line across the whole page and cuts every panel it crosses. Each cut
     * panel keeps its id, layers and bubbles as its first (top/left) part, and
     * the new empty parts are returned, so chain cuts on what they return:
     * `const [top, bottom] = panels.split({ axis: "horizontal", panelId: id,
     * position: 40 }); panels.split({ axis: "vertical", panelId: bottom.id });`.
     * Move a dividing line afterwards with resize; delete a panel with delete (a
     * neighbour stretches over its space). See the page namespace for more
     * examples.
     *
     * A panel has a title and an optional panel prompt (both set with update).
     * The panel prompt is used ONLY for the panel's own image (below); it is
     * never part of a layer's prompt, so what a layer's images show still
     * comes entirely from the layers' own prompts (see the layers namespace).
     *
     * PANEL IMAGE. Besides its layers, a panel can have one cohesive image of
     * the whole panel (background, characters and lighting drawn together, so
     * they share light, color and perspective). Do this last, once the layers
     * are final. `generate.run("panel:<panelId>")` generates and, if the panel
     * has no image yet, attaches it automatically (else review and attach it
     * yourself with `update(panelId, { mediaId })`); `generate.inspect("panel:<panelId>")`
     * instead gives you the full brief (prompt parts, where each layer sits, the
     * reference images) to write the prompt and generate it some other way.
     * While it is visible, the editor draws only
     * this image in place of the layers (bubbles still draw above it);
     * `imageVisible` hides or shows it and `mediaId: null` removes it. It is
     * optional, and goes out of date, listed by `generate.status("panels")`,
     * when the layers or the panel prompt change.
     *
     * A panel's aspect ratio follows from its rectangle and metadata.pageSize
     * (get returns it as `size`), so generate artwork at that ratio. The panel
     * array is in the order the panels were created (the numbers shown on the
     * page): a new panel is inserted right after the one it was cut from, so it
     * is not always left-to-right, top-to-bottom. Use x and y to tell where a
     * panel is.
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
       * Get one panel, with the physical size it prints at and the pixel size to generate art at.
       * A panel's background is best generated at exactly this size and aspect ratio, so nothing is
       * cropped or stretched.
       * @param panelId - The panel id.
       * @returns A deep-cloned Panel snapshot plus size: { widthIn, heightIn, aspectRatio, pixels: { width, height } } (150 dpi, longest side at most 2048), or null when not found. Read-only.
       */
      get: panels.get,

      /**
       * Cut panels along a straight line. Three forms, picked by what you give:
       *   - panelId + position: cut that panel in two. The original keeps its id, layers and bubbles
       *     and becomes the top (horizontal) or left (vertical) part; a new empty panel fills the rest.
       *   - panelId + count: cut that panel into `count` equal parts. The original is the first part;
       *     the others are new and empty.
       *   - no panelId, just position: draw a line across the whole page and cut every panel it
       *     crosses, like a guide. Panels the line misses or only touches at an edge, and panels that
       *     would be left too small, are not cut. Throws when nothing is cut.
       * Layer and bubble positions are percentages of their panel, so they scale with it. Throws when
       * a part would be smaller than 5% of the page.
       * @param opts - { axis, panelId?, position?, count?, pageIndex? }. axis is "horizontal" (a horizontal line: top and bottom parts, or stacked rows) or "vertical" (a vertical line: left and right parts, or side-by-side columns). position is where the line falls, as a percentage (0-100) of the panel's height (horizontal) or width (vertical), or of the page when there is no panelId; it defaults to 50 when cutting one panel in two and is required for a line across the page. count (at least 2) needs a panelId and cannot be combined with position. pageIndex (0-based, default the current page) is only used for a line across the page.
       * @returns The resulting panels: for one panel, the original then the new ones; for a line across the page, all panels of the page after the cut.
       */
      split: panels.split,

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
       * Update a panel's title, panel prompt or panel image. Only the given fields change.
       *
       * The panel image is one cohesive picture of the whole panel (background, layers and lighting
       * drawn together) — generate.run("panel:<panelId>") makes and attaches one directly; to make
       * it some other way, generate.inspect("panel:<panelId>") gives the full brief, then upload the
       * result with media.upload and set mediaId here. While it is visible it takes precedence over the layers: the
       * editor shows only this image (bubbles still draw above it) and the layers are not drawn. The
       * previous panel image, if any, goes to mediaHistory. The image remembers what it was made from:
       * editing a layer's image, place, size, rotation, flip, opacity, visibility or order, or the panel
       * prompt, makes it out of date (see generate.status("panels")), until you set a new one. Editing a
       * bubble does not.
       * @param panelId - The panel id.
       * @param patch - { title?, prompt?, mediaId?, imageVisible? }. prompt is direction for the panel as a whole (action, mood, lighting, time of day) used when generating the panel image; a blank prompt clears it, and changing it makes an existing panel image out of date. mediaId is a media id from media.upload or media.list to set as the panel image, or null to remove the panel image so the panel shows its layers again (the image stays in the project's media; see media.delete). imageVisible shows (true) or hides (false) the panel image without removing it; hidden, the panel shows its layers again.
       * @returns A deep-cloned snapshot of the updated Panel. Throws when the panel or media is not found, or imageVisible is set on a panel with no panel image.
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
     * array order, so array order is the stacking order (see order in update). There is no
     * separate background field: the background is the layer whose kind is
     * "background"; it fills the whole panel without stretching (an image of a
     * different ratio is cropped), so its x/y/width are ignored. Generate it at
     * the size panels.get or layers.get reports. A panel should have one
     * background. Every other layer is a foreground layer, usually a PNG with a
     * transparent background containing just its subject (a character, a prop),
     * placed over the background. A layer has a prompt: what its art should
     * show, for whoever generates the image. It may exist with only a prompt
     * and get its image later.
     *
     * HOW THE PROMPT FOR AN IMAGE IS BUILT. The layer prompt is only one part,
     * and a background's image is built differently from a foreground layer's:
     *
     * - Background: the STYLE paragraph (metadata.style), the SCENE STYLE
     *   addendum (metadata.sceneStyle), the SCENE description, then the LAYER
     *   prompt.
     * - Foreground: the STYLE paragraph, the CHARACTER STYLE addendum
     *   (metadata.characterStyle, only when the subject is a character — an
     *   object gets no addendum), the character's or object's description, and
     *   the LAYER prompt.
     *
     * Neither includes the panel's title, or — on a foreground — the panel's background scene,
     * even as "context only, do not draw it": most image generators draw the
     * literal setting the moment any place or scene language appears anywhere
     * in the prompt, caveat or not, which ruins an isolated cutout (worse on a
     * foreground, where it also fights the "no scene" in its own technical
     * requirements). So only a layer's own prompt says what it's doing, never
     * where.
     *
     * Each level says only what belongs to it, so the parts add up without
     * repeating or contradicting each other. Read them back with generate.inspect("layer:<panelId>/<layerId>").
     *
     * A layer can pin itself to one of its subject's/scene's variations (see
     * the Variation type and the variations namespace) with variationId: that
     * variation's own reference images become the default sent when generating
     * this layer's art (see generate.inspect), and its own sparkle
     * button in the reference picker generates just that one pose/state.
     *
     * DIRTY. A layer's `dirty` field says whether its image still matches its
     * prompt. add/update set it automatically: editing the prompt (or, for a
     * background, its scene; or, for a foreground layer, its subject; or its
     * chosen variation) turns it on; setting the image (mediaId) turns it off. Check layers.list or
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
       * Get one layer, with the size its art should be generated at. A background is the panel's
       * size; a foreground layer is layer.width % of the panel wide, at its aspectRatio (default 1, so
       * set aspectRatio first for a tall or wide subject). Foreground art should usually be a PNG with
       * a transparent background.
       * @param panelId - The panel id.
       * @param layerId - The layer id.
       * @returns A deep-cloned Layer snapshot plus size: { widthIn, heightIn, aspectRatio, pixels: { width, height } }, or null when not found. Read-only.
       */
      get: (panelId: string, layerId: string) => {
        const layer = layers.get(panelId, layerId);
        if (!layer) return null;
        return { ...layer, size: layerArtSize(requireProject(deps), panelId, layerId) };
      },

      /**
       * Add a layer to a panel: a prompt, an image, or both. Foreground
       * layers are appended on top of the stack; a background layer goes to the
       * bottom (if the panel already has a background, delete it first, or swap
       * its image with update(), since both would be drawn). A layer can start with
       * only a prompt and get its image later with update(). Put what this
       * layer's art shows in `prompt` (write it before you generate the image,
       * so the plan is on record). It is the last part of the prompt for the
       * image: that prompt is stitched from the comic style, the scene and
       * character descriptions and this layer prompt (see the layers namespace).
       * Foreground images
       * should usually be PNGs with a transparent background.
       * @param panelId - The panel id.
       * @param input - { name?, prompt?, subjectId?, sceneId?, variationId?, mediaId?, aspectRatio?, kind?, visible?, x?, y?, width?, rotation?, opacity?, flipX? }. mediaId must already be registered (from media.upload or media.list); omit it for a layer that is only a prompt so far. subjectId is the id of the character or object the layer shows (it must exist); the media picker lists that subject's art first. sceneId is the id of the scene a background layer is the setting of (it must exist); the picker lists that scene's art first. variationId is the id of one of subjectId's (or sceneId's) variations (it must belong to that entry): its own images become the default reference sent when generating this layer. name defaults to the media's name, else "Layer" or "Background". x/y/width are % of panel size and rotation is in degrees; kind defaults to "foreground"; geometry defaults to x:0, y:0, width:100, rotation:0, opacity:1 (0-1), visible:true, flipX:false (true mirrors the image left to right). aspectRatio (width / height) shapes a layer that has no image yet; use layers.get to see the size to generate at. dirty is set automatically (true when there's a prompt and no image yet) unless you pass it explicitly.
       * @returns A deep-cloned snapshot of the new Layer.
       */
      add: (panelId: string, input: LayerInput): Layer => {
        const kind = input.kind ?? 'foreground';
        assertKind(kind, LAYER_KINDS, 'Layer kind');
        const project = requireProject(deps);
        const image = resolveLayerImage(project, input);
        if (input.subjectId !== undefined) assertSubject(project, input.subjectId);
        if (input.sceneId !== undefined) assertScene(project, input.sceneId);
        if (input.variationId !== undefined) {
          const ownerId = kind === 'background' ? input.sceneId : input.subjectId;
          if (!ownerId) throw new Error('variationId needs a subjectId or sceneId.');
          assertVariation(project, ownerId, input.variationId);
        }
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
       * visibility, flip it left to right (flipX), rename, edit its prompt, set what it shows (subjectId: a character or object id) or, for a background, the scene it is the setting of (sceneId), pin it to one of that entry's variations (variationId), any of the three either null to clear it, swap its image (mediaId), or unlink its image (mediaId: null) — it stays in the project's media registry (unlike media.delete, which removes it everywhere), but it's no longer this layer's in any way, not even its history. Change its place in the stack with order.
       * Only the given fields change. dirty tracks itself: editing prompt,
       * subjectId, sceneId or variationId turns it on (off again if that leaves no prompt);
       * setting mediaId turns it off, even in the same call; unlinking it (mediaId: null) turns it on
       * again if there's still a prompt to act on, the same as any other layer left with no image.
       * Changing subjectId or sceneId to a different id (or clearing it) clears variationId too,
       * unless this same call also gives a new one — a variation belongs to one specific entry.
       * @param panelId - The panel id.
       * @param layerId - The layer id.
       * @param patch - Partial layer fields, plus order: "top", "bottom", "up" (one step toward the top), "down", or a 0-based position counted from the bottom of the whole stack (a background, if any, is position 0). Layers composite bottom-to-top in array order; bubbles always stay above all layers.
       * @returns A deep-cloned snapshot of the updated Layer. Throws when the panel or layer is not found.
       */
      update: updateLayer,

      /**
       * Delete a layer from a panel.
       * @param panelId - The panel id.
       * @param layerId - The layer id.
       * @returns True when a layer was removed, false when not found.
       */
      delete: layers.delete,
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
     * The project's style settings: the STYLE paragraph (plus its characterStyle/sceneStyle
     * addenda), the page size and the media registry. Use the reference namespace for the individual
     * characters, scenes and objects.
     */
    metadata: {
      /**
       * Read the whole metadata block (style, characterStyle, sceneStyle, pageSize, characters, scenes,
       * objects, media).
       * @returns A deep-cloned metadata snapshot. Read-only: mutate via metadata.update and the other namespaces.
       */
      get: () => snapshot(requireProject(deps).metadata),

      /**
       * Update the project-wide style settings. Only the given fields change.
       *
       * style: the STYLE paragraph, a short, fixed description of the visual style (medium, line,
       * palette, lighting, mood). Stitched, verbatim, into every image's prompt of every kind
       * (character, object and scene alike), so keep it to a few sentences and change it only if the
       * story calls for it. Keep it to what's true of every image: wording that only makes sense for
       * a figure (eye style, skin tone, proportions) belongs in characterStyle instead — stitching
       * it into an object's or scene's prompt too is what suggests a person where there shouldn't be
       * one, no matter how firmly the rest of the prompt says otherwise. There is no separate
       * synopsis field: track story notes elsewhere, since stitching a whole synopsis into every
       * prompt would drown out what is unique to each image. Changing it to a different value marks
       * every layer and reference variation that has a prompt as dirty, project-wide (it is the
       * first part of every one of their stitched prompts) — expect a large
       * `generate.status("layers")` / `generate.status("references")` afterward, and treat this as the
       * deliberate, whole-book action it is.
       *
       * characterStyle: the CHARACTER STYLE addendum, design language that only makes sense for a
       * figure (eye style, proportions, skin-tone rendering). Stitched in only for a character's
       * prompt — reference art, or a foreground layer whose subject is a character — right after the
       * shared STYLE paragraph; left out of object and scene prompts entirely. A character may be a
       * person or an animal, so keep this to what's true of either, not "person" specifically. Changing
       * it marks every character layer and character variation that has a prompt as dirty (not objects
       * or scenes, since they never stitch this in).
       *
       * sceneStyle: the SCENE STYLE addendum, rendering notes specific to establishing/background art
       * (level of detail, atmosphere). Stitched in only for a scene's prompt — reference art, or a
       * background layer — right after the shared STYLE paragraph; left out of character and object
       * prompts entirely. Changing it marks every background layer and scene variation that has a
       * prompt as dirty (not characters or objects, since they never stitch this in).
       *
       * pageSize: the physical page dimensions for the comic. Panels are stored as percentages of the
       * page, so they keep their layout but their aspect ratios change with the page: regenerate art
       * sized by panels.get.
       * @param patch - { style?, characterStyle?, sceneStyle?, pageSize? }: pageSize is { label, widthIn, heightIn }, e.g. one of PAGE_SIZE_PRESETS from the data model. An empty string clears a style text.
       * @returns { ok, error? }: nothing changes when ok is false.
       */
      update: (patch: MetadataPatch): ActionResult => {
        const { style, characterStyle, sceneStyle, pageSize } = patch ?? {};
        for (const [name, text] of Object.entries({ style, characterStyle, sceneStyle })) {
          if (text !== undefined && typeof text !== 'string') {
            return { ok: false, error: `${name} must be text.` };
          }
        }
        if (
          pageSize !== undefined &&
          (!pageSize ||
            typeof pageSize.label !== 'string' ||
            !(pageSize.widthIn > 0) ||
            !(pageSize.heightIn > 0))
        ) {
          return { ok: false, error: 'pageSize needs { label, widthIn, heightIn }.' };
        }
        deps.updateProject((p) => {
          const m = p.metadata;
          if (style !== undefined) {
            if (m.style !== style) cascadeStyleDirty(p);
            m.style = style;
          }
          if (characterStyle !== undefined) {
            if (m.characterStyle !== characterStyle) cascadeCharacterStyleDirty(p);
            m.characterStyle = characterStyle;
          }
          if (sceneStyle !== undefined) {
            if (m.sceneStyle !== sceneStyle) cascadeSceneStyleDirty(p);
            m.sceneStyle = sceneStyle;
          }
          if (pageSize !== undefined) m.pageSize = { ...pageSize };
        });
        return { ok: true };
      },
    },

    /**
     * Reference entries: the characters, scenes and objects, one set of functions
     * for all three, picked by `kind` ("characters", "scenes" or "objects"). An entry's description sets
     * its visual look (a character's appearance, outfit and distinctive features, a scene's setting,
     * time of day, mood and lighting) plus continuity notes; imageIds point at reference art in
     * metadata.media (upload it with media.upload) not tied to any particular variation. An LLM reads
     * a character (description + images) together with a scene to build image-generation prompts: copy
     * the description verbatim into every prompt involving it, and pass its reference images
     * (media.download) to the generator, so it looks the same on every page (see the continuity guide
     * above). In update(), imageIds, linkIds and variations replace the existing lists (they are not
     * appended to).
     *
     * An entry also has variations (see the Variation type and the variations namespace): named
     * poses or states, each its own image rather than several baked into one turnaround sheet.
     * Creating a character seeds three — Front view, Back view, Side view — since those apply to every
     * character; scenes (Day, Night, Rain) and objects (a locker's Open/Closed) start with none: add
     * whatever the story needs with variations.add. Generate the images with generate.run.
     */
    reference: {
      /**
       * List reference entries.
       * @param kind - "characters", "scenes" or "objects". Omit to list all three.
       * @returns [{ kind, id, name }] for every entry of that kind (or of every kind).
       */
      list: (kind?: StoryKind): Array<{ kind: StoryKind; id: string; name: string }> => {
        if (kind !== undefined) assertKind(kind, STORY_KIND_NAMES, 'Kind');
        return STORY_KIND_NAMES.filter((k) => kind === undefined || k === kind).flatMap((k) =>
          story[k].list().map((entry) => ({ kind: k, ...entry }))
        );
      },

      /**
       * Get one entry with its full description, image/link ids and variations.
       * @param kind - "characters", "scenes" or "objects".
       * @param id - The entry id.
       * @returns A deep-cloned Character, Scene or ComicObject snapshot, or null when not found. Read-only.
       */
      get: (kind: StoryKind, id: string) => storyOf(kind).get(id),

      /**
       * Create an entry. A character is seeded with Front view/Back view/Side view variations unless
       * `input` gives its own; scenes and objects start with none.
       * @param kind - "characters", "scenes" or "objects".
       * @param input - { name, description?, imageIds?, linkIds?, variations? }: linkIds are scene ids for a character or object, and character ids appearing in the scene for a scene.
       * @returns The new entry.
       */
      create: (kind: StoryKind, input: StoryEntryInput) => storyOf(kind).create(input),

      /**
       * Update an entry's name, description, image/link ids or variations. Only the given fields
       * change; imageIds, linkIds and variations each replace the existing list (not appended to) — use
       * the variations namespace to add/change/remove one variation at a time instead. Changing the
       * description makes every variation's current art out of date (dirty).
       * @param kind - "characters", "scenes" or "objects".
       * @param id - The entry id.
       * @param patch - { name?, description?, imageIds?, linkIds?, variations? }.
       * @returns A deep-cloned snapshot of the updated entry. Throws when not found.
       */
      update: (kind: StoryKind, id: string, patch: StoryEntryPatch) =>
        storyOf(kind).update(id, patch),

      /**
       * Delete an entry. References to it from other entries, layers and images are cleared or left
       * dangling; run project.lint to find and fix any.
       * @param kind - "characters", "scenes" or "objects".
       * @param id - The entry id.
       * @returns True when an entry was removed, false when not found.
       */
      delete: (kind: StoryKind, id: string): boolean => storyOf(kind).delete(id),
    },

    /**
     * Variations (poses/states) of a character, object or scene (see the Variation type): a name plus
     * its own prompt text, stitched in after the entry's description when generating its image (see
     * generate.run), and its own reference images. Replaces baking several poses into one
     * turnaround-sheet image, which confuses later prompting that references it: one variation, one
     * pose, one image at a time. Addressed by (kind, entryId, variationId), the same `kind` as the
     * reference namespace; read them with reference.get (an entry carries its variations).
     */
    variations: {
      /**
       * Add a variation to a character, object or scene.
       * @param kind - "characters", "scenes" or "objects".
       * @param entryId - The entry id.
       * @param input - { name, prompt?, imageIds? }: prompt is this variation's own instruction (e.g.
       *   "Front view, facing the camera directly."), stitched in after the entry's description when
       *   generating its image; defaults to "".
       * @returns The new Variation.
       */
      add: variations.add,

      /**
       * Update a variation's name, prompt or reference images. Only the given fields change;
       * imageIds replaces the list (it is not appended to). New images clear the variation's dirty
       * flag; changing the prompt sets it.
       * @param kind - "characters", "scenes" or "objects".
       * @param entryId - The entry id.
       * @param variationId - The variation id.
       * @param patch - { name?, prompt?, imageIds?, dirty? }.
       * @returns A deep-cloned snapshot of the updated Variation. Throws when not found.
       */
      update: variations.update,

      /**
       * Delete a variation. Layers pinned to it (layers.variationId) lose that link.
       * @param kind - "characters", "scenes" or "objects".
       * @param entryId - The entry id.
       * @param variationId - The variation id.
       * @returns True when a variation was removed, false when not found.
       */
      delete: variations.delete,
    },

    /**
     * The project's media registry: image files in the project's storage
     * folder (Drive, or an S3-compatible bucket). Layers (via mediaId) and
     * reference entries (via imageIds) refer to these entries instead
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
       * @param id - The media id (from media.list, reference.get(kind, id).imageIds, or a layer's mediaId).
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
       * thumbnail can be fixed later with media.update (thumbnailDataUrl).
       * @param name - File name, e.g. "hero-front.png".
       * @param dataUrl - The image bytes as a data: URL (e.g. from a generated PNG).
       * @param opts - Optional { mimeType, thumbnailDataUrl, subjectId, sceneId }: mimeType defaults to "image/png"; thumbnailDataUrl is the image resized to about 256px on its long side, as a data: URL (PNG for transparent images, else JPEG). Strongly recommended. subjectId is the id of the character or object this image is art of (it must exist): the media picker lists a subject's art first. sceneId is the same for a scene (a background). Do not use either for reference art: put those ids in the character's or scene's imageIds.
       * @returns A promise resolving to the new MediaItem. Its thumbnailFileName is set when a thumbnail was stored; if it is missing, retry with media.update(id, { thumbnailDataUrl }).
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
       * Rename an image, say what it shows, or replace its thumbnail. Only the given fields change.
       * The stored file keeps the name it was uploaded with; only the registry entry changes.
       *
       * The thumbnail is what the editor shows instead of the full image in lists and pickers, so the
       * media picker does not have to download every full image. Resize the image yourself and give it
       * a small copy: about 256px on the long side, PNG when the image has transparency (so cut-outs
       * stay cut out), else JPEG at about 85% quality. Use it for images uploaded without a thumbnail
       * (media.upload's result has no thumbnailFileName), and to replace a poor one.
       * @param id - The media id.
       * @param patch - { name?, subjectId?, sceneId?, thumbnailDataUrl? }: name is the new display name (not empty); subjectId is the id of the character or object the image is art of and sceneId the scene it is art of (each must exist), or null to clear it; thumbnailDataUrl is the new thumbnail as a data: URL.
       * @returns A promise resolving to the updated MediaItem; after a new thumbnail its thumbnailFileName is the new thumbnail's stable name. Rejects when the media id is not found.
       */
      update: async (
        id: string,
        patch: {
          name?: string;
          subjectId?: string | null;
          sceneId?: string | null;
          thumbnailDataUrl?: string;
        }
      ): Promise<MediaItem> => {
        const project = requireProject(deps);
        if (!project.metadata.media.some((m) => m.id === id)) {
          throw new Error(`Media "${id}" not found.`);
        }
        if (patch.name !== undefined && !patch.name.trim()) throw new Error('Name is required.');
        if (typeof patch.subjectId === 'string') assertSubject(project, patch.subjectId);
        if (typeof patch.sceneId === 'string') assertScene(project, patch.sceneId);
        let item = snapshot(
          mutate(deps, (p) => {
            const entry = p.metadata.media.find((m) => m.id === id)!;
            if (patch.name !== undefined) entry.name = patch.name.trim();
            if (typeof patch.subjectId === 'string') entry.subjectId = patch.subjectId;
            else if (patch.subjectId === null) delete entry.subjectId;
            if (typeof patch.sceneId === 'string') entry.sceneId = patch.sceneId;
            else if (patch.sceneId === null) delete entry.sceneId;
            return entry;
          })
        );
        if (patch.thumbnailDataUrl !== undefined) {
          item = await deps.uploadStorageThumbnail(id, patch.thumbnailDataUrl);
        }
        return item;
      },

      /**
       * Delete an image: its file and its thumbnail are trashed in storage
       * (recoverable there) and it leaves the registry. Anything using it
       * lets go of it: layers showing it stay but lose their image (they are
       * prompt-only layers again), and characters, scenes and objects drop it
       * from their imageIds.
       * @param id - The media id.
       * @returns A promise resolving to { layers, entries }: how many layers lost their image and how many reference entries lost a reference image. Rejects when the media id is not found or storage is not connected.
       */
      delete: (id: string): Promise<{ layers: number; entries: number }> =>
        deps.deleteStorageMedia(id),
    },

    /**
     * Generate art with the configured image service (an HTTP URL the app
     * POSTs to, or an agent-run service described by its prompt; see config): stitches a layer's prompt the same way the
     * layers namespace describes and pulls in its linked character's or
     * scene's reference images. Everything is aimed at a TARGET, one string:
     *
     *   layer:<panelId>/<layerId>                 a layer or background
     *   reference:<kind>/<entryId>                a character, scene or object's own reference image
     *   reference:<kind>/<entryId>/<variationId>  one variation (pose/state) of it
     *   reference:<kind>/<entryId>/*              every variation of it (batch only)
     *   panel:<panelId>                           a whole-panel image (background, layers and lighting together)
     *
     * where <kind> is characters, scenes or objects. The same target works for run, cancel and
     * inspect: inspect shows what run would send (for a panel, generate.inspect("panel:<panelId>")
     * instead gives the fuller brief an LLM agent writes its own prompt from — run's own stitched
     * prompt is a mechanical version of that, editable in the UI's dialog before sending). run only
     * registers the result, for you to preview and commit yourself; batch (no one to preview a batch
     * for) commits each result as it goes. Only one generation request runs at a time, even across
     * overlapping calls (see status).
     */
    generate: {
      /**
       * Generate one new image for a target, regardless of dirty. Registers the image in the media
       * registry (see media.update to rename it).
       *
       * A layer target: if the layer has no image yet, the new one becomes its image straight away;
       * otherwise it does not replace the current one — review it, then commit it yourself with
       * layers.update(panelId, layerId, { mediaId, aspectRatio }) (the previous image, if any, is kept in
       * the layer's history rather than discarded when you do; see mediaHistory in the data model).
       *
       * A panel target: same "first image is automatic, a later one waits for you to commit it"
       * rule as a layer, via panels.update(panelId, { mediaId }) (the previous panel image, if any,
       * goes to its mediaHistory). Unless a prompt is given, one is auto-stitched from the panel's
       * background, each visible layer (with its place in the panel) and its own prompt — a
       * mechanical version of what generate.inspect("panel:<panelId>") hands an LLM agent to write
       * by hand; read generate.inspect for the full brief, or edit the UI's dialog before sending.
       *
       * A reference target: the image is built from the STYLE paragraph, the entry's description and,
       * unless a prompt is given, a default prompt for a single, isolated view on a plain white
       * background (a character or object) or an establishing shot of the location with no characters (a
       * scene). With a variation, that variation's own prompt text is stitched in last and its own
       * reference images are used by default (falling back to the entry's own pose-neutral images if it
       * has none yet — never another variation's, which would actively mislead the model about pose or
       * orientation). The image is registered but not linked — review it, then commit it yourself with
       * reference.update(kind, id, { imageIds: [...] }) or variations.update(kind, entryId, variationId,
       * { imageIds: [...] }), the same "register, then link" split as media.upload.
       * @param target - A layer, panel or reference target (see the generate namespace).
       * @param prompt - Optional prompt to use instead of the default (e.g. edited by a user before generating; read the default with generate.inspect).
       * @param references - Optional reference images to send instead of the defaults (see generate.inspect), each { mediaId, note? }; a note says how to use that image and is added to the prompt. Extras beyond the generator's maximum (inspect's maxReferenceImages) are ignored.
       * @returns A promise resolving to the new MediaItem (for a layer or panel, plus the aspect ratio the image actually came out at). Rejects when no generator is configured, or generation fails.
       */
      run: async (
        target: string | AnyTarget,
        prompt?: string,
        references?: GenerationReference[]
      ): Promise<GeneratedImage> => {
        const t = parseTarget(target);
        if (t.type === 'layer') {
          const image = await generateLayerImage(deps, t.panelId, t.layerId, prompt, references);
          // A layer with no image yet takes its first generated one; once it has one, a new generation
          // waits for an explicit choice so the current image isn't swapped out from under the user.
          const layer = layers.get(t.panelId, t.layerId);
          if (layer && !layer.mediaId) {
            setLayerMedia(t.panelId, t.layerId, image.id, image.aspectRatio);
          }
          return image;
        }
        if (t.type === 'reference') {
          return t.variationId
            ? generateVariationImage(deps, t.kind, t.entryId, t.variationId, prompt, references)
            : generateReferenceImage(deps, t.kind, t.entryId, prompt, references);
        }
        if (t.type === 'panel') {
          const image = await generatePanelImage(deps, t.panelId, prompt, references);
          // A panel with no image yet takes its first generated one; once it has one, a new
          // generation waits for an explicit choice so the current image isn't swapped out from
          // under the user (same as a layer — see the branch above).
          const panel = panels.get(t.panelId);
          if (panel && !panel.image) panels.update(t.panelId, { mediaId: image.id });
          return image;
        }
        throw new Error('That target is every variation: use generate.batch for it.');
      },

      /**
       * Generate images for many targets at once, one request at a time, committing each result as
       * it goes (unlike generate.run, there's no one to preview a batch for): a layer's image becomes
       * its mediaId, a variation's goes into its imageIds. A failure on one item does not stop the rest.
       *
       * Scopes:
       *   - "layers": every layer and background across the whole project whose dirty is true
       *     (see generate.status("layers") for the list first).
       *   - "references": every variation (reference art for a character, object or scene) across the
       *     whole set of reference entries whose dirty is true — set automatically when its own prompt, or its
       *     entry's description, changes. Run both to regenerate everything stale in the project.
       *   - "reference:<kind>/<entryId>/*": every variation of one entry, dirty or not.
       * @param scope - "layers", "references", or "reference:<kind>/<entryId>/*".
       * @param options - Optional { kinds?, prompt?, references? }. kinds restricts "layers" to these layer kinds (e.g. ["background"] for backgrounds only) or "references" to these lists (e.g. ["characters"] for cast only); omit for all. prompt and references only apply to "reference:<kind>/<entryId>/*": prompt replaces the shared base (Style + description + technical requirements), each variation's own prompt is still stitched on top so every image still draws a different pose/state; references replace each variation's own default references.
       * @returns A promise resolving to one outcome per item found when it started: { pageId, panelId, layerId, ok, error? } for "layers", { kind, entryId, variationId, ok, error? } for "references", { variationId, ok, error? } for one entry's variations.
       */
      batch: (
        scope: string | AnyTarget,
        options?: {
          kinds?: string[];
          prompt?: string;
          references?: GenerationReference[];
        }
      ): Promise<Array<GenerationOutcome | VariationRefOutcome | VariationOutcome>> => {
        const kinds = options?.kinds;
        if (scope === 'layers' || scope === 'references') {
          if (kinds !== undefined && !Array.isArray(kinds)) {
            throw new Error('kinds must be a list, like ["background"].');
          }
          for (const kind of kinds ?? []) {
            if (scope === 'layers') assertKind(kind, LAYER_KINDS, 'Layer kind');
            else assertKind(kind, STORY_KIND_NAMES, 'Kind');
          }
          return scope === 'layers'
            ? generateAllDirty(deps, setLayerMedia, kinds as LayerKind[] | undefined)
            : generateAllDirtyVariations(deps, kinds as StoryKind[] | undefined);
        }
        const t = parseTarget(scope);
        if (t.type !== 'variations') {
          throw new Error(
            'batch needs "layers", "references" or "reference:<kind>/<entryId>/*"; for one image use generate.run.'
          );
        }
        return generateAllVariations(deps, t.kind, t.entryId, options?.prompt, options?.references);
      },

      /**
       * Cancel outstanding generation requests: one still queued is skipped when its turn comes, one
       * already running has its request aborted.
       * @param target - A layer or reference target to cancel that one's outstanding request, a queue item's id (from generate.status("queue")) to cancel just that item, or "all" to cancel everything queued or running at once, across layers, reference art and variations alike (use it to stop a whole generate.batch partway through).
       * @returns How many requests were cancelled; 0 if there was nothing outstanding.
       */
      cancel: (target: string | AnyTarget): number => {
        if (target === 'all') return cancelAllGenerations();
        if (typeof target === 'string' && /^\d+$/.test(target.trim())) {
          return cancelGenerationQueueItem(target.trim()) ? 1 : 0;
        }
        const t = parseTarget(target);
        if (t.type === 'layer') return cancelLayerGeneration(t.panelId, t.layerId) ? 1 : 0;
        if (t.type === 'panel') return cancelPanelGeneration(t.panelId) ? 1 : 0;
        if (t.type === 'reference') {
          return (
            t.variationId
              ? cancelVariationGeneration(t.kind, t.entryId, t.variationId)
              : cancelReferenceGeneration(t.kind, t.entryId)
          )
            ? 1
            : 0;
        }
        throw new Error(
          'Only a layer, panel or reference target (or a queue id, or "all") can be cancelled.'
        );
      },

      /**
       * Everything about what generate.run would do for a target, without generating anything. Read
       * this to show or edit the prompt before generating.
       *
       * For a layer or reference target: the default prompt, broken into the labeled pieces that get
       * stitched together, and the default reference images. For a layer: Style; the kind's style
       * addendum (Character style or Scene style, when set; an object foreground gets none);
       * Character/Scene/Object, the linked entry's own description; Layer prompt; Technical
       * requirements. There is no Page or Panel piece: pages and panels have no prompt of their own, only
       * a title. For a reference: Style, Character/Object/Scene, Technical requirements and, with a
       * variation, Variation. Which pieces appear depends on the kind and what's linked. Joining every
       * part's text with a blank line between them (in order) reproduces the `prompt`. The default
       * references are, for a layer, its own images (its current image, then its history) then those of
       * its character/object (foreground) or scene (background); for a reference, the entry's own
       * images; for a variation, its own images, or, if it has none yet, the entry's own pose-neutral
       * images.
       *
       * For a panel target (panel:<panelId>): everything needed to generate a PANEL IMAGE, one cohesive
       * picture of the whole panel (background, characters and props drawn together, so they share
       * lighting, perspective and style) that you generate yourself, outside the CLI, and then save with
       * panels.update(panelId, { mediaId }). Do this last, once the background and layers are final. It
       * needs no configured image generator. Layers and a background are optional: with neither, a
       * panel prompt alone is enough, they only make the result stronger (their absence is a warning,
       * not an error). The result is JSON with: panel (id, page, number, size in inches, aspect ratio and
       * pixels); style; promptParts (the labeled parts of the prompt: Style, Character style, Scene
       * style, Panel prompt, Technical requirements; NOT stitched, you write the final prompt from them
       * in order and add the setting and the layout); background (scene, variation, prompt, mediaId);
       * layers (visible foreground layers, back to front, each with its subject, variation, prompt,
       * mediaId, dirty and placement: x/y/width/height in % of the panel, rotation, flipX, opacity, the
       * same in pixels, its center, and a plain-words description); skipped (hidden layers); references
       * (the images to send to the generator, numbered by index, each with role, note, name, mimeType and
       * the image itself as a data: URL; the CLI saves each to a file and gives its path as `file`
       * instead); currentImage (the panel's existing panel image, with dirty); warnings; and
       * instructions (how to use all this and how to save the result).
       * @param target - A layer, reference or panel target (see the generate namespace).
       * @param includeImages - Panel targets only: whether to fetch the reference images and include them (the default, true). Pass false for the same brief without the images.
       * @returns For a layer or reference: { prompt, parts: [{ label, text }] in stitching order, references: [{ mediaId, note? }] in the order they're sent, maxReferenceImages, imageServicePrompt? } (maxReferenceImages is how many the configured image service uses, 0 if it has no url; imageServicePrompt is the image service instructions, when set). For a panel: the panel brief. Throws when the target is not found.
       */
      inspect: inspect,

      /**
       * What is queued, stale or out of date. Read-only. Call it first to see (and confirm) the work
       * before generate.batch.
       *
       * Scopes:
       *   - "queue" (the default): the generation queue right now: every layer, batch, reference-image
       *     and variation-image request that's running, waiting its turn, or has finished since the
       *     queue was last cleared.
       *   - "layers": what generate.batch("layers") would generate: every layer and background across
       *     the whole project whose dirty is true.
       *   - "references": what generate.batch("references") would generate: every variation (reference
       *     art for a character, object or scene) whose dirty is true, set automatically when its own
       *     prompt, or its entry's description, changes (see reference.update and variations.add/update).
       *   - "panels": the panels whose panel image is out of date: its layers or prompt changed since
       *     it was set (see panels.update). A panel with no panel image is not listed; panel images are
       *     optional, call generate.run("panel:<panelId>") for any panel to make one.
       * @param scope - "queue", "layers", "references" or "panels". Defaults to "queue".
       * @returns For "queue": [{ id, label, target, status: "queued" | "running" | "done" | "error", error? }] (target is a target string; id works with generate.cancel). For "layers": one { pageId, panelId, layerId, page, panelTitle?, panelNumber, name, kind, prompt?, hasImage } per dirty item (hasImage is false for a layer with no image yet). For "references": one { kind, entryId, variationId, entryName, variationName, prompt?, hasImage } per dirty item. For "panels": one { pageId, panelId, page, panelTitle?, panelNumber, prompt? } per out-of-date panel image.
       */
      status: (
        scope: 'queue' | 'layers' | 'references' | 'panels' = 'queue'
      ): Array<
        | (Omit<QueueItem, 'target'> & { target: string })
        | PendingGeneration
        | PendingReference
        | PendingPanelImage
      > => {
        switch (scope) {
          case 'queue':
            return getQueue().map((item) => ({ ...item, target: formatTarget(item.target) }));
          case 'layers':
            return pendingGenerations(requireProject(deps));
          case 'references':
            return pendingReferenceGenerations(requireProject(deps));
          case 'panels':
            return pendingPanelImages(requireProject(deps));
          default:
            throw new Error(
              `Unknown scope "${String(scope)}": use queue, layers, references or panels.`
            );
        }
      },

      /**
       * How many reference images the configured image service accepts per request (0 if none is
       * configured). generate.inspect already includes this for a layer or reference target; a
       * panel target's defaults are built directly from panelBrief.ts in the UI, which has no
       * synchronous inspect of its own, so it reads this separately.
       * @returns The generator's maxReferenceImages.
       */
      maxReferenceImages: (): number => maxReferenceImages(deps),

      /**
       * Read or set the image service configuration. Per-machine, not part of the project. Holds a
       * url, a prompt, or both. The url is an endpoint the app POSTs generation requests to (JSON
       * { kind, prompt, referenceImages, width?, height?, transparent? }; it answers with the image),
       * used by the web UI and this CLI. The prompt is free text telling an LLM agent where and how
       * to generate images itself (a URL to call, a tool to use). With a url, generate.run does the
       * work; with only a prompt, generate.run fails and repeats the prompt so the agent can generate
       * the image itself and upload it. If no service is configured, ask the human what it is.
       * @param config - Optional { provider: "service", url?, prompt? } (at least one of url or prompt) to set. Omit to read the current one.
       * @returns With no config: the current config, or null when none is set. With one: { ok, error? }.
       */
      config: configure,

      /**
       * Check that the configured image service url is reachable.
       * @returns A promise resolving to { ok, error? }.
       */
      test: async (): Promise<ActionResult> => {
        const config = deps.getGeneratorConfig();
        if (!config) return { ok: false, error: 'No image service is configured.' };
        if (!hasServiceUrl(config))
          return { ok: false, error: 'The image service has no url to test (prompt only).' };
        try {
          await createProvider(config, deps.generatorFetch).test();
          return { ok: true };
        } catch (e) {
          return { ok: false, error: errorMessage(e) };
        }
      },
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
