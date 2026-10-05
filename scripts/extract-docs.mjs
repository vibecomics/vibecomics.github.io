/**
 * Extract the JSDoc from the `ComicBuilder` object literal in src/ai/actions.ts
 * and generate:
 *   - src/ai/actions.docs.gen.ts: ACTION_DOCS (dotted path -> doc string, used
 *     for per-node toString()) and HELP_TEXT (returned by ComicBuilder.help()).
 *   - public/api.txt: HELP_TEXT plus the data model: the API reference for AI agents.
 *   - public/llms.txt: scripts/llms-guide.md, the step-by-step guide to building
 *     a comic (no API details; it points to api.txt and the CLI).
 *   - src/cli/commands.gen.ts: the CLI's command table (docs plus how each
 *     parameter is typed on the command line; see scripts/cli-commands.mjs).
 *
 * Run before tsc/vite: `node scripts/extract-docs.mjs`. Exits 1 when the source
 * cannot be parsed so the docs never go silently stale; nodes without JSDoc are
 * only reported.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { buildCommands } from './cli-commands.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ACTIONS_TS = path.join(ROOT, 'src', 'ai', 'actions.ts');
const GEN_TS = path.join(ROOT, 'src', 'ai', 'actions.docs.gen.ts');
const LLMS_TXT = path.join(ROOT, 'public', 'llms.txt');
const API_TXT = path.join(ROOT, 'public', 'api.txt');
const COMMANDS_TS = path.join(ROOT, 'src', 'cli', 'commands.gen.ts');
const ROOT_NAME = 'ComicBuilder';

const ts = createRequire(path.join(ROOT, 'package.json'))('typescript');

const CONVENTIONS = [
  '- This API is `window.ComicBuilder` in the running app, and the same functions are the',
  '  commands of the `vibecomics` command line (`vibecomics.mjs`, served next to the app; needs',
  '  Node.js 20+; `node vibecomics.mjs <namespace> <function> [arguments]` prints JSON).',
  '  Agents should use the command line: no browser, no injected JavaScript.',
  '- Several storage connections can be live at once, in the browser and on the command line alike:',
  '  `ComicBuilder.storage.connectWithDevice()` adds Google Drive (works from injected scripts, no',
  '  popup or user gesture needed — the same button a human clicks also works for an agent; the',
  '  browser needs this again every page load since the token is never persisted, while the CLI',
  '  keeps the login between runs — `vibecomics auth login` prints a URL and a code for the user to',
  '  approve, `vibecomics auth status` finishes it) and `storage.connectWithServer(url)` adds a',
  '  self-hosted HTTP storage server (any number of these; the browser reconnects its remembered',
  '  ones automatically next page load, the CLI keeps them in its state file between runs). See',
  '  `storage.listConnections()`. A project folder from `storage.listProjects()` carries the',
  '  `connectionId` it came from; pass it to `storage.createProject(name, pageSize, connectionId)`',
  '  when more than one connection is live.',
  '- Except for `storage.*` and `help()`, everything needs an open project. Without',
  '  one, `page.count/select/current` and `layers|bubbles.list/get` return 0 or null,',
  '  and every other call throws "No project is open". Open one with',
  '  `storage.openProject` or `storage.createProject`.',
  '- Reads (`page.select`, `layers.list`, `characters.get`, …) return deep-cloned',
  '  snapshots: inspect them freely, but mutating a snapshot changes nothing.',
  '  All writes go through the action functions.',
  '- A page is a set of panels that tile it, in any proportions; a panel is a',
  '  stack of layers with bubbles on top. Lay a page out with `panels.splitAcross`',
  '  (a line across the whole page), `panels.split` / `splitEvenly` (one panel)',
  '  and `panels.resize` (see the page and panels docs). A panel has no separate background field: the',
  '  background is the layer whose `kind` is `"background"`. It fills the panel,',
  '  sits at the bottom, and is never stretched (a different ratio is cropped).',
  '  Layers are stacked in array order (`layers.move` reorders them).',
  '- A layer has a `prompt` (what its art should show) and optionally an image.',
  '  Suggested workflow: `layers.add({ prompt, aspectRatio })`, read',
  '  `layers.size(panelId, layerId)` for the size to generate at, generate the',
  '  image, `media.upload` it, then `layers.update(..., { mediaId })`.',
  '- IMAGE FORMAT: foreground layers should usually be PNGs with a TRANSPARENT',
  '  background containing only their subject (a character, a prop), so they',
  '  composite over the background. Generate the background as an opaque image',
  "  at exactly the panel's aspect ratio: `panels.size(panelId)` (or",
  '  `layers.size` for the background layer) gives `aspectRatio` and `pixels`.',
  '- Bubbles always render above all layers. Speech, thought and shout bubbles have a',
  '  pointer aimed at `tailX`/`tailY`; the text is scaled to fit the bubble.',
  '- Changes are saved automatically: every minute, and only when something',
  '  changed. `storage.save()` saves immediately. (The command line saves after every command.)',
  '- Two systems can work on one project (the app in a browser, the command line, another',
  '  device). A save checks storage first: if somebody else saved since the project was opened,',
  '  their changes are merged with yours (changes to different things combine) and the merged',
  '  project is saved. If they clash, nothing is saved: the app shows the conflicts for the user',
  '  to settle, and the command line fails and lists them. Fetch the project again and apply the',
  '  change again.',
  '- On Drive, scope is `drive.file`: the app only sees folders and files IT created. Either way,',
  '  `storage.listProjects()` is the complete project list.',
  '- All images live in the project storage (Drive, or a self-hosted server). Upload with',
  '  `media.upload`, then use the returned id as a layer `mediaId` or a character `imageIds`',
  '  entry; layers reject any other image URL.',
  '- Always upload a thumbnail with each image. The media picker lists images by',
  '  thumbnail, and an image without one must be downloaded in full just to appear',
  '  there, which is slow and heavy with many or large images. Resize the image',
  '  yourself to about 256px on the long side (PNG if it has transparency, else JPEG',
  '  at about 85%) and pass it as `media.upload(name, dataUrl, { thumbnailDataUrl })`.',
  '  `media.uploadThumbnail(id, dataUrl)` adds one to an image uploaded without.',
  '  `media.delete(id)` removes an image everywhere it is used.',
  '- A registered image (`media.get(id).fileName`) is not something you can fetch yourself — on',
  '  Drive it needs the access token, kept private to the page. To read an image, call',
  '  `media.download(id)` (it returns a data URL; the command line',
  '  saves it to a file instead, `--out file`); to look at the result on the page in the app,',
  '  `page.openPreview()` and take a screenshot (the command line has no preview). Never',
  '  invent image URLs.',
];

/** How to build a comic (workflow, style, continuity), kept as plain Markdown. */
const LLMS_GUIDE = fs.readFileSync(path.join(ROOT, 'scripts', 'llms-guide.md'), 'utf8').trim();

