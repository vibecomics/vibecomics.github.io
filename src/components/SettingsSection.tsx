import type { DeviceCodeInfo } from '../drive/driveClient';
import type { StorageConnectionInfo } from '../storage/connections';
import ConnectSettings from './ConnectSettings';
import GeneratorSettings from './GeneratorSettings';
import { useGeneratorConfig, useGeneratorConfigProblem } from './useGeneratorConfig';
import { useState } from 'react';

/** A one-line summary of the image generator and a button to configure it. */
function GeneratorSettingsCard() {
  const [editing, setEditing] = useState(false);
  const config = useGeneratorConfig();
  const problem = useGeneratorConfigProblem();
  const summary = config
    ? `${config.comfy.baseUrl}${config.comfy.workflowName ? ` · ${config.comfy.workflowName}` : ''}`
    : (problem ?? 'Not set up');

  return (
    <div className="col-12 col-sm-6 col-md-4">
      <div className="card h-100 shadow-sm">
        <div className="card-body d-flex flex-column">
          <h3 className="card-title h6">Image generator</h3>
          <p className={`small text-truncate${config ? '' : ' text-muted'}`} title={summary}>
            {summary}
          </p>
          <button
            className="btn btn-outline-secondary mt-auto align-self-start"
            onClick={() => setEditing(true)}
          >
            {config ? 'Edit' : 'Set up'}
          </button>
        </div>
      </div>
      {editing && <GeneratorSettings onClose={() => setEditing(false)} />}
    </div>
  );
}

/** Storage and the image generator, folded away: they are rarely changed once a comic exists. */
export default function SettingsSection({
  connections,
  deviceCode,
  onChange,
}: {
  connections: StorageConnectionInfo[];
  deviceCode: DeviceCodeInfo | null;
  onChange: () => void;
}) {
  return (
    <details className="mt-4">
      <summary className="h6 mb-3" style={{ cursor: 'pointer' }}>
        Storage &amp; settings
      </summary>
      <div className="row g-3">
        <ConnectSettings connections={connections} deviceCode={deviceCode} onChange={onChange} />
        <GeneratorSettingsCard />
      </div>
    </details>
  );
}
