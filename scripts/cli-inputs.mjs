/**
 * How each parameter of every ComicBuilder function is typed on the command
 * line, used by scripts/cli-commands.mjs to generate src/cli/commands.gen.ts.
 * The JSDoc in src/ai/actions.ts supplies each function's description and the
 * name and text of each parameter; this file adds what the JSDoc does not say:
 * how to enter it. Keyed by dotted path without the `ComicBuilder.` prefix.
 *
 * Parameter kinds:
 *   string          single-line text
 *   multiline       multi-line text, passed as the raw string
 *   number          a number
 *   stringOrNumber  text, sent as a number when it is all digits
 *   enum            one of `options` (a <select>)
 *   json            JSON, parsed before the call
 *   file            the path of a local file, sent as a data: URL
 *   object          `fields` (each a kind of its own), given as one flag per
 *                   field (`--title "..."`) or as a JSON object
 *
 * Any string, multiline or json value that starts with `@` is read from that
 * file instead (`@notes.txt`); `@@` is a literal `@`.
 *
 * POSITIONAL (below) lists the functions where only some parameters are
 * positional. Other keys: `optional` (may be left out), `example` (shown in the help),
 * `allowEmpty` (an empty string is a real value), `help` (extra text shown in
 * the help), `flag` (an object field's flag, when it differs from its name) and
 * `fromFile: { param, use: 'name' | 'type' }` (when left out, the value comes
 * from the file given for another parameter: its name or its MIME type).
 *
 * extract-docs.mjs fails the build when this file and the JSDoc disagree about
 * a function's parameters, so the CLI cannot drift from the API.
 */

/**
 * Functions whose command line differs from the JSDoc's parameter order: only
 * the listed parameters are positional (in this order); the rest are flags.
 */
export const POSITIONAL = {
  'media.upload': ['dataUrl'],
  // `page update 2 --prompt "..."`: the page index first, the fields as flags.
  'page.update': ['pageIndex'],
};

const PANEL_ID = { type: 'string', example: 'panel_ab12cd' };
const LAYER_ID = { type: 'string', example: 'layer_ab12cd' };
const BUBBLE_ID = { type: 'string', example: 'bubble_ab12cd' };
const AXIS = { type: 'enum', options: ['horizontal', 'vertical'] };
const IMAGE = { type: 'file', help: 'Path of the image file (PNG, JPEG, WebP or GIF).' };

/** Story bible entries (characters, scenes, objects) share one shape. */
const STORY_ENTRY = {
  get: { id: { type: 'string', example: 'character_ab12cd' } },
  create: {
    input: {
      type: 'json',
      example:
        '{ "name": "Mira", "description": "Teenage girl, short red hair, green raincoat.", "imageIds": [], "linkIds": [] }',
    },
  },
  update: {
    id: { type: 'string', example: 'character_ab12cd' },
    patch: {
      type: 'json',
      example: '{ "description": "New description", "imageIds": ["media_ab12cd"] }',
    },
  },
  delete: { id: { type: 'string', example: 'character_ab12cd' } },
};

/** A page's or panel's intent, stitched into the prompt of the images below it. */
const PAGE_PROMPT = {
  type: 'string',
  optional: true,
  allowEmpty: true,
  help: "The page's intent: what happens on it, its mood and pacing. An empty value clears it.",
  example: 'The chase ends: Mara corners the thief on the rooftop at dusk; tense, fast, few words.',
};
const PANEL_PROMPT = {
  type: 'string',
  optional: true,
  allowEmpty: true,
  help: "The panel's intent: its moment, camera and mood. An empty value clears it.",
  example: 'Low angle, wide: the thief has nowhere left to run.',
};

const PAGE_SIZE = {
  type: 'json',
  example: '{ "label": "US Comic", "widthIn": 6.625, "heightIn": 10.25 }',
};

