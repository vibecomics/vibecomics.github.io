/**
 * Turns command-line words into the arguments of a ComicBuilder function,
 * following the command table (commands.gen.ts): numbers, JSON, choices, file
 * paths (read into data: URLs), and object parameters given as one flag per
 * field. Any string or JSON value that starts with `@` is read from that file.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { CommandSpec, ParamSpec } from './commandTypes';

/** Flags every command accepts; they are not parameters of the API function. */
export const GLOBAL_FLAGS = ['project', 'out', 'help'];

export class UsageError extends Error {}

export interface ParsedArgv {
  positional: string[];
  flags: Map<string, string | true>;
}

/** `--name value`, `--name=value`, a bare `--name`, and everything after `--` as positional. */
export function parseArgv(tokens: string[]): ParsedArgv {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '--') {
      positional.push(...tokens.slice(i + 1));
      break;
    }
    if (!token.startsWith('--') || token.length === 2) {
      positional.push(token);
      continue;
    }
    const equals = token.indexOf('=');
    if (equals > 0) {
      flags.set(token.slice(2, equals), token.slice(equals + 1));
    } else if (i + 1 < tokens.length && !tokens[i + 1].startsWith('--')) {
      flags.set(token.slice(2), tokens[++i]);
    } else {
      flags.set(token.slice(2), true);
    }
  }
  return { positional, flags };
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

/** The MIME type of an image, from its extension or else its first bytes. */
export function detectMimeType(file: string, bytes: Uint8Array): string {
  const byName = MIME_BY_EXTENSION[path.extname(file).toLowerCase()];
  if (byName) return byName;
  const startsWith = (...signature: number[]) => signature.every((b, i) => bytes[i] === b);
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (startsWith(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57) return 'image/webp';
  return 'application/octet-stream';
}

interface FileValue {
  dataUrl: string;
  name: string;
  type: string;
}

function readFileValue(cwd: string, given: string): FileValue {
  const file = path.resolve(cwd, given);
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(file);
  } catch {
    throw new UsageError(`Cannot read the file "${given}".`);
  }
  const type = detectMimeType(file, bytes);
  return {
    dataUrl: `data:${type};base64,${bytes.toString('base64')}`,
    name: path.basename(file),
    type,
  };
}

/** A value that starts with `@` is the name of a file to read; `@@` is a literal `@`. */
function expandAt(cwd: string, value: string): string {
  if (value.startsWith('@@')) return value.slice(1);
  if (!value.startsWith('@')) return value;
  try {
    return fs.readFileSync(path.resolve(cwd, value.slice(1)), 'utf8');
  } catch {
    throw new UsageError(`Cannot read the file "${value.slice(1)}".`);
  }
}

type Raw = string | true | undefined;

function convert(param: ParamSpec, label: string, raw: string | true, cwd: string): unknown {
  if (raw === true) throw new UsageError(`${label} needs a value.`);
  switch (param.kind) {
    case 'string':
      return expandAt(cwd, raw).trim();
    case 'multiline':
      return expandAt(cwd, raw);
    case 'number': {
      const number = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(number)) {
        throw new UsageError(`${label}: "${raw}" is not a number.`);
      }
      return number;
    }
    case 'stringOrNumber':
      return /^-?\d+$/.test(raw.trim()) ? Number(raw) : raw.trim();
    case 'enum':
      if (!param.options!.includes(raw)) {
        throw new UsageError(
          `${label} must be one of: ${param.options!.join(', ')} (got "${raw}").`
        );
      }
      return raw;
    case 'json':
    case 'object':
      try {
        return JSON.parse(expandAt(cwd, raw));
      } catch (e) {
        throw new UsageError(`${label}: not valid JSON (${(e as Error).message}).`);
      }
    case 'file':
      return readFileValue(cwd, raw);
  }
}

const flagOf = (param: ParamSpec) => param.flag ?? param.name;

/** The names of the flags a command accepts (object parameters contribute their fields). */
export function flagNames(spec: CommandSpec): string[] {
  return spec.params.flatMap((p) => (p.kind === 'object' ? p.fields!.map(flagOf) : [p.name]));
}

