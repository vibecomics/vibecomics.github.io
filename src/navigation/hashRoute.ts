import { initialTab } from '../components/editorTabs';
import type { EditorTab } from '../components/editorTabs';
import { resolveSelection } from '../components/selection';
import type { Selection } from '../components/selection';
import type { ComicProject } from '../types/comic';

/** A place in a comic: which project, and within it the tab, page, panel and layer. */
export interface ComicRoute {
  comic: string;
  /** Absent means the project's starting tab. */
  tab?: EditorTab;
  /** Pages tab: the page's number as the UI shows it (the cover is 0). */
  page?: number;
  /** Pages tab: the panel's position on the page, from 1. */
  panel?: number;
  layer?: string;
}

export type Route = { screen: 'welcome' } | ({ screen: 'comic' } & ComicRoute);

/** What the editor shows: the tab, the page at an index, and the highlighted panel and layer. */
export interface View {
  tab: EditorTab;
  pageIndex: number;
  selection: Selection;
}

export const WELCOME_HASH = '#welcome';
const WELCOME: Route = { screen: 'welcome' };
const FLAG_TABS: EditorTab[] = ['outline', 'cast', 'scenes', 'media'];

const wholeNumber = (text: string): number | undefined =>
  /^\d+$/.test(text) ? Number(text) : undefined;

/** Any URL that does not name a place reads as the welcome page. */
export function parseHash(hash: string): Route {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const comic = params.get('comic');
  const flags = FLAG_TABS.filter((tab) => params.has(tab));
  const hasPages = params.has('page');
  if (!comic || flags.length + (hasPages ? 1 : 0) > 1) return WELCOME;
  if (!hasPages) {
    if (params.has('panel') || params.has('layer')) return WELCOME;
    return { screen: 'comic', comic, tab: flags[0] };
  }

  const page = wholeNumber(params.get('page') ?? '');
  if (page === undefined) return WELCOME;
  let panel: number | undefined;
  if (params.has('panel')) {
    panel = wholeNumber(params.get('panel') ?? '');
    if (!panel) return WELCOME;
  }
  const layer = params.get('layer') ?? undefined;
  if (params.has('layer') && !layer) return WELCOME;
  return { screen: 'comic', comic, tab: 'pages', page, panel, layer };
}

export function formatHash(route: Route): string {
  if (route.screen === 'welcome') return WELCOME_HASH;
  const parts = [`comic=${encodeURIComponent(route.comic)}`];
  if (route.tab === 'pages') {
    if (route.page !== undefined) parts.push(`page=${route.page}`);
    if (route.panel !== undefined) parts.push(`panel=${route.panel}`);
    if (route.layer !== undefined) parts.push(`layer=${encodeURIComponent(route.layer)}`);
  } else if (route.tab) {
    parts.push(route.tab);
  }
  return `#${parts.join('&')}`;
}

/** The route without its panel and layer: moving between those is not a new place in history. */
export function placeHash(route: Route): string {
  return route.screen === 'welcome'
    ? formatHash(route)
    : formatHash({ ...route, panel: undefined, layer: undefined });
}

/** The view a project opens on when no URL says otherwise. */
export function startView(project: ComicProject): View {
  return { tab: initialTab(project), pageIndex: 0, selection: { panelId: null } };
}

/** The view a URL names in this project, or null when the URL points at something that is not there. */
export function viewFromRoute(project: ComicProject, route: ComicRoute): View | null {
  const tab = route.tab ?? initialTab(project);
  const none: Selection = { panelId: null };
  if (tab !== 'pages') return { tab, pageIndex: 0, selection: none };

  const pageIndex =
    route.page === undefined ? 0 : project.pages.findIndex((p) => p.number === route.page);
  const page = project.pages[pageIndex];
  if (!page) return null;
  if (route.panel === undefined) {
    return route.layer === undefined ? { tab, pageIndex, selection: none } : null;
  }

  const panel = page.panels[route.panel - 1];
  if (!panel) return null;
  if (route.layer !== undefined && !panel.layers.some((l) => l.id === route.layer)) return null;
  const selection: Selection = { panelId: panel.id };
  if (route.layer !== undefined) selection.layerId = route.layer;
  return { tab, pageIndex, selection };
}

/** The route for what the editor is showing. */
export function routeOf(comic: string, project: ComicProject, view: View): ComicRoute {
  if (view.tab !== 'pages') return { comic, tab: view.tab };
  const page = project.pages[view.pageIndex];
  if (!page) return { comic, tab: 'pages' };
  const { panel, current } = resolveSelection(page, view.selection);
  return {
    comic,
    tab: 'pages',
    page: page.number,
    panel: panel ? page.panels.indexOf(panel) + 1 : undefined,
    layer: panel ? current.layerId : undefined,
  };
}
