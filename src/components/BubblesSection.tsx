import { cb } from '../ai/actions';
import { defaultPointer } from '../state/layout';
import type { Bubble, BubbleKind, Panel } from '../types/comic';
import { DeleteButton, ExpandButton } from './RowButtons';
import type { Selection } from './selection';
import type { Expansion } from './useExpansion';

const KINDS: Array<{ kind: BubbleKind; label: string; sample: string }> = [
  { kind: 'speech', label: 'Speech', sample: 'Hello!' },
  { kind: 'thought', label: 'Thought', sample: 'Hmm…' },
  { kind: 'shout', label: 'Shout', sample: 'Watch out!' },
  { kind: 'caption', label: 'Caption', sample: 'Meanwhile…' },
];

interface Props {
  panel: Panel;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  expansion: Expansion;
}

function BubbleRow({
  panelId,
  bubble,
  selected,
  expanded,
  onSelect,
  onToggleExpanded,
}: {
  panelId: string;
  bubble: Bubble;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggleExpanded: () => void;
}) {
  const update = (patch: Partial<Bubble>) => cb().bubbles.update(panelId, bubble.id, patch);

  return (
    <div className={`border rounded p-2 mb-2${selected ? ' border-primary' : ''}`}>
      <div className="d-flex align-items-center gap-2">
        <ExpandButton expanded={expanded} label="bubble" onClick={onToggleExpanded} />
        <button
          className="btn btn-link btn-sm p-0 text-start text-truncate flex-grow-1 text-decoration-none"
          onClick={onSelect}
        >
          <span className="text-muted me-1">{bubble.kind}:</span>
          {bubble.text || '(empty)'}
        </button>
        <DeleteButton label="bubble" onClick={() => cb().bubbles.delete(panelId, bubble.id)} />
      </div>
      {expanded && (
        <div className="mt-2">
          <textarea
            className="form-control form-control-sm mb-2"
            rows={2}
            value={bubble.text}
            aria-label="Bubble text"
            onChange={(e) => update({ text: e.target.value })}
          />
          <select
            className="form-select form-select-sm"
            value={bubble.kind}
            aria-label="Bubble kind"
            onChange={(e) => {
              const kind = e.target.value as BubbleKind;
              const needsPointer = kind !== 'caption' && bubble.tailX === undefined;
              update({ kind, ...(needsPointer && defaultPointer(bubble)) });
            }}
          >
            {KINDS.map(({ kind, label }) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

/** The panel's speech, thought, shout and caption bubbles. Size and place them on the page itself. */
export default function BubblesSection({ panel, selection, onSelect, expansion }: Props) {
  function add(kind: BubbleKind, sample: string) {
    const offset = panel.bubbles.length % 4;
    const bubble = cb().bubbles.add(panel.id, {
      kind,
      text: sample,
      x: 8 + offset * 8,
      y: 6 + offset * 10,
    });
    onSelect({ panelId: panel.id, bubbleId: bubble.id });
    expansion.setAll([bubble.id], true);
  }

  return (
    <section className="mb-3" aria-label="Bubbles">
      <h3 className="h6">Bubbles</h3>
      <div className="btn-group btn-group-sm mb-2">
        {KINDS.map(({ kind, label, sample }) => (
          <button
            key={kind}
            className="btn btn-outline-secondary"
            onClick={() => add(kind, sample)}
          >
            + {label}
          </button>
        ))}
      </div>
      {panel.bubbles.map((bubble) => (
        <BubbleRow
          key={bubble.id}
          panelId={panel.id}
          bubble={bubble}
          selected={selection.bubbleId === bubble.id}
          expanded={expansion.isOpen(bubble.id)}
          onSelect={() =>
            onSelect({
              panelId: panel.id,
              bubbleId: selection.bubbleId === bubble.id ? undefined : bubble.id,
            })
          }
          onToggleExpanded={() => expansion.toggle(bubble.id)}
        />
      ))}
    </section>
  );
}
