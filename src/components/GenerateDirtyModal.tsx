import { createPortal } from 'react-dom';
import { pendingGenerations } from '../ai/builders';
import type { ComicProject } from '../types/comic';

interface Props {
  project: ComicProject;
  onGenerate: () => void;
  onClose: () => void;
}

/** Everything the "Generate all" button will generate: each layer or background whose image no
 * longer matches its prompt, grouped by where it sits in the comic. */
export default function GenerateDirtyModal({ project, onGenerate, onClose }: Props) {
  const items = pendingGenerations(project);

  return createPortal(
    <>
      <div className="modal-backdrop show" />
      <div
        className="modal d-block"
        role="dialog"
        aria-modal="true"
        aria-label="Images to generate"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="modal-dialog modal-lg modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="modal-title h5">
                ✨ {items.length} image{items.length === 1 ? '' : 's'} to generate
              </h2>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            <div className="modal-body">
              <ul className="list-group">
                {items.map((item) => (
                  <li key={`${item.panelId}/${item.layerId}`} className="list-group-item">
                    <div className="d-flex justify-content-between gap-2">
                      <strong>{item.name}</strong>
                      <span className="small text-muted text-nowrap">
                        Page {item.page} · {item.panelTitle || `Panel ${item.panelNumber}`}
                      </span>
                    </div>
                    <div className="small text-muted">
                      {item.kind === 'background' ? 'Background' : 'Layer'} ·{' '}
                      {item.hasImage ? 'prompt changed since the image was made' : 'no image yet'}
                    </div>
                    {item.prompt && <div className="small mt-1">{item.prompt}</div>}
                  </li>
                ))}
              </ul>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={items.length === 0}
                onClick={onGenerate}
              >
                ✨ Generate {items.length}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
