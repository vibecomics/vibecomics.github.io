import type { ReactNode } from 'react';

interface Props {
  title: string;
  open?: boolean;
  children: ReactNode;
}

/** Expandable help, in its own colour and type so it reads as help rather than as the content around it. */
export default function HelpSection({ title, open, children }: Props) {
  return (
    <details className="help-section mb-4" open={open}>
      <summary className="h5 mb-0">{title}</summary>
      <div className="help-body mt-3">{children}</div>
    </details>
  );
}
