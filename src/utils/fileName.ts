/**
 * The one rule for the names images are stored under: lowercase letters and digits joined by
 * dashes, then an image extension (`ashwini-running.png`, `ashwini-running.thumb.png`). No spaces, capitals or
 * punctuation, so a name is the same on every backend and file system (a Mac ignores case).
 */

const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif|avif|svg)$/i;
const MAX_STEM_LENGTH = 80;
const VALID_FILE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.thumb)?\.(?:png|jpe?g|webp|gif|avif|svg)$/;

/** True when `name` already follows the storage naming rule. */
export const isValidFileName = (name: string): boolean => VALID_FILE_NAME.test(name);

/** `name` reworded to follow the rule; `defaultExtension` is added when it has no image extension. */
export function toFileName(name: string, defaultExtension = 'png'): string {
  const trimmed = name.trim();
  const found = IMAGE_EXTENSION.exec(trimmed);
  const extension = found ? found[0].toLowerCase() : `.${defaultExtension.toLowerCase()}`;
  let stem = found ? trimmed.slice(0, found.index) : trimmed;
  const thumbnail = /\.thumb$/i.test(stem);
  if (thumbnail) stem = stem.slice(0, -'.thumb'.length);
  const words = stem
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_STEM_LENGTH)
    .replace(/^-+|-+$/g, '');
  return `${words || 'image'}${thumbnail ? '.thumb' : ''}${extension}`;
}

/** A stored file name as people read it: no extension, dashes as spaces, first letter capitalised. */
export function displayName(fileName: string): string {
  const words = fileName
    .replace(/\.thumb(?=\.[^.]+$)/i, '')
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `name` with a number before its extension, for a name that is taken: `a.png` -> `a-2.png`. */
export const numberedFileName = (name: string, n: number): string =>
  name.replace(/((?:\.thumb)?\.[a-z0-9]+)$/, `-${n}$1`);

/** The name of the thumbnail of `fileName`: `a-b.png` -> `a-b.thumb.jpg`. */
export const thumbnailFileNameOf = (fileName: string, extension: string): string =>
  `${fileName.replace(/\.[^.]+$/, '')}.thumb.${extension}`;
