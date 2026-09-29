# VibeComics — Engineering Spec

This is the full design document. The short user-facing overview lives in
`README.md`. The agent-facing runtime API reference is `ComicBuilder.help()`
in the browser console and the static copy in `public/api.txt`, plus the how-to guide `public/llms.txt`.

## 1. Architecture

VibeComics is a **static single-page app** (Vite + React + TypeScript)
deployed to GitHub Pages. It has no server and no database of its own.

```
Browser (React UI) ──window.ComicBuilder──> state (React useState + refs)
        │                                          │
        │ actions.ts delegates                     │ every 60s, if changed
        ▼                                          ▼
storage/activeBackend.ts ──────────────────── saveProjectJson()
        │                                    (routes to whichever is active)
        ▼
Google Drive API (OAuth token, page memory)   — or —   http-storage server (plain fetch, no auth)
```

- **One code path.** The UI and any AI agent call the same functions on
  `window.ComicBuilder` (installed by `src/ai/actions.ts`'s
  `installComicBuilder(deps)` in `App.tsx`). Buttons never contain their own
  mutation logic, so the UI can't drift from the agent API.
- **React is the view layer; the API is the model.** `App.tsx` keeps the
  project in `useState` plus mirrors in `useRef` so the installed API
  closures never go stale. `updateProject(mut)` clones the project,
  applies the mutation, stamps `updatedAt`, sets state, and marks the
  project as having unsaved changes.
- **One project store, picked per session.** There is no local-storage copy
  of the comic. The store is either Google Drive (`drive.file` scope: the
  app can only see folders/files it created) or a self-hosted HTTP storage
  server (`http-storage/`), chosen once on the splash screen and held as
  `storage/activeBackend.ts`'s module-level `active` flag for the rest of
  the session. Everything that reads or writes project data — `App.tsx`,
  `useProjectSaver`, `mediaImages.ts` — goes through that module's
  functions instead of importing a backend directly, so it behaves the same
  either way. See §6a.

## 2. Screens

`App.tsx` has exactly three screens plus one overlay:

1. **Splash** (`splash`) — hard gate, kept deliberately short. Title "Pick
   where to store your comic", then one section per backend: Drive has a
   "Connect with Google Drive" button that calls
   `ComicBuilder.storage.connectWithDevice()` (the OAuth device flow, showing
   a verification URL + user code to approve on any other device; it works
   the same from a real click or an injected script, so it is the only Drive
   connect method, no separate popup flow); the server section is a URL
   field (prefilled from whatever was remembered in `localStorage`, never
   auto-submitted) plus a Connect button that calls
   `ComicBuilder.storage.connectWithServer(url)`. Every page load lands on
   this screen: neither backend reconnects on its own.
2. **Tiles** (`tiles`) — one Bootstrap card per project folder plus a
   dashed "New project" tile. The new-project name and page size (preset:
   US Comic, US Trade, Manga B5, A4, Square, Portrait 4:5, Landscape 16:9)
   are collected in a Bootstrap modal and stored in
   `metadata.pageSize`. Each tile opens through
   `ComicBuilder.storage.openProject(id)`. Connection is implicit — no
   connected-status indicator and no disconnect button anywhere in the UI
   (disconnect stays available as `ComicBuilder.storage.disconnect()`).