const SERVED_FILES = [
  '## Files served next to the app',
  '',
  '- `llms.txt`: this guide',
  '- `vibecomics.mjs`: the command line (Node.js 20+): every API function as a command, no browser needed',
  '- `api.txt`: the API reference (also `ComicBuilder.help()` in the running app)',
  '- `schema/comic-project.schema.json`: JSON Schema of the project model',
];

const PAGE_SIZE_PRESET_LINES = readPageSizePresets();

const DATA_MODEL = [
  '## Data model',
  '',
  '- `ComicProject`: `{ id, title, pages[], updatedAt, savedAt, metadata }`: `savedAt` (ISO time of the last save) is required, `updatedAt` optional',
  '- `ComicPage`: `{ id, number, title, panels[] }`: `number` is 0-based and shown as 0, 1, …',
  '- `Panel`: `{ id, title?, x, y, width, height, layers[], bubbles[] }`: `x`/`y`/`width`/`height` are % of the page; the panels of a page tile it with no gaps',
  '- `Layer`: `{ id, name, kind: "background" | "foreground", mediaId?, prompt?, aspectRatio?, visible, x, y, width, rotation (degrees), opacity (0-1), flipX? }`: `mediaId` is the image (omitted while the layer is only a prompt); `aspectRatio` is width / height of its art; `x`/`y`/`width` are % of panel size; aspect ratio preserved, never stretched; `flipX: true` mirrors the image left to right (`layers.flip` toggles it); layers stack in array order, and a `background` layer fills its panel',
  '- `Bubble`: `{ id, kind: "speech" | "thought" | "shout" | "caption", text, x, y, width, height, tailX?, tailY? }`: % of the panel; the text is scaled to fit',
  '- `ProjectMetadata`: `{ outline, pageSize, characters[], scenes[], objects[], media[] }`',
  '- `PageSize`: `{ label, widthIn, heightIn }`; the presets (any custom size with positive widthIn/heightIn also works):',
  ...PAGE_SIZE_PRESET_LINES,
  '- `Character` / `ComicObject`: `{ id, name, description, imageIds[], sceneIds[] }`',
  '- `Scene`: `{ id, name, description, characterIds[], imageIds[] }`',
  '- `MediaItem`: `{ id, name, fileName, mimeType, thumbnailFileName? }`',
  '',
  'Machine-readable schema: `schema/comic-project.schema.json` (JSON Schema, draft 2020-12).',
];

