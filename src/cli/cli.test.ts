/// <reference types="node" />
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { COMMAND_TABLE } from './commands.gen';
import { runCli } from './main';
import { createFakeGoogle } from './testing/fakeGoogle';

// A 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

/** A fresh machine (state folder, working folder) talking to a fresh fake Google. */
function setup() {
  const clock = { now: Date.parse('2026-09-20T12:00:00Z') };
  const google = createFakeGoogle(() => clock.now);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vibecomics-home-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vibecomics-work-'));

  async function run(...argv: string[]) {
    let out = '';
    let err = '';
    const code = await runCli(argv, {
      env: { VIBECOMICS_HOME: home },
      cwd: work,
      fetch: google.fetch,
      stdout: (text) => void (out += text),
      stderr: (text) => void (err += text),
      deviceClient: { clientId: 'client', clientSecret: 'secret' },
      sleep: async () => undefined,
      now: () => clock.now,
    });
    return { code, out, err, json: () => JSON.parse(out) };
  }

  async function login() {
    await run('auth', 'login');
    google.approve();
    const status = await run('auth', 'status');
    assert.equal(status.json().connected, true);
  }

  return { run, login, google, clock, home, work };
}

test('help lists the commands and explains one', async () => {
  const { run } = setup();
  const overview = await run();
  assert.equal(overview.code, 0);
  assert.match(overview.out, /layers add\s+Add a layer to a panel/);
  assert.doesNotMatch(overview.out, /^ {2}page openPreview/m);

  const layersAdd = await run('help', 'layers', 'add');
  assert.match(layersAdd.out, /^vibecomics layers add <panelId> <input>/);
  assert.match(layersAdd.out, /input {2}\(json, required\)/);

  const viaFlag = await run('media', 'upload', '--help');
  assert.match(viaFlag.out, /vibecomics media upload <dataUrl> \[--name <text>\]/);
  assert.match(viaFlag.out, /--thumbnail {2}\(file, optional\)/);
});

test('login is two steps and survives across separate runs', async () => {
  const { run, google, clock, home } = setup();

  const started = await run('auth', 'login');
  assert.equal(started.code, 0);
  assert.equal(started.json().pending.code, 'ABCD-EFGH');
  assert.equal(started.json().pending.url, 'https://www.google.com/device');
  assert.equal(started.json().connected, false);

  const waiting = await run('auth', 'status');
  assert.equal(waiting.json().connected, false);
  assert.equal(waiting.json().pending.code, 'ABCD-EFGH');

  google.approve();
  const done = await run('auth', 'status');
  assert.equal(done.json().connected, true);
  assert.equal(done.json().pending, undefined);

  // The refresh token is on disk, readable only by the user.
  const file = path.join(home, 'state.json');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).auth.refreshToken, 'refresh-1');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);

  // An hour later the access token has expired: the next run refreshes it by itself.
  clock.now += 2 * 3600 * 1000;
  const listed = await run('storage', 'listProjects');
  assert.equal(listed.code, 0, listed.err);
  assert.ok(google.calls.some((c) => c === 'POST oauth2.googleapis.com/token'));

  const out = await run('auth', 'logout');
  assert.equal(out.json().connected, false);
  assert.equal((await run('storage', 'listProjects')).code, 1);
});

test('a denied login reports why and can be retried', async () => {
  const { run, google } = setup();
  await run('auth', 'login');
  google.deny();
  const status = await run('auth', 'status');
  assert.match(status.json().error, /denied/);
  assert.equal(status.json().pending, undefined);
});

test('without a login, Drive commands say how to log in', async () => {
  const { run } = setup();
  const result = await run('storage', 'listProjects');
  assert.equal(result.code, 1);
  assert.match(result.err, /Not connected to Google Drive\. Run "vibecomics auth login"/);
});

test('a project persists on Drive and is picked up by the next command', async () => {
  const { run, login, google } = setup();
  await login();

  const created = await run('storage', 'createProject', 'Demo');
  assert.equal(created.code, 0, created.err);
  const folder = created.json();
  assert.equal(folder.name, 'Demo');

  // Separate runs share the open project through the state file, and each saves before it exits.
  const page = await run('page', 'add', '--title', 'Chapter 1');
  assert.equal(page.json().title, 'Chapter 1');
  assert.equal((await run('page', 'count')).json(), 2);
  assert.equal(google.projectIn(folder.id).pages.length, 2);

  const split = await run('panels', 'splitEvenly', page.json().panels[0].id, 'vertical', '2');
  assert.equal(split.json().length, 2);

  const layer = await run(
    'layers',
    'add',
    split.json()[0].id,
    '{"kind":"background","prompt":"A rooftop at dusk","aspectRatio":1.5}'
  );
  assert.equal(layer.json().kind, 'background');
  const saved = google.projectIn(folder.id);
  assert.equal(saved.pages[1].panels[0].layers[0].prompt, 'A rooftop at dusk');

  const panelId = split.json()[0].id;
  const layerId = layer.json().id;
  assert.equal((await run('layers', 'flip', panelId, layerId)).json().flipX, true);
  assert.equal(google.projectIn(folder.id).pages[1].panels[0].layers[0].flipX, true);
  assert.equal((await run('layers', 'flip', panelId, layerId)).json().flipX, false);

  // The current page is remembered: with none given, panels list shows page 1.
  assert.equal((await run('panels', 'list')).json().length, 2);
  assert.equal((await run('page', 'select', '0')).json().title, 'Cover');
  assert.equal((await run('panels', 'list')).json().length, 1);
});

