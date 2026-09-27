# VibeComics: how to build a comic

VibeComics is a comic builder. Pages are made of panels; each panel is a stack
of image layers with speech bubbles on top; everything is stored in the user's
Google Drive. This file tells you, an AI agent, **how to build a good comic with
it, step by step**. It does not list functions.

- **How you drive it: the `vibecomics` command line, not a browser.** It is one
  file, `vibecomics.mjs`, with nothing to install (Node.js 20 or newer; check
  `node --version`). Download it:
  `curl -fsSLO https://nparashuram.github.io/vibecomics/vibecomics.mjs` (it is
  served next to this file, so if you read this file from somewhere else, use the
  same address with `llms.txt` replaced by `vibecomics.mjs`). Then
  `node vibecomics.mjs help`. Every function is a command:
  `node vibecomics.mjs <namespace> <function> [arguments]`. It prints JSON. You do
  not need a browser and you do not need to inject any JavaScript. Below,
  "the CLI" means this program.
- **What running it needs:** Node.js 20 or newer (older versions refuse to start)
  and network access to Google (`oauth2.googleapis.com` and
  `www.googleapis.com`). Nothing else: no npm, no packages, no browser. It keeps
  its login and the open project in `~/.vibecomics`; if your sandbox is wiped
  between sessions, set the `VIBECOMICS_HOME` environment variable to a folder
  that persists, or the user will have to approve a new login each time.
- **Exact functions, parameters and examples:** `node vibecomics.mjs help` lists
  every command, `help <namespace> <function>` explains one, and `help --full`
  prints the whole API reference (also served as `api.txt`).
- **Project file format:** `schema/comic-project.schema.json`.

## Your role: orchestrator

You are the **orchestrator**, not the illustrator. The app stores the comic; it
does not draw. Your job is to direct the work:

1. Decide the story, the visual style and the page layouts.
2. Write a **prompt** for every image and give it to an image generator that
   you call yourself (an image model or tool outside this app).
3. Put what the generator returns into the comic, then look at the result and
   fix what is wrong.

The generator only sees the prompt (and any reference images) you hand it, and
it has no memory of the last image you asked for. **Consistency between images
is entirely your responsibility.**

## Before you start

- Log in to the user's Google Drive once: `node vibecomics.mjs auth login` prints
  a web address and a code. **Show them to the user** and ask them to open the
  address on any device (a phone works), enter the code and approve. Then run
  `node vibecomics.mjs auth status`: it finishes the login when they have
  approved (if it says "pending", wait for them and run it again). The login is
  remembered on this machine, so you do this once, not for every command.
- Open the user's project, or create one if they want a new comic. Nothing else
  works without an open project. It stays open for the commands that follow.
- Every image lives on the user's Drive, inside the project's folder. You
  upload images (files on your disk) to the project; you never invent or paste
  image URLs, and you cannot fetch a Drive image yourself (the CLI can download
  one to a file when you need to see it or pass it to a generator).
- Every command saves its changes to Drive before it exits, so there is nothing
  to save at the end. Run commands one at a time, never in parallel.
- The user may have the project open in the app while you work. Before saving,
  the CLI checks whether they saved in the meantime: if so, their changes and
  yours are merged automatically (changes to different things simply combine). If
  they clash (you and they changed the same thing, or one of you deleted what the
  other changed), the command fails, saves nothing and says what clashed. Then
  fetch the project again (the next command does), look at what the user
  changed, and apply your change again on top of it, or ask the user which
  version to keep.

## The workflow

Work in this order. Do not generate images before steps 1 to 4 are done: the
plan is what keeps a hundred separate images looking like one comic.

### 1. Agree on the brief and the visual style

Get the premise, genre, audience, length (pages) and tone from the user. If
something important is missing, ask once, then proceed with sensible defaults.

Then fix the **visual style** and write it down as a short STYLE paragraph.
Every prompt for the whole comic will begin with it, word for word, so make it
concrete:

