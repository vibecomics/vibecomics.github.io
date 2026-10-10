# VibeComics: how to build a comic

> VibeComics is a comic builder. A comic is pages, each page is panels, each
> panel is a stack of image layers with speech bubbles on top. You, an AI
> agent, build the whole comic for the human by driving the VibeComics CLI.
> This file teaches you the workflow. It does not list functions.

## Files served next to the app

Everything you need lives at the same deployed site as this file — the same
origin and folder, whatever that happens to be (the project's own site, a
fork's, a custom domain). Never use a github.com source URL for any of them,
and never hard-code `vibecomics.github.io`: derive each address from the one
you fetched this file from, replacing just the file name.

- This file is the workflow guide itself, served as `llms.txt`.
- CLI: `vibecomics.mjs`, next to this file — the single-file program you run.
  There is nothing else to install.
- API documentation: `api.txt`, next to this file — the exact commands,
  arguments, and returns for the project's API functions. Also available
  from the CLI itself as full help and per-command help.
- Project schema: `schema/comic-project.schema.json`, next to this file — the
  machine-readable shape of a project, if you need to check a field.

## 1. Using the CLI and searching its documentation

You drive VibeComics with the CLI, not with a browser.

There are **two documentation sources, and they are not interchangeable**:

- **The CLI's own built-in help is the source for CLI-only things**: how
  to run the program, the login commands (section 2), and the CLI's home
  folder settings. These are _not_ in api.txt — do not search for them
  there.
- **api.txt is canonical for the project API functions** (the namespaces
  for storage, pages, panels, layers, bubbles, the story bible, media,
  and generation): exact names, arguments, flags, and returns.

Rules that apply to both:

1. Download `vibecomics.mjs` from the address above. You need Node.js 20
   or newer; check your version before you start, and run the CLI's help
   before your first project command.
2. Before using any API function you have not already verified in this
   session, search the API documentation for it. Never guess a function
   name, an argument, or a flag. If you cannot find it, search again with
   different words; do not invent a plausible-looking command.
3. Run CLI commands one at a time, never in parallel. Every command saves
   its changes before it exits, so there is nothing extra to save later.
4. The CLI keeps its login and its open project on this machine, in its
   home folder (the built-in help names the folder and the environment
   variable that moves it). If your environment is wiped between
   sessions, point that variable at a folder that persists, or the human
   will have to approve a fresh login every session.

Your job in this section ends when: the CLI runs, its help works, and you
can search both documentation sources.

## 2. Storage: connect Google Drive — connection only, no project yet

Do this before any story work, but note what this section is _for_: it
**connects storage**. It does not create a project. A new project's page
size and page count come from the story (section 4), so creating the
project happens after intake, in section 5. Creating it here, blind,
would lock in a default page size that is probably wrong.

- The VibeComics website stores nothing on its own servers. A comic, its
  images, and everything in it live in storage the human chooses.
- **Google Drive is the recommended default.** Use it unless the human
  names a different storage they already have.
- Connect through the CLI's login flow. These commands are documented in
  the **CLI's built-in help**, not in api.txt:
  1. Run the CLI login command. It gives you a web address and a code.
  2. **Show that address and that code to the human.** You give the code
     to the human; you never ask the human for a code. The human opens
     the address on any device, enters the code, and approves access.
  3. Run the CLI's auth-status command. It completes the login once the
     human has approved. If it says the login is still pending, wait for
     the human and run it again — do not restart the login.
- If the login command itself fails — it errors, or returns without
  printing a web address and a code — the connection step is blocked,
  not the human's approval. Do not invent an address or a code, and do
  not ask the human for one. Check that this environment can reach the
  internet (the login needs to reach Google), retry the login once,
  and if it fails again, tell the human plainly: the connection step
  itself is what's blocked, here is the exact error, and the comic
  cannot start until login works — then stop. Do not proceed to story
  work on assumed storage.
- Tell the human, in one sentence, what they are approving: the app can
  only see files and folders it created in their Drive, nothing else.
- Once connected, list the human's existing projects (search api.txt for
  the storage functions) so you know what already exists. If the human
  arrived asking to continue a named existing comic, open that one now
  and skip to section 6. Otherwise, do **not** open or create anything
  yet.
- If, and only if, the human themselves names an HTTP storage server
  address, there is an HTTP storage option — search the API documentation
  for connecting with a server. Do not offer it, suggest it, or explain
  it otherwise.