test('--project opens another project first, and other projects are listed', async () => {
  const { run, login } = setup();
  await login();
  await run('storage', 'createProject', 'One');
  await run('storage', 'createProject', 'Two');
  await run('metadata', 'setOutline', 'Outline of two');

  const listed = await run('storage', 'listProjects');
  assert.deepEqual(
    listed.json().map((f: { name: string }) => f.name),
    ['One', 'Two']
  );
  const outline = await run('metadata', 'get', '--project', 'One');
  assert.equal(outline.json().outline, '');
  assert.equal((await run('metadata', 'get')).json().outline, '');
  assert.equal((await run('metadata', 'get', '--project', 'Two')).json().outline, 'Outline of two');
});

test('media: upload a file with a thumbnail, look at it, delete it', async () => {
  const { run, login, google, work } = setup();
  await login();
  await run('storage', 'createProject', 'Art');
  fs.writeFileSync(path.join(work, 'hero.png'), PNG);
  fs.writeFileSync(path.join(work, 'hero.small.png'), PNG);

  const uploaded = await run('media', 'upload', 'hero.png', '--thumbnail', 'hero.small.png');
  assert.equal(uploaded.code, 0, uploaded.err);
  const item = uploaded.json();
  assert.equal(item.name, 'hero.png');
  assert.equal(item.mimeType, 'image/png');
  assert.ok(item.thumbnailDriveFileId);
  assert.deepEqual(google.file(item.driveFileId)!.content, PNG);
  assert.equal((await run('media', 'list')).json().length, 1);

  const downloaded = await run('media', 'download', item.id, '--out', 'copy.png');
  assert.equal(downloaded.json().savedTo, path.join(work, 'copy.png'));
  assert.deepEqual(fs.readFileSync(path.join(work, 'copy.png')), PNG);

  assert.equal(uploaded.err, ''); // a thumbnail was given: nothing to remind about

  // Without a thumbnail the upload works, and stderr says how to add one (stdout stays pure JSON).
  const named = await run('media', 'upload', 'hero.png', '--name', 'hero-front.png');
  assert.equal(named.json().name, 'hero-front.png');
  assert.equal(named.json().thumbnailDriveFileId, undefined);
  assert.match(named.err, /note: this image has no thumbnail.*media uploadThumbnail/);

  const removed = await run('media', 'delete', item.id);
  assert.deepEqual(removed.json(), { layers: 0, entries: 0 });
  assert.equal(google.file(item.driveFileId)!.trashed, true);
});

test('JSON can come from a file with @', async () => {
  const { run, login, google, work } = setup();
  await login();
  const { id } = (await run('storage', 'createProject', 'Files')).json();
  fs.writeFileSync(path.join(work, 'outline.txt'), 'Premise: a cat. Twist: it is a dog.');
  await run('metadata', 'setOutline', '@outline.txt');
  assert.equal(google.projectIn(id).metadata.outline, 'Premise: a cat. Twist: it is a dog.');

  const panelId = (await run('page', 'current')).json().panels[0].id;
  fs.writeFileSync(path.join(work, 'bubble.json'), '{"text":"Hi!","kind":"speech"}');
  const bubble = await run('bubbles', 'add', panelId, '@bubble.json');
  assert.equal(bubble.json().text, 'Hi!');
});

