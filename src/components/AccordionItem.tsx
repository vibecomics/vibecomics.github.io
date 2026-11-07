import type { ReactNode } from 'react';
import { ChevronIcon } from './Icons';

interface Props {
  title: string;
  open: boolean;
  onToggle: () => void;
  /** Shown beside the title even while collapsed, e.g. a warning that needs seeing. */
  badge?: ReactNode;
  /** Controls shown in the header, right of the title — a sibling of the toggle button, not nested
   * inside it, so clicking them never also collapses/expands the section. Shown even while
   * collapsed, e.g. an "Add" button or a switch that doesn't need the section open to use. */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * One item of a Bootstrap accordion (put several inside a `.accordion`): stacked panels with shared
 * borders, a header bar that is tinted while open, and the chevron on the right. The parent keeps
 * which items are open, and any number can be. The body is only rendered while open.
 */
export default function AccordionItem({ title, open, onToggle, badge, actions, children }: Props) {
  return (
    <section className="accordion-item" aria-label={title}>
      {/* fontSize: Bootstrap resets it on .accordion-button itself, not the header, so a sibling
          action (e.g. a switch, sized in em) would otherwise inherit the h3's much larger default. */}
      <h3 className="accordion-header d-flex align-items-stretch" style={{ fontSize: '1rem' }}>
        <button
          type="button"
          className={`accordion-button accordion-button-no-caret py-3 px-3 gap-2${open ? '' : ' collapsed'}`}
          style={{ flex: '1 1 0%', minWidth: 0 }}
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${title.toLowerCase()}`}
          onClick={onToggle}
        >
          <span className="fw-semibold">{title}</span>
          {badge}
        </button>
        {/* Bootstrap's own caret is suppressed above (accordion-button-no-caret) and always redrawn
            here instead, after any actions, so every section's arrow looks the same (not a mix of
            Bootstrap's built-in one and ours), and "+ Add layer" etc. reads before it, not after. */}
        <div
          className="d-flex align-items-center gap-2 ps-3 pe-2 flex-shrink-0"
          style={{
            backgroundColor: open ? 'var(--bs-accordion-active-bg)' : 'var(--bs-accordion-bg)',
          }}
        >
          {actions}
          <button
            type="button"
            className="btn btn-link text-reset p-1 d-flex align-items-center justify-content-center"
            aria-hidden="true"
            tabIndex={-1}
            onClick={onToggle}
          >
            <ChevronIcon open={open} />
          </button>
        </div>
      </h3>
      {open && <div className="accordion-body bg-body-tertiary p-2">{children}</div>}
    </section>
  );
}
