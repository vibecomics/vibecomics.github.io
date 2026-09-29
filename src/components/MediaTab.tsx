import type { MediaItem } from '../types/comic';
import MediaGrid from './MediaGrid';
import { uploadImage } from './panelActions';
import { useTask } from './useTask';

/** Every image uploaded to the project, to browse and delete (not to pick one for a slot). */
export default function MediaTab({ media }: { media: MediaItem[] }) {
  const task = useTask();

  return (
    <div className="container-fluid py-4">
      <h2 className="h5 mb-3">Media</h2>
      <MediaGrid
        media={media}
        prefer={{ kind: 'all' }}
        onUpload={(file) => void task.run(async () => void (await uploadImage(file)))}
      />
      {task.error && <div className="text-danger small mt-2">{task.error}</div>}
    </div>
  );
}
