/** The CLI's help text, built from the command table (docs come from the JSDoc via commands.gen.ts). */
import { HELP_TEXT } from '../ai/actions.docs.gen';
import type { CommandSpec, ParamSpec } from './commandTypes';
import { COMMAND_TABLE } from './commands.gen';

const { commands, namespaces } = COMMAND_TABLE;

export const findCommand = (path: string): CommandSpec | undefined =>
  commands.find((c) => c.path === path);

export const commandsIn = (namespace: string): CommandSpec[] =>
  commands.filter((c) => c.path.startsWith(`${namespace}.`));

export const isNamespace = (name: string): boolean => namespaces.some((n) => n.name === name);

const CONVENTIONS = `How the CLI works
  - Output is JSON on stdout. Errors go to stderr as "error: ..." with exit code 1
    (2 for a mistake in how the command was typed).
  - Log in once with "vibecomics auth login". The login, the open project and the
    current page are remembered in ~/.vibecomics (set VIBECOMICS_HOME to move it).
  - Each command loads the open project from Google Drive, changes it, and saves it
    back before it exits: there is nothing else to save. Run commands one at a
    time, not in parallel.
  - Open a project with "storage openProject <name>" (or create one with
    "storage createProject <name>"); it stays open for the commands that follow.
    "--project <name>" on any command opens that project first.
  - JSON arguments: quote them for your shell, or put the JSON in a file and pass
    "@file.json". Any text or JSON argument that starts with @ is read from that file.
  - Images are files: "media upload hero.png --thumbnail hero.thumb.png". To look
    at an image, "media download <id> --out hero.png" writes it to a file.
  - There is no preview screen in the CLI (page openPreview is unavailable).`;

export const AUTH_HELP = `vibecomics auth login [--wait]
  Start logging in to Google Drive. Prints a URL and a code: the user opens the URL on
  any device (a phone works), enters the code and approves. Then run "auth status".
  With --wait it keeps checking until they approve (it can take minutes).
vibecomics auth status
  Finishes a pending login once the user has approved, and reports whether you are
  connected and which project is open.
vibecomics auth logout
  Revokes the login at Google and forgets it (and the open project) on this machine.`;

const kindLabel = (p: ParamSpec): string => {
  switch (p.kind) {
    case 'enum':
      return p.options!.join('|');
    case 'number':
      return 'number';
    case 'stringOrNumber':
      return 'text|number';
    case 'json':
      return 'json';
    case 'file':
      return 'file';
    case 'object':
      return 'json';
    default:
      return 'text';
  }
};

const flagOf = (p: ParamSpec) => p.flag ?? p.name;

function usage(spec: CommandSpec): string {
  const positional = new Set(spec.positional ?? spec.params.map((p) => p.name));
  const parts = ['vibecomics', ...spec.path.split('.')];
  const flags: string[] = [];
  for (const p of spec.params) {
    if (p.kind === 'object') {
      if (positional.has(p.name)) parts.push(`[${p.name}]`);
      for (const f of p.fields!) flags.push(`[--${flagOf(f)} <${kindLabel(f)}>]`);
    } else if (positional.has(p.name)) {
      parts.push(p.optional ? `[${p.name}]` : `<${p.name}>`);
    } else {
      flags.push(p.optional ? `[--${p.name} <${kindLabel(p)}>]` : `--${p.name} <${kindLabel(p)}>`);
    }
  }
  return [...parts, ...flags].join(' ');
}

function describe(p: ParamSpec, indent: string): string[] {
  const lines = [
    `${indent}${p.name}  (${kindLabel(p)}, ${p.optional ? 'optional' : 'required'})  ${p.doc}`.trimEnd(),
  ];
  if (p.help) lines.push(`${indent}    ${p.help}`);
  if (p.example) lines.push(`${indent}    Example: ${p.example}`);
  for (const f of p.fields ?? []) {
    lines.push(...describe({ ...f, name: `--${flagOf(f)}` }, `${indent}    `));
  }
  return lines;
}

export function commandHelp(spec: CommandSpec): string {
  const lines = [usage(spec), '', spec.description];
  if (spec.params.length) {
    lines.push('', 'Arguments:');
    for (const p of spec.params) lines.push(...describe(p, '  '));
  }
  if (spec.returns) lines.push('', `Prints: ${spec.returns}`);
  return lines.join('\n');
}

export function namespaceHelp(name: string): string {
  const ns = namespaces.find((n) => n.name === name)!;
  const rows = commandsIn(name).map((c) => `  ${c.path.split('.')[1].padEnd(18)}${c.summary}`);
  return [
    ns.description,
    '',
    `Commands in "${name}":`,
    ...rows,
    '',
    `More: vibecomics help ${name} <function>`,
  ].join('\n');
}

/** Commands that only make sense in the app; they stay callable but are left out of the overview. */
const BROWSER_ONLY = new Set([
  'storage.connectWithServer',
  'storage.showProjects',
  'storage.backupTo',
  'page.openPreview',
  'page.closePreview',
]);

const shorten = (text: string, max = 68): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;

export function overview(): string {
  const groups = namespaces.map((ns) => {
    const rows = commandsIn(ns.name)
      .filter((c) => !BROWSER_ONLY.has(c.path))
      .map((c) => `  ${c.path.replace('.', ' ').padEnd(26)}${shorten(c.summary)}`);
    return rows.join('\n');
  });
  return [
    'vibecomics: command-line client for VibeComics, a comic builder that keeps every',
    "comic in the user's Google Drive. It is the same API as the app's window.ComicBuilder.",
    '',
    'Usage:',
    '  vibecomics <namespace> <function> [arguments] [--project <name>]',
    '  vibecomics auth login [--wait] | status | logout',
    '  vibecomics help [<namespace> [<function>]] [--full]',
    '',
    'Getting started:',
    '  1. vibecomics auth login      prints a URL and a code: the user opens the URL on any',
    '                                device, enters the code and approves',
    '  2. vibecomics auth status     run it after they approve: it finishes the login',
    '  3. vibecomics storage listProjects   then  storage openProject <name>  (or createProject)',
    '',
    CONVENTIONS,
    '',
    'Commands (details: vibecomics help <namespace> <function>; the whole reference:',
    'vibecomics help --full):',
    groups.join('\n\n'),
  ].join('\n');
}

export const fullReference = (): string => `${CONVENTIONS}\n\n${HELP_TEXT}`;
