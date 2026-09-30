import type { ReactNode } from 'react';

export const ICON_BUTTON_SIZE = 34;

interface Props {
  label: string;
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

/** A small square icon-only button, always with a tooltip (title) and an accessible label, since it
 * has no visible text of its own to explain what it does. */
export default function IconButton({ label, title, disabled, onClick, children }: Props) {
  return (
    <button
      type="button"
      className="btn btn-outline-secondary p-0 d-flex align-items-center justify-content-center"
      style={{ width: ICON_BUTTON_SIZE, height: ICON_BUTTON_SIZE, fontSize: 15, lineHeight: 1 }}
      disabled={disabled}
      title={title}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