3. **Editor** (`editor`) — fills the viewport exactly (fixed layout; tab content
   scrolls inside it). A project with only its cover opens on the **Outline**
   tab; a project with more pages opens on **Pages**. The Bootstrap dark
   navbar has the project title left-aligned and, at the far right, a
   floppy-disk save button: it shows a spinner while a save is in flight,
   is disabled when nothing is unsaved, turns red after a failed save, and
   otherwise calls `ComicBuilder.storage.save()`. Its size is fixed, so
   saving never moves the title. On mobile the navbar also has two Bootstrap
   dropdowns that open directly under their toggles: a hamburger at the left
   (Open project, Preview this page, Close project) and a picker at the
   right showing the current tab. On desktop the tabs are a tab bar. Below
   the navbar the editor has four tabs — **Outline** (page-size preset and
   story outline), **Cast & Props** (two lists, Characters and
   Objects, whose entries each have a description and reference-image
   thumbnails with an upload button), **Scenes**, **Pages**. The Pages tab has a page-number
   rail on the left for desktop with a `+` button pinned to its bottom, and a
   horizontally scrolling page-number footer on mobile with the `+` button
   at its far right. Page numbers are plain (`0`, `1`, `2`); `+` calls
   `ComicBuilder.page.add()` and shows the new page. **Pages are reordered by
   dragging their number** along the rail (`PageButtons`): a press that moves
   less than 5px is still a click that selects the page; a drag shows the new
   sequence live (the buttons stay in the DOM and CSS `order` moves them, like
   the layer rows) and calls `page.move` on release. The cover (page 0) does not
   drag and nothing can land before it. The page on screen stays the same page.
   A finger drags on the side rail (which sets `touch-action: none` on its
   buttons) but scrolls the footer, so for touch and for the keyboard there are
   also **Move page earlier / later** buttons (arrows) next to the page title
   above the sheet (hidden on the cover).

   The selected page is the **only view**: a **page sheet** at the real
   aspect ratio of `metadata.pageSize` (the largest rectangle of that ratio
   that fits, via container-query units), with the **inspector** for the
   highlighted panel (a right-hand pane, or a bottom sheet on narrow screens; see below). There are no modes. Every page always has at
   least one panel, so a new page is a blank sheet. Everything is edited on
   the sheet, and there is no help text.

   - **Panels.** Click a panel to highlight it (a blue outline; the only panel
     of a page is always highlighted). The highlighted panel is painted last
     and shows anything that spills out of it, so its handles stay reachable.
     Stacking is arranged so that content always sits above other panels: a
     panel's number badge is the first thing painted in it (under its own
     layers and bubbles), and only the highlighted panel uses `z-index`, so
     its layers, bubbles and handles paint over every other panel's canvas,
     number and bubbles.
     "Delete panel" removes it (the neighbours stretch over its space).
   - **Cutting.** Nothing on the page cuts a panel by accident: clicks,
     drags and hovering over a panel or its margins do nothing. Only the
     highlighted panel has two **scissors** (`CutHandle`), each a 30px circle
     overlapping the panel's edge: a horizontal-facing pair on the **left**
     edge (cuts into a top and a bottom part) and a vertical-facing pair on the
     **top** edge (cuts into a left and a right part). Press a pair and drag it
     along the panel: it follows the pointer with a dotted line across the
     panel. Let go **over the panel** and it is cut there (`panels.split`,
     which keeps the original panel highlighted so it can be cut again); let go
     outside it (past either end, or more than 40px to the side) and nothing
     happens. The line snaps to 25, 33, 50, 67 and 75% of the panel, and the
     scissors and line turn red when a drop would not cut (outside the panel, or
     leaving a part under 5%). A press on the scissors that barely moves does
     nothing. `panels.splitAcross` and `panels.splitEvenly` remain in the API
     (the UI has no controls for them). The lines between panels are draggable handles: dragging one
     previews the resize locally and commits on release through
     `panels.resize`, moving every panel on that line together so the page
     stays tiled.
   - **Layers.** A layer is a box on its panel (a background fills the panel
     instead). Selecting a layer, from its row or by clicking it on the page,
     shows four corner handles (resize about the centre, keeping the aspect
     ratio) and a rotate handle above it (snaps to 15°); dragging its body
     moves it. Drags preview locally and commit one `layers.update` on release.
     A layer without an image shows a dashed placeholder with its prompt.
     Delete or Backspace removes the selected layer or bubble unless a text
     field has focus.
   - **Bubbles.** A selected bubble shows corner handles (resize with the
     opposite corner fixed; the text is scaled to fit) and a blue dot at its
     pointer tip; dragging the body moves it and dragging the dot aims the
     pointer.
   - **Where the inspector lives.** One inspector is rendered, placed by screen
     width (`InspectorPane`, a media query at 768px). On a **wide screen** it is
     a pane on the right of the page (a quarter to a third of the width, full
     height, always visible). On a **narrow screen** it is a **draggable bottom
     sheet** under the page (`BottomSheet`) with three heights: closed (only the
     handle bar), half (40% of the screen, at most 320px) and full (60%, leaving
     the page a strip above). The handle bar (the only control) shows a grabber
     and the summary ("Panel 2 · 3 layers · 1 bubble", kept up to date from API
     calls). Drag it and the sheet follows the finger; on release it settles:
     pulled past 30% of the way to the next height it moves there, otherwise it
     springs back. A tap on the handle bar toggles closed and half, and a tap anywhere on the
     page (a press that barely moves, on a panel, layer or bubble, but not on
     the scissors) closes the sheet so the whole page shows; drags never
     close it. The chosen
     height is remembered per browser (localStorage) and the
     closed sheet's content is inert (unfocusable). The page area takes whatever
     room the sheet leaves; crossing the breakpoint swaps the layout in place.
   - **Inspector** (for the highlighted panel), top to bottom: the **Panel
     prompt** box (`panels.update`), **Bubbles**
     ("+ Speech / Thought / Caption" and a row per bubble), **Layers** (a row
     per layer, top of the stack first, with a ≡ handle to drag it into a new position (the rows stay in place in the DOM and are shown in the new order with CSS `order`, since moving a dragged element would drop its pointer capture), a
     visibility checkbox, a chevron to expand its details, its name to select
     it, and a trash icon; "Expand all / Collapse all"; "Add layer", which adds
     an empty layer, selects and expands it and focuses its prompt so you can
     type what it should show), **Background** ("Set background", which becomes a
     "Background" row with the same chevron and trash icon). Expanded, a layer shows its name, prompt, its image as a thumbnail
     (or an "Add image" tile when it has none; no file name or pixel size) and opacity; a bubble shows its text and kind. Position, size and rotation are
     only on the page. Expanding a row and selecting it are independent. The
     last section of the inspector is the **Page prompt** (`PageDetails`,
     `page.update`), the intent of the whole page: it is **collapsed by
     default** (a chevron toggle; while collapsed it previews the text in one
     line), shown whether or not a panel is highlighted, and it keeps its open or
     closed state while you switch panels and pages.
   - **Media picker** (`MediaPicker`, one component for every place an image is chosen): clicking
     the thumbnail, or "Set background", opens a popup with a thumbnail of every image in the
     project (transparent images on a checkerboard), the current one outlined, and an "Upload
     new image…" button; picking or uploading closes it and shows a spinner on the thumbnail
     while it works. Images are ordered by what they are for. For a background: "Fits this
     panel" (opaque, aspect ratio within 5% of the panel's), then "Other backgrounds" (opaque),
     then "Other images". For a layer: "Transparent images" first, then "Other images". When the
     layer has a **subject** (its "Shows" dropdown: a character or object) the subject's art
     comes before all of these: "Art of Mara, not used yet" (images tagged `subjectId` = the
     subject that no layer uses), "Art of Mara, in use" (tagged, and on some layer), then the
     usual groups below, and last "Reference images of Mara" (the entity's `imageIds`); an image
     both tagged and in `imageIds` counts as art. A background layer has a **scene** (its "Scene" dropdown) in place of a subject, and the picker lists that scene's art first in the same way (images tagged `sceneId`; the scene's `imageIds` are its reference images). A search box at the top (focused, debounced) filters every page: all words
     must appear in the image's name, the names of the characters, objects and scenes it is art or
     reference art of, or the names of layers using it (a layer still called "Layer" or
     "Background" does not count), ignoring case and accents. Thumbnails load only when their
     tile scrolls into view. An image uploaded from the picker of a layer with a subject is
     tagged as that subject's art. Shape and
     transparency are read from the pixels once per file (`mediaImages.ts`), from the thumbnail when
     there is one, and not stored. The list is paged, 24 images at a time (Previous / Next and
     "Page 2 of 5" in the footer, opening on the page that holds the current image); a group cut
     by a page break repeats its title. Over the top corner of each thumbnail are two icons:
     **open in a new tab** (the full image, from a blob URL because Drive needs the access token;
     the tab is opened inside the click so pop-up blockers allow it) and **delete** (confirms, then
     `media.delete`, which stays in the picker). Lists and pickers show thumbnails, never full files.

