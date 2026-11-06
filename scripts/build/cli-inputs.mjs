/**
 * How each parameter of every ComicBuilder function is typed on the command
 * line, used by scripts/build/cli-commands.mjs to generate src/cli/commands.gen.ts.
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
  // `page update 2 --title "..."`: the page index first, the fields as flags.
  'page.update': ['pageIndex'],
};

const PANEL_ID = { type: 'string', example: 'panel_ab12cd' };
const LAYER_ID = { type: 'string', example: 'layer_ab12cd' };
const BUBBLE_ID = { type: 'string', example: 'bubble_ab12cd' };
const IMAGE = { type: 'file', help: 'Path of the image file (PNG, JPEG, WebP or GIF).' };
const KIND = {
  type: 'enum',
  options: ['characters', 'scenes', 'objects'],
  help: 'Which kind of reference entry.',
};
const ENTRY_ID = { type: 'string', example: 'char_ab12cd' };
const VARIATION_ID = { type: 'string', example: 'var_ab12cd' };
const REFERENCE_LIST = {
  type: 'json',
  optional: true,
  example: '[{ "mediaId": "media_ab12cd", "note": "use this outfit" }]',
};
const PROMPT = { type: 'multiline', optional: true, allowEmpty: true };
const CONNECTION_ID = { type: 'string', example: 's3:http://localhost:9000/my-bucket' };

const PAGE_SIZE = {
  type: 'json',
  example: '{ "label": "US Comic", "widthIn": 6.625, "heightIn": 10.25 }',
};

export const INPUTS = {
  'storage.connect': {
    target: {
      type: 'string',
      example: 's3://accessKey:secretKey@localhost:9000/my-bucket',
      help: '"drive" for Google Drive (it prints a URL and a code for the user), or an s3:// connection string.',
    },
  },
  'storage.disconnect': { id: { ...CONNECTION_ID, optional: true } },
  'storage.listProjects': {
    show: { type: 'json', optional: true, example: 'true' },
  },
  'storage.createProject': {
    name: { type: 'string', example: 'My first comic' },
    pageSize: { ...PAGE_SIZE, optional: true },
    connectionId: { ...CONNECTION_ID, optional: true },
  },
  'storage.openProject': { idOrName: { type: 'string', example: 'My first comic' } },
  'storage.backupTo': { connectionId: CONNECTION_ID },

  'project.lint': {},
  'project.load': {
    data: { type: 'multiline', example: '{ "id": "…", "title": "…", "pages": [] }' },
  },

  'metadata.update': {
    patch: {
      type: 'object',
      fields: {
        style: {
          type: 'multiline',
          optional: true,
          allowEmpty: true,
          help: 'The STYLE paragraph, stitched into every image prompt.',
        },
        characterStyle: {
          type: 'multiline',
          optional: true,
          allowEmpty: true,
          help: 'The CHARACTER STYLE addendum, stitched into character prompts only.',
        },
        sceneStyle: {
          type: 'multiline',
          optional: true,
          allowEmpty: true,
          help: 'The SCENE STYLE addendum, stitched into scene prompts only.',
        },
        pageSize: { ...PAGE_SIZE, optional: true },
      },
    },
  },

  'page.select': { i: { type: 'number', optional: true, example: '0' } },
  'page.add': {
    input: {
      type: 'object',
      optional: true,
      fields: {
        title: { type: 'string', optional: true, help: 'The page title.' },
      },
    },
  },
  'page.update': {
    patch: {
      type: 'object',
      fields: {
        title: { type: 'string', optional: true, help: 'The new page title.' },
      },
    },
    pageIndex: { type: 'number', optional: true, example: '2' },
  },
  'page.move': {
    from: { type: 'number', example: '3' },
    to: { type: 'number', example: '1' },
  },
  'page.preview': {
    open: {
      type: 'json',
      optional: true,
      example: 'false',
      help: 'true (the default) opens, false closes.',
    },
  },

  'panels.list': { pageIndex: { type: 'number', optional: true, example: '0' } },
  'panels.get': { panelId: PANEL_ID },
  'panels.split': {
    opts: {
      type: 'object',
      fields: {
        axis: {
          type: 'enum',
          options: ['horizontal', 'vertical'],
          help: 'horizontal: a horizontal line (rows); vertical: a vertical line (columns).',
        },
        panelId: {
          type: 'string',
          optional: true,
          example: 'panel_ab12cd',
          help: 'The panel to cut. Leave out to cut every panel along a line across the whole page.',
        },
        position: {
          type: 'number',
          optional: true,
          example: '50',
          help: 'Where the line falls, 0-100 (% of the panel, or of the page without --panelId). Default 50 for one panel; required across the page.',
        },
        count: {
          type: 'number',
          optional: true,
          example: '3',
          help: 'Cut the panel into this many equal parts (needs --panelId; not with --position).',
        },
        pageIndex: {
          type: 'number',
          optional: true,
          example: '0',
          help: 'Only for a line across the page: which page (default the current one).',
        },
      },
    },
  },
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
        prompt: {
          type: 'multiline',
          optional: true,
          help: 'Direction for the whole panel (action, mood, lighting, time of day), used for the panel image. A blank value clears it.',
        },
        mediaId: {
          type: 'string',
          optional: true,
          example: 'media_ab12cd',
          help: 'Set the panel image to this media id (from "media upload" or "media list"). To remove it, pass JSON: --patch \'{"mediaId":null}\'.',
        },
        imageVisible: {
          type: 'json',
          optional: true,
          example: 'true',
          help: 'true shows the panel image, false hides it (the layers show again).',
        },
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
        '{ "mediaId": "media_ab12cd", "subjectId": "char-ab12cd", "sceneId": "scene-ab12cd", "x": 10, "y": 20, "width": 60, "opacity": 1, "flipX": true, "order": "top" }',
      help: 'order is "top", "bottom", "up", "down", or a 0-based position from the bottom.',
    },
  },
  'layers.delete': { panelId: PANEL_ID, layerId: LAYER_ID },

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

  'reference.list': { kind: { ...KIND, optional: true } },
  'reference.get': { kind: KIND, id: ENTRY_ID },
  'reference.create': {
    kind: KIND,
    input: {
      type: 'json',
      example:
        '{ "name": "Mira", "description": "Teenage girl, short red hair, green raincoat.", "imageIds": [], "linkIds": [] }',
    },
  },
  'reference.update': {
    kind: KIND,
    id: ENTRY_ID,
    patch: {
      type: 'json',
      example: '{ "description": "New description", "imageIds": ["media_ab12cd"] }',
    },
  },
  'reference.delete': { kind: KIND, id: ENTRY_ID },

  'variations.add': {
    kind: KIND,
    entryId: ENTRY_ID,
    input: {
      type: 'json',
      example: '{ "name": "Front view", "prompt": "Front view, facing the camera directly." }',
    },
  },
  'variations.update': {
    kind: KIND,
    entryId: ENTRY_ID,
    variationId: VARIATION_ID,
    patch: {
      type: 'json',
      example: '{ "prompt": "New prompt text", "imageIds": ["media_ab12cd"] }',
    },
  },
  'variations.delete': { kind: KIND, entryId: ENTRY_ID, variationId: VARIATION_ID },

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
      type: 'object',
      fields: {
        name: { type: 'string', optional: true, example: 'mara-running.png' },
        subjectId: {
          type: 'string',
          optional: true,
          flag: 'subject',
          example: 'char-ab12cd',
          help: 'Id of the character or object this image is art of. To clear it, pass JSON: --patch \'{"subjectId":null}\'.',
        },
        sceneId: {
          type: 'string',
          optional: true,
          flag: 'scene',
          example: 'scene-ab12cd',
          help: 'Id of the scene this image is art of. To clear it, pass JSON: --patch \'{"sceneId":null}\'.',
        },
        thumbnailDataUrl: {
          ...IMAGE,
          optional: true,
          flag: 'thumbnail',
          help: 'Path of a new thumbnail: the image resized to about 256px on its long side (PNG if it has transparency, else JPEG).',
        },
      },
    },
  },
  'media.delete': { id: { type: 'string', example: 'media_ab12cd' } },

  'generate.run': {
    target: {
      type: 'string',
      example: 'layer:panel_ab12cd/layer_ab12cd',
      help: 'layer:<panelId>/<layerId>, reference:<kind>/<entryId> or reference:<kind>/<entryId>/<variationId>.',
    },
    prompt: PROMPT,
    references: REFERENCE_LIST,
  },
  'generate.batch': {
    scope: {
      type: 'string',
      example: 'layers',
      help: '"layers" (every dirty layer), "references" (every dirty variation) or reference:<kind>/<entryId>/* (every variation of one entry).',
    },
    options: {
      type: 'object',
      optional: true,
      fields: {
        kinds: {
          type: 'json',
          optional: true,
          example: '["background"]',
          help: 'Restrict "layers" to these layer kinds ("background", "foreground") or "references" to these lists ("characters", "scenes", "objects"). Omit for all.',
        },
        prompt: { type: 'multiline', optional: true, allowEmpty: true },
        references: REFERENCE_LIST,
      },
    },
  },
  'generate.cancel': {
    target: {
      type: 'string',
      example: 'all',
      help: 'A layer or reference target, a queue item id (from "generate status"), or "all".',
    },
  },
  'generate.inspect': {
    target: {
      type: 'string',
      example: 'layer:panel_ab12cd/layer_ab12cd',
      help: 'layer:<panelId>/<layerId>, reference:<kind>/<entryId>[/<variationId>] or panel:<panelId>.',
    },
    includeImages: {
      type: 'json',
      optional: true,
      example: 'false',
      help: 'Panel targets only. false returns the brief without fetching the reference images. By default each image is saved to a file (see --out) and its path is given as "file".',
    },
  },
  'generate.status': {
    scope: {
      type: 'enum',
      optional: true,
      options: ['queue', 'layers', 'references', 'panels'],
      help: 'Default queue.',
    },
  },
  'generate.config': {
    config: {
      type: 'json',
      optional: true,
      example: '@comfy-config.json',
      help: 'The generator config, usually kept in a file: { "provider": "comfy", "comfy": { "baseUrl": "http://localhost:8188", "workflow": { ... }, "nodes": { "positivePromptNodeId": "6", "outputNodeId": "9" } } }. Leave out to read the current one.',
    },
  },
  'generate.test': {},
};
