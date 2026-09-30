import { toggleGenerationPanel, useGenerationPanelOpen } from './generationPanelState';
import { useGenerationQueue } from './useGenerationStatus';

/** The toolbar's single 🪄 button: toggles the generation panel (rendered by EditorScreen, as a
 * flex sibling of the tab content — see GenerationPanel and generationPanelState), which lists the
 * queue and lets you generate every dirty layer. Badged with how many items are queued or actively
 * running, so there's a hint even while the panel is closed. */
export default function GeneratorButton() {
  const open = useGenerationPanelOpen();
  const queue = useGenerationQueue();
  const activeCount = queue.filter((i) => i.status === 'queued' || i.status === 'running').length;

  return (
    <button
      type="button"
      className="btn btn-sm btn-outline-light d-flex align-items-center justify-content-center"
      title="Generation queue"
      aria-label="Generation queue"
      aria-expanded={open}
      onClick={toggleGenerationPanel}
    >
      🪄
      {activeCount > 0 && <span className="badge bg-light text-dark ms-1">{activeCount}</span>}
    </button>
  );
}
