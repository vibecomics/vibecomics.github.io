import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  title: ReactNode;
  /** What a screen reader announces for the dialog. */
  label: string;
  /** A wide dialog, for forms and lists with many fields. */
  wide?: boolean;
  onClose: () => void;
  /** A `.modal-footer` with the dialog's buttons, if it has any. */
  footer?: ReactNode;
  children: ReactNode;
}

/** A dialog shown over the page. A click on the dimmed area, or on the × , closes it. */
export default function Modal({ title, label, wide, onClose, footer, children }: Props) {
  return createPortal(
    <>
      <div className="modal-backdrop show" />
      <div
        className="modal d-block"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className={`modal-dialog modal-dialog-scrollable${wide ? ' modal-lg' : ''}`}>
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="modal-title h5">{title}</h2>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            <div className="modal-body">{children}</div>
            {footer}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
