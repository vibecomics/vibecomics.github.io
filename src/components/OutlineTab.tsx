import { useState } from 'react';
import { cb } from '../ai/actions';
import type { ComicProject } from '../types/comic';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_PRESETS } from '../types/comic';

/** Project title, page size and the STYLE paragraph stitched into every image's prompt. */
export default function OutlineTab({ project }: { project: ComicProject }) {
  const [style, setStyle] = useState(project.metadata.style);
  const [characterStyle, setCharacterStyle] = useState(project.metadata.characterStyle ?? '');
  const [sceneStyle, setSceneStyle] = useState(project.metadata.sceneStyle ?? '');
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
        Stitched, verbatim, into every image's prompt of every kind — keep it to what's true of
        everything (medium, line, palette, lighting, mood). There's no synopsis field: track the
        story itself elsewhere (each page and panel has its own prompt for what happens there).
        Wording that only makes sense for a figure (eye style, skin tone) belongs in Character style
        below instead — putting it here too is what makes an object or scene prompt draw a person.
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

      <hr className="my-4" />

      <label className="form-label fw-semibold" htmlFor="outline-character-style">
        Character style
      </label>
      <textarea
        id="outline-character-style"
        className="form-control"
        rows={2}
        value={characterStyle}
        onChange={(e) => setCharacterStyle(e.target.value)}
        placeholder="Design language that only makes sense for a figure: eye style, proportions, skin tone…"
      />
      <div className="form-text">
        Stitched in only for a character's prompt (reference art, or a foreground layer whose
        subject is a character), right after Style. Left out of object and scene prompts entirely. A
        character may be a person or an animal, so keep this to what's true of either.
      </div>
      <button
        className="btn btn-primary mt-3"
        onClick={() => {
          cb().metadata.setCharacterStyle(characterStyle);
          setNote('Character style saved.');
        }}
      >
        Save character style
      </button>

      <hr className="my-4" />

      <label className="form-label fw-semibold" htmlFor="outline-scene-style">
        Scene style
      </label>
      <textarea
        id="outline-scene-style"
        className="form-control"
        rows={2}
        value={sceneStyle}
        onChange={(e) => setSceneStyle(e.target.value)}
        placeholder="Rendering notes specific to establishing/background art: level of detail, atmosphere…"
      />
      <div className="form-text">
        Stitched in only for a scene's prompt (reference art, or a background layer), right after
        Style. Left out of character and object prompts entirely.
      </div>
      <button
        className="btn btn-primary mt-3"
        onClick={() => {
          cb().metadata.setSceneStyle(sceneStyle);
          setNote('Scene style saved.');
        }}
      >
        Save scene style
      </button>
    </div>
  );
}