- **Medium and technique:** e.g. inked line art with flat colour, watercolour
  wash, painterly digital, halftone-and-screentone manga, cel-shaded, gritty
  pencil.
- **Line:** weight, quality (clean, scratchy, none), and whether outlines are
  black or coloured.
- **Palette:** a handful of named colours or a mood (muted earth tones, neon on
  navy), and how colour changes between scenes (warm for home, cold for the
  lab).
- **Lighting and rendering:** flat, soft, dramatic, rim-lit; where the light
  comes from.
- **Mood, era and genre cues:** noir, whimsical, 1980s sci-fi.
- **Level of detail:** simple and iconic, or dense and textured.

Keep it to a few sentences and never change it halfway through the book unless
the story calls for it. Save it in the project's outline so it is always there.

### 2. Build the story bible

The **story bible** is the project's outline plus its characters, scenes and
objects (props). It is the single source of truth for every image.

- **Outline:** the STYLE paragraph, then the premise and a page-by-page list of
  beats (what happens on each page).
- **Characters, scenes and objects:** for each one, write a canonical visual
  description: for a character its age, build, face, hair, skin tone, outfit,
  colours and distinguishing marks; for a place its layout, time of day,
  materials and colours; for an object its shape, size, colour and wear. Add
  continuity notes (scar on left cheek, always carries the red satchel). Link
  characters to the scenes they appear in.
- **Reference art:** for each character, generate a clean full-body view and a
  face close-up, neutral pose, on a **transparent background**, and attach them
  to the character. For key places or props do the same. From then on that art
  is the reference for every later image. The user may also have uploaded
  reference images already, so look before you make your own.
