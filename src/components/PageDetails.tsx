import { useState } from 'react';
import { cb } from '../ai/actions';
import type { ComicPage } from '../types/comic';
import { ChevronIcon } from './Icons';
import PromptField from './PromptField';

interface Props {
  page: ComicPage;
  pageIndex: number;
}

/**
 * What you can say about the whole page: its prompt (intent). The last section
 * of the inspector, collapsed until opened, and shown whether or not a panel is
 * highlighted. While collapsed it previews the prompt so you can tell it is set.
 */
export default function PageDetails({ page, pageIndex }: Props) {
  const [open, setOpen] = useState(false);
  const preview = page.prompt?.trim();

  return (
    <section className="px-3 pb-3 pt-2 border-top">
      <button
        type="button"
        className="btn btn-link p-0 d-flex align-items-center gap-1 w-100 text-start text-body text-decoration-none"
        aria-expanded={open}
        aria-controls="page-prompt-body"
        onClick={() => setOpen(!open)}
      >
        <ChevronIcon open={open} />
        <span className="h6 mb-0 flex-shrink-0">Page prompt</span>
        {!open && preview && (
          <span className="text-muted small text-truncate ms-2" style={{ minWidth: 0 }}>
            {preview}
          </span>
        )}
      </button>
      {open && (
        <div id="page-prompt-body" className="mt-2">
          <PromptField
            id="page-prompt"
            label="Page prompt"
            hideLabel
            placeholder="What happens on this page, its mood and pacing. Comes first in the prompt for every image on it."
            value={page.prompt ?? ''}
            onChange={(prompt) => cb().page.update({ prompt }, pageIndex)}
          />
        </div>
      )}
    </section>
  );
}
