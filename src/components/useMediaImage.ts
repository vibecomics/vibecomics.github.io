import { useEffect, useState } from 'react';
import type { MediaItem } from '../types/comic';
import { mediaKey } from '../utils/mediaKey';
import { loadBlobUrl } from './mediaImages';

/**
 * A layer's image, resolved from its registered MediaItem, as something an <img> can show. Its
 * bytes are fetched once and served from a blob URL: on Drive an <img> tag cannot send the access
 * token, and on any backend the cache spares a request per render. null while loading, or while
 * the layer has no image yet.
 */
export function useMediaImage(item: MediaItem | undefined): string | null {
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null);
  const key = item ? mediaKey(item) : null;

  useEffect(() => {
    if (!item || !key) return;
    let current = true;
    loadBlobUrl(item).then(
      (url) => current && setLoaded({ key, url }),
      () => undefined
    );
    return () => {
      current = false;
    };
  }, [item, key]);

  return key !== null && loaded?.key === key ? loaded.url : null;
}