- **Art versus reference art:** a character's or object's `imageIds` are its
  reference art, the images you attach to every generation. Do not add the
  pictures you generate of it to `imageIds`. Tag them instead: upload with
  `media.upload(..., { subjectId })`, or `media.update(id, { subjectId })` (use
  `sceneId` for a scene's background art), so the editor's media picker lists
  them first for a layer that shows that character or object, or is set in
  that scene. Give images and layers clear names too (`media.update`
  renames an image), because the picker's search reads them.

### 3. Plan the pages and their layouts

For every page, decide before drawing:

- **Which story beats it holds** (one to five is typical) and the **reading
  order** (left to right, top to bottom).
- **Its panels.** Pick a layout that serves the beats: a large panel for an
  establishing shot or a dramatic moment, small ones for quick action or
  dialogue, a tall narrow panel for a fall or a reveal, a wide one for a
  landscape. Vary size and shape from page to page so the book has rhythm;
  avoid a uniform grid unless that is the style.
- **Camera for each panel:** establishing wide shot, medium shot, close-up,
  low or high angle, over-the-shoulder. Change it between neighbouring panels
  so the eye keeps moving, and keep a consistent screen direction when
  characters move or talk to each other (do not flip who is on the left
  without a reason).
- **Where the words go.** Leave calm space (sky, wall, floor) in the panel for
  bubbles and captions rather than covering faces or the action.

Every new page starts as one blank panel that you then cut up into the layout.
Choose the page size first (the standard comic sizes are in the API
reference); it decides every image's proportions.

### 4. Write the prompts for every page, panel and layer, before any image

Build the whole comic as **prompts first**, at three levels. Each level says
only what belongs to it, so the parts add up when they are stitched together
(step 5) without repeating or contradicting each other:

- **The page prompt:** the intent of the whole page. What happens on it (the
  beats from step 3), its mood and pacing, how the panels flow. Set it when you
  add the page, or later.
- **The panel prompt:** the intent of one panel. The moment it shows, the
  camera (shot and angle), the mood, what it must get across, where the words
  will go.
- **The layer prompts:** for each panel, add the layers it needs and write the
  prompt in each one while its image slot is still empty:
  - one **background** layer: the setting, at the bottom of the stack, filling
    the panel;
  - one **foreground** layer per character or prop that appears, so each can be
    moved, resized and reused separately (see step 6);
  - give each layer a clear name ("Mara, running", "Lab background");
  - set each foreground layer's `subjectId` to the character or object it
    shows (`layers.update(panelId, layerId, { subjectId })`, `null` clears it);
  - set each background layer's `sceneId` to the scene it is the setting of
    (`layers.update(panelId, layerId, { sceneId })`, `null` clears it);
  - a layer prompt is about that one image: the pose, action, expression and
    gaze of the character, or the look of the background. The setting and the
    character descriptions are not repeated here: they come from the story
    bible.

These prompts are the record of how every image is asked for. The user can open
the page in the editor and read your plan (the page and panel prompts are boxes
in the inspector, and each empty layer shows its prompt), so this is also where
they can correct you cheaply, before any image has been generated. Fix the
plan, then start generating.

### 5. Stitch the prompt for each image the same way

The prompt you give the generator for a layer (a background too) is **built
from the stored parts**, in this order, never written from scratch:

1. The **STYLE paragraph**, verbatim.
2. The **page prompt** of the page it is on, verbatim.
3. The **panel prompt** of the panel it is in, verbatim.
4. The **scene description** from the bible, verbatim.
5. Each **character's and object's description**, verbatim, for everything in
   this image (do not paraphrase; a reworded description is a different
   character).
6. The **layer prompt**: what this image shows (pose, action, expression, gaze,
   framing).
7. The **technical requirements** for the image kind (next section), including
   the exact size or aspect ratio the app gives you for that layer.

Read the parts back from the project when you generate (the page, its panels
with their prompts, the layer, the characters) instead of trusting your memory:
that is what keeps a hundred images consistent, and it means fixing a page
prompt or a character description fixes every image you stitch from it after.
If the generator accepts reference images, attach the character's reference art
to every image of that character. If it cannot, rely on the verbatim
description.

### 6. Generate the images to the right specification

Layers are **stacked on top of other layers**, so what each image contains
matters:

**Foreground layers (characters, props, effects, lettering that is art)**

- **A PNG with a real transparent background**, containing **only its
  subject**. The layer will be placed on top of a background and other
  characters, so any background pixels would show as a box.
- No scenery, ground plane, cast shadow on a floor, frame, border, watermark or
  speech text in the image. (Words belong in bubbles, not baked into art.)
- Crisp, clean edges with no white or coloured halo, and no fringe left by a
  removed background.
- Keep the whole subject inside the image with a little margin, unless the
  crop is intended (a character leaning in from the panel edge is better done
  by placing the layer partly outside the panel than by cropping the art).
- Draw it at the size and proportion it will have on the panel: a small
  distant figure need not be generated as a huge one.
- If your generator cannot produce transparency, generate the subject on a
  flat, plain, single-colour background that does not appear in the subject,
  and cut the background out before uploading. Never upload a picture of a
  checkerboard: that is not transparency.

**Background layers**

- **Opaque**, with no transparency, no characters or props that will move, and
  no text.
- **The exact aspect ratio of the panel**, taken from the app (the size it
  reports for the layer). The app never stretches an image; if the ratio is
  wrong the image is cropped to fill the panel and you lose the composition.
- Keep the area where characters will stand and where bubbles will sit
  uncluttered, and lay out the perspective and horizon so a character placed
  on it looks grounded.

**Visual consistency across layers and pages**

- Same STYLE paragraph, same rendering, same line weight for backgrounds and
  characters, so a character does not look pasted onto a photograph.
- **Match the lighting** of the background: if the sun is low and from the
  left, say so in the character's prompt as well (light direction, colour
  temperature, rim light).
- **Match the palette** to the scene's mood from the bible.
- **Match scale:** a character's size relative to doors, furniture and other
  characters must agree from panel to panel.
- Send the same character to the generator with the same reference and
  description every time; regenerate only when pose, expression or outfit must
  change.

### 7. Add each image to its layer and compose the panel

Upload each generated file to the project, attach it to the layer whose prompt
it answers, then compose. **Always upload a thumbnail with each image:** resize a
copy yourself to about 256 pixels on its long side (PNG if the image has
transparency, so cut-outs stay cut out; otherwise JPEG at about 85% quality) and
pass it with the upload. The editor lists images by thumbnail, and one without
must be downloaded in full just to appear, which is slow with many or large
images. The CLI does not make thumbnails for you.

