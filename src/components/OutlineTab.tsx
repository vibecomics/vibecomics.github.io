import { useState } from 'react';
import { cb } from '../ai/actions';
import type { ComicProject } from '../types/comic';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_PRESETS } from '../types/comic';

/** Project title, page size and the STYLE paragraph stitched into every image's prompt. */
export default function OutlineTab({ project }: { project: ComicProject }) {
  const [style, setStyle] = useState(project.metadata.style);
  const [note, setNote] = useState('');
  const pageSize = project.metadata.pageSize ?? DEFAULT_PAGE_SIZE;
  const presetIndex = PAGE_SIZE_PRESETS.findIndex(
    (p) => p.widthIn === pageSize.widthIn && p.heightIn === pageSize.heightIn
  );

  return (
    <div className="container py-4" style={{ maxWidth: 800 }}>
      <h2 className="h5 mb-1">Style</h2>
      <p className="text-muted small mb-4">{project.title}</p>

      <div className="mb-4">
        <label className="form-label fw-semibold" htmlFor="outline-pagesize">
          Page size
        </label>
        <select
          id="outline-pagesize"
          className="form-select"
          style={{ maxWidth: 340 }}
          value={presetIndex >= 0 ? presetIndex : 'custom'}
          onChange={(e) => {
            const preset = PAGE_SIZE_PRESETS[Number(e.target.value)];
            if (!preset) return;
            cb().metadata.setPageSize({ ...preset });
            setNote(`Page size set to ${preset.label}.`);
          }}
        >
          {presetIndex < 0 && (
            <option value="custom">
              {pageSize.label} — {pageSize.widthIn}&quot; × {pageSize.heightIn}&quot;
            </option>
          )}
          {PAGE_SIZE_PRESETS.map((preset, i) => (
            <option key={preset.label} value={i}>
              {preset.label}
            </option>
          ))}
        </select>
        <div className="form-text">
          {pageSize.widthIn}&quot; × {pageSize.heightIn}&quot; — stored in the project metadata.
        </div>
      </div>

      <div className="mb-2 d-flex justify-content-between align-items-center">
        <label className="form-label fw-semibold mb-0" htmlFor="outline-text">
          STYLE paragraph
        </label>
        {note && <span className="text-success small">{note}</span>}
      </div>
      <textarea
        id="outline-text"
        className="form-control"
        rows={4}
        value={style}
        onChange={(e) => setStyle(e.target.value)}
        placeholder="A short paragraph fixing the visual style: medium, line, palette, lighting, mood…"
      />
      <div className="form-text">
        Stitched, verbatim, into every image's prompt — keep it to a few sentences. There's no
        synopsis field: track the story itself elsewhere (each page and panel has its own prompt for
        what happens there).
      </div>
      <button
        className="btn btn-primary mt-3"
        onClick={() => {
          cb().metadata.setStyle(style);
          setNote('Style saved.');
        }}
      >
        Save style
      </button>
    </div>
  );
}