test('mistakes are reported clearly and change nothing', async () => {
  const { run, login, google } = setup();
  await login();
  const { id } = (await run('storage', 'createProject', 'Oops')).json();
  const content = () => {
    const { pages, metadata } = google.projectIn(id);
    return JSON.stringify({ pages, metadata });
  };
  const before = content();

  const unknown = await run('nope', 'thing');
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /Unknown command "nope"/);

  const wrongFn = await run('layers', 'explode');
  assert.equal(wrongFn.code, 2);
  assert.match(wrongFn.err, /Commands in layers: list, get, add/);

  assert.match((await run('panels', 'get')).err, /Missing panelId/);
  assert.match(
    (await run('panels', 'split', 'p', 'sideways')).err,
    /axis must be one of: horizontal, vertical/
  );
  assert.match((await run('page', 'select', 'two')).err, /"two" is not a number/);
  assert.match((await run('layers', 'add', 'p', '{oops')).err, /not valid JSON/);
  assert.match((await run('page', 'count', '--wat')).err, /Unknown option --wat/);
  assert.match((await run('page', 'count', 'extra')).err, /Too many arguments/);
  assert.match(
    (await run('media', 'upload', 'missing.png')).err,
    /Cannot read the file "missing.png"/
  );

  const apiError = await run('layers', 'list', 'no-such-panel');
  assert.equal(apiError.code, 0); // the API returns null for an unknown panel
  assert.equal(apiError.json(), null);
  const thrown = await run('panels', 'delete', 'no-such-panel');
  assert.equal(thrown.json(), false);

  const preview = await run('page', 'openPreview');
  assert.equal(preview.code, 1);
  assert.match(preview.err, /no preview in the CLI/);

  assert.equal(content(), before);
});

test('storage connect explains that the CLI logs in another way', async () => {
  const { run } = setup();
  const result = await run('storage', 'connect');
  assert.equal(result.code, 1);
  assert.match(result.err, /auth login/);
});

test('every command has help that starts with its own usage line', async () => {
  const { run } = setup();
  assert.ok(COMMAND_TABLE.commands.length >= 60);
  for (const command of COMMAND_TABLE.commands) {
    const [namespace, name] = command.path.split('.');
    const help = await run('help', namespace, name);
    assert.equal(help.code, 0, `${command.path}: ${help.err}`);
    assert.ok(help.out.startsWith(`vibecomics ${namespace} ${name}`), command.path);
    const viaFlag = await run(namespace, name, '--help');
    assert.equal(viaFlag.out, help.out, command.path);
  }
  for (const ns of COMMAND_TABLE.namespaces) {
    assert.match((await run('help', ns.name)).out, new RegExp(`Commands in "${ns.name}"`));
  }
  assert.match((await run('help', '--full')).out, /How the CLI works[\s\S]*# ComicBuilder/);
  assert.match((await run('help', 'auth')).out, /auth login \[--wait\]/);
  assert.equal((await run('help', 'nope')).code, 2);
});

test('auth login --wait keeps checking until the user approves', async () => {
  const { run, google } = setup();
  let checks = 0;
  // Approve on the third check by patching the fake through the run's sleep: use a fresh runner.
  let out = '';
  const code = await runCli(['auth', 'login', '--wait'], {
    env: { VIBECOMICS_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'vibecomics-wait-')) },
    cwd: os.tmpdir(),
    fetch: google.fetch,
    stdout: (text) => void (out += text),
    stderr: () => undefined,
    deviceClient: { clientId: 'client', clientSecret: 'secret' },
    sleep: async () => {
      if (++checks === 3) google.approve();
    },
  });
  assert.equal(code, 0);
  assert.equal(checks, 3);
  assert.equal(JSON.parse(out).connected, true);
  void run;
});

test('an expired login code is reported and cleared', async () => {
  const { run, clock } = setup();
  await run('auth', 'login');
  clock.now += 31 * 60 * 1000;
  const status = await run('auth', 'status');
  assert.match(status.json().error, /expired/);
  assert.equal(status.json().pending, undefined);
  assert.equal((await run('auth', 'status')).json().error, undefined);
});

test('a revoked login says to log in again', async () => {
  const { run, login, google, clock } = setup();
  await login();
  google.revokeAll();
  clock.now += 2 * 3600 * 1000;
  const result = await run('storage', 'listProjects');
  assert.equal(result.code, 1);
  assert.match(result.err, /Could not refresh the Google login.*auth login/);

  // `auth status` reports it instead of failing, so an agent can tell it must log in again.
  const status = await run('auth', 'status');
  assert.equal(status.code, 0);
  assert.equal(status.json().connected, false);
  assert.match(status.json().error, /Could not refresh the Google login/);
  assert.match(status.json().next, /auth login/);
});

test('a broken state file is reported, not silently discarded', async () => {
  const { run, home } = setup();
  fs.writeFileSync(path.join(home, 'state.json'), '{not json');
  const result = await run('storage', 'status');
  assert.equal(result.code, 1);
  assert.match(result.err, /state\.json is not valid JSON/);
  assert.equal(fs.readFileSync(path.join(home, 'state.json'), 'utf8'), '{not json');
});

