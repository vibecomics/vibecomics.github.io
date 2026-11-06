/**
 * Attach each generated doc string (ACTION_DOCS, keyed by dotted path) as the
 * non-enumerable toString() of its node in the action tree, so
 * `ComicBuilder.storage.connect.toString()` in the console prints its docs.
 */
export function attachDocs(root: object, docs: Record<string, string>, rootPath: string): void {
  const seen = new Set<object>();

  function visit(node: unknown, path: string): void {
    if ((typeof node !== 'object' && typeof node !== 'function') || node === null) return;
    if (seen.has(node)) return;
    seen.add(node);

    const doc = docs[path];
    if (doc) {
      Object.defineProperty(node, 'toString', { value: () => doc, configurable: true });
    }
    for (const [key, child] of Object.entries(node)) visit(child, `${path}.${key}`);
  }

  visit(root, rootPath);
}
