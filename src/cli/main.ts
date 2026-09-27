/**
 * The vibecomics command line: `vibecomics <namespace> <function> [arguments]`
 * calls the same ComicBuilder API the app exposes on `window`, in Node, against
 * the user's Google Drive. See help.ts for the user-facing description.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createComicBuilder } from '../ai/actions';
import type { DeviceClient } from '../drive/deviceOAuth';
import { UsageError, buildArgs, parseArgv } from './args';
import {
  AUTH_HELP,
  commandHelp,
  commandsIn,
  findCommand,
  fullReference,
  isNamespace,
  namespaceHelp,
  overview,
} from './help';
import { createNodeSession } from './nodeSession';
import { StateStore, stateDir } from './state';

export interface CliIo {
  env: Record<string, string | undefined>;
  cwd: string;
  fetch?: typeof fetch;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** The Google device OAuth client baked into this build, or null. */
  deviceClient: DeviceClient | null;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Commands that do not need the open project loaded first. */
const WITHOUT_PROJECT = new Set([
  'storage.connectWithDevice',
  'storage.connectWithServer',
  'storage.disconnect',
  'storage.status',
  'storage.listProjects',
  'storage.showProjects',
  'storage.createProject',
  'storage.openProject',
]);

const LOGIN_HINT = 'Run "vibecomics auth login" and have the user approve it.';

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** Write a downloaded image next to the caller and report where it went instead of dumping base64. */
function saveDownload(
  result: { name: string; mimeType: string; dataUrl: string },
  out: string | true | undefined,
  cwd: string
) {
  const target = path.resolve(cwd, typeof out === 'string' ? out : path.basename(result.name));
  const payload = result.dataUrl.slice(result.dataUrl.indexOf(',') + 1);
  fs.writeFileSync(target, Buffer.from(payload, 'base64'));
  return { name: result.name, mimeType: result.mimeType, savedTo: target };
}

async function run(argv: string[], io: CliIo): Promise<number | void> {
  const { positional, flags } = parseArgv(argv);
  const [first, second, ...rest] = positional;

  // ---- help -----------------------------------------------------------------------
  if (!first || first === 'help') {
    if (flags.has('full')) return io.stdout(`${fullReference()}\n`);
    const [namespace, fn] = [second, rest[0]];
    if (!namespace) return io.stdout(`${overview()}\n`);
    if (namespace && fn) {
      const spec = findCommand(`${namespace}.${fn}`);
      if (!spec)
        throw new UsageError(`No command "${namespace} ${fn}". See: vibecomics help ${namespace}`);
      return io.stdout(`${commandHelp(spec)}\n`);
    }
    if (isNamespace(namespace)) return io.stdout(`${namespaceHelp(namespace)}\n`);
    if (namespace === 'auth') return io.stdout(`${AUTH_HELP}\n`);
    throw new UsageError(`No namespace "${namespace}". See: vibecomics help`);
  }

  const session = createNodeSession({
    store: new StateStore(stateDir(io.env)),
    fetch: io.fetch,
    deviceClient: io.deviceClient,
    sleep: io.sleep,
    now: io.now,
  });

  // ---- auth -----------------------------------------------------------------------
  if (first === 'auth') {
    if (second === 'login') return io.stdout(json(await session.auth.login(flags.has('wait'))));
    if (second === 'status') return io.stdout(json(await session.auth.status()));
    if (second === 'logout') return io.stdout(json(await session.auth.logout()));
    throw new UsageError('Usage: vibecomics auth login [--wait] | status | logout');
  }

  // ---- API commands ---------------------------------------------------------------
  const spec = second ? findCommand(`${first}.${second}`) : undefined;
  if (!spec) {
    if (isNamespace(first)) {
      const names = commandsIn(first).map((c) => c.path.split('.')[1]);
      throw new UsageError(
        second
          ? `No command "${first} ${second}". Commands in ${first}: ${names.join(', ')}.`
          : `Missing command. Commands in ${first}: ${names.join(', ')}.`
      );
    }
    throw new UsageError(`Unknown command "${first}". See: vibecomics help`);
  }
  if (flags.has('help')) return io.stdout(`${commandHelp(spec)}\n`);

  const args = buildArgs(spec, { positional: rest, flags }, io.cwd);
  const api = createComicBuilder(session.deps);
  const project = flags.get('project');

  await session.prepare(!WITHOUT_PROJECT.has(spec.path) && project === undefined);
  if (typeof project === 'string') {
    const opened = await api.storage.openProject(project);
    if (!opened.ok) throw new Error(opened.error);
  }

  const [namespace, name] = spec.path.split('.');
  const fn = (api as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>)[
    namespace
  ][name];
  let result = await fn(...args);
  await session.finish();

  if (
    spec.path === 'media.upload' &&
    !(result as { thumbnailDriveFileId?: string }).thumbnailDriveFileId
  ) {
    io.stderr(
      'note: this image has no thumbnail, so the editor must download it in full to list it. ' +
        'Resize a copy to about 256px on its long side and add it with ' +
        '"media uploadThumbnail <id> <file>" (or pass --thumbnail when uploading).\n'
    );
  }
  if (spec.path === 'media.download') {
    result = saveDownload(result as Parameters<typeof saveDownload>[0], flags.get('out'), io.cwd);
  }
  io.stdout(result === undefined ? json({ ok: true }) : json(result));
  if (spec.path === 'project.lint') {
    const errors = (result as Array<{ severity: string }>).filter((f) => f.severity === 'error');
    if (errors.length > 0) {
      io.stderr(`note: ${errors.length} error${errors.length === 1 ? '' : 's'} found.\n`);
      return 1;
    }
  }
  return 0;
}

/** Run the CLI; resolves to the process exit code. */
export async function runCli(argv: string[], io: CliIo): Promise<number> {
  try {
    return (await run(argv, io)) ?? 0;
  } catch (e) {
    let message = e instanceof Error ? e.message : String(e);
    if (message.includes('Not connected to Google Drive')) message += ` ${LOGIN_HINT}`;
    io.stderr(`error: ${message}\n`);
    return e instanceof UsageError ? 2 : 1;
  }
}
