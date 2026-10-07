import { useState } from 'react';
import type { ReactNode } from 'react';

interface Props {
  title: string;
  open?: boolean;
  children: ReactNode;
}

/** Expandable help, in its own colour and type so it reads as help rather than as the content around it. A cross dismisses it for this view. */
export default function HelpSection({ title, open, children }: Props) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <details className="help-section mt-3 mb-4" open={open}>
      <summary className="h5 mb-0 justify-content-between gap-2">
        <span>{title}</span>
        <button
          type="button"
          className="btn-close flex-shrink-0"
          style={{ fontSize: '0.65rem' }}
          aria-label="Hide this help"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDismissed(true);
          }}
        />
      </summary>
      <div className="help-body mt-3">{children}</div>
    </details>
  );
}