/** The page size presets, read from src/types/comic.ts so they cannot drift. */
function readPageSizePresets() {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'types', 'comic.ts'), 'utf8');
  const presets = [...source.matchAll(/label: '([^']*)', widthIn: ([\d.]+), heightIn: ([\d.]+)/g)];
  if (presets.length === 0) throw new Error('extract-docs: no PAGE_SIZE_PRESETS found in comic.ts');
  return presets.map(
    ([, label, widthIn, heightIn]) =>
      `  - \`{ label: '${label}', widthIn: ${widthIn}, heightIn: ${heightIn} }\``
  );
}

function commentText(comment) {
  if (!comment) return '';
  if (typeof comment === 'string') return comment;
  return comment.map((part) => part.text ?? '').join('');
}

/** Source text of a tag, for tags TypeScript would otherwise split into a `{type}` and a comment. */
function rawTagText(tag, sourceFile) {
  return tag
    .getText(sourceFile)
    .replace(/^@\w+\s*/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trim())
    .join(' ')
    .trim();
}

function readJsDoc(node, sourceFile) {
  const doc = { description: '', params: [], returns: '' };
  for (const block of node.jsDoc ?? []) {
    const description = commentText(block.comment).trim();
    if (description) doc.description += (doc.description ? '\n' : '') + description;
    for (const tag of block.tags ?? []) {
      const tagName = tag.tagName.text;
      if (tagName === 'param') {
        const text = commentText(tag.comment)
          .replace(/^-\s*/, '')
          .replace(/\s*\n\s*/g, ' ');
        doc.params.push([tag.name.getText(sourceFile), text.trim()]);
      } else if (tagName === 'returns' || tagName === 'return') {
        // `@returns { ok, error? }` parses as a type expression; keep the source text instead.
        doc.returns = tag.typeExpression
          ? rawTagText(tag, sourceFile)
          : commentText(tag.comment).trim();
      }
    }
  }
  return doc;
}

function formatDoc({ description, params, returns }) {
  let out = description;
  if (params.length) {
    out += '\n\nParameters:' + params.map(([name, text]) => `\n  * ${name}: ${text}`).join('');
  }
  if (returns) out += `\n\nReturns: ${returns}`;
  return out;
}

function findRoot(sourceFile) {
  let found = null;
  (function walk(node) {
    if (found) return;
    if (ts.isVariableStatement(node)) {
      const [declaration] = node.declarationList.declarations;
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === ROOT_NAME &&
        declaration.initializer &&
        ts.isObjectLiteralExpression(declaration.initializer)
      ) {
        found = { statement: node, literal: declaration.initializer };
        return;
      }
    }
    ts.forEachChild(node, walk);
  })(sourceFile);
  return found;
}

/** Walk the object literal, recording docs by dotted path (in source order). */
function collectDocs(sourceFile, root) {
  const docs = new Map();
  const details = new Map();
  const functions = new Set();
  const undocumented = [];

  function visit(literal, parentPath) {
    for (const member of literal.properties) {
      const isProperty = ts.isPropertyAssignment(member);
      const isMethod = ts.isMethodDeclaration(member);
      if (!isProperty && !isMethod && !ts.isShorthandPropertyAssignment(member)) continue;

      const memberPath = `${parentPath}.${member.name.text}`;
      const doc = readJsDoc(member, sourceFile);
      if (!doc.description) undocumented.push(memberPath);
      docs.set(memberPath, formatDoc(doc));
      details.set(memberPath, doc);

      const value = isProperty ? member.initializer : null;
      if (value && ts.isObjectLiteralExpression(value)) {
        visit(value, memberPath);
      } else if (
        isMethod ||
        (value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))) ||
        doc.returns ||
        doc.params.length
      ) {
        functions.add(memberPath);
      }
    }
  }

  const rootDoc = readJsDoc(root.statement, sourceFile);
  docs.set(ROOT_NAME, formatDoc(rootDoc));
  details.set(ROOT_NAME, rootDoc);
  visit(root.literal, ROOT_NAME);
  return { docs, details, functions, undocumented };
}