test('--project with an unknown name fails and keeps the current project', async () => {
  const { run, login } = setup();
  await login();
  await run('storage', 'createProject', 'Keep');
  const result = await run('metadata', 'get', '--project', 'Missing');
  assert.equal(result.code, 1);
  assert.match(result.err, /No project folder "Missing"/);
  assert.equal((await run('page', 'count')).json(), 1);
});

test('the rest of the API works through the command line', async () => {
  const { run, login, google, work } = setup();
  await login();
  const { id: folderId } = (await run('storage', 'createProject', 'Everything')).json();
  const saved = () => google.projectIn(folderId);

  // Story bible
  const hero = (
    await run('characters', 'create', '{"name":"Mira","description":"Red hair","linkIds":[]}')
  ).json();
  assert.equal(hero.name, 'Mira');
  await run('characters', 'update', hero.id, '{"description":"Short red hair"}');
  assert.equal((await run('characters', 'get', hero.id)).json().description, 'Short red hair');
  const scene = (await run('scenes', 'create', '{"name":"Roof"}')).json();
  const prop = (await run('objects', 'create', '{"name":"Satchel"}')).json();
  assert.equal((await run('scenes', 'list')).json()[0].id, scene.id);
  assert.equal((await run('objects', 'list')).json()[0].id, prop.id);
  assert.equal((await run('objects', 'delete', prop.id)).json(), true);
  assert.equal(saved().metadata.characters[0].description, 'Short red hair');

  // Page size, outline, page and panel edits (object flags)
  await run('metadata', 'setPageSize', '{"label":"Square","widthIn":8,"heightIn":8}');
  assert.equal(saved().metadata.pageSize.label, 'Square');
  await run('metadata', 'setOutline', '');
  const page = (await run('page', 'add')).json();
  assert.equal(page.title, '');
  const [top, bottom] = (
    await run('panels', 'split', page.panels[0].id, 'horizontal', '40')
  ).json();
  assert.equal(bottom.y, 40);
  assert.equal(
    (await run('panels', 'update', top.id, '--title', 'Establishing')).json().title,
    'Establishing'
  );
  assert.equal((await run('panels', 'resize', top.id, 'bottom', '45')).json().length, 2);
  assert.equal((await run('panels', 'size', top.id)).json().pixels.width > 0, true);
  assert.equal((await run('panels', 'splitAcross', 'vertical', '50')).json().length, 4);

  // Layers: numbers and words for "move"
  const a = (await run('layers', 'add', top.id, '{"prompt":"one"}')).json();
  const b = (await run('layers', 'add', top.id, '{"prompt":"two"}')).json();
  assert.deepEqual(
    (await run('layers', 'move', top.id, a.id, 'top')).json().map((l: { id: string }) => l.id),
    [b.id, a.id]
  );
  assert.deepEqual(
    (await run('layers', 'move', top.id, a.id, '0')).json().map((l: { id: string }) => l.id),
    [a.id, b.id]
  );
  assert.equal(
    (await run('layers', 'update', top.id, a.id, '{"opacity":0.5}')).json().opacity,
    0.5
  );
  assert.equal((await run('layers', 'size', top.id, a.id)).json().pixels.width > 0, true);
  assert.equal((await run('layers', 'delete', top.id, b.id)).json(), true);

  // Bubbles
  const bubble = (await run('bubbles', 'add', top.id, '{"text":"Hi","kind":"thought"}')).json();
  assert.equal(
    (await run('bubbles', 'update', top.id, bubble.id, '{"text":"Hello"}')).json().text,
    'Hello'
  );
  assert.equal((await run('bubbles', 'get', top.id, bubble.id)).json().text, 'Hello');
  assert.equal((await run('bubbles', 'delete', top.id, bubble.id)).json(), true);

  // A thumbnail added later, then the whole project replaced from a file
  fs.writeFileSync(path.join(work, 'art.png'), PNG);
  const media = (await run('media', 'upload', 'art.png')).json();
  assert.equal(media.thumbnailDriveFileId, undefined);
  const fixed = (await run('media', 'uploadThumbnail', media.id, 'art.png')).json();
  assert.ok(fixed.thumbnailDriveFileId);
  assert.equal((await run('media', 'get', media.id)).json().id, media.id);

  const snapshot = JSON.parse(JSON.stringify(saved()));
  snapshot.title = 'Loaded from a file';
  fs.writeFileSync(path.join(work, 'project.json'), JSON.stringify(snapshot));
  assert.equal((await run('project', 'load', '@project.json')).json().ok, true);
  assert.equal(saved().title, 'Loaded from a file');
  assert.equal((await run('page', 'current')).json().number, 0);

  // Save, close, disconnect
  assert.equal((await run('storage', 'save')).json().ok, true);
  assert.equal((await run('storage', 'closeProject')).code, 0);
  assert.equal((await run('page', 'count')).json(), 0);
  assert.equal((await run('page', 'add')).code, 1);
  assert.equal((await run('storage', 'status')).json().connected, true);
  await run('storage', 'disconnect');
  assert.equal((await run('storage', 'status')).json().connected, false);
});

