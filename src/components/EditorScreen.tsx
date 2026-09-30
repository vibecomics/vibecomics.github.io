import type { ReactNode } from 'react';
import type { ComicProject } from '../types/comic';
import type { SaveState } from '../state/useProjectSaver';
import ConflictDot from './ConflictDot';
import EditorNavbar from './EditorNavbar';
import { EDITOR_TABS } from './editorTabs';
import type { EditorTab } from './editorTabs';
import { setGenerationPanelOpen, useGenerationPanelOpen } from './generationPanelState';
import GenerationPanel from './GenerationPanel';
import MediaTab from './MediaTab';
import OutlineTab from './OutlineTab';
import PagesTab from './PagesTab';
import { ProjectContext } from './ProjectContext';
import StoryTab from './StoryTab';

interface Props {
  project: ComicProject;
  pageIndex: number;
  tab: EditorTab;
  onTabChange: (tab: EditorTab) => void;
  saveState: SaveState;
  dirty: boolean;
  /** The tabs, and the pages (by id), that hold a conflict with changes made elsewhere: they get a dot. */
  conflictTabs: Set<EditorTab>;
  conflictPageIds: Set<string>;
  /** The footer that shows the conflicts, while there are any. */
  conflictBar: ReactNode;
  onRefresh: () => Promise<void>;
}

/** Navbar, tab bar and the active tab, laid out to fill the viewport exactly. */
export default function EditorScreen({
  project,
  pageIndex,
  tab,
  onTabChange,
  saveState,
  dirty,
  conflictTabs,
  conflictPageIds,
  conflictBar,
  onRefresh,
}: Props) {
  const generationPanelOpen = useGenerationPanelOpen();

  return (
    <ProjectContext.Provider value={project}>
      <div className="position-fixed top-0 bottom-0 start-0 end-0 d-flex flex-column bg-body-tertiary">
        <EditorNavbar
          title={project.title}
          tab={tab}
          onTabChange={onTabChange}
          saveState={saveState}
          dirty={dirty}
          conflictTabs={conflictTabs}
          onRefresh={onRefresh}
        />

        <ul className="nav nav-tabs px-3 pt-2 bg-body border-bottom d-none d-md-flex mb-0">
          {EDITOR_TABS.map((t) => (
            <li className="nav-item" key={t.id}>
              <button
                className={`nav-link${t.id === tab ? ' active' : ''}`}
                onClick={() => onTabChange(t.id)}
              >
                {t.label}
                {conflictTabs.has(t.id) && <ConflictDot className="ms-1 align-middle" />}
              </button>
            </li>
          ))}
        </ul>

        <div className="d-flex flex-grow-1" style={{ minHeight: 0 }}>
          {tab === 'pages' ? (
            <PagesTab
              pages={project.pages}
              pageIndex={pageIndex}
              pageSize={project.metadata.pageSize}
              media={project.metadata.media}
              conflictPageIds={conflictPageIds}
            />
          ) : (
            <div className="flex-grow-1 overflow-auto" style={{ minHeight: 0, minWidth: 0 }}>
              {tab === 'outline' && <OutlineTab key={project.id} project={project} />}
              {tab === 'cast' && (
                <>
                  <StoryTab key={`${project.id}-characters`} project={project} kind="characters" />
                  <StoryTab key={`${project.id}-objects`} project={project} kind="objects" />
                </>
              )}
              {tab === 'scenes' && <StoryTab key={project.id} project={project} kind="scenes" />}
              {tab === 'media' && <MediaTab media={project.metadata.media} />}
            </div>
          )}
          {generationPanelOpen && <GenerationPanel onClose={() => setGenerationPanelOpen(false)} />}
        </div>

        {conflictBar}
      </div>
    </ProjectContext.Provider>
  );
}
