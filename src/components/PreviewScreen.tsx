import { cb } from '../ai/actions';
import type { ComicPage, ComicProject, PageSize } from '../types/comic';
import { formatPageLabel } from '../types/comic';
import PageSheet from './PageSheet';
import { ProjectContext } from './ProjectContext';

interface Props {
  project: ComicProject;
  page: ComicPage;
  pageSize: PageSize;
}

/** The current page on a dark background with minimal chrome, for screenshots. */
export default function PreviewScreen({ project, page, pageSize }: Props) {
  return (
    <ProjectContext.Provider value={project}>
      <div className="position-fixed top-0 bottom-0 start-0 end-0 d-flex flex-column bg-dark">
        <div className="d-flex justify-content-between align-items-center p-3">
          <span className="text-light">Preview — {formatPageLabel(page)}</span>
          <button className="btn btn-outline-light btn-sm" onClick={() => cb().page.closePreview()}>
            Close preview
          </button>
        </div>
        <PageSheet page={page} pageSize={pageSize} />
      </div>
    </ProjectContext.Provider>
  );
}