test('pages and panels have prompts, through the CLI', async () => {
  const { run, login, google } = setup();
  await login();
  const { id: folderId } = (await run('storage', 'createProject', 'Intents')).json();
  const saved = () => google.projectIn(folderId);

  // A page created with a prompt; the cover page has none.
  const page = (
    await run('page', 'add', '--title', 'Chase', '--prompt', 'Rooftop chase, dusk.')
  ).json();
  assert.equal(page.prompt, 'Rooftop chase, dusk.');
  assert.equal(saved().pages[0].prompt, undefined);
  assert.equal(saved().pages[1].prompt, 'Rooftop chase, dusk.');

  // page update: the index is positional, the fields are flags; without an index it is the current page.
  const updated = (
    await run('page', 'update', '1', '--prompt', 'The chase ends on the roof.')
  ).json();
  assert.equal(updated.prompt, 'The chase ends on the roof.');
  assert.equal(updated.title, 'Chase'); // only the given fields change
  assert.equal(
    (await run('page', 'update', '--title', 'Chase, part 2')).json().prompt,
    'The chase ends on the roof.'
  );
  assert.equal(saved().pages[1].title, 'Chase, part 2');
  await run('page', 'update', '0', '--prompt', 'The cover: the city at dusk.');
  assert.equal(saved().pages[0].prompt, 'The cover: the city at dusk.');
  assert.equal((await run('page', 'select', '1')).json().prompt, 'The chase ends on the roof.');

  // panels: a prompt via a flag or via JSON; a cut keeps it on the original and starts the new one empty
  const panelId = page.panels[0].id;
  assert.equal(
    (await run('panels', 'update', panelId, '--prompt', 'Wide, low angle.')).json().prompt,
    'Wide, low angle.'
  );
  assert.equal(
    (
      await run('panels', 'update', panelId, '{"title":"Roof","prompt":"Wide, low angle, dusk."}')
    ).json().title,
    'Roof'
  );
  const [kept, fresh] = (await run('panels', 'split', panelId, 'vertical', '50')).json();
  assert.equal(kept.prompt, 'Wide, low angle, dusk.');
  assert.equal(fresh.prompt, undefined);
  assert.equal((await run('panels', 'get', panelId)).json().prompt, 'Wide, low angle, dusk.');
  assert.equal(saved().pages[1].panels[0].prompt, 'Wide, low angle, dusk.');

  // An empty value clears it, and reads back as empty text
  assert.equal((await run('panels', 'update', panelId, '--prompt', '')).json().prompt, '');
  assert.equal((await run('page', 'update', '1', '--prompt', '')).json().prompt, '');

  // Mistakes
  assert.match((await run('page', 'update', '9', '--prompt', 'x')).err, /Page 9 not found/);
  assert.match((await run('page', 'update', '-1', '--prompt', 'x')).err, /Page -1 not found/);
  assert.match((await run('panels', 'update', panelId, '{"prompt":5}')).err, /prompt must be text/);
  assert.match((await run('panels', 'update', panelId, '5')).err, /patch must be a JSON object/);
  assert.match(
    (await run('page', 'update', 'first', '--prompt', 'x')).err,
    /"first" is not a number/
  );
  assert.equal((await run('panels', 'update', 'no-such-panel', '--prompt', 'x')).code, 1);

  // The prompt is written down where the LLM can read it back next to the layer's own
  const layer = (
    await run('layers', 'add', fresh.id, '{"kind":"background","prompt":"Rooftop"}')
  ).json();
  const read = (await run('page', 'select', '1')).json();
  assert.equal(read.panels[1].layers[0].id, layer.id);
  assert.equal(read.panels[1].layers[0].prompt, 'Rooftop');

  // Everything survives a reload from Drive, as a fresh process reads it
  assert.equal((await run('page', 'current')).json().panels[0].prompt, '');
});