- Place and size foreground layers so they read well: put the focal subject
  near a third of the panel, overlap layers for depth, tuck characters against
  the panel edge for tension. A layer keeps its proportions; only its position,
  size and rotation change.
- **Reuse instead of regenerating:** a character that is the same pose in
  several panels is one transparent image placed in each. Reuse is how you keep
  the comic consistent and the generation count low.
- Stacking order is bottom to top: background, then things behind characters,
  characters, then things in front of them. Bubbles always sit above every
  layer.

### 8. Letter the comic

After the art is in place, add the words as bubbles, not as text inside images:

- **Speech** bubbles for dialogue, **thought** bubbles for inner voice,
  **captions** for narration and scene labels.
- Keep lines short (a dozen words is a lot). Split long speeches across
  bubbles. Put bubbles in reading order, top-left to bottom-right, so the
  first one to be read is the first one placed.
- Aim each pointer at its speaker's mouth or head, and keep bubbles off faces
  and off the key action.
- The text is scaled to fit the bubble: make the bubble big enough that it
  stays legible.
- Sound effects are art: make them transparent foreground layers, in the same
  style, not bubble text.

### 9. Review every page and correct

The CLI has no preview screen, so review what you can see: download the images
you generated and look at each one (compare it with the character's reference
art and with the previous page), and read each page back (its panels, layers,
prompts and bubbles) to check the layout. If the user has the app open, ask them
to look at a page and tell you what is wrong. Check:

- **Character continuity:** face, hair, outfit, proportions, colours.
- **Transparency:** no white boxes, halos or leftover background around
  foreground layers.
- **Lighting and scale** match the background; nothing floats.
- **Framing:** backgrounds are not awkwardly cropped; nothing important sits
  under a bubble; layers stay inside the panel unless it is deliberate.
- **Lettering:** legible, correct spelling, in reading order, pointers aimed
  correctly.
- **Flow:** the panels read in the intended order and the camera varies.
- **The project's own checks:** run `project.lint()` (CLI: `project lint`, which
  exits 1 when there are errors). Fix every error, then the warnings, then run
  it again until it reports no errors. Each finding names the thing by name and
  id and says where it is; a `fix`, when there is one, is a safe call you can run
  as given (`ComicBuilder.<call>(...args)`) that only clears or unlinks
  something. Findings without a fix need a decision: their message says what to
  do. Typical ones are a reference to a deleted character or image, an image
  that is not what its layer says, two entries with the same name, an image with
  no thumbnail, and layers that do not say which character, object or scene they
  show.

Fix problems at the source: tighten the part of the prompt that caused it (the
layer prompt, the panel or page prompt if the fault is shared, or the
description in the bible), stitch the prompt again (quote the descriptions more
exactly, attach the reference), regenerate that one image, and swap it in. The
stored prompts then still describe what produced the image.

### 10. Keep the bible current, save and report

- If the story changes something on purpose (a new outfit, an injury, a new
  location), update the description and add new reference art. For a lasting
  change create a variant entry, for example "Hero (winter coat)", so earlier
  pages still match their own reference.
- Save the project, then tell the user what you built, what you assumed, and
  anything you would improve.

## Continuity checklist

Before generating any image, confirm:

- The prompt is stitched from the stored parts, in order: the STYLE paragraph,
  the page prompt, the panel prompt, the scene, the characters and objects, the
  layer prompt, then the technical requirements.
- The STYLE paragraph is in the prompt, verbatim.
- Every character, place and prop in the image is in the prompt with its
  description verbatim.
- Its reference art is attached, if the generator takes images.
- It is the right kind: a transparent PNG subject for foreground layers, an
  opaque exact-ratio picture for backgrounds.
- The page prompt, the panel prompt and the layer prompt are written down in the
  project, so the plan is on record and the user can read it.