Your job in this section ends when: storage is connected and you have
listed what projects already exist. No project needs to exist yet.

## 3. Your role: the orchestrator

You are the orchestrator, not the illustrator, and not a passive scribe.

- The app stores and assembles the comic. It does not invent the story,
  decide the layouts, or keep images consistent. You do.
- You take the human's story and break it down, in this order:
  **story → pages → panels → layers**, with a story bible alongside it
  (characters, props/objects, scenes).
- At each level you store what belongs at that level in the project (see
  section 6 for exactly what that is), so what the project can store is
  in the project, not only in this conversation. Note what it cannot:
  there is no stored outline or page-map field you can write — the plan
  lives in the project as page and panel titles and as layer prompts.
  Do not search for an outline setter; there isn't one.
- You write the prompts, you arrange for the images to be generated from
  stitched prompts (section 9), in the order in section 10, and you
  review and fix the result (section 13).
- The image generator — whether it is the one configured in the CLI or a
  tool you call yourself — only sees the prompt and the reference images
  it is handed. It has no memory of any other image. **Consistency across
  a hundred images is your responsibility**, and it comes from reusing
  the same stored descriptions and the same reference images every time,
  never from re-describing a character from memory.

The structure below is for you. Do not lecture the human about it, do not
recite it to them, and do not make them fill in a form that follows it.
You use it silently to organise what they tell you.

## 4. Story intake: one path

There is exactly one intake path. Do not offer alternatives.

1. **Let the human narrate.** Ask them, in one short sentence, to tell you
   the story they want to build, in their own words, as much or as little
   as they have. Then stop and listen.
2. **Extract silently.** From the narration, pull out as much of this as
   is actually there:
   - a working title, if one is implied
   - comic size and approximate page count, if stated
   - the characters: who they are, how they look, what distinguishes them
   - the props/objects that matter to the story
   - the scenes/places, and what each place is like
   - the story arc: where it starts, what changes, how it ends
     Do not invent details the narration does not support and present them
     as the human's. Guesses you need in order to proceed are assumptions —
     label them as yours when you report back.
3. **Repeat back what you structured.** Show the human, briefly and in
   plain language (not as a data table of fields): the story as you
   understood it, the characters, props, and scenes you found, and the
   shape of the arc. This is their cheap chance to correct you.
