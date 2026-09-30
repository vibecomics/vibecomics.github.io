import type { GenerationStatus } from '../ai/generation';
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
}

/** The "✨ Generate" button that opens the generate dialog, disabled (with the reason as its
 * tooltip) while a generation is queued or running for this item, no generator is set up, or
 * `blockedReason` is given. */
export default function GenerateButton({ status, blockedReason, title, onClick }: Props) {
  const configured = Boolean(useGeneratorConfig());
  const configProblem = useGeneratorConfigProblem();
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

  return (
    // A disabled <button> doesn't show its own title tooltip in most browsers, so the tooltip goes
    // on this wrapping span instead.
    <span title={reason ?? title}>
      <button
        type="button"
        className="btn btn-outline-secondary btn-sm"
        disabled={reason !== null}
        onClick={onClick}
      >
        {status === 'running' && <Spinner />}
        {status === 'queued' ? '⏳' : '✨'}{' '}
        {status === 'running' ? 'Generating' : status === 'queued' ? 'Queued' : 'Generate'}
      </button>
    </span>
  );
}