const commandName = (spec: CommandSpec) => spec.path.replace('.', ' ');

function checkFlags(spec: CommandSpec, flags: ParsedArgv['flags']): void {
  const accepted = new Set(flagNames(spec));
  for (const param of spec.params) accepted.add(param.name);
  for (const name of flags.keys()) {
    if (accepted.has(name) || GLOBAL_FLAGS.includes(name)) continue;
    const options = flagNames(spec).map((f) => `--${f}`);
    throw new UsageError(
      `Unknown option --${name} for "${commandName(spec)}".` +
        (options.length ? ` Options: ${options.join(' ')}.` : ' It takes no options.')
    );
  }
}

/** An object parameter: an optional JSON object, plus one flag per field. */
function readObject(
  param: ParamSpec,
  raw: Raw,
  flags: ParsedArgv['flags'],
  cwd: string
): Record<string, unknown> {
  const given = raw === undefined ? {} : convert(param, param.name, raw, cwd);
  if (typeof given !== 'object' || given === null || Array.isArray(given)) {
    throw new UsageError(
      `${param.name} must be a JSON object, like {"${param.fields![0].name}": ...}.`
    );
  }
  const object = given as Record<string, unknown>;
  for (const field of param.fields!) {
    const given = flags.get(flagOf(field));
    if (given === undefined) continue;
    const value = convert(field, `--${flagOf(field)}`, given, cwd);
    object[field.name] = field.kind === 'file' ? (value as FileValue).dataUrl : value;
  }
  return object;
}

/**
 * The arguments to call `spec` with. Parameters are positional in the order the
 * API lists them (or as `spec.positional` says), and any parameter can also be
 * given as `--name value`; the fields of an object parameter are flags.
 */
export function buildArgs(spec: CommandSpec, { positional, flags }: ParsedArgv, cwd: string) {
  checkFlags(spec, flags);
  const positionalNames = new Set(spec.positional ?? spec.params.map((p) => p.name));
  const queue = [...positional];
  const files = new Map<string, FileValue>();
  const values = new Map<string, unknown>();

  // First everything given explicitly, then what defaults from a file (media upload's name and type).
  for (const param of spec.params) {
    let raw: Raw = flags.get(param.name);
    if (raw === undefined && positionalNames.has(param.name)) raw = queue.shift();
    if (param.kind === 'object') {
      values.set(param.name, readObject(param, raw, flags, cwd));
    } else if (raw !== undefined) {
      const value = convert(param, param.name, raw, cwd);
      if (param.kind === 'file') files.set(param.name, value as FileValue);
      values.set(param.name, param.kind === 'file' ? (value as FileValue).dataUrl : value);
    }
  }
  if (queue.length) {
    throw new UsageError(
      `Too many arguments: "${queue[0]}" was not expected. See: vibecomics help ${commandName(spec)}`
    );
  }
  const fromFile = (param: ParamSpec) => {
    const source = param.fromFile && files.get(param.fromFile.param);
    return source && param.fromFile ? source[param.fromFile.use] : undefined;
  };
  for (const param of spec.params) {
    if (param.kind === 'object') {
      const object = values.get(param.name) as Record<string, unknown>;
      for (const field of param.fields!) {
        // Only an absent field defaults from a file: an explicit JSON null means "clear it".
        if (object[field.name] === undefined) object[field.name] = fromFile(field);
      }
      for (const key of Object.keys(object)) if (object[key] === undefined) delete object[key];
    } else {
      values.set(param.name, values.get(param.name) ?? fromFile(param));
    }
  }

  const args = spec.params.map((param) => {
    const value = values.get(param.name);
    if (param.kind === 'object') {
      return Object.keys(value as object).length === 0 && param.optional ? undefined : value;
    }
    if (value === undefined && !param.optional) {
      throw new UsageError(`Missing ${param.name}. See: vibecomics help ${commandName(spec)}`);
    }
    return value;
  });
  while (args.length && args[args.length - 1] === undefined) args.pop();
  return args;
}
