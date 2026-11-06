import { useState } from 'react';
import { cb } from '../ai/actions';
import Modal from './Modal';
import type { GeneratorConfig } from '../generators/types';
import { useTask } from './useTask';

interface Props {
  onClose: () => void;
}

/** Configure the image service: a URL this app POSTs generation requests to, instructions for an
 * LLM agent on how to generate images itself, or both. The same config is read and written by an
 * LLM through generate.config. */
export default function GeneratorSettings({ onClose }: Props) {
  const existing = cb().generate.config();
  const task = useTask();
  const [url, setUrl] = useState(existing?.url ?? '');
  const [prompt, setPrompt] = useState(existing?.prompt ?? '');

  function saveConfig(): void {
    const config: GeneratorConfig = {
      provider: 'service',
      ...(url.trim() && { url: url.trim() }),
      ...(prompt.trim() && { prompt: prompt.trim() }),
    };
    const result = cb().generate.config(config);
    if (!result.ok) throw new Error(result.error);
  }

  function save() {
    void task.run(async () => {
      saveConfig();
      onClose();
    });
  }

  function testConnection() {
    void task.run(async () => {
      // Saved first, so it tests what's on screen.
      saveConfig();
      const result = await cb().generate.test();
      if (!result.ok) throw new Error(result.error);
    });
  }

  return (
    <Modal
      title="Image service"
      label="Image service"
      onClose={onClose}
      footer={
        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={task.busy || !url.trim()}
            onClick={testConnection}
          >
            Test connection
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={task.busy || (!url.trim() && !prompt.trim())}
            onClick={save}
          >
            Save
          </button>
        </div>
      }
    >
      <label className="form-label small">Service URL</label>
      <input
        className="form-control form-control-sm mb-1"
        placeholder="http://127.0.0.1:8188/vibecomic/generate"
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <div className="form-text mb-3">
        Used by this page: each image request is POSTed here as JSON and the image comes back.
      </div>
      <label className="form-label small">Instructions for an AI agent</label>
      <textarea
        className="form-control form-control-sm mb-1"
        rows={4}
        placeholder="e.g. Generate images with the ComfyUI server at http://…:8188/vibecomic/generate by POSTing the prompt JSON."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div className="form-text mb-2">
        Used when an AI agent drives vibecomics: tells it where and how to generate images. Set a
        URL, instructions, or both.
      </div>
      {task.error && <div className="text-danger small mb-2">{task.error}</div>}
    </Modal>
  );
}