/** The skill-style reference: conventions, then one section per namespace. */
function renderReference({ docs, functions }) {
  const paths = [...docs.keys()].filter((p) => p !== ROOT_NAME);
  const isNamespace = (p) => paths.some((other) => other.startsWith(`${p}.`));
  const depth = (p) => p.split('.').length;
  const heading = (p) => `### ${p}${functions.has(p) ? '()' : ''}`;

  const lines = [`# ${ROOT_NAME} — AI command API for VibeComics`, ''];
  const rootDoc = docs.get(ROOT_NAME);
  if (rootDoc) lines.push(`> ${rootDoc.replaceAll('\n', '\n> ')}`, '');
  lines.push(
    'The app exposes this API on `window.ComicBuilder` once it has loaded.',
    'Every UI control calls the same functions: one code path, no drift.',
    'In the browser console (or via automation), start with `ComicBuilder.help()`.',
    'This is the API reference. How to build a comic (workflow, visual style, image',
    'formats, continuity) is in `llms.txt`, served next to the app: read it first.',
    '',
    '## Conventions — read before acting',
    '',
    ...CONVENTIONS,
    ''
  );

  const general = paths.filter((p) => depth(p) === 2 && !isNamespace(p));
  if (general.length) {
    lines.push('## General', '');
    for (const p of general) lines.push(heading(p), '', docs.get(p), '');
  }
  for (const namespace of paths.filter((p) => depth(p) === 2 && isNamespace(p))) {
    lines.push(`## ${namespace.split('.')[1]}`, '', docs.get(namespace), '');
    for (const p of paths.filter((other) => other.startsWith(`${namespace}.`))) {
      lines.push(heading(p), '', docs.get(p), '');
    }
  }
  return lines.join('\n').trimEnd();
}

function main() {
  const sourceFile = ts.createSourceFile(
    'actions.ts',
    fs.readFileSync(ACTIONS_TS, 'utf8'),
    ts.ScriptTarget.ESNext,
    true
  );
  const root = findRoot(sourceFile);
  if (!root) {
    console.error(`extract-docs: no \`const ${ROOT_NAME} = {...}\` found in src/ai/actions.ts`);
    process.exit(1);
  }

  const collected = collectDocs(sourceFile, root);
  for (const missing of collected.undocumented) {
    console.error(`extract-docs: warning: no JSDoc on ${missing}`);
  }
  const reference = renderReference(collected);

  fs.writeFileSync(
    GEN_TS,
    '// GENERATED by scripts/extract-docs.mjs — do not edit by hand.\n' +
      '// Source of truth: JSDoc in src/ai/actions.ts.\n' +
      `export const ACTION_DOCS: Record<string, string> = ${JSON.stringify(Object.fromEntries(collected.docs), null, 2)};\n\n` +
      `export const HELP_TEXT = ${JSON.stringify(reference)};\n`
  );
  fs.writeFileSync(API_TXT, `${reference}\n\n${DATA_MODEL.join('\n')}\n`);
  fs.mkdirSync(path.dirname(COMMANDS_TS), { recursive: true });
  fs.writeFileSync(
    COMMANDS_TS,
    '// GENERATED by scripts/extract-docs.mjs — do not edit by hand.\n' +
      '// Source of truth: the JSDoc in src/ai/actions.ts and scripts/cli-inputs.mjs.\n' +
      "import type { CommandTable } from './commandTypes';\n\n" +
      `export const COMMAND_TABLE: CommandTable = ${JSON.stringify(
        buildCommands({ ...collected, rootName: ROOT_NAME }),
        null,
        2
      )};\n`
  );
  fs.writeFileSync(LLMS_TXT, `${LLMS_GUIDE}\n\n${SERVED_FILES.join('\n')}\n`);
  const shown = (file) => path.relative(ROOT, file);
  console.log(
    `extract-docs: wrote ${collected.docs.size} entries to ${shown(GEN_TS)}, ${shown(API_TXT)}, ${shown(LLMS_TXT)} and ${shown(COMMANDS_TS)}`
  );
}

main();