4. **Preview overlay** (`preview` boolean) — the current page's panels with
   minimal chrome (page number/title + "Close preview"), rendered on a dark
   background (the same page sheet, without editing chrome) so an agent can
   screenshot a finished page. Preview is always
   per-page, never the whole project. Entered via
   `ComicBuilder.page.openPreview()`, exited via `closePreview()`.

**Status toasts.** Every status message ("Loading project…", "Opened …",
"Project closed.", errors) is a `StatusToast`: a Bootstrap toast fixed to the
top of the screen, above all other elements and outside the page flow. It
closes itself after 5 seconds and has a dismiss button; errors are red.

## 3. Data model

TypeScript source of truth: `src/types/comic.ts`. JSON Schema:
`public/schema/comic-project.schema.json` (draft 2020-12). Every Drive
project folder holds exactly one `project.json`.

- `ComicProject` — `{ id, title, pages[], updatedAt, savedAt, metadata }`.
  `savedAt` is stamped on every successful Drive write and drives the
  Saving/Saved indicator.
- `ComicPage` — `{ id, number, title, prompt?, panels[] }`. `number` is 0-based and
  displayed as is (`0` = cover, `1` = page one). `prompt` is the intent of the
  whole page (what happens, mood, pacing); see "Prompts" below.
- `Panel` — `{ id, title?, prompt?, x, y, width, height, layers[], bubbles[] }`.
  `prompt` is the intent of the panel (its moment, camera, mood).
  `x`/`y`/`width`/`height` are percentages of the **page**. The panels of a
  page tile it (no gaps or overlaps), and each is at least 5% of the page
  wide and tall. A panel's aspect ratio follows from its rectangle and
  `metadata.pageSize`, so the canvas ratio is per panel. Every page has at
  least one panel. Older projects are normalized on load: a page without
  panels gets one full-page panel, and panels without rectangles are stacked
  as equal rows (`normalizeProject`).
- `Layer` — `{ id, name, kind: "background" | "foreground", src, mediaId?,
prompt?, aspectRatio?, subjectId?, sceneId?, visible, x, y, width, rotation, opacity, flipX? }`. `subjectId` is the character or object a foreground layer shows and `sceneId` the scene a background is set in (`layers.update(..., { subjectId: null })` clears it); deleting that entity clears the link everywhere. A layer
  is a `prompt` (what its art should show, for whoever generates the image)
  and optionally an image, so it can exist as just a prompt (`src` is `""`)
  and get its image later. `aspectRatio` (width / height) shapes a layer
  that has no image yet and tells the generator what proportions to use.
  Foreground layers should usually be PNGs with a transparent background;
  a background should be generated at its panel's aspect ratio. A foreground layer
  is clipped to its panel. `flipX` mirrors the image left to right.
  A layer's `prompt` is only its own part of the image prompt; see "Prompts" below.
  There is **no separate background field**: the background is the layer
  whose `kind` is `"background"`; it always fills the panel (cropped, never
  stretched) and sits at the bottom, so its `x`/`y`/`width` are ignored.
  Layers are drawn in **array order** (last on top); `layers.move` reorders.
  For foreground layers `x`/`y`/`width` are percentages of panel size and
  the aspect ratio is preserved. A layer's image is its `mediaId`, pointing
  at a `MediaItem` in `metadata.media`; `mediaId` is absent for a
  prompt-only layer with no image yet.
- `Bubble` — `{ id, kind: "speech" | "thought" | "shout" | "caption", text, x, y,
width, height, tailX?, tailY? }`. Bubbles always render above all layers.
  `x`/`y` is the bubble's top-left corner and `width`/`height` its size, in
  percent of the panel; the text is scaled to fit that box (older bubbles
  without a `height` get 20 on load). Speech, thought and shout bubbles
  have a pointer whose tip is `tailX`/`tailY` (percent of the panel): a wedge from
  the bubble's edge for speech and shout, a trail of circles for thought;
  captions have none. A shout is drawn as a spiky burst with bold capitals. `bubbles.add` aims a new pointer below the bubble.
- `ProjectMetadata` — `{ outline, pageSize, characters[], scenes[],
objects[], media[] }`: the story bible plus the media registry.
  `pageSize` is `{ label, widthIn, heightIn }`, chosen at creation from
  `PAGE_SIZE_PRESETS` (old projects without it load with the US Comic
  default).
