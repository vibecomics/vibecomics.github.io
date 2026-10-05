import { useEffect, useState } from 'react';
import { cb } from '../ai/actions';
import Modal from './Modal';
import {
  detectComfyNodes,
  listComfyWorkflows,
  loadComfyWorkflow,
} from '../generators/comfyWorkflows';
import type { ComfyNodeMapping } from '../generators/comfy';
import type { GeneratorConfig } from '../generators/types';
import { useTask } from './useTask';

interface Props {
  onClose: () => void;
}

interface NodeFields {
  positivePromptNodeId: string;
  promptField: string;
  outputNodeId: string;
  transparentOutputNodeId: string;
  referenceImageNodeIds: string;
  sizeNodeId: string;
  seedNodeId: string;
}

const splitIds = (text: string): string[] =>
  text
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

const EMPTY_FIELDS: NodeFields = {
  positivePromptNodeId: '',
  promptField: '',
  outputNodeId: '',
  transparentOutputNodeId: '',
  referenceImageNodeIds: '',
  sizeNodeId: '',
  seedNodeId: '',
};

const nodeFieldsOf = (nodes: ComfyNodeMapping): NodeFields => ({
  positivePromptNodeId: nodes.positivePromptNodeId,
  promptField: nodes.promptField ?? '',
  outputNodeId: nodes.outputNodeId,
  transparentOutputNodeId: nodes.transparentOutputNodeId ?? '',
  referenceImageNodeIds: (nodes.referenceImageNodeIds ?? []).join(', '),
  sizeNodeId: nodes.sizeNodeId ?? '',
  seedNodeId: nodes.seedNodeId ?? '',
});

/** Configure the image generator: currently a self-hosted ComfyUI instance. The workflow is never
 * defined here — only a server URL and the name of a workflow already saved in ComfyUI's own
 * workflows folder. Its node mapping is guessed automatically (see detectComfyNodes) and only
 * shown under "Advanced" for a manual correction if the guess is wrong. */
