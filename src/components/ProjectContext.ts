import { createContext, useContext } from 'react';
import type { ComicProject } from '../types/comic';

/** The open project, for components deep in the editor that need more of it than they are given. */
export const ProjectContext = createContext<ComicProject | null>(null);

export function useProject(): ComicProject {
  const project = useContext(ProjectContext);
  if (!project) throw new Error('No project is open.');
  return project;
}
