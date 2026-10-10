import { useState } from 'react';
import type { DeviceCodeInfo } from '../drive/driveClient';
import type { StorageConnectionInfo } from '../storage/connections';
import type { ProjectFolder } from '../storage/types';
import ConnectSettings from './ConnectSettings';
import NewProjectModal from './NewProjectModal';
import SettingsSection from './SettingsSection';
import { useStorageConnections } from './useStorageConnections';

const TAGLINE =
  'VibeComics builds comics page by page: you set the story, style and layout, and an AI agent and AI image generator draws the art.';

const STORAGE_PROMISE =
  'VibeComics does not store anything on its servers. Your comics stay in the storage you choose.';

/** The prompt to copy into an AI agent that can run commands, naming where the comic is kept. */
function AiPrompt({ connections }: { connections: StorageConnectionInfo[] }) {
  const live = connections.find((c) => c.connected);
  const where = live ? live.label : 'my Google Drive, or a storage server I name';
  const guide = new URL('llms.txt', document.baseURI).href;
  const prompt = `Read ${guide} and follow it to build a comic. Use the vibecomics CLI and keep the comic in ${where}. Ask me for anything you need first. Once you're done with storage, tell me, and we'll start on the overall comic story.`;
  return (
    <>
      <p className="mb-2">
        Copy and paste the following prompt into your AI agent (ChatGPT, Claude Code, Claude on the
        web, or similar).
      </p>
      <textarea
        className="form-control font-monospace small"
        rows={4}
        readOnly
        value={prompt}
        onFocus={(e) => e.currentTarget.select()}
        onClick={(e) => e.currentTarget.select()}
      />
    </>
  );
}

/**
 * The first-run screen, at #nux: what the app is, then two ways to start side by side in the page.
 * With AI, copy a prompt into an agent and open the comic to follow its progress. By hand, choose
 * where the comic is kept and build it step by step.
 */
export default function NuxScreen({
  projects,
  deviceCode,
}: {
  projects: ProjectFolder[];
  deviceCode: DeviceCodeInfo | null;
}) {
  const [showNewModal, setShowNewModal] = useState(false);
  const { connections, refreshConnections } = useStorageConnections(projects, deviceCode);
  const live = connections.filter((c) => c.connected);

  return (
    <div className="min-vh-100 bg-body-tertiary">
      <div className="container py-5" style={{ maxWidth: 720 }}>
        <div className="d-flex align-items-center gap-3 mb-2">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" width={48} height={48} />
          <h1 className="h3 mb-0">VibeComics</h1>
        </div>
        <p className="lead mb-5">{TAGLINE}</p>

        <section className="mb-5">
          <h2 className="h4 mb-3">Get started with AI</h2>
          <AiPrompt connections={connections} />
          <p className="small text-muted mt-3 mb-0">
            To see the progress, follow the steps to manually open the comic in your browser.
          </p>
        </section>

        <section className="border-top pt-5">
          <h2 className="h4 mb-3">Get started manually</h2>
          <h3 className="h6 d-flex align-items-center gap-2">
            {live.length > 0 && (
              <span className="text-success" aria-label="Done">
                ✓
              </span>
            )}
            First step: choose where your comic is kept
          </h3>
          <p className="text-muted small mb-3">
            {STORAGE_PROMISE} Once this is done, the other steps follow in your comic.
          </p>
          {live.length === 0 ? (
            <div className="row g-3">
              <ConnectSettings
                connections={connections}
                deviceCode={deviceCode}
                onChange={refreshConnections}
              />
            </div>
          ) : (
            <>
              <p className="text-muted small mb-3">
                Stored in {live.map((c) => c.label).join(', ')}.
              </p>
              {projects.length === 0 && (
                <p className="mb-3">Next step: create your first project.</p>
              )}
              <button className="btn btn-primary" onClick={() => setShowNewModal(true)}>
                New project
              </button>
              <hr className="my-4" />
              <SettingsSection
                connections={connections}
                deviceCode={deviceCode}
                onChange={refreshConnections}
              />
            </>
          )}
        </section>

        {projects.length > 0 && (
          <a className="d-inline-block mt-4 small" href="#welcome">
            Back to your comics
          </a>
        )}
      </div>
      {showNewModal && (
        <NewProjectModal connections={connections} onClose={() => setShowNewModal(false)} />
      )}
    </div>
  );
}
