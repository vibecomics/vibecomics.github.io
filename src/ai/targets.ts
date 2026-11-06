/**
 * What a generation call is aimed at, as one string the command line (and an LLM) can write:
 *
 *   layer:<panelId>/<layerId>                      a layer or background
 *   reference:<kind>/<entryId>                     a character/scene/object's own reference image
 *   reference:<kind>/<entryId>/<variationId>       one variation of it
 *   reference:<kind>/<entryId>/*                   every variation of it (batch calls only)
 *   panel:<panelId>                                a whole-panel image
 *
 * `<kind>` is characters, scenes or objects. The UI passes the equivalent GenerationTarget object.
 */
import type { GenerationTarget, ReferenceKind } from './generation';

const KINDS: readonly string[] = ['characters', 'scenes', 'objects'];

export const TARGET_SYNTAX =
  'layer:<panelId>/<layerId> | reference:<kind>/<entryId>[/<variationId>] | panel:<panelId>';

/** Any target the generate functions can be aimed at. */
export type AnyTarget =
  | GenerationTarget
  | { type: 'panel'; panelId: string }
  | { type: 'variations'; kind: ReferenceKind; entryId: string };

/** The string form of a target (the inverse of parseTarget). */
export function formatTarget(target: AnyTarget): string {
  switch (target.type) {
    case 'layer':
      return `layer:${target.panelId}/${target.layerId}`;
    case 'panel':
      return `panel:${target.panelId}`;
    case 'variations':
      return `reference:${target.kind}/${target.entryId}/*`;
    case 'reference':
      return `reference:${target.kind}/${target.entryId}${
        target.variationId ? `/${target.variationId}` : ''
      }`;
  }
}

/** Parse a target string, or pass an object through. Throws a message that shows the syntax. */
export function parseTarget(input: string | AnyTarget): AnyTarget {
  if (typeof input !== 'string') return input;
  const bad = (why: string) =>
    new Error(`Bad target "${input}": ${why}. Targets look like: ${TARGET_SYNTAX}.`);
  const colon = input.indexOf(':');
  if (colon < 0) throw bad('expected "<type>:<ids>"');
  const type = input.slice(0, colon);
  const ids = input.slice(colon + 1).split('/');
  if (ids.some((id) => !id)) throw bad('an id is empty');
  if (type === 'layer') {
    if (ids.length !== 2) throw bad('a layer is layer:<panelId>/<layerId>');
    return { type: 'layer', panelId: ids[0], layerId: ids[1] };
  }
  if (type === 'panel') {
    if (ids.length !== 1) throw bad('a panel is panel:<panelId>');
    return { type: 'panel', panelId: ids[0] };
  }
  if (type === 'reference') {
    const [kind, entryId, variationId, ...extra] = ids;
    if (!KINDS.includes(kind)) throw bad(`kind must be one of ${KINDS.join(', ')}`);
    if (!entryId || extra.length)
      throw bad('a reference is reference:<kind>/<entryId>[/<variationId>]');
    if (variationId === '*') return { type: 'variations', kind: kind as ReferenceKind, entryId };
    return {
      type: 'reference',
      kind: kind as ReferenceKind,
      entryId,
      ...(variationId && { variationId }),
    };
  }
  throw bad(`unknown type "${type}"`);
}
