import type { GenerationStatus } from '../ai/generation';
import { SparklesIcon } from './Icons';
import Spinner from './Spinner';
import { useGeneratorConfig, useGeneratorConfigProblem } from './useGeneratorConfig';

interface Props {
  /** A generation for this item is queued (waiting its turn behind another one) or actively running. */
  status: GenerationStatus;
  /** Why generating isn't possible yet, other than the reasons this button knows itself. */
  blockedReason?: string;
  /** The tooltip when generating is possible. */
  title: string;
  onClick: () => void;
  /** Cancels this item's queued or running generation. Omit to hide the cancel button (e.g. a
   * context with no way to cancel one). Shown only while `status` is "queued" or "running". */
  onCancel?: () => void;
}

/** The sparkles button that opens the generate dialog, disabled (with the reason as its tooltip)
 * while a generation is queued or running for this item, no generator is set up, or
 * `blockedReason` is given — alongside a red × button to cancel that queued/running generation, when
 * `onCancel` is given. */
export default function GenerateButton({ status, blockedReason, title, onClick, onCancel }: Props) {
  const configured = Boolean(useGeneratorConfig());
  const configProblem = useGeneratorConfigProblem();
  const active = status === 'running' || status === 'queued';
  const reason =
    status === 'running'
      ? 'A generation for this item is already running'
      : status === 'queued'
        ? 'A generation for this item is queued, waiting its turn'
        : (blockedReason ??
          (configured
            ? null
            : (configProblem ??
              'Set up an image generator first (Settings, on the project list)')));
  const label = status === 'running' ? 'Generating' : status === 'queued' ? 'Queued' : 'Generate';

  return (
    <>
      {/* A disabled <button> doesn't show its own title tooltip in most browsers, so the tooltip
      goes on this wrapping span instead. */}
      <span title={reason ?? title}>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm btn-icon"
          aria-label={label}
          disabled={reason !== null}
          onClick={onClick}
        >
          {status === 'running' ? <Spinner /> : status === 'queued' ? '⏳' : <SparklesIcon />}
        </button>
      </span>
      {active && onCancel && (
        <button
          type="button"
          className="btn btn-outline-danger btn-sm btn-icon"
          title={`Cancel this ${status === 'running' ? 'generation' : 'queued generation'}`}
          aria-label={`Cancel this ${status === 'running' ? 'generation' : 'queued generation'}`}
          onClick={onCancel}
        >
          &times;
        </button>
      )}
    </>
  );
}
