interface Props {
  /** Unique on the screen: ties the label to the box. */
  id: string;
  label: string;
  /** Keep the label for screen readers but not on screen (a heading already says it). */
  hideLabel?: boolean;
  /** Says what the prompt is for; it shows while the box is empty. */
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}

/** A labelled box for the prompt (the intent) of a page or a panel. */
export default function PromptField({ id, label, hideLabel, placeholder, value, onChange }: Props) {
  return (
    <div className="mb-3">
      <label
        className={`form-label fw-semibold small mb-1${hideLabel ? ' visually-hidden' : ''}`}
        htmlFor={id}
      >
        {label}
      </label>
      <textarea
        id={id}
        className="form-control form-control-sm"
        rows={3}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