- `Character` / `ComicObject` — `{ id, name, description, imageIds[],
sceneIds[] }`. The description carries visual continuity guidance.
- `Scene` — `{ id, name, description, characterIds[], imageIds[] }`.
- `MediaItem` — `{ id, name, fileName, mimeType, thumbnailFileName?, subjectId?, sceneId? }`. `fileName` (and `thumbnailFileName`) is the stable, backend-portable name the image is stored under in the project's storage folder, assigned once at upload from the item's name (`ash-sword-reference.png`, then `-2`, `-3` if that is taken; its thumbnail is `ash-sword-reference.thumb.png`); it is not a URL (see §6's "Addressing images by name"). `subjectId` is the character or object, and `sceneId` the scene, the image is art of (reference art stays in the entity's `imageIds`); `media.upload(..., { subjectId, sceneId })` and `media.update(id, { name?, subjectId?, sceneId? })` set them (`null` clears), and each must name an existing entity. `media.update` only renames the registry entry (the stored file keeps its name). The thumbnail is a small stored file (about 256px on the long side; PNG if the image has transparency, else JPEG) that the UI shows instead of the full image. `media.upload` documents that the caller (an LLM) should resize the image and pass `thumbnailDataUrl`, so the media picker never has to download full images; if it is omitted the browser makes one; `media.uploadThumbnail(id, dataUrl)` adds or replaces one. `media.delete(id)` trashes both files in storage, then removes the item, clears `mediaId` on layers using it and drops it from `imageIds` (`src/state/media.ts`).

Structural validation lives in `src/state/project.ts` (`assertValidProject`,
`createBlankProject`).

## 4. The `window.ComicBuilder` API

Defined in `src/ai/actions.ts` as a nested object literal with JSDoc on
every node and method. `createComicBuilder(deps)` wires the object to the
host app through `ComicBuilderDeps` (getProject, updateProject,
replaceProject, page index, preview, status, storage, media). The API is
also the app's **LLM skill**: see §5.

**Prompts.** Three levels of the project carry a `prompt`, each saying only
what belongs to it: the page (its intent: what happens, mood, pacing), the panel
(its moment, camera, mood) and the layer (what that one image shows). The prompt
for the image of a layer, a background included, is not stored: an LLM stitches
it from the stored parts at generation time, in this order: the STYLE paragraph
(in `metadata.outline`), the page prompt, the panel prompt, the scene
description, the description of each character and object in the image, and the
layer prompt (then the technical requirements). Keeping the levels separate
means a fix to a page prompt or a character description flows into every image
stitched from it afterwards. All three are optional strings (validated on load
and by the API; `""` clears one), editable in the UI and through the API
(`page.update`, `panels.update`, `layers.update`) and so through the CLI.

Namespaces:

- `help()`
- `storage` — `connect()`, `connectWithDevice()`, `disconnect()`, `status()`, `listProjects()`,
  `createProject(name)`, `openProject(idOrName)`, `closeProject()` (saves
  first; stays open if saving fails), `showProjects()`, `save()`
- `project` — `load(data)` (replace the whole project from JSON, validated)
- `page` — `count()`, `select(i)`, `current()`, `add(input?)` (append a page
  with one full-page panel and show it; `input` is `{ title?, prompt? }`),
  `update(patch, pageIndex?)` (`{ title?, prompt? }` of the current or given
  page), `move(from, to)` (reorder: the pages in between shift, every page is
  renumbered, the page on screen stays the same page; the cover, page 0, stays
  first, so both positions must be 1 or more), `openPreview()`, `closePreview()`
- `panels` — `list(pageIndex?)`, `get(panelId)`, `size(panelId)` (inches and
  aspect ratio and the pixel size to generate at, for sizing artwork),
  `splitAcross(axis, position, pageIndex?)` (a line across the whole page,
  cutting every panel it crosses), `split(panelId, axis, position?)`,
  `splitEvenly(panelId, axis, count)`, `resize(panelId, edge, position)`,
  `update(panelId, { title?, prompt? })`, `delete(panelId)`. `axis` is `"horizontal"`
  (a horizontal line: top and bottom parts) or `"vertical"`. Splitting keeps
  the original panel's id and content as the first (top/left) part and
  inserts the new empty panel right after it. `resize` moves one edge and
  every panel on the same dividing line (a horizontal line spans the page and
  moves as a whole; vertical lines belong to their row of panels), clamping
  at the minimum size; the page's outer edges are fixed. `delete` lets the
  neighbours that exactly cover one of its edges stretch over it, and
  refuses to delete a page's last panel. The pure geometry lives in
  `src/state/layout.ts`.