export const INPUTS = {
  'storage.createProject': {
    name: { type: 'string', example: 'My first comic' },
    pageSize: { ...PAGE_SIZE, optional: true },
  },
  'storage.openProject': { idOrName: { type: 'string', example: 'My first comic' } },
  'storage.connectWithServer': { url: { type: 'string', example: 'http://localhost:4000' } },

  'project.lint': {},
  'project.load': {
    data: { type: 'multiline', example: '{ "id": "…", "title": "…", "pages": [] }' },
  },

  'page.select': { i: { type: 'number', example: '0' } },
  'page.add': {
    input: {
      type: 'object',
      optional: true,
      fields: {
        title: { type: 'string', optional: true, help: 'The page title.' },
        prompt: PAGE_PROMPT,
      },
    },
  },
  'page.update': {
    patch: {
      type: 'object',
      fields: {
        title: { type: 'string', optional: true, help: 'The new page title.' },
        prompt: PAGE_PROMPT,
      },
    },
    pageIndex: { type: 'number', optional: true, example: '2' },
  },

  'page.move': {
    from: { type: 'number', example: '3' },
    to: { type: 'number', example: '1' },
  },

  'panels.list': { pageIndex: { type: 'number', optional: true, example: '0' } },
  'panels.get': { panelId: PANEL_ID },
  'panels.size': { panelId: PANEL_ID },
  'panels.split': {
    panelId: PANEL_ID,
    axis: AXIS,
    position: { type: 'number', optional: true, example: '50' },
  },
  'panels.splitAcross': {
    axis: AXIS,
    position: { type: 'number', example: '50' },
    pageIndex: { type: 'number', optional: true, example: '0' },
  },
  'panels.splitEvenly': { panelId: PANEL_ID, axis: AXIS, count: { type: 'number', example: '3' } },
  'panels.resize': {
    panelId: PANEL_ID,
    edge: { type: 'enum', options: ['top', 'bottom', 'left', 'right'] },
    position: { type: 'number', example: '45' },
  },
  'panels.update': {
    panelId: PANEL_ID,
    patch: {
      type: 'object',
      fields: {
        title: { type: 'string', optional: true, help: 'The new panel title.' },
        prompt: PANEL_PROMPT,
      },
    },
  },
  'panels.delete': { panelId: PANEL_ID },

  'layers.list': { panelId: PANEL_ID },
  'layers.get': { panelId: PANEL_ID, layerId: LAYER_ID },
  'layers.add': {
    panelId: PANEL_ID,
    input: {
      type: 'json',
      example:
        '{ "kind": "background", "name": "Rooftop at dusk", "prompt": "STYLE… A rooftop at dusk…", "aspectRatio": 1.5, "mediaId": "media_ab12cd" }',
    },
  },
  'layers.update': {
    panelId: PANEL_ID,
    layerId: LAYER_ID,
    patch: {
      type: 'json',
      example:
        '{ "mediaId": "media_ab12cd", "subjectId": "char-ab12cd", "sceneId": "scene-ab12cd", "x": 10, "y": 20, "width": 60, "opacity": 1 }',
    },
  },
  'layers.flip': { panelId: PANEL_ID, layerId: LAYER_ID },
  'layers.delete': { panelId: PANEL_ID, layerId: LAYER_ID },
  'layers.size': { panelId: PANEL_ID, layerId: LAYER_ID },
  'layers.move': {
    panelId: PANEL_ID,
    layerId: LAYER_ID,
    to: {
      type: 'stringOrNumber',
      example: 'top',
      help: 'One of top, bottom, up, down, or a 0-based position from the bottom (digits).',
    },
  },

  'bubbles.list': { panelId: PANEL_ID },
  'bubbles.get': { panelId: PANEL_ID, bubbleId: BUBBLE_ID },
  'bubbles.add': {
    panelId: PANEL_ID,
    input: {
      type: 'json',
      example:
        '{ "kind": "speech", "text": "Hello!", "x": 10, "y": 10, "width": 40, "height": 20 }',
    },
  },
  'bubbles.update': {
    panelId: PANEL_ID,
    bubbleId: BUBBLE_ID,
    patch: { type: 'json', example: '{ "text": "New text", "tailX": 30, "tailY": 60 }' },
  },
  'bubbles.delete': { panelId: PANEL_ID, bubbleId: BUBBLE_ID },

  'metadata.setStyle': { text: { type: 'multiline', allowEmpty: true } },
  'metadata.setPageSize': { pageSize: PAGE_SIZE },

  'characters.get': STORY_ENTRY.get,
  'characters.create': STORY_ENTRY.create,
  'characters.update': STORY_ENTRY.update,
  'characters.delete': STORY_ENTRY.delete,
  'characters.generateImage': {
    id: { type: 'string', example: 'character_ab12cd' },
    prompt: { type: 'multiline', optional: true, allowEmpty: true },
    references: {
      type: 'json',
      optional: true,
      example: '[{ "mediaId": "media_ab12cd", "note": "use this outfit" }]',
    },
  },
  'scenes.get': { id: { type: 'string', example: 'scene_ab12cd' } },
  'scenes.create': STORY_ENTRY.create,
  'scenes.update': { ...STORY_ENTRY.update, id: { type: 'string', example: 'scene_ab12cd' } },
  'scenes.delete': { id: { type: 'string', example: 'scene_ab12cd' } },
  'scenes.generateImage': {
    id: { type: 'string', example: 'scene_ab12cd' },
    prompt: { type: 'multiline', optional: true, allowEmpty: true },
    references: {
      type: 'json',
      optional: true,
      example: '[{ "mediaId": "media_ab12cd", "note": "use this outfit" }]',
    },
  },
  'objects.get': { id: { type: 'string', example: 'object_ab12cd' } },
  'objects.create': STORY_ENTRY.create,
  'objects.update': { ...STORY_ENTRY.update, id: { type: 'string', example: 'object_ab12cd' } },
  'objects.delete': { id: { type: 'string', example: 'object_ab12cd' } },
  'objects.generateImage': {
    id: { type: 'string', example: 'object_ab12cd' },
    prompt: { type: 'multiline', optional: true, allowEmpty: true },
    references: {
      type: 'json',
      optional: true,
      example: '[{ "mediaId": "media_ab12cd", "note": "use this outfit" }]',
    },
  },

  'media.get': { id: { type: 'string', example: 'media_ab12cd' } },
  'media.download': { id: { type: 'string', example: 'media_ab12cd' } },
  'media.upload': {
    name: {
      type: 'string',
      optional: true,
      example: 'hero-front.png',
      help: "Left out, the file's own name is used.",
      fromFile: { param: 'dataUrl', use: 'name' },
    },
    dataUrl: IMAGE,
    opts: {
      type: 'object',
      optional: true,
      fields: {
        mimeType: {
          type: 'string',
          optional: true,
          example: 'image/png',
          help: "Left out, the file's type is used (from its extension).",
          fromFile: { param: 'dataUrl', use: 'type' },
        },
        subjectId: {
          type: 'string',
          optional: true,
          flag: 'subject',
          example: 'char-ab12cd',
          help: 'Id of the character or object this image is art of (not reference art).',
        },
        sceneId: {
          type: 'string',
          optional: true,
          flag: 'scene',
          example: 'scene-ab12cd',
          help: 'Id of the scene this image is art of, for a background (not reference art).',
        },
        thumbnailDataUrl: {
          ...IMAGE,
          optional: true,
          flag: 'thumbnail',
          help: 'Path of a thumbnail: the image resized to about 256px on its long side (PNG if it has transparency, else JPEG). Strongly recommended: the CLI cannot make one itself, and an image without one is slow to list in the editor.',
        },
      },
    },
  },
  'media.update': {
    id: { type: 'string', example: 'media_ab12cd' },
    patch: {
      type: 'json',
      example: '{ "name": "mara-running.png", "subjectId": "char-ab12cd", "sceneId": null }',
    },
  },
  'media.uploadThumbnail': { id: { type: 'string', example: 'media_ab12cd' }, dataUrl: IMAGE },
  'media.delete': { id: { type: 'string', example: 'media_ab12cd' } },

  'generate.layer': {
    panelId: PANEL_ID,
    layerId: LAYER_ID,
    prompt: { type: 'multiline', optional: true, allowEmpty: true },
    references: {
      type: 'json',
      optional: true,
      example: '[{ "mediaId": "media_ab12cd", "note": "use this outfit" }]',
    },
  },
  'generate.cancelLayer': { panelId: PANEL_ID, layerId: LAYER_ID },
  'generate.layerReferences': { panelId: PANEL_ID, layerId: LAYER_ID },
  'generate.entryReferences': {
    kind: { type: 'enum', options: ['characters', 'scenes', 'objects'] },
    id: { type: 'string', example: 'character_ab12cd' },
  },
  'generate.cancelReference': {
    kind: { type: 'enum', options: ['characters', 'scenes', 'objects'] },
    id: { type: 'string', example: 'character_ab12cd' },
  },
  'generate.maxReferenceImages': {},
  'generate.layerPrompt': { panelId: PANEL_ID, layerId: LAYER_ID },
  'generate.layerPromptParts': { panelId: PANEL_ID, layerId: LAYER_ID },
  'generate.pending': {},
  'generate.dirty': {},
  'generate.getConfig': {},
  'generate.setConfig': {
    config: {
      type: 'json',
      example: '@comfy-config.json',
      help: 'The generator config, usually kept in a file: { "provider": "comfy", "comfy": { "baseUrl": "http://localhost:8188", "workflow": { ... }, "nodes": { "positivePromptNodeId": "6", "outputNodeId": "9" } } }.',
    },
  },
  'generate.testConnection': {},
  'generate.referencePrompt': {
    kind: { type: 'enum', options: ['characters', 'scenes', 'objects'] },
    id: { type: 'string', example: 'character_ab12cd' },
  },
  'generate.referencePromptParts': {
    kind: { type: 'enum', options: ['characters', 'scenes', 'objects'] },
    id: { type: 'string', example: 'character_ab12cd' },
  },
  'generate.queue': {},
  'generate.cancelQueueItem': { id: { type: 'string', example: '1' } },
};
