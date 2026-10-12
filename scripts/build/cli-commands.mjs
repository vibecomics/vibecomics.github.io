/**
 * Builds the CLI's command table (src/cli/commands.gen.ts): for every callable
 * node of the ComicBuilder API, its docs and how each parameter is typed on the
 * command line. The JSDoc (collected by scripts/build/extract-docs.mjs) supplies the
 * descriptions and the parameter names and text; scripts/build/cli-inputs.mjs says
 * what kind of value each parameter is. The build fails when the two disagree
 * about a function's parameters, so the CLI cannot drift from the API.
 */
import { INPUTS, POSITIONAL } from './cli-inputs.mjs';

const KINDS = new Set([
  'string',
  'multiline',
  'number',
  'stringOrNumber',
  'enum',
  'json',
  'file',
  'object',
]);

/** The first sentence of a description, on one line. */
function summarize(description) {
  const paragraph = description
    .split(/\n\s*\n/)[0]
    .replace(/\s+/g, ' ')
    .trim();
  const end = paragraph.search(/[.:] |[.:]$/);
  const sentence = end < 0 ? paragraph : paragraph.slice(0, end + 1);
  return sentence.replace(/:$/, '.');
}

function checkInputs(functionPaths, details, prefix) {
  const problems = [];
  const known = new Set();
  for (const fnPath of functionPaths) {
    const short = fnPath.slice(prefix.length);
    known.add(short);
    const documented = details.get(fnPath).params.map(([name]) => name);
    const spec = Object.keys(INPUTS[short] ?? {});
    if (documented.join() !== spec.join()) {
      problems.push(
        `${short}: JSDoc parameters (${documented.join(', ') || 'none'}) differ from ` +
          `scripts/build/cli-inputs.mjs (${spec.join(', ') || 'none'})`
      );
    }
  }
  for (const short of Object.keys(INPUTS)) {
    if (!known.has(short))
      problems.push(`${short}: in scripts/build/cli-inputs.mjs but not in the API`);
  }
  const checkKinds = (where, fields) => {
    for (const [name, field] of Object.entries(fields)) {
      if (!KINDS.has(field.type)) problems.push(`${where}.${name}: unknown kind "${field.type}"`);
      if (field.type === 'enum' && !field.options?.length) {
        problems.push(`${where}.${name}: an enum needs options`);
      }
      if (field.type === 'object') checkKinds(`${where}.${name}`, field.fields ?? {});
    }
  };
  for (const [short, fields] of Object.entries(INPUTS)) checkKinds(short, fields);
  for (const [short, names] of Object.entries(POSITIONAL)) {
    const params = Object.keys(INPUTS[short] ?? {});
    for (const name of names) {
      if (!params.includes(name))
        problems.push(`${short}: positional "${name}" is not a parameter`);
    }
  }
  if (problems.length) {
    throw new Error(`cli: input spec out of date:\n  ${problems.join('\n  ')}`);
  }
}

function paramSpec(name, field, doc) {
  return {
    name,
    kind: field.type,
    optional: Boolean(field.optional),
    doc: doc ?? '',
    ...(field.example && { example: field.example }),
    ...(field.help && { help: field.help }),
    ...(field.options && { options: field.options }),
    ...(field.allowEmpty && { allowEmpty: true }),
    ...(field.flag && { flag: field.flag }),
    ...(field.fromFile && { fromFile: field.fromFile }),
    ...(field.type === 'object' && {
      fields: Object.entries(field.fields).map(([key, child]) => paramSpec(key, child)),
    }),
  };
}

/**
 * @param {object} args
 * @param {Map<string, {description: string, params: [string, string][], returns: string}>} args.details JSDoc by dotted path
 * @param {Set<string>} args.functions paths of the callable nodes
 * @param {string} args.rootName the root of the path, e.g. `ComicBuilder`
 */
export function buildCommands({ details, functions, rootName }) {
  const prefix = `${rootName}.`;
  // `help` is the CLI's own help (`vibecomics help --full` prints the same reference). Any other
  // function outside a namespace would have no `<namespace> <function>` command to reach it.
  const topLevel = [...functions].filter((p) => p.slice(prefix.length).split('.').length === 1);
  const unroutable = topLevel.filter((p) => p !== `${prefix}help`);
  if (unroutable.length) {
    throw new Error(
      `cli: ${unroutable.map((p) => p.slice(prefix.length)).join(', ')} is not in a namespace, so ` +
        'the CLI cannot route it; put it in a namespace or teach src/cli/main.ts about it'
    );
  }
  const routed = [...functions].filter((p) => !topLevel.includes(p));
  checkInputs(routed, details, prefix);

  const commands = routed.map((fnPath) => {
    const short = fnPath.slice(prefix.length);
    const detail = details.get(fnPath);
    const docs = new Map(detail.params);
    return {
      path: short,
      summary: summarize(detail.description),
      description: detail.description,
      returns: detail.returns,
      ...(POSITIONAL[short] && { positional: POSITIONAL[short] }),
      params: Object.entries(INPUTS[short] ?? {}).map(([name, field]) =>
        paramSpec(name, field, docs.get(name))
      ),
    };
  });

  const namespaces = [...details.keys()]
    .filter((p) => p.split('.').length === 2 && p !== rootName)
    .filter((p) => [...details.keys()].some((other) => other.startsWith(`${p}.`)))
    .map((p) => ({ name: p.slice(prefix.length), description: details.get(p).description }));

  return { commands, namespaces };
}
