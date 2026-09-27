import type { MediaItem } from '../types/comic';

export type FileRef = Pick<MediaItem, 'fileName'>;

/** The key a file is cached, queued and looked up under: its stable name. */
export const mediaKey = (ref: FileRef): string => ref.fileName;
