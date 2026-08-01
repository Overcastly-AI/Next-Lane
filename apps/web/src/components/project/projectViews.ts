import type { ComponentType } from 'react';
import {
  ViewBacklogIcon,
  ViewBoardIcon,
  ViewDashboardsIcon,
  ViewPagesIcon,
  ViewReportsIcon,
  ViewRoadmapIcon,
  ViewTriageIcon,
} from '@/components/nav/sidebarIcons';

/**
 * The canonical list of a project's views — ONE list, consumed by both
 * surfaces that navigate a project.
 *
 * It exists because those two surfaces disagreed. `ProjectNav`'s tab bar knew
 * about eleven views; the sidebar's per-project sub-nav knew about six, and
 * the two did not even agree on which were important: Dashboards and Roadmap
 * were sidebar rows but lived in the tab bar's "More" menu, while Triage,
 * Analytics, Poker, Standup and Automation were reachable from the tabs and
 * invisible from the sidebar entirely. The nav audit named this as the single
 * biggest driver of "the nav doesn't seem organised" — the app disagreeing
 * with itself about what it contains.
 *
 * `primary` is now the one definition of "important enough to be a top-level
 * destination", and both surfaces honour it: the tab bar renders primary views
 * as tabs and the rest under More, and the sidebar renders exactly the primary
 * set. Adding a view means adding one row here.
 */
interface BaseProjectView {
  /** Route segment under `/projects/:id/`. */
  to: string;
  label: string;
  /** Stable e2e hook, where one already exists. Do not invent new ones here. */
  testId?: 'nav-pages' | 'nav-automation';
}

/**
 * A top-level destination: a tab in the project bar AND a row in the sidebar.
 *
 * `Icon` is REQUIRED here rather than optional on a single shared shape, so
 * that adding a primary view without an icon is a compile error instead of a
 * blank 14px gap in the sidebar. The sidebar renders `view.Icon` directly; the
 * type is what guarantees it exists.
 */
export interface PrimaryProjectView extends BaseProjectView {
  primary: true;
  Icon: ComponentType<{ className?: string }>;
}

/** Reachable from the tab bar's "More" menu only — no icon, no sidebar row. */
export interface SecondaryProjectView extends BaseProjectView {
  primary: false;
}

/**
 * `primary` is the one definition of "important enough to be a top-level
 * destination", and both surfaces honour it.
 *
 * The split is by how often a view is a daily destination, not by how much
 * work it took to build. Poker and Standup are ceremony surfaces used at fixed
 * moments; Analytics is the project twin of a Personal-group item; Automation
 * is configuration.
 */
export type ProjectView = PrimaryProjectView | SecondaryProjectView;

export const PROJECT_VIEWS: readonly ProjectView[] = [
  { to: 'board',       label: 'Board',      Icon: ViewBoardIcon,      primary: true },
  { to: 'backlog',     label: 'Backlog',    Icon: ViewBacklogIcon,    primary: true },
  { to: 'triage',      label: 'Triage',     Icon: ViewTriageIcon,     primary: true },
  // Docs (route `/pages` — unchanged, deep links and MCP depend on it) is a
  // flagship pillar and stays first-class; the founder previously could not
  // find it under More.
  { to: 'pages',       label: 'Docs',       Icon: ViewPagesIcon,      primary: true, testId: 'nav-pages' },
  { to: 'dashboards',  label: 'Dashboards', Icon: ViewDashboardsIcon, primary: true },
  { to: 'roadmap',     label: 'Roadmap',    Icon: ViewRoadmapIcon,    primary: true },
  { to: 'reports',     label: 'Reports',    Icon: ViewReportsIcon,    primary: true },
  { to: 'analytics',   label: 'Analytics',   primary: false },
  { to: 'poker',       label: 'Poker',       primary: false },
  { to: 'standups',    label: 'Standup',     primary: false },
  { to: 'automations', label: 'Automation',  primary: false, testId: 'nav-automation' },
];

/** Views shown as top-level tabs and as sidebar rows. */
export const PRIMARY_PROJECT_VIEWS: readonly PrimaryProjectView[] =
  PROJECT_VIEWS.filter((v): v is PrimaryProjectView => v.primary);

/** Views reachable from the tab bar's "More" menu. */
export const SECONDARY_PROJECT_VIEWS: readonly SecondaryProjectView[] =
  PROJECT_VIEWS.filter((v): v is SecondaryProjectView => !v.primary);
