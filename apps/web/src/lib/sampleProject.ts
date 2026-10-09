/**
 * "Explore with a sample project" — client-side seeding.
 *
 * Builds a clearly-labelled demo project through the ordinary REST endpoints
 * (no special API): a project, three labels, an epic with children, ~12 issues
 * spread over every workflow status / type / priority, one active sprint and
 * two wiki pages. The runner takes an injectable `call` so it is unit-testable
 * and reports progress so the UI can show a determinate bar.
 */
import { IssueType, Priority, SprintState } from '@next-lane/shared';
import type {
  IssueDto,
  LabelDto,
  PageDto,
  ProjectDto,
  SprintDto,
  StatusDto,
} from '@next-lane/shared';

export const SAMPLE_NAME = 'Sample: Website Relaunch';
const SAMPLE_PREFIX = 'Sample:';
const BASE_KEY = 'SAMPLE';

export function isSampleProject(p: Pick<ProjectDto, 'name'>): boolean {
  return p.name.trim().toLowerCase().startsWith(SAMPLE_PREFIX.toLowerCase());
}

/** First unused key: SAMPLE, SAMPLE2, SAMPLE3, ... (max 10 chars server-side). */
export function pickSampleKey(existingKeys: readonly string[]): string {
  const used = new Set(existingKeys.map((k) => k.toUpperCase()));
  if (!used.has(BASE_KEY)) return BASE_KEY;
  for (let n = 2; n < 1000; n++) {
    const key = `${BASE_KEY}${n}`.slice(0, 10);
    if (!used.has(key)) return key;
  }
  return `S${Date.now().toString(36).toUpperCase()}`.slice(0, 10);
}

type Column = 'todo' | 'progress' | 'done';

interface SampleIssue {
  ref: string;
  title: string;
  description?: string;
  type: IssueType;
  priority: Priority;
  column: Column;
  points?: number;
  labels?: string[];
  parent?: string;
  inSprint?: boolean;
}

export const SAMPLE_LABELS = [
  { name: 'design', color: '#8b5cf6' },
  { name: 'frontend', color: '#0ea5e9' },
  { name: 'content', color: '#f59e0b' },
];

export const SAMPLE_ISSUES: SampleIssue[] = [
  { ref: 'epic', title: 'Relaunch marketing site', type: IssueType.EPIC, priority: Priority.HIGH, column: 'progress',
    description: 'Umbrella for everything shipping with the new site. Child issues roll up here.' },
  { ref: 'hero', title: 'Design new homepage hero', type: IssueType.STORY, priority: Priority.HIGH, column: 'done', points: 5, labels: ['design'], parent: 'epic', inSprint: true,
    description: 'Headline, sub-copy and a single primary call to action.' },
  { ref: 'nav', title: 'Build responsive navigation', type: IssueType.TASK, priority: Priority.MEDIUM, column: 'progress', points: 3, labels: ['frontend'], parent: 'epic', inSprint: true },
  { ref: 'pricing', title: 'Write pricing page copy', type: IssueType.TASK, priority: Priority.MEDIUM, column: 'progress', points: 2, labels: ['content'], parent: 'epic', inSprint: true },
  { ref: 'safari', title: 'Fix layout shift on Safari iOS', type: IssueType.BUG, priority: Priority.HIGHEST, column: 'todo', points: 2, labels: ['frontend'], parent: 'epic', inSprint: true,
    description: 'The footer jumps when the address bar collapses.' },
  { ref: 'seo', title: 'Add SEO metadata to all pages', type: IssueType.TASK, priority: Priority.LOW, column: 'todo', points: 1, inSprint: true },
  { ref: 'contact', title: 'Contact form returns 500 on long messages', type: IssueType.BUG, priority: Priority.HIGH, column: 'todo', points: 3, labels: ['frontend'], inSprint: true },
  { ref: 'analytics', title: 'Set up privacy-friendly analytics', type: IssueType.STORY, priority: Priority.MEDIUM, column: 'todo', points: 3 },
  { ref: 'blog', title: 'Migrate blog posts from the old CMS', type: IssueType.STORY, priority: Priority.LOW, column: 'todo', points: 8, labels: ['content'] },
  { ref: 'dark', title: 'Dark mode for the docs section', type: IssueType.STORY, priority: Priority.LOWEST, column: 'todo', labels: ['design'] },
  { ref: 'a11y', title: 'Audit colour contrast (WCAG AA)', type: IssueType.TASK, priority: Priority.MEDIUM, column: 'done', points: 2, labels: ['design'], inSprint: true },
  { ref: 'dns', title: 'Cut over DNS to the new host', type: IssueType.TASK, priority: Priority.HIGHEST, column: 'todo', points: 1 },
];

