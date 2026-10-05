import { useState } from 'react';
import { cb } from '../ai/actions';
import type { ComicProject } from '../types/comic';
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_PRESETS } from '../types/comic';
import { isCoverOnly } from '../state/project';
import type { EditorTab } from './editorTabs';
import HelpSection from './HelpSection';
import PageSizeOptions from './PageSizeOptions';
import StyleField from './StyleField';

interface Props {
  project: ComicProject;
  onTabChange: (tab: EditorTab) => void;
}

/** Project title, page size, and the comic style stitched into every image's prompt. */
export default function OutlineTab({ project, onTabChange }: Props) {
  const [note, setNote] = useState('');
  const pageSize = project.metadata.pageSize ?? DEFAULT_PAGE_SIZE;
  const presetIndex = PAGE_SIZE_PRESETS.findIndex(
    (p) => p.widthIn === pageSize.widthIn && p.heightIn === pageSize.heightIn
  );

  return (
    <div className="container py-4" style={{ maxWidth: 800 }}>
      <h2 className="h5 mb-4">Comic Style (Project: {project.title})</h2>

      {isCoverOnly(project) && (
        <HelpSection title="How a comic is built" open>
          <p>
            A comic is made of pages. Each page is split into panels, and each panel is built from
            layers and a background.
          </p>
          <p>
            To keep the comic consistent, you also create the characters, props and scenes it uses.
            Together they are the cast, props and scenes, and every panel can reuse them.
          </p>
          <p className="mb-0">
            This project has no pages yet.{' '}
            <button
              type="button"
              className="btn btn-link p-0 align-baseline"
              onClick={() => onTabChange('pages')}
            >
              Create a page
            </button>{' '}
            or{' '}
            <button
              type="button"
              className="btn btn-link p-0 align-baseline"
              onClick={() => onTabChange('cast')}
            >
              create a character
            </button>{' '}
            to get started.
          </p>
        </HelpSection>
      )}

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
          <PageSizeOptions />
        </select>
        <div className="form-text">
          {pageSize.widthIn}&quot; × {pageSize.heightIn}&quot; — stored in the project metadata.
          {note && <span className="text-success ms-2">{note}</span>}
        </div>
      </div>

      <StyleField
        id="outline-text"
        label="Comic style"
        rows={4}
        value={project.metadata.style}
        placeholder="e.g. Inked line art with flat colour, muted earth tones with one bright accent, soft light from a window, gritty 1980s noir."
        onSave={(text) => cb().metadata.setStyle(text)}
      />
    </div>
  );
}
