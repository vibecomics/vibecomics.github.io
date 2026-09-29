/**
 * A size-limited store of downloaded files kept in the browser's Cache API, so an image that was
 * fetched from storage once is not fetched again after a reload. Keys are the images' file names; each
 * is stored under a made-up URL that never reaches the network. Nothing here may break loading:
 * when the Cache API is missing or fails, `get` finds nothing and `put` does nothing.
 *
 * The Cache API has no size limit or expiry of its own, so this remembers each entry's size and
 * the time it was stored, and when the total passes `maxBytes` it deletes the oldest entries first.
 */

/** The part of the Cache API this uses (so a test can stand in for the browser). */
export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
  delete(name: string): Promise<boolean>;
}
export interface CacheLike {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
  delete(key: string): Promise<boolean>;
  keys(): Promise<ReadonlyArray<{ url: string }>>;
}

export interface BlobStore {
  get(id: string): Promise<Blob | undefined>;
  put(id: string, blob: Blob): Promise<void>;
  /** Forget everything stored. */
  clear(): Promise<void>;
}

export interface BlobStoreOptions {
  cacheName: string;
  /** Total size at which the oldest entries start to be deleted. */
  maxBytes: number;
  /** Files bigger than this are not stored at all. */
  maxFileBytes: number;
  now?: () => number;
}

// Not a real host: a URL is only needed as a key, and this can never match a page's own requests.
const KEY_BASE = 'https://media-cache.invalid/';
const keyOf = (id: string) => `${KEY_BASE}${encodeURIComponent(id)}`;

interface Entry {
  key: string;
  size: number;
  at: number;
}

export function createBlobStore(
  storage: CacheStorageLike | undefined,
  { cacheName, maxBytes, maxFileBytes, now = Date.now }: BlobStoreOptions
): BlobStore {
  if (!storage) {
    return { get: async () => undefined, put: async () => undefined, clear: async () => undefined };
  }

  let opened: Promise<{ cache: CacheLike; entries: Map<string, Entry> }> | null = null;
  /** The cache and what is in it (read once per session from the entries' headers, not their bodies). */
  const open = () => {
    opened ??= (async () => {
      const cache = await storage.open(cacheName);
      const entries = new Map<string, Entry>();
      for (const request of await cache.keys()) {
        const response = await cache.match(request.url);
        if (!response) continue;
        entries.set(request.url, {
          key: request.url,
          size: Number(response.headers.get('Content-Length')) || 0,
          at: Number(response.headers.get('X-Cached-At')) || 0,
        });
      }
      return { cache, entries };
    })();
    // A failed open is tried again next time.
    opened.catch(() => (opened = null));
    return opened;
  };

  return {
    async get(id) {
      try {
        const { cache } = await open();
        const response = await cache.match(keyOf(id));
        return response ? await response.blob() : undefined;
      } catch {
        return undefined;
      }
    },

    async put(id, blob) {
      if (blob.size > maxFileBytes) return;
      try {
        const { cache, entries } = await open();
        const key = keyOf(id);
        const at = now();
        await cache.put(
          key,
          new Response(blob, {
            headers: {
              'Content-Type': blob.type,
              'Content-Length': String(blob.size),
              'X-Cached-At': String(at),
            },
          })
        );
        entries.set(key, { key, size: blob.size, at });

        let total = 0;
        for (const entry of entries.values()) total += entry.size;
        if (total <= maxBytes) return;
        const oldestFirst = [...entries.values()].sort((a, b) => a.at - b.at);
        for (const entry of oldestFirst) {
          if (total <= maxBytes || entry.key === key) break;
          await cache.delete(entry.key);
          entries.delete(entry.key);
          total -= entry.size;
        }
      } catch {
        // A full disk or a blocked cache: the image simply is not kept.
      }
    },

    async clear() {
      try {
        opened = null;
        await storage.delete(cacheName);
      } catch {
        // Nothing to do: the next open starts from what is there.
      }
    },
  };
}
