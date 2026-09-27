import { useEffect, useState } from 'react';
import type { MediaItem } from '../types/comic';
import { errorMessage } from '../utils/errors';
import { mediaKey } from '../utils/mediaKey';
import { loadDisplayUrl } from './mediaImages';

type Source = Pick<MediaItem, 'fileName' | 'thumbnailFileName'>;

/**
 * An image as something an <img> can show: its thumbnail when it has one that loads, else the full
 * file. `failed` when neither could be loaded, with the reason in `error`.
 */
export function useMediaUrl(source: Source | null): {
  url: string | null;
  failed: boolean;
  error: string | null;
} {
  const full = source ? mediaKey(source) : null;
  const { fileName, thumbnailFileName } = source ?? {};
  const key = full && `${thumbnailFileName ?? ''}/${full}`;
  const [state, setState] = useState<{ key: string | null; url: string | null; error?: string }>({
    key: null,
    url: null,
  });

  useEffect(() => {
    if (!full || !fileName) return;
    let current = true;
    loadDisplayUrl({ fileName, thumbnailFileName }).then(
      (url) => current && setState({ key, url }),
      (e) => current && setState({ key, url: null, error: errorMessage(e) })
    );
    return () => {
      current = false;
    };
  }, [key, full, fileName, thumbnailFileName]);

  const settled = key !== null && state.key === key;
  return {
    url: settled ? state.url : null,
    failed: settled && !state.url,
    error: settled ? (state.error ?? null) : null,
  };
}
