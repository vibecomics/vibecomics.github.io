import { useEffect, useState } from 'react';
import { driveFileIdFromUrl } from '../utils/driveUrl';
import { loadBlobUrl } from './mediaImages';

/**
 * A layer image URL as something an <img> can show. A Drive URL needs the user's access token, so
 * its bytes are fetched once and served from a blob URL; null until that load finishes. Anything
 * else (a storage-server URL, which needs no auth and answers CORS GETs directly) is returned as-is.
 */
export function useDriveImage(src: string): string | null {
  const [loaded, setLoaded] = useState<{ src: string; url: string } | null>(null);
  const fileId = driveFileIdFromUrl(src);

  useEffect(() => {
    if (!fileId) return;
    let current = true;
    loadBlobUrl(fileId).then(
      (url) => current && setLoaded({ src, url }),
      () => undefined
    );
    return () => {
      current = false;
    };
  }, [src, fileId]);

  if (!src) return null;
  if (!fileId) return src;
  return loaded?.src === src ? loaded.url : null;
}
