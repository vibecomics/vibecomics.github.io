/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBlobStore } from './blobStore';
import type { CacheLike, CacheStorageLike } from './blobStore';

/** An in-memory stand-in for the browser's CacheStorage. */
function fakeStorage() {
  const caches = new Map<string, Map<string, Response>>();
  const storage: CacheStorageLike = {
    async open(name) {
      const entries = caches.get(name) ?? new Map<string, Response>();
      caches.set(name, entries);
      const cache: CacheLike = {
        async match(key) {
          return entries.get(key)?.clone();
        },
        async put(key, response) {
          entries.set(key, response);
        },
        async delete(key) {
          return entries.delete(key);
        },
        async keys() {
          return [...entries.keys()].map((url) => ({ url }));
        },
      };
      return cache;
    },
    async delete(name) {
      return caches.delete(name);
    },
  };
  return { storage, caches };
}

const blob = (size: number, type = 'image/png') => new Blob([new Uint8Array(size)], { type });
const options = { cacheName: 'test', maxBytes: 100, maxFileBytes: 60 };

test('a stored file comes back with its type, and an unknown id finds nothing', async () => {
  const { storage } = fakeStorage();
  const store = createBlobStore(storage, options);
  assert.equal(await store.get('a'), undefined);
  await store.put('a', blob(10, 'image/jpeg'));
  const found = await store.get('a');
  assert.equal(found?.size, 10);
  assert.equal(found?.type, 'image/jpeg');
  assert.equal(await store.get('b'), undefined);
});

test('ids with odd characters are stored separately', async () => {
  const { storage } = fakeStorage();
  const store = createBlobStore(storage, options);
  await store.put('a/b', blob(1));
  await store.put('a?b', blob(2));
  assert.equal((await store.get('a/b'))?.size, 1);
  assert.equal((await store.get('a?b'))?.size, 2);
});

test('a second store on the same cache sees what the first kept', async () => {
  const { storage } = fakeStorage();
  await createBlobStore(storage, options).put('a', blob(10));
  assert.equal((await createBlobStore(storage, options).get('a'))?.size, 10);
});

test('past the limit the oldest files go first, and the newest stays', async () => {
  const { storage } = fakeStorage();
  let clock = 0;
  const store = createBlobStore(storage, { ...options, now: () => ++clock });
  await store.put('a', blob(40));
  await store.put('b', blob(40));
  await store.put('c', blob(40)); // 120 > 100: a, the oldest, goes
  assert.equal(await store.get('a'), undefined);
  assert.equal((await store.get('b'))?.size, 40);
  assert.equal((await store.get('c'))?.size, 40);
});

test('the sizes and ages of files kept by an earlier session count toward the limit', async () => {
  const { storage } = fakeStorage();
  let clock = 0;
  const first = createBlobStore(storage, { ...options, now: () => ++clock });
  await first.put('a', blob(50));
  await first.put('b', blob(40));
  const second = createBlobStore(storage, { ...options, now: () => ++clock + 100 });
  await second.put('c', blob(50)); // 140 > 100: a is the oldest
  assert.equal(await second.get('a'), undefined);
  assert.equal((await second.get('b'))?.size, 40);
  assert.equal((await second.get('c'))?.size, 50);
});

test('a file over the per-file limit is not stored', async () => {
  const { storage } = fakeStorage();
  const store = createBlobStore(storage, options);
  await store.put('big', blob(61));
  assert.equal(await store.get('big'), undefined);
});

test('clear forgets everything', async () => {
  const { storage, caches } = fakeStorage();
  const store = createBlobStore(storage, options);
  await store.put('a', blob(10));
  await store.clear();
  assert.equal(caches.has('test'), false);
  assert.equal(await store.get('a'), undefined);
  await store.put('b', blob(5)); // usable again afterwards
  assert.equal((await store.get('b'))?.size, 5);
});

test('without a Cache API, or when it fails, nothing breaks', async () => {
  const none = createBlobStore(undefined, options);
  await none.put('a', blob(1));
  assert.equal(await none.get('a'), undefined);
  await none.clear();

  const broken: CacheStorageLike = {
    open: async () => {
      throw new Error('blocked');
    },
    delete: async () => {
      throw new Error('blocked');
    },
  };
  const store = createBlobStore(broken, options);
  await store.put('a', blob(1));
  assert.equal(await store.get('a'), undefined);
  await store.clear();
});