test('pages can be reordered from the CLI, and the cover stays first', async () => {
  const { run, login, google } = setup();
  await login();
  const { id: folderId } = (await run('storage', 'createProject', 'Order')).json();
  for (const title of ['A', 'B', 'C']) await run('page', 'add', '--title', title);
  const order = async () => {
    const pages = google.projectIn(folderId).pages as Array<{ title: string; number: number }>;
    return pages.map((p) => `${p.number}:${p.title}`).join(' ');
  };
  assert.equal(await order(), '0:Cover 1:A 2:B 3:C');

  // Move C to the front (after the cover): everything renumbers, and the page on screen stays B.
  await run('page', 'select', '2');
  const moved = await run('page', 'move', '3', '1');
  assert.equal(moved.code, 0, moved.err);
  assert.equal(moved.json().title, 'C');
  assert.equal(moved.json().number, 1);
  assert.equal(await order(), '0:Cover 1:C 2:A 3:B');
  const shown = (await run('page', 'current')).json();
  assert.equal(shown.title, 'B');
  assert.equal(shown.number, 3);

  // Moving the page that is on screen: it stays on screen
  await run('page', 'select', '1');
  await run('page', 'move', '1', '3');
  assert.equal(await order(), '0:Cover 1:A 2:B 3:C');
  assert.equal((await run('page', 'current')).json().title, 'C');
  assert.equal((await run('page', 'current')).json().number, 3);

  // A neighbour swap, and a move to the same place changes nothing
  await run('page', 'move', '1', '2');
  assert.equal(await order(), '0:Cover 1:B 2:A 3:C');
  const same = await run('page', 'move', '2', '2');
  assert.equal(same.code, 0);
  assert.equal(await order(), '0:Cover 1:B 2:A 3:C');

  // Content and prompts travel with the page
  await run('page', 'update', '2', '--prompt', 'A is the chase');
  await run('page', 'move', '2', '1');
  assert.equal((await run('page', 'select', '1')).json().prompt, 'A is the chase');

  // Mistakes change nothing
  const before = await order();
  assert.match((await run('page', 'move', '0', '2')).err, /cover \(page 0\) stays first/);
  assert.match((await run('page', 'move', '2', '0')).err, /cover \(page 0\) stays first/);
  assert.match((await run('page', 'move', '9', '1')).err, /Page 9 not found/);
  assert.match((await run('page', 'move', '1', '9')).err, /Page 9 not found/);
  assert.match((await run('page', 'move', '-1', '1')).err, /Page -1 not found/);
  assert.match((await run('page', 'move', '1.5', '2')).err, /Page 1.5 not found/);
  assert.match((await run('page', 'move', 'first', '2')).err, /"first" is not a number/);
  assert.match((await run('page', 'move', '1')).err, /Missing to/);
  assert.equal(await order(), before);
  assert.match((await run('help')).out, /page move\s+Move a page to a new position/);
});

test('a change made elsewhere is merged in when it does not clash', async () => {
  const { run, login, google } = setup();
  await login();
  const { id: folderId } = (await run('storage', 'createProject', 'Shared')).json();
  await run('page', 'add', '--title', 'X');

  // Another system edits the outline right after this command has read the project.
  google.afterNextProjectRead(() =>
    google.externalEdit(folderId, (p) => {
      p.metadata.outline = 'Written elsewhere';
    })
  );
  const result = await run('page', 'update', '1', '--prompt', 'Mine');
  assert.equal(result.code, 0, result.err);
  const saved = google.projectIn(folderId);
  assert.equal(saved.metadata.outline, 'Written elsewhere'); // theirs survived
  assert.equal(saved.pages[1].prompt, 'Mine'); // and so did ours

  // A change made between two commands is simply read by the next one.
  google.externalEdit(folderId, (p) => {
    p.pages[1].title = 'Renamed elsewhere';
  });
  assert.equal((await run('page', 'update', '1', '--prompt', 'After')).code, 0);
  assert.equal(google.projectIn(folderId).pages[1].title, 'Renamed elsewhere');
  assert.equal(google.projectIn(folderId).pages[1].prompt, 'After');
});

test('a clash is reported, nothing is overwritten, and applying it again works', async () => {
  const { run, login, google } = setup();
  await login();
  const { id: folderId } = (await run('storage', 'createProject', 'Shared')).json();
  await run('page', 'add', '--title', 'X');

  google.afterNextProjectRead(() =>
    google.externalEdit(folderId, (p) => {
      p.pages[1].prompt = 'Theirs';
    })
  );
  const clash = await run('page', 'update', '1', '--prompt', 'Ours');
  assert.equal(clash.code, 1);
  assert.match(clash.err, /Nothing was saved/);
  assert.match(clash.err, /Page 1 "X" › prompt/);
  assert.match(clash.err, /yours: {2}Ours/);
  assert.match(clash.err, /theirs: Theirs/);
  assert.match(clash.err, /before: \(not set\)/);
  assert.match(clash.err, /Fetch the project again.*apply this change again/);
  assert.equal(google.projectIn(folderId).pages[1].prompt, 'Theirs'); // untouched

  // The next command fetches the current project, so the same change now goes through.
  const again = await run('page', 'update', '1', '--prompt', 'Ours');
  assert.equal(again.code, 0, again.err);
  assert.equal(google.projectIn(folderId).pages[1].prompt, 'Ours');
});