4. **Ask only for what is missing.** Note what is still blank, then ask
   about it conversationally — **one focused question at a time**, not a
   batch of questions. Fill that gap, then ask the next, if there is one.
   If nothing essential is missing, ask nothing and proceed.

   **Which gaps to ask about, and which to assume.** Not every blank is
   a question. Ask — one at a time, per step 4 — only about things
   other stored prompts will have to refer to, or that cannot be
   changed cheaply later: a main character's appearance; a location
   the story turns on (where something is hidden, found, or left); the
   contents of anything shown in close-up that another entry's prompt
   must describe (a photograph, a portrait, a letter's drawing); and
   whether a named person actually appears on a page or is only
   mentioned. Assume and label the rest — a minor prop's colour or
   material, non-recurring background detail, small clothing details —
   state the assumption in your repeat-back (step 3) so the human can
   correct it without being interrogated about it. Length, page size,
   and visual style are neither questions nor silent assumptions:
   propose them, per step 5, and let the human react to the proposal.

5. **Map the arc onto pages, and settle the page size.** If the human
   gave a page count (for example, 25 pages), break the arc into that
   many pages at a high level: what happens on each page, and roughly
   what panels each page needs. If they gave no count, propose one from
   the size of the story — using the beat count as the yardstick: one
   page holds roughly one to five beats (section 7), so divide the
   arc's beats by that range and propose a count inside it — and say
   it is your proposal. Likewise, if they
   gave no page size, propose one now — the physical size is needed in
   the next section, and this is where it legitimately comes from.
6. **Check the map with the human.** Gently ask whether those pages and
   panels make sense. Iterate in conversation — change the map, not the
   project — until they are content. Only then create the project and
   start storing prompts.

Do not generate any image, and do not store any prompt, until steps 3–6
have happened. A comic planned in conversation is cheap to change; a
comic generated from an unconfirmed plan is not.

## 5. Create the project — after intake

Now, and only now, create the project (search api.txt for the storage
functions):

- Use the page size settled in section 4. If you create a project without
  choosing a size, a default size applies, and changing size later
  changes every panel's proportions and makes sized art stale.
- A project has a title: use the working title from intake.
- **A new project already contains one page: its cover page, with one
  panel.** That first page is the cover — it is not story page 1. Plan
  it as a cover (title, one strong image; lettering for a cover is still
  bubbles/text, never baked into the art, section 12), and create your
  story pages after it. Do not put the story's first page onto the cover
  page, and do not create a duplicate cover.
- Everything that follows in this file happens inside this open project.
  Nothing in sections 6–13 works without one.
- Tell the human, once: they can log into the VibeComics website
  themselves and open this project there to watch it fill in as you
  work, without waiting for your report (section 14). Seeing it is a
  cheap way for them to catch something they want changed early and
  tell you, rather than after a whole page is done.

## 6. The story bible and the prompts — exactly where each prompt lives

The story bible is the project's reusable truth: its style, its
characters, its props/objects, and its scenes. This section mirrors how
the project is actually structured. Do not invent prompt fields that are
not here.

**There are no page prompts and no panel prompts.** Pages and panels are
structure — a title, a layout, a position. Their planning lives in your
conversation with the human (section 4) and is folded into layer prompts
and bible entries when you store it.

The prompts that exist are these — read the list carefully, because two
different kinds of things are on it:

**Shared prompts (stored once, in the project's metadata):**

- **Comic style prompt** — one, for the whole comic. A short paragraph
  covering medium and technique, line, palette, lighting, mood/era, and
  level of detail. Stitched, word for word, into _every_ image prompt
  in the book, of every kind. Write it once, concretely, and do not
  change it casually: changing it makes every image in the book stale.
- **Character style addendum** — one, shared by _all characters only_.
  Design language that only makes sense for a figure (eye style,
  proportions, how skin tones are rendered). It is stitched _only_ into
  character prompts — a character's reference art, and a foreground layer
  whose subject is a character — right after the comic style prompt.
  Write one only if there is genuinely figure-only language to put in
  it; if there is not, leave it empty. An empty addendum contributes
  nothing when stitched.
- **Scene style addendum** — one, shared by _all scenes only_. Rendering
  notes specific to places and backgrounds (level of detail, atmosphere).
  Stitched _only_ into scene prompts — a scene's reference art, and a
  background layer — right after the comic style prompt. Same rule:
  write one only if there is genuinely scene-only language; otherwise
  leave it empty.
- **There is no object addendum**, by design. Objects stitch neither
  addendum — putting figure language into an object's prompt is how a
  person ends up drawn standing next to a prop.

**Per-entry prompts (stored on each bible entry itself):**

- **Character prompt** — one per character, specific to that character
  only. It is that character's own stored description: age, build, face,
  hair, skin tone, outfit and its colours, distinguishing marks, and
  continuity notes ("scar on the left cheek", "always carries the red
  satchel"). Two characters never share one.
- **Object/prop prompt** — one per object, specific to that object only:
  its own stored description — shape, size, colour, material, and wear.
- **Scene prompt** — one per scene, specific to that scene only: its own
  stored description — layout, time of day, materials, colours, and the
  light in that place.
- **Variations** — a character, object, or scene may have variations:
  one pose or state each (front / back / side views for a character; a
  night state for a scene). Each variation has its own short prompt,
  which is stitched _after_ that entry's own description — and, for a
  variation's own image, _last_ of all, after the technical requirements
  (section 9) — and each variation holds its own reference images.
  Write variation prompts defensively: a back view must say that no face
  or front-facing features are visible, or a generator may blend them in.
- **Layer prompts** — one per layer, written in section 8.
- **Background scene prompt** — a background layer has no separate prompt
  of its own kind. Its setting comes from the scene it points to: that
  scene's own prompt (its description), plus the background layer's own
  layer prompt saying what this particular view of the scene shows.

A worked miniature, so lengths and specificity are anchored. A character
entry's prompt is a paragraph like: _"Tomas, 58, lighthouse keeper.
Short, broad, weather-lined face, grey stubble, deep squint lines. Navy
oilskin coat over a cream fisherman's sweater, every day. Brass lamp key
on a cord around his neck. Left thumb missing its tip."_ — look, outfit,
marks, continuity prop, nothing about where he is or what he is doing:
pose and place belong to variations and layer prompts, not here.

Building the bible, in order:

1. Set the comic style prompt from the brief agreed in section 4. Set
   the character and scene style addenda only if section 6's tests for
   them are met; otherwise leave them empty on purpose.
2. Create one bible entry per character, prop/object, and scene you
   extracted, with its specific prompt as its description. Link entries
   that belong together where the project supports links (which
   characters belong in which scenes, and so on) — search the API
   documentation for how entries link.
3. Handle variations — knowing what the tool does for you:
   - **Creating a character automatically seeds three variations: Front
     view, Back view, Side view.** You did not add them; they are
     already there. List the new character's variations, tighten each
     seeded variation's prompt for this character, and **delete the
     seeded variations the story will never show** rather than
     generating art for them.
   - Scenes and objects get **no** seeded variations. Add only the
     variations the story actually needs.
   - A state that will recur (a scene at night, in scene after scene)
     belongs in a variation of that scene. A one-off condition that
     happens once belongs in that one layer's prompt instead.
   - **Crowds and extras:** a group that is never individually named or
     focused (market crowd, crew, townspeople as a body) may be one
     character entry whose prompt describes the group collectively.
     Anyone who recurs, speaks, or is seen close up gets their own
     entry — do not stretch a group entry over a real character.
   - **A person who never appears on a page** (dead before the story
     starts, spoken of but never shown): still create their bible entry
     if other entries' prompts refer to them (their belongings, their
     portrait's sitter) — but generate **no** reference art and **no**
     variations' art for them unless a page will actually show them
     (a portrait or a flashback does count as showing them).
   - **Fixture props — a place that is also a thing.** Some story
     elements are both a location and an object: a little free library
     box, a sign, a statue — fixed in one place, but also framed in
     close-up, opened, filled, or handled. Model the thing as an
     **object** entry (so it can be a foreground subject, be reused,
     and hold variations for its states), and model its location —
     the corner, the square, the room it stands in — as the **scene**.
     Do not make the fixture itself the scene: a background cannot be
     picked out in close-up the way a layered object can.
   - **People shown only inside something else.** A person who appears
     only inside an artefact — a photograph, a portrait, a poster, a
     screen — gets a bible entry if other prompts refer to them (per
     the never-appears rule above), but generate **no** standalone
     reference art and no variations for them. Their depiction lives
     on the artefact's own entry: the photograph/portrait object is
     generated in bible-first order (section 10) like any other entry,
     and its prompt carries the embedded person's description. Only if
     the person later appears directly on a page do they get their own
     reference art. This refines the rule above: an embedded depiction
     counts as "showing" the person for entry-creation purposes, not
     for standalone-art purposes.
4. If the human already has reference images for an entry, use theirs.
   Look before you generate your own.
5. Show the human the bible briefly — style, and each entry in a line —
   and let them correct it before any reference image is generated.

## 7. Planning pages and panels

Pages and panels are structure. Plan them from the page map the human
approved in section 4. Remember the project already has its cover page
(section 5): your story pages are created after it, in story order, each
with a short title that says what the page is.

- Every new page starts as a single whole-page panel. Cut it into the
  layout the page needs (search the API documentation for the panel
  split and resize functions). Give each panel a short title.
- Choose layouts that serve the beats: a large panel for an establishing
  shot or a dramatic moment; small panels for quick action or dialogue;
  a tall panel for a fall or a reveal; a wide one for a landscape. Vary
  size and shape from page to page; avoid a uniform grid unless that is
  the agreed style.
- Avoid more than one full page-height panel on a page. One tall panel
  reads fine for a fall or a reveal; several side by side are hard to
  generate art for (each is an awkward, elongated crop) and hard for the
  reader's eye to follow. If a page wants more than one dramatic moment,
  give them mixed heights instead of stacking full-height panels.
- Decide the camera per panel — wide, medium, close-up, high or low
  angle — and change it between neighbouring panels. Keep screen
  direction consistent: do not flip who stands on the left without a
  story reason.
- Plan where the words will go now, not later: leave calm space (sky,
  wall, floor) in some panel for bubbles, away from faces and the key
  action.
- One page typically holds one to five story beats. If a page in your
  map holds more, it is probably two pages.

You are done planning a page when every beat in the approved map has a
panel, and every panel has a title and a camera in your notes.

## 8. Building layers and writing layer prompts

Inside each panel, the art is layers. Build all of a comic's layers as
prompts first, before generating the layers' images.

For each panel:

1. Add **one background layer**: the setting, at the bottom of the stack,
   filling the panel. **Point it to its scene** — a background layer is
   associated with the scene it is the setting of, using the layer's
   scene link (search the API documentation for the layer fields). Pin
   the scene's variation instead, if this panel shows a specific state
   of that scene (its night state, for example).
2. Add **one foreground layer per character or prop** that appears in
   the panel, so each can be moved, sized, and reused separately.
   **Point each foreground layer to its character or prop**, using the
   layer's subject link, and **pin the variation** that matches what
   the layer shows (side view for a figure in profile, back view for a
   figure seen from behind, front view otherwise). A layer that points
   nowhere has no reference images when it is generated — see section 9.
3. Name every layer clearly ("Tomas, climbing", "Harbour background").
   Names are how you, the human, and the editor's image picker find
   things later.
4. Write **the layer prompt** in each layer while it is still empty.
   A layer prompt says only what belongs to this one image:
   - foreground: the pose, action, expression, and gaze of that one
     subject — and nothing about where it is. Never describe the place
     in a foreground layer prompt (see section 9 for why). When a panel
     holds more than one character, write the blocking into each one's
     own layer prompt, not just the gaze: where that character is
     looking, what they are doing, and how they relate to the others in
     the panel (facing each other, back to back, one looking past the
     other at something off-panel). This is deliberately not a rule
     that everyone faces one way — some panels want that, some want
     attention split or deliberately mismatched. The point is that you
     decided the direction on purpose, not that it was left to chance.
   - background: what this view of the scene shows — the part of the
     place in frame, the time, where characters will stand, where
     bubbles will sit.
     Do not repeat the character's, prop's, or scene's description in the
     layer prompt. That description is stored once, in the bible, and is
     stitched in automatically (section 9). Repeating it here creates two
     versions of the truth, and they will drift apart. The same rule
     runs the other way: if a detail turns out to repeat across more
     than one image of the same character, prop, or scene (a scar, a
     prop they always carry, a limp), it does not belong scattered
     across layer prompts — move it into that entry's own bible
     description (section 6) instead, so every prompt that uses the
     entry carries it automatically.

A layer with a prompt and no image is a plan, not a failure. The whole
comic should exist in this prompt-only state, and be checkable by the
human in the editor, before section 10 generates anything beyond
reference art.

## 9. How image prompts are stitched together

You do not write a final image prompt from scratch, and you do not
improvise one in this conversation. Each image's prompt is **stitched,
in a fixed order, from the stored parts** — which is exactly why the
parts are stored once, verbatim, and why editing a part fixes every
image stitched from it afterwards.

Recipes below are the one canonical version. Note where the two shared
addenda from section 6 appear: the character style addendum goes only
into character prompts, the scene style addendum only into scene and
background prompts, and objects get neither. If an addendum is empty, it
contributes nothing and the recipe is otherwise unchanged.

Use the stitching the project itself provides — never reassemble it by
hand. The function to call is specific to what you are stitching:
`generate.layerPrompt()` for a layer or background (its
`layerPromptParts` sibling returns the same prompt as labeled pieces, if
you need to inspect or edit one), `generate.referencePrompt()` for a
bible entry's reference art, and `generate.variationPrompt()` for a
variation's own image (each has a `...Parts` sibling too). The
**technical requirements** that close every recipe are the line those
functions return for that kind of image; do not write your own version
of that line, and do not paraphrase theirs. (Before a project exists —
for example, while showing the human an example during intake — you
cannot call those functions, so present any early example as parts, with
the technical line shown as a placeholder, never as an invented quote.)
If you generate an image with a tool outside the CLI, reproduce the same
order yourself, using the technical line the project returns.

**A bible entry's reference image** (no variation involved), in order:

1. the comic style prompt, verbatim
2. the kind's addendum, if any: character style for a character, scene
   style for a scene, neither for an object
3. that entry's own prompt — its description, verbatim
4. the technical requirements for that kind of image
   Then, **for a variation's image**, that variation's own prompt is
   stitched in last, after the technical requirements.

**A foreground layer's image**, in order:

1. the comic style prompt, verbatim
2. the character style addendum — _only if the subject is a character_;
   a prop/object subject gets no addendum
3. the linked character's or prop's own prompt, verbatim — from the
   layer's subject link
4. the layer prompt — only what the subject is doing, never where it is
5. the technical requirements for a foreground image
   Reference images sent with it are resolved from the layer's links: the
   layer's own images first, then the linked entry's — and if the layer is
   pinned to a variation, that variation's images are the default
   references. A foreground prompt deliberately contains **no** scene
   description and no place language at all: generators draw a full scene
   the moment place language appears, even if it is labelled "for context
   only", and a foreground image must be an isolated subject.

**A background layer's image**, in order:

1. the comic style prompt, verbatim
2. the scene style addendum
3. the linked scene's own prompt — the background scene prompt — verbatim,
   from the layer's scene link
4. the layer prompt — what this view of the scene shows
5. the technical requirements for a background image
   Reference images are resolved from the linked scene (and its pinned
   variation) the same way as for a foreground layer.

A worked example of one stitched foreground prompt, parts labelled:

- _Style:_ "Inked line art with flat colour, muted harbour palette of
  slate, tar-black and rope-brown, soft overcast light, quiet
  melancholic mood, simple iconic shapes."
- _Character style:_ "Faces drawn with heavy-lidded eyes and unlined
  skin; hands oversized and expressive."
- _Character:_ [the Tomas paragraph from section 6, word for word]
- _Layer prompt:_ "Climbing the lighthouse stairs, body in profile,
  looking up, lamp key swinging from his neck cord."
- _Technical requirements:_ [the line returned by the prompt-parts
  function for this layer — not written by hand]

Two stitching rules that apply to every recipe:

- **Verbatim means verbatim.** Never paraphrase a stored description or
  addendum when it is stitched. A reworded character is, to the
  generator, a different character.
- **Match across the panel.** Lighting direction, palette, and scale
  must agree between a panel's background and its foregrounds. Say the
  matching light in the layer prompt ("low sun from the left") when it
  is not already in the stored parts — that is layer-prompt information,
  not place description.

## 10. Generation order: check the generator, bible first, then layers

Generate in this order. Do not skip ahead.

**Phase 0 — check a generator exists.** Before generating anything,
check whether an image generator is configured for the CLI (search the
API documentation for the generation-configuration functions, and test
the connection if it provides a test). Three outcomes:

- A generator is configured and reachable: proceed, and let it do the
  stitching (section 9).
- None is configured: **stop and tell the human.** Either they configure
  one (the configuration lives with the CLI, and the documentation for
  it is in api.txt), or they agree that you will generate with a tool of
  your own and register the results. Do not discover this at the first
  failed generation — "no generator configured" is a setup problem, not
  a generation failure, and it will reject every generation call alike.
- You are generating externally by agreement: follow the standing rule
  directly below — every prompt is fetched from the API, assembled by
  the project, never stitched by hand.

**Fetch every prompt from the API. Never write one yourself, and never
hand-stitch one — even from parts you just read back.** Section 9 names
the exact functions: `generate.layerPrompt()` / `generate.layerPromptParts()`
for layers and backgrounds, `generate.referencePrompt()` and
`generate.variationPrompt()` for bible art. Calling them is what makes
the prompt you generate from byte-for-byte what the project stores,
instead of your reconstruction of it. A prompt copied from a plan, a
brief, or your memory drifts from what the project contains, and that
drift is where wrong images come from.

Work from the API's list, not from your own:

1. Ask the API what is outstanding with `generate.pending()`. It lists
   every layer and background that has a prompt but no image yet; its
   sibling does the same for story-bible reference art.
2. For each outstanding item, fetch its assembled prompt with
   `generate.layerPrompt()` (or `generate.referencePrompt()` /
   `generate.variationPrompt()` for bible art). Fetch the item's
   default reference images the same way (search api.txt for
   "layerReferences" and "entryReferences").
3. Generate with those exact words and those references — bible
   reference art first, before any layer images, per the order above.
4. Upload the finished image and attach it to the layer or entry it
   belongs to (search api.txt for the media upload calls), then call
   `generate.pending()` again. Repeat until the list is empty.

If a prompt is wrong, fix the stored piece — the layer's prompt, the
entry's description, the metadata style prompt — and fetch again.
Never patch the assembled prompt on your side and generate from the
patch: the next fetch resurrects the original error, and the project
and its images silently disagree.

One gap to check on bible art: the prompt parts returned for
reference and variation art can omit the character or scene style
addendum stored in the project metadata (section 9's recipes include
it; see the api.txt corrections list). Before generating bible art
from fetched parts, confirm the addendum is there; if it is missing,
append the metadata addendum for that entry kind to the joined prompt.

Concurrency: fetching prompts and generating images are reads and
independent work — they parallelise freely. Attaching results does
not: every change rewrites the whole project, so uploads are attached
one writer at a time, in order.

**Phase 1 — bible reference art first.** Generate the images for the
characters, props/objects, and scenes — including their variations —
before you generate a single layer image.

- Why: a layer's reference images are resolved from the entry and
  variation it points to. If those images do not exist yet, the layer is
  generated with nothing to anchor it, and its subject will not match
  the same subject in any other panel.
- Generate each entry's general reference image, then each variation's
  image (search the API documentation for the generation functions for
  entries and for variations, and for how a generated image is reviewed
  and then committed to an entry or a variation — generation alone does
  not always attach it). To review an image, fetch it to a file with the
  media download function (search api.txt for it) and look at the file —
  that, not a filename or an id, is how a CLI agent sees art.
- Review each reference image against its entry's own prompt before
  committing it. A wrong reference image poisons every layer that uses
  it; a wrong layer image poisons only that layer.
- **How variation references really behave.** When a variation that has no
  images of its own yet is generated, the default reference set falls back
  to the entry's own pose-neutral images only — never another variation's.
  The app deliberately excludes other variations' images from that
  fallback, because a front view's image sent while generating a back view
  would mislead the model about facing (a face appearing on a "back view").
  So you do not need to pass references explicitly to avoid that: the
  default is already safe. Once a variation has images of its own, the
  default set is its own images.
- Skip art the story never shows: no reference art for an entry the
  human never sees on a page (see section 6), and no art for a seeded
  character variation you deleted.

**Phase 2 — layer images.** Only when the bible's reference art exists:

- Preview before you batch. The API documentation describes functions
  that list everything still needing generation, for layers and for
  bible entries separately, without generating anything. Use them, show
  the human the size of the batch if it is large, then generate.
- Generate each layer from its stitched prompt (section 9) with its
  resolved reference images. If you generate outside the CLI, hand the
  generator the stitched prompt and those same references, then register
  and attach what it returns using the media and layer functions in the
  API documentation.
- Reuse before you regenerate. The same subject, in the same pose, in
  several panels, is one image placed in each of those layers — not a
  new generation per panel. Reuse is the main thing keeping a long comic
  consistent, and it keeps the generation count down.
- If you upload image files yourself, each image also needs the small
  thumbnail the editor uses to list images — search the API
  documentation for what an upload requires. An image without one makes
  the editor download the full image just to display the list.

## 11. Composing each panel

Generation gives you images; composition makes them a panel.

- Stacking order is bottom to top: the background, then things behind
  the characters, then the characters, then things in front of them.
  Bubbles always sit above every layer (section 12).
- Place and size each foreground layer so the panel reads: the focal
  subject clear, overlaps used for depth, nothing important cropped by
  the panel edge unless the crop is the point. A layer keeps its
  proportions; only its position, size, rotation, and mirroring change
  (search the API documentation for the layer fields and the move/flip
  functions).
- Check each composed panel for scale and grounding: a character's size
  against doors, furniture, and other characters must agree with the
  neighbouring panels, and feet must meet the ground the background
  implies. To check, fetch the panel's images to files and look at them
  (section 10, Phase 1, says how).
- Do a first pass over a whole page, not panel-by-panel perfection: get
  every panel composed, then letter it, then review the page as a page
  (section 13).

## 12. Lettering: bubbles and captions

Words are not baked into generated images; they are added afterwards,
with the bubble functions of each panel (search the API documentation
for the bubbles section). One exception process, for words that exist
_inside_ the story world, is at the end of this section.

- **You will usually have to write the dialogue yourself.** A human's
  narration gives you story beats, not lines. Draft each page's dialogue
  and captions from its beats, keep them short, and show the draft lines
  to the human as part of checking that page — before or as you letter
  it. Do not present invented dialogue as if the human wrote it.
- **Speech** bubbles for dialogue, **thought** bubbles for inner voice,
  **shout** bubbles for yelling, screams, and loud effects, **captions**
  for narration and scene labels. These four kinds are what the project
  supports; do not invent others.
- Keep each bubble's text short — a dozen words is a lot. Split a long
  speech across several bubbles.
- Add bubbles in reading order, top-left to bottom-right. Aim each
  bubble's pointer at its speaker, and keep bubbles off faces and off
  the key action — use the calm space you planned in section 7.
- Make each bubble big enough that its text stays legible; the text is
  scaled to fit the bubble, so a small bubble means small words.
- Sound effects that are part of the art are not bubble text: if one is
  needed, it is a foreground layer of lettering-as-art, prompted and
  generated like any other foreground layer.
- **Words inside the story world** (a name pencilled on a lid, a shop
  sign, a letter): image generators render exact lettering badly, so do
  not rely on a generated image for words the reader must be able to
  read. Prompt the object _without_ legible text (a blank label, faint
  pencil marks), and carry the actual wording in a caption or in the
  repeat-back to the human. Only if the human insists the words be in
  the art itself, warn them it may come out garbled and need retries.

## 13. Review, check, and fix at the source

Review every page before you call the comic done. To review a page,
fetch its panels' images to files and look at them (the media download
function, section 10); reading back prompts and structure alone does not
show you a broken image.

What to look at, per page:

- **Continuity:** each character's face, hair, outfit, proportions, and
  colours match their bible entry and the previous page; props look the
  same each time they appear.
- **Foreground quality:** no leftover background, boxes, or halos around
  a cut-out subject.
- **Lighting, scale, grounding:** foregrounds match their background's
  light; nothing floats; sizes agree across panels.
- **Framing and flow:** panels read in the intended order; the camera
  varies; nothing important sits under a bubble.
- **Lettering:** legible, correctly spelled, in reading order, pointers
  aimed at the right speaker, and the lines are the ones the human
  approved or saw in draft.

Then run the project's own checks:

- The API documentation describes a project check (lint) function and
  the pending-generation lists. Run the check, fix every error, then
  the warnings, and run it again until it reports no errors. Typical
  findings: a layer pointing at an entry that no longer exists, an image
  that is not what its layer says, two entries with the same name, an
  image with no thumbnail, a layer that does not say which character,
  prop, or scene it shows.
- A thing with a stored prompt but a stale or missing image is tracked
  for you (the documentation calls this state "dirty"). After any round
  of prompt edits, list what is dirty — for layers, and separately for
  bible entries — and regenerate exactly that set, bible entries before
  the layers that depend on them.

**Fix at the source, never by patching a single image's prompt.** If an
image is wrong, find which stored part caused it — the layer prompt if
only this image is wrong, the entry's own prompt if every image of that
character, prop, or scene is wrong, the comic style prompt or an
addendum only if the whole book (or every character, or every scene) is
wrong — fix that part, let the prompt re-stitch, and regenerate that one
image. The stored prompts must always describe the image that was
actually produced from them.

If the story itself changes on purpose — a new outfit, an injury, a new
place — do not quietly rewrite history: update the entry's prompt, add
new reference art, and for a lasting change add a new variation or a
new entry, so earlier pages still match their own references.

## 14. Report to the human

When the comic, or an agreed part of it, is done, tell the human:

- what you built — title, page count (saying which page is the cover),
  and the state of each page (planned, generated, lettered, reviewed)
- what you assumed where their narration was silent (from section 4)
- which pages, if any, still have dirty or missing images, or check
  findings you did not fix, and why
- anything you would improve next, in one or two items at most

Do not end with a claim that the comic is finished if any page is still
prompt-only, unlettered, or unchecked. Say which pages those are.

## Never do these

- Never point the human, or yourself, at a github.com source URL for the
  CLI, the API documentation, or this guide. Use the deployed site.
- Never guess a CLI function, argument, or flag. Search the documentation
  — and search the _right_ documentation: the CLI's built-in help for
  CLI-only things like login, api.txt for API functions.
- Never ask the human for a login code. You give the code to the human.
- Never lecture the human about comic structure, forms, or this file.
- Never create a project before story intake, or at a page size nobody
  chose.
- Never write a page prompt or a panel prompt, or hunt for a field for
  one. There is none.
- Never treat a character, prop, or scene prompt as a shared setting.
  Each is specific to its one entry. (The two addenda are the only
  shared prompt text besides the comic style, and each goes only where
  section 9 puts it.)
- Never describe a place in a foreground layer prompt, and never add a
  scene description to a foreground image "for context".
- Never paraphrase a stored description or addendum when a prompt is
  stitched, and never write your own technical-requirements line.
- Never generate a layer image before the bible reference art it depends
  on exists, and never start generating before checking a generator is
  actually configured.
- Never bake words into a generated image. Words are bubbles — see
  section 12 for the one process around words inside the story world.
- Never patch a single wrong image with a one-off prompt. Fix the stored
  part that caused it, re-stitch, regenerate.
