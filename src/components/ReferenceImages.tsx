import { useState } from 'react';
import { cb } from '../ai/actions';
import type { MediaItem } from '../types/comic';
import FileButton from './FileButton';
import ImageLightbox from './ImageLightbox';
import MediaThumb from './MediaThumb';
import { uploadImage } from './panelActions';
import { useTask } from './useTask';

interface Props {
  kind: 'characters' | 'scenes' | 'objects';
  entryId: string;
  imageIds: string[];
  media: MediaItem[];
}

/** Reference images of a story-bible entry: thumbnails plus an upload button. */
export default function ReferenceImages({ kind, entryId, imageIds, media }: Props) {
  const task = useTask();
  const [viewing, setViewing] = useState<number | null>(null);
  const items = imageIds.flatMap((id) => media.find((m) => m.id === id) ?? []);

  async function upload(files: File[]) {
    const entries = cb()[kind];
    for (const file of files) {
      const item = await uploadImage(file);
      const current = entries.get(entryId)?.imageIds ?? [];
      entries.update(entryId, { imageIds: [...current, item.id] });
    }
  }

  return (
    <div className="mt-3">
      <div className="d-flex flex-wrap gap-2 align-items-center">
        {items.map((item, i) => (
          <MediaThumb
            key={item.id}
            item={item}
            onOpen={() => setViewing(i)}
            onRemove={() =>
              cb()[kind].update(entryId, { imageIds: imageIds.filter((id) => id !== item.id) })
            }
          />
        ))}
        <FileButton
          label="Upload reference images"
          busy={task.busy}
          multiple
          onFiles={(files) => void task.run(() => upload(files))}
        />
      </div>
      {viewing !== null && (
        <ImageLightbox items={items} start={viewing} onClose={() => setViewing(null)} />
      )}
      {task.error && <div className="text-danger small mt-2">Could not upload: {task.error}</div>}
    </div>
  );
}
