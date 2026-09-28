import { useState } from 'react';
import { createPortal } from 'react-dom';
import { cb } from '../ai/actions';
import { listComfyQwenModels } from '../generators/comfy';
import type { ComfyNodeMapping } from '../generators/comfy';
import { QWEN_IMAGE_EDIT_NODES, buildQwenImageEditWorkflow } from '../generators/defaultWorkflow';
import type { GeneratorConfig } from '../generators/types';
import { useTask } from './useTask';

interface Props {
  onClose: () => void;
}

interface NodeFields {
  positivePromptNodeId: string;
  promptField: string;
  outputNodeId: string;
  referenceImageNodeIds: string;
  sizeNodeId: string;
  seedNodeId: string;
}

const splitIds = (text: string): string[] =>
  text
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

const nodeFieldsOf = (nodes: ComfyNodeMapping): NodeFields => ({
  positivePromptNodeId: nodes.positivePromptNodeId,
  promptField: nodes.promptField ?? '',
  outputNodeId: nodes.outputNodeId,
  referenceImageNodeIds: (nodes.referenceImageNodeIds ?? []).join(', '),
  sizeNodeId: nodes.sizeNodeId ?? '',
  seedNodeId: nodes.seedNodeId ?? '',
});

/** Configure the image generator: currently a self-hosted ComfyUI instance. Only the server URL is
 * required; the workflow and its node mapping default to a built-in starter graph. */
export default function GeneratorSettings({ onClose }: Props) {
  const existing = cb().generate.getConfig();
  const task = useTask();
  const [baseUrl, setBaseUrl] = useState(existing?.comfy.baseUrl ?? '');
  const [workflowText, setWorkflowText] = useState(
    existing ? JSON.stringify(existing.comfy.workflow, null, 2) : ''
  );
  const [fields, setFields] = useState<NodeFields>(
    nodeFieldsOf(existing?.comfy.nodes ?? QWEN_IMAGE_EDIT_NODES)
  );
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
        workflow,
        nodes: {
          positivePromptNodeId: nodeFields.positivePromptNodeId,
          outputNodeId: nodeFields.outputNodeId,
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

  /** With no workflow yet (nothing saved, nothing pasted into Advanced), build the Qwen-Image-Edit
   * starter from whatever UNET/CLIP/VAE/LoRA files the server actually has installed. */
  async function withDetectedModel(): Promise<{ workflowText: string; fields: NodeFields }> {
    if (workflowText.trim()) return { workflowText, fields };
    const models = await listComfyQwenModels(baseUrl);
    if (!models.unet[0] || !models.clip[0] || !models.vae[0]) {
      throw new Error(
        'No Qwen-Image-style models (UNET/CLIP/VAE) found on that server. Paste your own workflow under "Advanced" instead.'
      );
    }
    const workflow = buildQwenImageEditWorkflow({
      unet: models.unet[0],
      clip: models.clip[0],
      vae: models.vae[0],
      lora: models.lora[0] ?? '',
    });
    return {
      workflowText: JSON.stringify(workflow, null, 2),
      fields: nodeFieldsOf(QWEN_IMAGE_EDIT_NODES),
    };
  }

  async function saveConfig(workflowSource: string, nodeFields: NodeFields): Promise<void> {
    const result = cb().generate.setConfig(buildConfig(workflowSource, nodeFields));
    if (!result.ok) throw new Error(result.error);
  }

  function save() {
    void task.run(async () => {
      const detected = await withDetectedModel();
      setWorkflowText(detected.workflowText);
      setFields(detected.fields);
      await saveConfig(detected.workflowText, detected.fields);
      onClose();
    });
  }

  function testConnection() {
    void task.run(async () => {
      // Saved first, so it reads what's on screen (with any auto-detected model).
      const detected = await withDetectedModel();
      setWorkflowText(detected.workflowText);
      setFields(detected.fields);
      await saveConfig(detected.workflowText, detected.fields);
      const result = await cb().generate.testConnection();
      if (!result.ok) throw new Error(result.error);
    });
  }

  return createPortal(
    <>
      <div className="modal-backdrop show" />
      <div
        className="modal d-block"
        role="dialog"
        aria-modal="true"
        aria-label="Generator settings"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="modal-dialog modal-lg modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="modal-title h5">Generator settings</h2>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            <div className="modal-body">
              <label className="form-label small">ComfyUI server URL</label>
              <input
                className="form-control form-control-sm mb-2"
                placeholder="http://192.168.1.10:8081"
                autoFocus
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
              <div className="form-text mb-2">
                Uses a built-in Qwen-Image-Edit starter workflow, filled in from whatever models
                your server has installed, when you test the connection. Open "Advanced" below only
                if you want to use your own ComfyUI workflow instead.
              </div>
              {task.error && <div className="text-danger small mb-2">{task.error}</div>}

              <details>
                <summary className="small mb-2">Advanced: workflow &amp; node mapping</summary>
                <div className="mt-2">
                  <label className="form-label small">
                    Workflow JSON (ComfyUI's "Save (API Format)" export)
                  </label>
                  {!workflowText.trim() && (
                    <div className="text-muted small mb-1">
                      Empty: "Test connection" or "Save" will fill in the built-in Qwen-Image-Edit
                      starter from your server's installed models.
                    </div>
                  )}
                  <textarea
                    className="form-control form-control-sm mb-2 font-monospace"
                    rows={8}
                    value={workflowText}
                    onChange={(e) => setWorkflowText(e.target.value)}
                  />
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
                      <label className="form-label small">
                        Reference image node ids (comma-separated)
                      </label>
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
            </div>
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
                  task.busy || !baseUrl || !fields.positivePromptNodeId || !fields.outputNodeId
                }
                onClick={save}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