export const SAMPLE_PAGES: { title: string; content: string }[] = [
  {
    title: 'Relaunch brief',
    content:
      '# Relaunch brief\n\nGoal: a faster, clearer marketing site that converts.\n\n## Success metrics\n\n- Lighthouse performance above 90\n- Contact form completion up 20%\n\n## Scope\n\nHomepage, pricing, blog and docs. See the **Relaunch marketing site** epic on the board.\n',
  },
  {
    title: 'Launch checklist',
    content:
      '# Launch checklist\n\n- [x] Design sign-off\n- [ ] Cross-browser pass (Safari iOS first)\n- [ ] SEO metadata\n- [ ] DNS cut-over\n\nTip: press **Ctrl/Cmd + K** to jump to any issue or page.\n',
  },
];

export type SampleCall = <T>(
  path: string,
  options?: { method?: string; body?: unknown },
) => Promise<T>;

export interface SampleProgress {
  done: number;
  total: number;
  label: string;
}

export class SampleSeedError extends Error {
  /** The project that was created before the failure (null if it never was). */
  project: ProjectDto | null;
  constructor(message: string, project: ProjectDto | null) {
    super(message);
    this.name = 'SampleSeedError';
    this.project = project;
  }
}

/** Total progress steps: project + labels + sprint + issues + label links + pages + start. */
export function sampleStepCount(): number {
  const links = SAMPLE_ISSUES.reduce((n, i) => n + (i.labels?.length ?? 0), 0);
  return 1 + SAMPLE_LABELS.length + 1 + SAMPLE_ISSUES.length + links + SAMPLE_PAGES.length + 1;
}

function pickStatus(statuses: StatusDto[], column: Column): StatusDto | undefined {
  const sorted = [...statuses].sort((a, b) => a.order - b.order);
  const cat = column === 'todo' ? 'TODO' : column === 'progress' ? 'IN_PROGRESS' : 'DONE';
  return sorted.find((s) => s.category === cat) ?? sorted[column === 'todo' ? 0 : sorted.length - 1];
}

export async function createSampleProject(
  call: SampleCall,
  workspaceId: string,
  existingKeys: readonly string[],
  onProgress?: (p: SampleProgress) => void,
): Promise<ProjectDto> {
  const total = sampleStepCount();
  let done = 0;
  const step = (label: string) => onProgress?.({ done: ++done, total, label });

  // Project (retry on key collision from a concurrent create).
  let project: ProjectDto | null = null;
  const keys = [...existingKeys];
  for (let attempt = 0; attempt < 5 && !project; attempt++) {
    const key = pickSampleKey(keys);
    try {
      project = await call<ProjectDto>('/projects', {
        method: 'POST',
        body: {
          workspaceId,
          key,
          name: SAMPLE_NAME,
          description:
            'A throwaway demo project so you can explore boards, sprints and wiki pages. Archive it any time from project settings.',
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (/already in use|conflict/i.test(msg)) keys.push(key);
      else throw new SampleSeedError(msg || 'Could not create the sample project.', null);
    }
  }
  if (!project) throw new SampleSeedError('Could not find a free project key.', null);
  step('Creating project');

  const pid = project.id;
  try {
    const board = await call<{ statuses: StatusDto[] }>(`/projects/${pid}/board`);

    const labelIds: Record<string, LabelDto> = {};
    for (const l of SAMPLE_LABELS) {
      labelIds[l.name] = await call<LabelDto>(`/projects/${pid}/labels`, { method: 'POST', body: l });
      step('Adding labels');
    }

    const day = 86_400_000;
    const sprint = await call<SprintDto>(`/projects/${pid}/sprints`, {
      method: 'POST',
      body: {
        name: 'Sprint 1',
        goal: 'Ship the new homepage and fix launch blockers',
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 14 * day).toISOString(),
      },
    });
    step('Planning sprint');

    const created: Record<string, IssueDto> = {};
    for (const spec of SAMPLE_ISSUES) {
      const status = pickStatus(board.statuses, spec.column);
      created[spec.ref] = await call<IssueDto>('/issues', {
        method: 'POST',
        body: {
          projectId: pid,
          title: spec.title,
          type: spec.type,
          priority: spec.priority,
          description: spec.description,
          statusId: status?.id,
          storyPoints: spec.points,
          parentId: spec.parent ? created[spec.parent]?.id : undefined,
          sprintId: spec.inSprint ? sprint.id : undefined,
        },
      });
      step('Creating issues');
      for (const name of spec.labels ?? []) {
        await call<void>(`/issues/${created[spec.ref].id}/labels`, {
          method: 'POST',
          body: { labelId: labelIds[name].id },
        });
        step('Labelling issues');
      }
    }

    for (const pg of SAMPLE_PAGES) {
      await call<PageDto>(`/projects/${pid}/pages`, { method: 'POST', body: pg });
      step('Writing wiki pages');
    }

    await call<SprintDto>(`/sprints/${sprint.id}`, {
      method: 'PATCH',
      body: { state: SprintState.ACTIVE },
    });
    step('Starting sprint');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    throw new SampleSeedError(msg, project);
  }
  return project;
}