- `layers` — `list(panelId)`, `get(panelId, layerId)`, `add(panelId, layer)`
  (a background goes to the bottom; the image is optional, given as `mediaId`
  from a registered `MediaItem`), `update(panelId, layerId, patch)`, `delete(panelId,
layerId)`, `move(panelId, layerId, "top" | "bottom" | "up" | "down" |
index)`, `size(panelId, layerId)` (the size to generate the art at: the
  panel's for a background, `width` × `aspectRatio` for a foreground layer)
- `bubbles` — `list/get/add/update/delete`, addressed by panel id
- `metadata` — `get()`, `setOutline(text)`, `setPageSize(pageSize)`
- `characters` / `scenes` / `objects` — `list/get/create/update/delete`
- `media` — `list()`, `get(id)`, `upload(name, dataUrl, mimeType)` (data URL
  → File → Drive upload → registry entry) and `download(id)` (the image's
  bytes from Drive, fetched with the app's token, as `{ name, mimeType,
dataUrl }`, so an agent can pass reference images to an image generator)

Semantics:

- **Snapshots.** Reads return `structuredClone` deep copies — inspect them
  freely; mutating a snapshot changes nothing. All writes go through the
  action functions.
- **Ids.** Every created entity gets `crypto.randomUUID()` with a
  timestamp/random fallback.
- **One mutation path.** Every mutation goes through `deps.updateProject`,
  which marks the project as having unsaved changes for the autosave (§7).
  The navbar's save button calls `storage.save()`, like any agent would.
- **One Drive connect method.** `storage.connectWithDevice()` is the OAuth
  device flow: it returns a verification URL + user code for the user to
  approve on any device, and the caller polls `storage.status()` until
  connected. It works headless (no popup, no user gesture), so the same
  button and the same call serve a human click and an AI assistant alike;
  there is no separate popup flow. `storage.connectWithServer(url)` is the
  other option, connecting to a self-hosted HTTP storage server instead
  (§6a) — no OAuth at all, just a reachability check.

## 5. Runtime docs generation (the LLM skill)

`scripts/extract-docs.mjs` (run by both `npm run dev` and `npm run build`)
parses `src/ai/actions.ts` with the TypeScript compiler API, extracting the
JSDoc above the `ComicBuilder` literal and every namespace and method (object
properties, shorthand properties and methods are all handled; `@returns` text
that starts with `{ … }` is kept verbatim). It emits four artifacts:

1. `src/ai/actions.docs.gen.ts` — `ACTION_DOCS`, a path-keyed docs table, and
   `HELP_TEXT`, the rendered reference (gitignored; generated before `tsc`).
2. `public/api.txt` — `HELP_TEXT` (the conventions, then every
   namespace/function with description, parameters and return value) plus the
   data model: the **API reference**. It is **deployed with the site**, next to
   `index.html`.
3. `public/llms.txt` — `scripts/llms-guide.md`, printed verbatim: the
   **how-to-build-a-comic guide**. It deliberately contains no function
   names, signatures or code; it points to `api.txt` for those (the JSDoc,
   including its layout examples, is where API usage lives) and tells the
   agent to drive the app with the CLI (section 13), not a browser.
4. `src/cli/commands.gen.ts` — the CLI's command table (section 13): the same
   JSDoc plus `scripts/cli-inputs.mjs`, which says what kind of value each
   parameter is (text, number, choice, JSON, file, or an object given as one
   flag per field). `scripts/cli-commands.mjs` builds it and **fails the build**
   if `cli-inputs.mjs` and the JSDoc disagree about any function's parameters
   (gitignored; generated before `tsc`).

The guide is plain Markdown. It tells the agent that it is the
**orchestrator** (it directs the work and writes prompts for an image
generator it calls itself; the app never draws), then walks it through the
build in order: agree the brief and a **visual style** (a STYLE paragraph
that starts every prompt), build the **story bible** (outline, characters,
scenes, objects, reference art), plan the pages and panel layouts (pacing,
camera, room for bubbles), **write the page, panel and layer prompts before
any image exists**, stitch every image prompt from those stored parts in the
same order, generate to spec
(**foreground layers are transparent PNGs holding only their subject**,
because they are stacked on other layers; backgrounds are opaque at the
panel's exact aspect ratio; match lighting, palette and scale), attach and
compose (reuse assets), letter with bubbles, review and correct, and keep the
bible current. A continuity checklist closes it.

At runtime, `src/ai/docs.ts` (`attachDocs`) walks the API object and sets a
non-enumerable `toString()` on every node with its docs, and
`ComicBuilder.help()` returns `HELP_TEXT`. Both come from the same JSDoc, so
they cannot drift from the code.

## 6. Google Drive

- **Scope:** `drive.file` only. The app sees exactly the folders and files
  it created; `storage.listProjects()` is the complete project list.
- **Token storage:** the OAuth access token lives only in a JS module
  variable (page memory). It is never written to localStorage,
  sessionStorage, or cookies. Reloading the page drops the token — one
  click reconnects. `storage.disconnect()` saves any unsaved changes, then revokes the grant
  at Google (full sign-out).
- **Folder layout:** one folder per project (named after the project),
  containing `project.json` and uploaded artwork. Artwork is uploaded via
  `uploadImage()` and registered as `MediaItem`s, each named by its stable
  `fileName` (see §6's "Addressing images by name"); a layer holds only the
  `mediaId` pointing at one. Because Drive needs the access token, `useDriveImage`
  fetches the bytes once (`loadBlobUrl`) and shows them from a blob URL.
  Character reference images are uploaded from the Cast & Props and Scenes
  tabs via `media.upload` and shown as blob-URL thumbnails (the media
  thumbnail, `thumbnailFileName`).
- **One implementation for the page and the CLI:** the Drive REST calls
  (`driveRest.ts`) and the OAuth device-flow requests (`deviceOAuth.ts`) use no
  browser APIs; the access token and `fetch` are injected. `driveClient.ts` binds
  them to the page's in-memory token. There is no popup flow — the device
  flow is the only way in, for the page and for the CLI (section 13) alike,
  which binds the same code to a token kept in its state file.
- **Client IDs:** `GOOGLE_DEVICE_CLIENT_ID` + `GOOGLE_DEVICE_CLIENT_SECRET`
  ("TVs and Limited Input devices", device flow) at build time — the only
  Google client the app needs. Read only from the dotenv files (`.env`,
  `.env.local`) by `scripts/read-env.mjs` (used by `vite.config.js` and
  `scripts/build-cli.mjs`); shell env vars are ignored. CI writes
  `.env.local` from the repo secrets of the same names before building. The
  secret ships in the bundle by design: Google's device-client model
  assumes distributed apps cannot keep secrets (the same model rclone
  uses); it only identifies the client, scope stays `drive.file`, and
  access tokens remain memory-only.

## 6a. The HTTP storage server (the other backend)

`http-storage/` is a standalone Node server (`server.ts` + `store.ts` +
`start.ts`) that plays Drive's role over plain CORS-enabled REST instead of
OAuth: one folder per project under a configurable root, `project.json` with
the same optimistic-concurrency versioning (an `If-Match` header instead of
Drive's file `version`, a 412 response instead of `ProjectChangedError`), and
media files alongside it, as plain files under their real names (a project
folder holds `project.json`, the images and a `.trash/`, nothing else: no
index, no metadata file, no cache). A file is addressed by project and name
(`GET|HEAD|DELETE /projects/:name/files/:file`), its MIME type comes from its
extension, its version is its modification time, and an upload that would
reuse a name is refused with a 409. `scripts/migrate-http-storage.mjs`
converts a root from the earlier UUID-blob layout. `scripts/build-http-storage.mjs` bundles it (esbuild, no
dependencies) to `http-storage/dist/http-storage.mjs`; `npm run http-storage`
runs it locally (default `0.0.0.0:8081`; `npm run dev` is fixed to
`0.0.0.0:8080`, both bound to every interface).

**Pluggable backends.** `src/storage/backend.ts` defines `StorageBackendImpl`:
the shape any project store must implement (`listProjectFolders`,
`ensureProjectFolder`, `uploadImage`, `trashFile`, `downloadFile`,
`findFileByName`, `saveProjectJson`, `loadProjectFile`, `hasAccess`,
`disconnect`, plus a display `label`). Each backend's own module builds and
exports one: `driveClient.ts`'s `driveBackend` binds it to Drive's REST calls
and the page's in-memory token; `serverClient.ts`'s `serverBackend` binds it
to `serverRest.ts`'s calls and a base URL checked once against `GET /health`
(remembered in `localStorage` since it is not a secret, but only to prefill
the connect screen's field next time; the app never reconnects on its own).
`src/storage/activeBackend.ts` holds a `REGISTRY: Record<StorageBackend,
StorageBackendImpl>`, a module-level flag for which key is active, and one
function per storage call that looks up `REGISTRY[active]` and delegates.
That registry is the only place that knows both backends exist: everything
else (`App.tsx`, `useProjectSaver`, `mediaImages.ts`, `storage/projectStore.ts`)
imports `activeBackend.ts`'s functions instead of a backend directly, so
adding a third backend means writing a new module that implements
`StorageBackendImpl`, adding one line to `REGISTRY` and to the `StorageBackend`
union, and giving the splash screen a way to connect it. Nothing else changes.

**Addressing images by name, not URL.** A `MediaItem`'s `fileName` (and
`thumbnailFileName`) is the stable, backend-portable name it is stored under
in the project's storage folder, assigned once at upload
(`src/ai/storageDeps.ts`) from the item's name and never changed — never a raw
URL or a backend's own opaque file id. To read the bytes, the active
backend's `downloadFile(folderId, name)` and `trashFile(folderId, name)` take
the name itself (Drive looks up its own file id internally; the server uses
the name as the file's name on disk), and `findFileByName` checks a name is
free before an upload, since a name must be unique within a project
(`src/components/mediaImages.ts`, `src/ai/storageDeps.ts`). `project.json`
itself never stores a backend id, so moving a project's files between
backends needs no rewriting of the file: copy the bytes under matching names
to the other backend and the same `fileName` values resolve there too. Stored names follow one rule
(`src/utils/fileName.ts`): lowercase letters and digits joined by dashes, then
an image extension (`ashwini-running.png`, `ashwini-running.thumb.png`). Uploads
reword their name to fit (`toFileName`), the HTTP server refuses any other
name, and a name is never reused within a project. Files are never shown by
name: the UI shows a `MediaItem`'s `name` label, which for an uploaded file
starts as its file name with dashes as spaces and a capital first letter
(`displayName`). `scripts/normalize-http-storage.mjs` renames an existing root
to the rule. A
layer holds no image reference of its own beyond `mediaId`, pointing at the
`MediaItem`; `Layer.src` and any backend-specific id on a `MediaItem` are
gone.

The CLI does not support the server backend (`connectStorageWithServer` is a
stub there that points at `vibecomics auth login`): it stays Drive-only.

## 7. Autosave

`useProjectSaver` (`src/state/useProjectSaver.ts`) owns saving. Every
mutation marks the project dirty (`markDirty`, called from `updateProject` and
`replaceProject`); nothing is written otherwise.

- **Cadence:** while a project is open, a 60-second interval saves it, but only
  if it is dirty. `storage.save()` (the navbar's floppy-disk button) saves
  immediately, and does nothing when clean.
- **Write:** `project.json` is written with `savedAt` and `updatedAt`
  stamped. Edits made while the write is in flight keep the project dirty for
  the next round; a failed write keeps it dirty too, shows an error toast and
  turns the button red.
- **Two systems, one file (optimistic concurrency).** Both backends keep a
  version outside `project.json` itself (metadata, not a field of the
  schema): Drive's per-file `version` counter, or the storage server's own
  counter checked against an `If-Match` header (§6a) — atomically there,
  unlike Drive. The saver remembers, in memory, the **base** (the copy it
  loaded or last wrote) and the version of it; `saveProjectJson` (routed
  through `activeBackend.ts`) reads the current version on the request that
  already finds the file and refuses to write (`ProjectChangedError`) if it
  moved. Then, before pushing, the saver **pulls** the newer copy and does a
  three-way merge of base, ours and theirs (`src/state/merge.ts`, a pure
  function shared with the CLI). Everything has an id, so changes to
  different things, or to different fields of one thing, combine; the merged
  project is written on top of their version, and the merge repeats (up to
  three times) if yet another save lands meanwhile. There is no polling and
  no live update: it happens only when saving. On Drive, the check and the
  write are not atomic, so a save landing in the milliseconds between them
  can still slip through.
- **What is a conflict:** the same field of the same thing changed differently on
  both sides; a thing deleted on one side and changed on the other; both sides
  reordering the same list (the pages, a layer stack) differently; or panel layouts
  that are each valid but do not tile the page once combined. Nothing is written
  for a conflict. The merged project (ours wherever there is a conflict) becomes
  the open project and the base becomes theirs, and saving waits until every
  conflict is settled (autosave pauses; `storage.save()` returns
  `{ ok: false, error }` naming them; closing the project is refused).
- **Where conflicts show (browser):** a red **dot** on the page number of a page
  that holds one (also on the Pages, Cast & Props, Scenes or Outline tab), the Save
  button turns red, and a **conflict footer** (`ConflictBar`) appears under the
  editor. It shows one conflict at a time (‹ › to move between them), takes the
  editor to its tab and page, and offers **Base**, **Ours** and **Theirs**: each
  shows that version's text and, for a conflict on a page, a small preview of the
  page as it would look with that version (the merged project with that one
  conflict settled that way). A **Keep** menu picks Ours, Theirs or Base and
  **Resolve** applies it; when the last one is resolved the project is saved by
  itself.
- **CLI:** each command loads the project with its Drive version, changes it and
  saves; on a version mismatch it merges too. With no conflict it writes the
  merged project; on a conflict it writes nothing and fails with an error that
  lists each conflict (what you changed, what they changed, and what it was
  before) and says to fetch the project again and apply the change again.
- **Flush points:** closing a project and disconnecting save first; closing
  stays on the project if saving fails.
- **Unload:** while dirty, the browser asks for confirmation before the tab
  is closed, since up to a minute of changes could be lost.

## 8. Service worker & updates

Pattern: cache-first with commit-based update detection.

- `src/sw.ts` is bundled to `dist/sw.js` by `scripts/build-meta.mjs`
  (esbuild, minified IIFE) after `vite build`.
- `build-meta.mjs` also writes `dist/buildinfo.js` as
  `self.BUILD_INFO = { commit, builtAt, files }`, where `commit` is the
  current git HEAD and `files` is the recursive `dist/` listing (taken
  **after** bundling so `sw.js` is included; `buildinfo.js` itself is
  cached explicitly, not listed).
- The worker installs by fetching `buildinfo.js` and precaching every
  listed file into a cache named per registration scope (`comic-builder:<scope>`,
  so other sites on the same origin, such as other GitHub Pages projects of the
  same user, never clash); files a newer build no longer lists are pruned.
- On every navigation it fetches `buildinfo.js` with `cache: "no-store"`;
  if the commit differs, it re-downloads all files and posts
  `UPDATE_READY` to clients.
- `src/sw-register.ts` registers `./sw.js` **only in production builds**
  (never in dev), polls hourly and on visibility change, and shows a
  Bootstrap "new version available" banner with a Reload button when an
  update lands.

## 9. Build pipeline

`npm run build`:

```
node scripts/extract-docs.mjs   # actions.ts -> actions.docs.gen.ts + public/api.txt + src/cli/commands.gen.ts; guide -> public/llms.txt
node scripts/build-cli.mjs      # src/cli/bin.ts -> public/vibecomics.mjs (esbuild, Node 20)
tsc -b                          # TypeScript (project references)
vite build                      # -> dist/
node scripts/build-meta.mjs     # bundle src/sw.ts -> dist/sw.js; write dist/buildinfo.js
```

`npm run dev` runs the extractor and the CLI bundle first for the same reason
(vite then serves `public/vibecomics.mjs`). `npm run cli -- <args>` rebuilds and
runs the CLI. Other scripts:
`npm run lint` (oxlint) and `npm test` (runs the extractor, then
`scripts/run-tests.mjs`, which bundles every `src/**/*.test.ts` with esbuild and
runs it with Node's built-in test runner; the tests cover the pure code: panel
layout geometry, and project validation and normalization,
plus the CLI end to end against an in-memory fake of Google's OAuth and Drive
endpoints, `src/cli/testing/fakeGoogle.ts`). Formatting: Prettier config in `.prettierrc.json` (single quotes, semicolons, 2-space,
100 col, es5 trailing commas); `npm run format` / `npm run format:check`;
a Husky pre-commit hook runs `lint-staged` on
`*.{js,ts,json,css,html,md}`. `src/ai/actions.docs.gen.ts`, `src/cli/commands.gen.ts`, `public/llms.txt`, `public/api.txt`, `public/vibecomics.mjs` and `*.tsbuildinfo` are
gitignored (generated).

CI (`.github/workflows/ci.yml`): `npm ci`, `npm run format:check`,
`npm run lint`, `npm test`, `npm run build`. Deploy (`.github/workflows/deploy.yml`): on pushes to
`main` touching code/build paths, configure Pages, `npm ci`, `npm run
build` (after writing `.env.local` from the Google repo secrets), upload
`dist/`, deploy. The build uses `base: './'` (relative asset URLs), so the
site does not depend on the repository name or hosting path.

## 10. Styling rule

**Bootstrap owns all app chrome** — splash card, tiles, modal, navbar,
dropdown, banners, buttons, forms. Custom CSS (`src/App.css`) exists **only
for the comic canvas**: `.panels` grid, `.panel*` presentation,
`.panel-canvas` / `.panel-layer` positioning, `.bubble` variants, and a
small mobile adjustment. If it's UI chrome, it's a Bootstrap class; if
it's drawn comic content, it's custom CSS.

## 11. Agent testing constraints

- Drive OAuth during automated testing: `storage.connectWithDevice()` (the
  only connect method — no popup flow exists) is headless-friendly, but no
  throwaway credentials exist, so completing it for real still needs the
  agent to relay the URL + code to the user, who approves on any device.
  `storage.connectWithServer(url)` (§6a) needs no OAuth at all — it works
  headless outright against a storage server the agent can start itself.
- Static checks (tsc, vite build, prettier, extractor) are the automated
  gate. Live-browser verification — visual inspection and console
  injection of `window.ComicBuilder` — needs a real browser session and is
  done by the supervising agent, not the build subagent.
- After `npm run build` goes green and the deploy workflow is green,
  report OAuth-gated paths as unverified unless the user performed the
  gesture.

## 12. Source layout

- `src/App.tsx` — screen state, storage wiring (`ComicBuilderDeps`), toast.
- `src/cli/` — the command line (section 13).
- `src/components/` — one file per screen or widget, grouped by role:
  screens (`SplashScreen`, `ProjectTiles`, `EditorScreen`, `PreviewScreen`),
  editor chrome (`EditorNavbar`, `SaveButton`, `StatusToast`, `DropdownMenu`),
  tabs (`PagesTab`, `OutlineTab`, `StoryTab`, `ReferenceImages`), the page
  canvas (`PageSheet`, `CutHandle`, `PanelView`, `LayerBox`, `BubbleView`, `CornerHandle`,
  `bubbleShape.ts`) and the inspector (`InspectorPane`, `BottomSheet`, `PanelInspector`, `BubblesSection`,
  `LayersSection`, `BackgroundSection`, `LayerRow`, `LayerDetails`,
  `MediaPicker`, `MediaSlot`, `RowButtons`). Small hooks and helpers live beside them
  (`useTask`, `useExpansion`, `useDriveImage`, `panelActions`, `selection`).
- `src/ai/` — `actions.ts` (the documented `window.ComicBuilder` literal:
  the JSDoc there is the source of the LLM docs), `builders.ts` (the shared
  list/get/add/update/delete builders and validation it is assembled from),
  `deps.ts` (`ComicBuilderDeps` and the input/patch types), `storageDeps.ts`
  (the storage-backed deps the page and the CLI share: media upload, download
  and delete, create or open a project — generic over `MediaHost.drive` /
  `.fileUrl`), `docs.ts`, generated `actions.docs.gen.ts`. `createComicBuilder(deps)`
  uses no browser APIs, so it runs in Node too.
- `src/drive/` — `driveRest.ts` (Drive REST, token and `fetch` injected),
  `deviceOAuth.ts` (device flow, refresh and revoke, no browser APIs),
  `driveClient.ts` (the page's token and the device flow bound to it).
- `src/server/` — the storage-server counterpart (§6a): `serverRest.ts`
  (REST calls, base URL and `fetch` injected) and `serverClient.ts` (the
  page's base URL, remembered in `localStorage`, bound to it).
- `src/storage/` — `backend.ts` (the `StorageBackendImpl` interface),
  `activeBackend.ts` (the registry that dispatches to whichever backend is
  active; see §6a) and `projectStore.ts` (load, validate and normalize a
  project, through whichever is active).
- `src/state/` — project validation/creation/normalization (`project.ts`),
  project lint (`lint.ts`: `lintProject` returns findings `{ code, severity,
message, where, fix? }`, errors first; exposed as `project.lint()` and the
  CLI's `project lint`, which exits 1 on errors; unlike `assertValidProject` it
  never blocks opening or saving; a `fix` only clears or unlinks something),
  panel layout geometry (`layout.ts`), the three-way project merge used to
  combine two systems' saves (`merge.ts`) and `useProjectSaver`.
- `src/types/comic.ts` — the data model; `src/utils/` — small shared helpers
  (`mediaKey.ts` derives the cache/lookup key for a `MediaItem` from its
  `fileName`, `geometry.ts`, `drag.ts`, ...).
- `*.test.ts` files sit next to the code they test (`npm test`).

## 13. The command line (`vibecomics.mjs`)

Agents that cannot run JavaScript in a page (or should not need a browser at
all) drive the app with a Node.js 20+ program, bundled by esbuild to
`public/vibecomics.mjs` and deployed next to `llms.txt`. It calls the same
`createComicBuilder(deps)` as the page, with deps built for Node, so a command is
exactly the API function of the same name:
`node vibecomics.mjs <namespace> <function> [arguments]` prints the result as JSON
(errors go to stderr as `error: …`, exit 1; exit 2 for a mistake in how the
command was typed). `help`, `help <namespace> <function>` and `help --full` are
generated from the JSDoc.

- **Arguments** follow the command table: positional in the API's parameter
  order (or as `--name value`); numbers, choices and JSON are validated before the
  call; an object parameter is one flag per field (`page add --title X`) or JSON;
  a file parameter is a path (read into a data URL; `media upload hero.png
--thumbnail small.png`, with the name and MIME type defaulting from the file);
  a value starting with `@` is read from that file (`@bubble.json`).
  `media download <id> --out file` writes the image to a file.
- **State** (`src/cli/state.ts`): each command is its own process, so the login
  (a refresh token and the current access token), the open project's Drive folder
  and the current page persist in `~/.vibecomics/state.json` (mode 0600 in a 0700
  folder; `VIBECOMICS_HOME` moves it). This is the one place a token is written to
  disk, unlike the page, and only the CLI does it; `auth logout` revokes it.
- **Login** is the OAuth device flow (`deviceOAuth.ts`), split in two so it fits
  an agent's tool calls: `auth login` prints the URL and code and returns;
  `auth status` finishes it (one poll) once the user has approved. Later runs
  refresh the access token from the refresh token. `storage.connectWithServer`
  (the HTTP storage server backend) is unavailable in the CLI, which only
  supports Drive.
- **Per command** (`src/cli/nodeSession.ts`): refresh the login, load the open
  project from Drive (skipped for commands that do not need it), call the API,
  and save `project.json` back if anything changed (`savedAt`/`updatedAt`
  set as `useProjectSaver` does). There is no autosave timer and no preview
  screen (`page.openPreview` fails with an explanation). Run commands one at a
  time: two at once would each save their own copy.
- **Thumbnails:** there is no canvas in Node, so the CLI cannot make a
  thumbnail; agents pass one (`--thumbnail`), as the guide says.
- **Tests** (`src/cli/cli.test.ts`) run the real CLI against
  `src/cli/testing/fakeGoogle.ts`, an in-memory `fetch` standing in for Google's
  OAuth and Drive endpoints.
