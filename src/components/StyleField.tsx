import { useRef, useState } from 'react';

interface Props {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  rows: number;
  onSave: (text: string) => void;
  /** Save as the user types (and when the box loses focus) instead of with a Save button. */
  autoSave?: boolean;
}

const AUTO_SAVE_DELAY_MS = 500;

/** A style paragraph: the comic's, with a Save button, or a character's or scene's, saved as it is typed. */
export default function StyleField({
  id,
  label,
  placeholder,
  value,
  rows,
  onSave,
  autoSave = false,
}: Props) {
  const [text, setText] = useState(value);
  const [saved, setSaved] = useState(false);
  const pending = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  function flush() {
    window.clearTimeout(timer.current);
    if (pending.current === null) return;
    onSave(pending.current);
    pending.current = null;
  }

  function change(next: string) {
    setText(next);
    setSaved(false);
    if (!autoSave) return;
    pending.current = next;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, AUTO_SAVE_DELAY_MS);
  }

  return (
    <div className="mt-4">
      <label className="form-label fw-semibold" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="form-control"
        rows={rows}
        value={text}
        placeholder={placeholder}
        onChange={(e) => change(e.target.value)}
        onBlur={autoSave ? flush : undefined}
      />
      {!autoSave && (
        <div className="d-flex align-items-center gap-2 mt-2">
          <button
            className="btn btn-primary"
            onClick={() => {
              onSave(text);
              setSaved(true);
            }}
          >
            Save
          </button>
          {saved && <span className="text-success small">Saved.</span>}
        </div>
      )}
    </div>
  );
}
