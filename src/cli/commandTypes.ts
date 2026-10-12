/** How a parameter is typed on the command line (see scripts/build/cli-inputs.mjs). */
export type ParamKind =
  'string' | 'multiline' | 'number' | 'stringOrNumber' | 'enum' | 'json' | 'file' | 'object';

export interface ParamSpec {
  name: string;
  kind: ParamKind;
  optional: boolean;
  /** The parameter's text from the JSDoc. */
  doc: string;
  example?: string;
  help?: string;
  options?: string[];
  allowEmpty?: boolean;
  /** The flag of an object field, when it is not the field's name. */
  flag?: string;
  /** When left out, the value comes from the file given for another parameter. */
  fromFile?: { param: string; use: 'name' | 'type' };
  /** The fields of an `object` parameter. */
  fields?: ParamSpec[];
}

export interface CommandSpec {
  /** Dotted API path without the root, e.g. `layers.add`. */
  path: string;
  summary: string;
  description: string;
  returns: string;
  /** When set, only these parameters are positional (in this order); the rest are flags. */
  positional?: string[];
  params: ParamSpec[];
}

export interface CommandTable {
  commands: CommandSpec[];
  namespaces: Array<{ name: string; description: string }>;
}