test('changing something the other side deleted is a conflict', async () => {
  const { run, login, google } = setup();
  await login();
  const { id: folderId } = (await run('storage', 'createProject', 'Shared')).json();
  const page = (await run('page', 'add', '--title', 'X')).json();
  const layer = (
    await run('layers', 'add', page.panels[0].id, '{"name":"Hero","prompt":"Hero"}')
  ).json();

  google.afterNextProjectRead(() =>
    google.externalEdit(folderId, (p) => {
      p.pages[1].panels[0].layers = [];
    })
  );
  const clash = await run(
    'layers',
    'update',
    page.panels[0].id,
    layer.id,
    '{"prompt":"Hero, angrier"}'
  );
  assert.equal(clash.code, 1);
  assert.match(clash.err, /Layer "Hero"/);
  assert.match(clash.err, /yours: {2}changed here/);
  assert.match(clash.err, /theirs: deleted there/);
  assert.deepEqual(google.projectIn(folderId).pages[1].panels[0].layers, []);
});

test('changes that keep landing while the CLI merges are merged too', async () => {
  const { run, login, google } = setup();
  await login();
  const { id: folderId } = (await run('storage', 'createProject', 'Busy')).json();
  await run('page', 'add', '--title', 'X');

  // One edit after the CLI reads the project, and another right after it re-reads to merge.
  google.afterNextProjectRead(() => {
    google.externalEdit(folderId, (p) => {
      p.metadata.outline = 'First elsewhere';
    });
    google.afterNextProjectRead(() =>
      google.externalEdit(folderId, (p) => {
        p.pages[1].title = 'Second elsewhere';
      })
    );
  });
  const result = await run('page', 'update', '1', '--prompt', 'Ours');
  assert.equal(result.code, 0, result.err);
  const saved = google.projectIn(folderId);
  assert.equal(saved.metadata.outline, 'First elsewhere');
  assert.equal(saved.pages[1].title, 'Second elsewhere');
  assert.equal(saved.pages[1].prompt, 'Ours');
});

test('reading and writing keep the Drive version in step, so a lone CLI never conflicts with itself', async () => {
  const { run, login, google } = setup();
  await login();
  const { id: folderId } = (await run('storage', 'createProject', 'Solo')).json();
  const before = google.versionOf(folderId)!;
  for (let i = 0; i < 4; i++) {
    assert.equal((await run('page', 'add', '--title', `P${i}`)).code, 0);
    assert.equal((await run('metadata', 'setOutline', `outline ${i}`)).code, 0);
  }
  assert.equal(google.versionOf(folderId), before + 8); // exactly one write per changing command
  assert.equal(google.projectIn(folderId).pages.length, 5);
  // A command that changes nothing writes nothing.
  await run('page', 'count');
  await run('page', 'current');
  assert.equal(google.versionOf(folderId), before + 8);
});

test('layers and images can say what they show, and names can be changed', async () => {
  const { run, login, google, work } = setup();
  await login();
  const { id: folderId } = (await run('storage', 'createProject', 'Cast')).json();
  const saved = () => google.projectIn(folderId);
  const mara = (await run('characters', 'create', '{"name":"Mara"}')).json();
  const scooter = (await run('objects', 'create', '{"name":"Red scooter"}')).json();
  const panelId = saved().pages[0].panels[0].id;

  // A layer's subject: set, change, clear, and never an id that does not exist
  const layer = (
    await run('layers', 'add', panelId, JSON.stringify({ prompt: 'Mara', subjectId: mara.id }))
  ).json();
  assert.equal(layer.subjectId, mara.id);
  assert.equal(
    (
      await run('layers', 'update', panelId, layer.id, JSON.stringify({ subjectId: scooter.id }))
    ).json().subjectId,
    scooter.id
  );
  const cleared = (await run('layers', 'update', panelId, layer.id, '{"subjectId":null}')).json();
  assert.equal('subjectId' in cleared, false);
  assert.equal('subjectId' in saved().pages[0].panels[0].layers[0], false);
  const bad = await run('layers', 'update', panelId, layer.id, '{"subjectId":"char-nope"}');
  assert.equal(bad.code, 1);
  assert.match(bad.err, /Subject "char-nope" not found/);

  // An image uploaded as a subject's art, renamed, re-tagged and cleared
  fs.writeFileSync(path.join(work, 'run.png'), PNG);
  const art = (await run('media', 'upload', 'run.png', '--subject', mara.id)).json();
  assert.equal(art.subjectId, mara.id);
  const renamed = (
    await run('media', 'update', art.id, JSON.stringify({ name: 'mara-running.png' }))
  ).json();
  assert.equal(renamed.name, 'mara-running.png');
  assert.equal(renamed.subjectId, mara.id);
  assert.equal(
    (await run('media', 'update', art.id, JSON.stringify({ subjectId: scooter.id }))).json()
      .subjectId,
    scooter.id
  );
  assert.equal((await run('media', 'update', art.id, '{"name":"  "}')).code, 1);
  assert.equal((await run('media', 'upload', 'run.png', '--subject', 'char-nope')).code, 1);

  // Deleting a character or object lets go of everything it was the subject of
  await run('layers', 'update', panelId, layer.id, JSON.stringify({ subjectId: scooter.id }));
  await run('objects', 'delete', scooter.id);
  assert.equal('subjectId' in saved().pages[0].panels[0].layers[0], false);
  assert.equal('subjectId' in saved().metadata.media[0], false);
  assert.equal(saved().metadata.media[0].name, 'mara-running.png');
});

