import { downloadFile, findFileByName, getCurrentFolderId } from '../storage/activeBackend';
import type { MediaItem } from '../types/comic';
import { createBlobStore } from '../utils/blobStore';
import { mediaKey } from '../utils/mediaKey';
import type { FileRef } from '../utils/mediaKey';

/** The backend id for a file ref's stable name, resolved by listing the open project's folder. */
async function resolveFileId(ref: FileRef): Promise<string> {
  const folderId = getCurrentFolderId();
  if (!folderId) throw new Error('No project folder is open.');
  const found = await findFileByName(folderId, ref.fileName);
  if (!found) throw new Error(`No file named "${ref.fileName}" in this project.`);
  return found.id;
}

const blobUrls = new Map<string, Promise<string>>();

// Images already fetched from storage are kept in the browser's Cache API, so a reload or a later
// visit does not fetch them again. The oldest go when the total passes the limit.
const store = createBlobStore(typeof caches === 'undefined' ? undefined : caches, {
  // One cache per app, since every GitHub Pages project of a user shares one origin.
  cacheName: `vibecomics-media:${import.meta.env.BASE_URL}`,
  maxBytes: 250 * 1024 * 1024,
  maxFileBytes: 30 * 1024 * 1024,
});

/** Forget every image kept in the browser: the next person to use it must not see this one's pictures. */
export async function clearMediaCache(): Promise<void> {
  blobUrls.clear();
  await store.clear();
}

// Downloads go through a small queue: a picker with dozens of images must not fire them all at once
// (Drive answers a burst with rate-limit errors). Images on screen jump ahead of background work.
type Priority = 'high' | 'low';
interface Job {
  id: string;
  priority: Priority;
  run: () => void;
}
const MAX_DOWNLOADS = 4;
const queue: Job[] = [];
let active = 0;

function pump() {
  while (active < MAX_DOWNLOADS && queue.length > 0) {
    const next = queue.findIndex((job) => job.priority === 'high');
    const [job] = queue.splice(Math.max(next, 0), 1);
    active++;
    job.run();
  }
}

function schedule<T>(id: string, priority: Priority, task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    queue.push({
      id,
      priority,
      run: () =>
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            pump();
          }),
    });
    pump();
  });
}

const RETRY_DELAY_MS = 500;
const MAX_ATTEMPTS = 3;

/** Drive's "slow down" answers: too many requests, a quota, or a server hiccup. */
function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return /Drive API error (429|5\d\d)/.test(message) || /rate ?limit|quota/i.test(message);
}

async function downloadWithRetry(ref: FileRef): Promise<Blob> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await downloadFile(await resolveFileId(ref));
    } catch (e) {
      if (attempt >= MAX_ATTEMPTS || !isRetryable(e)) throw e;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * 2 ** (attempt - 1)));
    }
  }
}

/**
 * A registered file's bytes as a blob URL, fetched once and cached: on Drive that avoids sending
 * the access token to an `<img>` tag, and on any backend it avoids resolving the stable name to a
 * backend id on every access. `low` priority is for work nobody is looking at; asking for the same
 * file at `high` speeds it up.
 */
export function loadBlobUrl(ref: FileRef, priority: Priority = 'high'): Promise<string> {
  const key = mediaKey(ref);
  let url = blobUrls.get(key);
  if (url) {
    if (priority === 'high') {
      for (const job of queue) if (job.id === key) job.priority = 'high';
    }
    return url;
  }
  url = (async () => {
    // A kept copy needs no download, so it does not wait in the download queue.
    const kept = await store.get(key);
    if (kept) return URL.createObjectURL(kept);
    const blob = await schedule(key, priority, () => downloadWithRetry(ref));
    void store.put(key, blob);
    return URL.createObjectURL(blob);
  })();
  url.catch(() => blobUrls.delete(key));
  blobUrls.set(key, url);
  return url;
}

/** An image as shown in lists and pickers: its thumbnail, or the full image when it has none or the thumbnail cannot be loaded. */
export async function loadDisplayUrl(
  item: Pick<MediaItem, 'fileName' | 'thumbnailFileName'>,
  priority: Priority = 'high'
): Promise<string> {
  if (item.thumbnailFileName) {
    try {
      return await loadBlobUrl({ fileName: item.thumbnailFileName }, priority);
    } catch {
      // Fall through to the full image.
    }
  }
  return loadBlobUrl(item, priority);
}

/**
 * Show an image full size in a new browser tab. Drive needs the access token, so the tab shows a
 * blob URL of the downloaded bytes; the tab is opened first, inside the click, so pop-up blockers
 * allow it. Throws when the browser blocks the tab.
 */
export function openInNewTab(item: Pick<MediaItem, 'fileName' | 'name'>): void {
  const tab = window.open('', '_blank');
  if (!tab) throw new Error('The browser blocked the new tab. Allow pop-ups for this site.');
  tab.document.title = item.name;
  tab.document.body.textContent = 'Loading image…';
  loadBlobUrl(item).then(
    (url) => {
      tab.location.href = url;
    },
    () => {
      tab.document.body.textContent = 'Could not load the image.';
    }
  );
}

/** What the picker needs to know about an image: its shape and whether it has see-through areas. */
export interface MediaInfo {
  /** Width / height. */
  aspect: number;
  /** Has a real share of transparent pixels: a cut-out for a layer rather than a full-bleed background. */
  transparent: boolean;
}

const infos = new Map<string, MediaInfo>();
const pendingInfos = new Map<string, Promise<MediaInfo>>();

const MIME_WITH_ALPHA = /png|webp|gif|avif|svg/;
const SAMPLE_SIZE = 64;

function hasTransparency(image: HTMLImageElement): boolean {
  const scale = Math.min(1, SAMPLE_SIZE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) return false;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let clear = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) clear++;
  return clear / (data.length / 4) > 0.005;
}

/** The info of an image that has already been read, else undefined. */
export function cachedMediaInfo(key: string): MediaInfo | undefined {
  return infos.get(key);
}

/** Read an image's shape and transparency (once per file), from its thumbnail when it has one. */
export function loadMediaInfo(
  item: Pick<MediaItem, 'fileName' | 'thumbnailFileName' | 'mimeType'>
): Promise<MediaInfo> {
  const key = mediaKey(item);
  let info = pendingInfos.get(key);
  if (!info) {
    info = (async () => {
      const image = new Image();
      image.src = await loadDisplayUrl(item, 'low');
      await image.decode();
      const result = {
        aspect: Math.round((image.naturalWidth / image.naturalHeight) * 1000) / 1000,
        transparent: MIME_WITH_ALPHA.test(item.mimeType) && hasTransparency(image),
      };
      infos.set(key, result);
      return result;
    })();
    info.catch(() => pendingInfos.delete(key));
    pendingInfos.set(key, info);
  }
  return info;
}
