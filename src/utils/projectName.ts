/**
 * Validate a project (folder) name: rejects anything that could escape a path or hide from a
 * listing, shared by every backend that keys storage by project name. Browser- and Node-safe.
 */
export function sanitizeProjectName(name: unknown): string {
  if (typeof name !== 'string') throw new Error('name must be a string.');
  const trimmed = name.trim();
  if (!trimmed) throw new Error('name must not be empty.');
  if (trimmed.length > 200) throw new Error('name is too long (200 characters max).');
  if (trimmed === '.' || trimmed === '..') throw new Error('name is reserved.');
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    throw new Error('name must not contain path separators.');
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(trimmed)) {
    throw new Error('name must not contain control characters.');
  }
  return trimmed;
}