export default function GeneratorSettings({ onClose }: Props) {
  const existing = cb().generate.getConfig();
  const task = useTask();
  const [baseUrl, setBaseUrl] = useState(existing?.comfy.baseUrl ?? '');
  const [workflowText, setWorkflowText] = useState(
    existing ? JSON.stringify(existing.comfy.workflow, null, 2) : ''
  );
  const [fields, setFields] = useState<NodeFields>(
    existing ? nodeFieldsOf(existing.comfy.nodes) : EMPTY_FIELDS
  );
  const [workflowName, setWorkflowName] = useState(existing?.comfy.workflowName ?? '');
  // The workflows saved on the server, listed once a URL is entered (null until then).
  const [available, setAvailable] = useState<string[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    setAvailable(null);
    setListError(null);
    if (!/^https?:\/\/./.test(baseUrl)) return;
    let stale = false;
    const timer = setTimeout(() => {
      listComfyWorkflows(baseUrl)
        .then((names) => !stale && setAvailable(names))
        .catch((e: unknown) => !stale && setListError(e instanceof Error ? e.message : String(e)));
    }, 400);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [baseUrl]);

  /** Choosing a saved workflow loads it and fills in the node mapping guessed from it. */
  function chooseWorkflow(name: string) {
    setWorkflowName(name);
    if (!name) return;
    void task.run(async () => {
      const workflow = await loadComfyWorkflow(baseUrl, name);
      setWorkflowText(JSON.stringify(workflow, null, 2));
      setFields(nodeFieldsOf(detectComfyNodes(workflow)));
    });
  }

  const setField = <K extends keyof NodeFields>(key: K, value: NodeFields[K]) =>
    setFields((f) => ({ ...f, [key]: value }));

  function buildConfig(workflowSource: string, nodeFields: NodeFields): GeneratorConfig {
    let workflow: GeneratorConfig['comfy']['workflow'];
    try {
      workflow = JSON.parse(workflowSource);
    } catch {
      throw new Error('Workflow must be valid JSON (ComfyUI’s "Save (API Format)" export).');
    }
    return {
      provider: 'comfy',
      comfy: {
        baseUrl,
        ...(workflowName && { workflowName }),
        workflow,
        nodes: {
          positivePromptNodeId: nodeFields.positivePromptNodeId,
          outputNodeId: nodeFields.outputNodeId,
          ...(nodeFields.transparentOutputNodeId.trim() && {
            transparentOutputNodeId: nodeFields.transparentOutputNodeId,
          }),
          ...(nodeFields.promptField.trim() && { promptField: nodeFields.promptField }),
          ...(nodeFields.referenceImageNodeIds.trim() && {
            referenceImageNodeIds: splitIds(nodeFields.referenceImageNodeIds),
          }),
          ...(nodeFields.sizeNodeId.trim() && { sizeNodeId: nodeFields.sizeNodeId }),
          ...(nodeFields.seedNodeId.trim() && { seedNodeId: nodeFields.seedNodeId }),
        },
      },
    };
  }

  async function saveConfig(): Promise<void> {
    if (!workflowName || !workflowText.trim()) {
      throw new Error('Select a workflow saved in ComfyUI first.');
    }
    const result = cb().generate.setConfig(buildConfig(workflowText, fields));
    if (!result.ok) throw new Error(result.error);
  }

  function save() {
    void task.run(async () => {
      await saveConfig();
      onClose();
    });
  }

  function testConnection() {
    void task.run(async () => {
      // Saved first, so it reads what's on screen.
      await saveConfig();
      const result = await cb().generate.testConnection();
      if (!result.ok) throw new Error(result.error);
    });
  }

  return (
    <Modal
      title="Generator settings"
      label="Generator settings"
      wide
      onClose={onClose}
      footer={
        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={task.busy || !baseUrl}
            onClick={testConnection}
          >
            Test connection
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={
              task.busy ||
              !baseUrl ||
              !workflowName ||
              !fields.positivePromptNodeId ||
              !fields.outputNodeId
            }
            onClick={save}
          >
            Save
          </button>
        </div>
      }
    >
      <label className="form-label small">ComfyUI server URL</label>
      <input
        className="form-control form-control-sm mb-2"
        placeholder="http://192.168.1.10:8081"
        autoFocus
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
      />
      {available && (
        <>
          <label className="form-label small">Workflow</label>
          <select
            className="form-select form-select-sm mb-2"
            value={workflowName}
            onChange={(e) => chooseWorkflow(e.target.value)}
          >
            <option value="">Select a workflow saved in ComfyUI…</option>
            {[...new Set([...(workflowName ? [workflowName] : []), ...available])].map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <div className="form-text mb-2">
            {available.length === 0
              ? 'No workflows saved on that server yet. Save one in ComfyUI ("Save (API Format)" files go in its workflows folder) and reopen this.'
              : 'Workflows saved in ComfyUI. Only the name is kept in this browser; the workflow is fetched from the server when the page loads.'}
          </div>
        </>
      )}
      {listError && <div className="text-danger small mb-2">{listError}</div>}
      {task.error && <div className="text-danger small mb-2">{task.error}</div>}

      <details>
        <summary className="small mb-2">Advanced: node mapping</summary>
        <div className="mt-2">
          {!workflowName && (
            <div className="text-muted small mb-1">
              Pick a workflow saved on the server above to guess these automatically.
            </div>
          )}
          <div className="row g-2 mb-2">
            <div className="col-6">
              <label className="form-label small">Positive prompt node id</label>
              <input
                className="form-control form-control-sm"
                value={fields.positivePromptNodeId}
                onChange={(e) => setField('positivePromptNodeId', e.target.value)}
              />
            </div>
            <div className="col-6">
              <label className="form-label small">
                Prompt field name (optional, default "text")
              </label>
              <input
                className="form-control form-control-sm"
                value={fields.promptField}
                onChange={(e) => setField('promptField', e.target.value)}
              />
            </div>
            <div className="col-6">
              <label className="form-label small">Output (SaveImage) node id</label>
              <input
                className="form-control form-control-sm"
                value={fields.outputNodeId}
                onChange={(e) => setField('outputNodeId', e.target.value)}
              />
            </div>
            <div className="col-6">
              <label className="form-label small">Transparent output node id (optional)</label>
              <input
                className="form-control form-control-sm"
                value={fields.transparentOutputNodeId}
                onChange={(e) => setField('transparentOutputNodeId', e.target.value)}
              />
              <div className="form-text">
                A second SaveImage fed by a background-removal node (e.g. Inspyrenet Rembg), used
                instead of the output above for character/prop layers.
              </div>
            </div>
            <div className="col-6">
              <label className="form-label small">Reference image node ids (comma-separated)</label>
              <input
                className="form-control form-control-sm"
                value={fields.referenceImageNodeIds}
                onChange={(e) => setField('referenceImageNodeIds', e.target.value)}
              />
            </div>
            <div className="col-3">
              <label className="form-label small">Size node id (optional)</label>
              <input
                className="form-control form-control-sm"
                value={fields.sizeNodeId}
                onChange={(e) => setField('sizeNodeId', e.target.value)}
              />
            </div>
            <div className="col-3">
              <label className="form-label small">Seed node id (optional)</label>
              <input
                className="form-control form-control-sm"
                value={fields.seedNodeId}
                onChange={(e) => setField('seedNodeId', e.target.value)}
              />
            </div>
          </div>
        </div>
      </details>
    </Modal>
  );
}
