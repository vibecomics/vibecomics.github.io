import Spinner from './Spinner';
import { useGeneratorConfig } from './useGeneratorConfig';

interface Props {
  /** A generation for this item is already running. */
  generating: boolean;
  /** Why generating isn't possible yet, other than the reasons this button knows itself. */
  blockedReason?: string;
  /** The tooltip when generating is possible. */
  title: string;
  onClick: () => void;
}

/** The "✨ Generate" button that opens the generate dialog, disabled (with the reason as its
 * tooltip) while a generation is running, no generator is set up, or `blockedReason` is given. */
export default function GenerateButton({ generating, blockedReason, title, onClick }: Props) {
  const configured = Boolean(useGeneratorConfig());
  const reason = generating
    ? 'A generation for this item is already running'
    : (blockedReason ??
      (configured ? null : 'Set up an image generator first (menu → Generator settings)'));

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
        {generating && <Spinner />}✨ {generating ? 'Generating' : 'Generate'}
      </button>
    </span>
  );
}