test('a background says which scene it is set in, and images can be art of a scene', async () => {
  const { run, login, google, work } = setup();
  await login();
  const { id: folderId } = (await run('storage', 'createProject', 'Scenes')).json();
  const saved = () => google.projectIn(folderId);
  const roof = (await run('scenes', 'create', '{"name":"Rooftop"}')).json();
  const mara = (await run('characters', 'create', '{"name":"Mara"}')).json();
  const panelId = saved().pages[0].panels[0].id;

  const bg = (
    await run(
      'layers',
      'add',
      panelId,
      JSON.stringify({ kind: 'background', prompt: 'Roof at dusk', sceneId: roof.id })
    )
  ).json();
  assert.equal(bg.sceneId, roof.id);
  assert.equal(saved().pages[0].panels[0].layers[0].sceneId, roof.id);
  const bad = await run('layers', 'update', panelId, bg.id, JSON.stringify({ sceneId: mara.id }));
  assert.equal(bad.code, 1);
  assert.match(bad.err, /Scene .* not found/);

  fs.writeFileSync(path.join(work, 'roof.png'), PNG);
  const art = (await run('media', 'upload', 'roof.png', '--scene', roof.id)).json();
  assert.equal(art.sceneId, roof.id);
  assert.equal('subjectId' in art, false);
  const cleared = (await run('media', 'update', art.id, '{"sceneId":null}')).json();
  assert.equal('sceneId' in cleared, false);
  await run('media', 'update', art.id, JSON.stringify({ sceneId: roof.id }));

  // Deleting the scene lets go of the background and the image
  await run('scenes', 'delete', roof.id);
  assert.equal('sceneId' in saved().pages[0].panels[0].layers[0], false);
  assert.equal('sceneId' in saved().metadata.media[0], false);
});

test('lint reports problems with fixes, exits non-zero on errors, and a fix clears its finding', async () => {
  const { run, login, google } = setup();
  await login();
  const { id: folderId } = (await run('storage', 'createProject', 'Lint')).json();
  const panelId = google.projectIn(folderId).pages[0].panels[0].id;

  // Nothing wrong yet: an empty list and exit code 0
  const clean = await run('project', 'lint');
  assert.equal(clean.code, 0);
  assert.deepEqual(clean.json(), []);

  // A layer that shows a character, which is then deleted through a project reload (a stale link)
  const mara = (
    await run('characters', 'create', '{"name":"Mara","description":"Red hair"}')
  ).json();
  const layer = (
    await run(
      'layers',
      'add',
      panelId,
      JSON.stringify({ name: 'Mara running', prompt: 'x', subjectId: mara.id })
    )
  ).json();
  const project = JSON.parse(JSON.stringify(google.projectIn(folderId)));
  project.metadata.characters = [];
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lint-')), 'project.json');
  fs.writeFileSync(file, JSON.stringify(project));
  assert.equal((await run('project', 'load', `@${file}`)).json().ok, true);

  const broken = await run('project', 'lint');
  assert.equal(broken.code, 1);
  assert.match(broken.err, /1 error found/);
  const [finding] = broken.json();
  assert.equal(finding.code, 'dangling-subject');
  assert.equal(finding.severity, 'error');
  assert.equal(finding.where.layerId, layer.id);
  assert.deepEqual(finding.fix, {
    call: 'layers.update',
    args: [panelId, layer.id, { subjectId: null }],
  });

  // Running the suggested fix through the API clears the finding
  await run('layers', 'update', panelId, layer.id, JSON.stringify(finding.fix.args[2]));
  assert.deepEqual((await run('project', 'lint')).json(), []);
});
