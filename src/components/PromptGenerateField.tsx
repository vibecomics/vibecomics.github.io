import { useState } from 'react';
import type { GenerationStatus } from '../ai/generation';
import GenerateIconButton from './GenerateIconButton';

interface Props {
  value: string;
  /** Called on blur, only when the text actually changed. */
  onCommit: (text: string) => void;
  placeholder: string;
  ariaLabel: string;
  rows?: number;
  autoFocus?: boolean;
  className?: string;
  status: GenerationStatus;
  generateTitle: string;
  /** Why generating isn't possible yet, other than no generator being configured or a generation
   * already being queued/running for this field (e.g. an empty prompt). */
  blockedReason?: string;
  onGenerate: () => void;
  onCancel: () => void;
}

/**
 * A multi-line prompt textarea with its Generate control anchored inside it instead of beside it, so
 * the button costs no layout space of its own — the textarea keeps the room a button-sized row would
 * otherwise take. The button sits bottom-right, inside the textarea's own reserved right-hand padding,
 * so it never overlaps the typed text regardless of how many lines there are. It's muted until the
 * field is hovered or focused, except while a generation is queued or running, when it stays fully
 * visible since it doubles as the cancel control (see .prompt-generate-field / .prompt-generate-btn in
 * App.css).
 *
 * Give this a React `key` tied to the entity it edits (layer id, panel id, variation id) when the
 * same mounted field can be pointed at a different entity: it keeps its own uncommitted text locally
 * and only syncs from `value` at mount, same as StyleField.
 */
export default function PromptGenerateField({
  value,
  onCommit,
  placeholder,
  ariaLabel,
  rows = 3,
  autoFocus,
  className,
  status,
  generateTitle,
  blockedReason,
  onGenerate,
  onCancel,
}: Props) {
  const [text, setText] = useState(value);

  return (
    <div className={`prompt-generate-field${className ? ` ${className}` : ''}`}>
      <textarea
        className="form-control"
        style={{ resize: 'vertical' }}
        rows={rows}
        value={text}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== value) onCommit(text);
        }}
      />
      <span
        className={`prompt-generate-btn${status === 'running' || status === 'queued' ? ' active' : ''}`}
      >
        <GenerateIconButton
          status={status}
          title={generateTitle}
          blockedReason={blockedReason}
          onClick={onGenerate}
          onCancel={onCancel}
        />
      </span>
    </div>
  );
}
