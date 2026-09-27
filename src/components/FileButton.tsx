import Spinner from './Spinner';

interface Props {
  label: string;
  busy?: boolean;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
}

/** A button that opens the image file picker. */
export default function FileButton({ label, busy = false, multiple = false, onFiles }: Props) {
  return (
    <label className={`btn btn-outline-secondary btn-sm${busy ? ' disabled' : ''}`}>
      {busy && <Spinner />}
      {busy ? 'Uploading…' : label}
      <input
        type="file"
        accept="image/*"
        multiple={multiple}
        className="d-none"
        disabled={busy}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </label>
  );
}
