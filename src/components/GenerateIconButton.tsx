import type { GenerationStatus } from '../ai/generation';
import IconButton from './IconButton';
import { hasServiceUrl } from '../generators/types';
import { useGeneratorConfig, useGeneratorConfigProblem } from './useGeneratorConfig';

interface Props {
  status: GenerationStatus;
  title: string;
  /** True for a "generate all" action (e.g. one image for every variation, or every dirty layer):
   * uses a different idle icon (🪄) than a single-item generate (✨), so the two are never confused
   * at a glance when both appear near each other. */
  all?: boolean;
  /** Why generating isn't possible yet, other than the reasons this button knows itself (no
   * generator configured, already queued/running). */
  blockedReason?: string;
  onClick: () => void;
  onCancel: () => void;
}

/** The icon-only Generate button: shows queued/running state (⏳ / spinner) so a batch run makes
 * every item's own button reflect its place in the queue, not just the one currently executing, and
 * doubles as a cancel button while active. */
export default function GenerateIconButton({
  status,
  title,
  all,
  blockedReason,
  onClick,
  onCancel,
}: Props) {
  const configured = hasServiceUrl(useGeneratorConfig());
  const configProblem = useGeneratorConfigProblem();
  const active = status === 'running' || status === 'queued';
  const reason =
    blockedReason ??
    (configured
      ? null
      : (configProblem ?? 'Set up an image generator first (Settings, on the project list)'));
  const label =
    status === 'running'
      ? 'Generating — click to cancel'
      : status === 'queued'
        ? 'Queued — click to cancel'
        : (reason ?? title);

  return (
    <IconButton
      label={label}
      title={label}
      disabled={!active && reason !== null}
      onClick={active ? onCancel : onClick}
    >
      {status === 'running' ? (
        <span className="spinner-border spinner-border-sm" role="status" aria-label="Generating" />
      ) : status === 'queued' ? (
        '⏳'
      ) : all ? (
        '🪄'
      ) : (
        '✨'
      )}
    </IconButton>
  );
}
