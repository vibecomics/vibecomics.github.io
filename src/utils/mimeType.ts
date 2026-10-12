/** The MIME type a stored file's name maps to, from its extension. Browser- and Node-safe. */

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  json: 'application/json',
};

export function mimeTypeOf(fileName: string): string {
  const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}
