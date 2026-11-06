import type { ReactNode } from 'react';

interface Props {
  title: string;
  open: boolean;
  onToggle: () => void;
  /** Shown beside the title even while collapsed, e.g. a warning that needs seeing. */
  badge?: ReactNode;
  children: ReactNode;
}

/**
 * One item of a Bootstrap accordion (put several inside a `.accordion`): stacked panels with shared
 * borders, a header bar that is tinted while open, and the chevron on the right. The parent keeps
 * which items are open, and any number can be. The body is only rendered while open.
 */
export default function AccordionItem({ title, open, onToggle, badge, children }: Props) {
  return (
    <section className="accordion-item" aria-label={title}>
      <h3 className="accordion-header">
        <button
          type="button"
          className={`accordion-button py-2 px-3 gap-2${open ? '' : ' collapsed'}`}
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${title.toLowerCase()}`}
          onClick={onToggle}
        >
          <span className="fw-semibold">{title}</span>
          {badge}
        </button>
      </h3>
      {open && <div className="accordion-body bg-body-tertiary p-2">{children}</div>}
    </section>
  );
}
