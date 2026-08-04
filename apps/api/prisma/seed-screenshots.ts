/**
 * Seed the DRESSED demo workspace used for product screenshots.
 *
 * Why this exists: the screenshots in `docs/screenshots/` were originally
 * staged by hand. That is why they drift — reshooting meant recreating a
 * workspace from memory, so nobody did it, and the docs kept showing a UI two
 * design passes old. This script makes the dataset reproducible, so a reshoot
 * is two commands rather than an afternoon.
 *
 * Deliberately SEPARATE from `seed.ts`. That one is the honest first-run
 * experience a self-hoster gets from `docker compose up`, and it should stay
 * small. This one is a showroom: WIP limits sitting exactly at capacity, a
 * blocked card, a colour rule that actually matches, comment counts, a
 * half-burned sprint. Mixing the two would either bloat the first-run demo or
 * flatten the screenshots.
 *
 *   DATABASE_URL=... npx tsx prisma/seed-screenshots.ts
 *
 * Destructive for the `nova` workspace only; it is dropped and rebuilt on
 * every run so shots are byte-comparable between reshoots.
 */
import {
  PrismaClient,
  IssueType,
  Priority,
  StatusCategory,
  SprintState,
  Role,
  IssueLinkType,
  BoardType,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { initialRanks, parseWikiLinks } from '@next-lane/shared';

const prisma = new PrismaClient();

const DAY = 24 * 3600 * 1000;

/** People, with the avatar colours the existing shots use. */
const PEOPLE = [
  { email: 'maya@nova.dev', name: 'Maya Okafor', color: '#6366f1' },
  { email: 'alex@nova.dev', name: 'Alex Kim', color: '#14b8a6' },
  { email: 'dev@nova.dev', name: 'Dev Kaur', color: '#0ea5e9' },
  { email: 'priya@nova.dev', name: 'Priya Shah', color: '#10b981' },
  { email: 'sam@nova.dev', name: 'Sam Reyes', color: '#ec4899' },
  { email: 'tom@nova.dev', name: 'Tom Braun', color: '#8b5cf6' },
  { email: 'lena@nova.dev', name: 'Lena Marsh', color: '#f59e0b' },
];

async function main() {
  const passwordHash = await argon2.hash('nextlane');

  const users = [];
  for (const p of PEOPLE) {
    users.push(
      await prisma.user.upsert({
        where: { email: p.email },
        update: { name: p.name, avatarColor: p.color },
        create: { email: p.email, name: p.name, passwordHash, avatarColor: p.color },
      }),
    );
  }
  const [maya, alex, dev, priya, sam, tom, lena] = users;

  // Rebuilt from scratch each run so two reshoots produce the same frame.
  const prior = await prisma.workspace.findUnique({ where: { slug: 'nova' } });
  if (prior) await prisma.workspace.delete({ where: { id: prior.id } });

  const ws = await prisma.workspace.create({
    data: { name: 'Nova Analytics', slug: 'nova' },
  });
  for (const u of users) {
    await prisma.membership.create({
      data: {
        userId: u.id,
        workspaceId: ws.id,
        role: u.id === maya.id ? Role.ADMIN : Role.MEMBER,
      },
    });
  }

  const project = await prisma.project.create({
    data: {
      key: 'NOVA',
      name: 'Nova Platform',
      description: 'Usage metering, billing and insights for the Nova product.',
      workspaceId: ws.id,
      leadId: maya.id,
    },
  });

  // WIP limits are set to exactly the number of cards seeded into those
  // columns, so the board shows a live "4 / 4" at capacity rather than a
  // limit nothing is testing.
  const todo = await prisma.status.create({
    data: { name: 'To Do', category: StatusCategory.TODO, order: 0, projectId: project.id },
  });
  const inProgress = await prisma.status.create({
    data: { name: 'In Progress', category: StatusCategory.IN_PROGRESS, order: 1, wipLimit: 4, projectId: project.id },
  });
  const inReview = await prisma.status.create({
    data: { name: 'In Review', category: StatusCategory.IN_PROGRESS, order: 2, wipLimit: 3, projectId: project.id },
  });
  const done = await prisma.status.create({
    data: { name: 'Done', category: StatusCategory.DONE, order: 3, projectId: project.id },
  });

  const label = async (name: string, color: string) =>
    prisma.label.create({ data: { name, color, projectId: project.id } });
  const billing = await label('billing', '#f59e0b');
  const frontend = await label('frontend', '#3b82f6');
  const backend = await label('backend', '#8b5cf6');
  const design = await label('design', '#ec4899');
  const infra = await label('infra', '#14b8a6');
  const security = await label('security', '#ef4444');
  const bug = await label('bug', '#ef4444');
  const performance = await label('performance', '#10b981');

  const sprintStart = new Date(Date.now() - 7 * DAY);
  const sprint = await prisma.sprint.create({
    data: {
      name: 'Sprint 14',
      goal: 'Metered billing end to end, and insights that load under a second.',
      state: SprintState.ACTIVE,
      startDate: sprintStart,
      endDate: new Date(Date.now() + 7 * DAY),
      projectId: project.id,
    },
  });

  type Spec = {
    title: string;
    status: string;
    assignee: string | null;
    priority: Priority;
    type?: IssueType;
    points?: number;
    labels: string[];
    inSprint?: boolean;
    doneOnDay?: number;
  };

  const S = { todo: todo.id, prog: inProgress.id, rev: inReview.id, done: done.id };
  const specs: Spec[] = [
    // Done — a half-burned sprint reads as a real team mid-flight.
    { title: 'Meter ingestion service for billable events', status: S.done, assignee: dev.id, priority: Priority.HIGH, points: 5, labels: [backend.id, billing.id], doneOnDay: 2 },
    { title: 'Stripe invoice line-item sync', status: S.done, assignee: priya.id, priority: Priority.HIGH, points: 3, labels: [billing.id, backend.id], doneOnDay: 3 },
    { title: 'Insights query cache warm-up', status: S.done, assignee: lena.id, priority: Priority.MEDIUM, points: 2, labels: [performance.id], doneOnDay: 4 },
    { title: 'Fix timezone drift in usage rollups', status: S.done, assignee: sam.id, priority: Priority.HIGHEST, type: IssueType.BUG, points: 3, labels: [bug.id, backend.id], doneOnDay: 5 },
    { title: 'Empty-state illustrations for insights', status: S.done, assignee: alex.id, priority: Priority.LOW, points: 1, labels: [design.id], doneOnDay: 6 },
    // In review — sits exactly on its 3/3 WIP limit.
    { title: 'Proration engine for mid-cycle plan changes', status: S.rev, assignee: dev.id, priority: Priority.HIGHEST, points: 8, labels: [billing.id, backend.id] },
    { title: 'Funnel chart widget', status: S.rev, assignee: sam.id, priority: Priority.MEDIUM, points: 5, labels: [frontend.id, design.id] },
    { title: 'Rate-limit usage API per org', status: S.rev, assignee: tom.id, priority: Priority.MEDIUM, points: 3, labels: [backend.id, security.id] },
    // In progress — exactly on its 4/4 limit.
    { title: 'Billing plan picker redesign', status: S.prog, assignee: alex.id, priority: Priority.HIGH, points: 5, labels: [frontend.id, design.id] },
    { title: 'Cohort retention heatmap', status: S.prog, assignee: lena.id, priority: Priority.MEDIUM, points: 8, labels: [frontend.id] },
    { title: 'Backfill historical events into pipeline v2', status: S.prog, assignee: priya.id, priority: Priority.HIGH, points: 5, labels: [infra.id] },
    { title: 'Alerting on ingestion lag', status: S.prog, assignee: tom.id, priority: Priority.MEDIUM, points: 3, labels: [infra.id] },
    // To do
    { title: 'Usage alerts when nearing plan limits', status: S.todo, assignee: null, priority: Priority.HIGH, points: 5, labels: [billing.id] },
    { title: 'Export insights as scheduled PDF', status: S.todo, assignee: maya.id, priority: Priority.MEDIUM, points: 5, labels: [frontend.id] },
    { title: 'Fix duplicate webhook deliveries on retry', status: S.todo, assignee: null, priority: Priority.HIGHEST, type: IssueType.BUG, points: 3, labels: [bug.id, backend.id] },
    { title: 'Self-serve plan downgrade flow', status: S.todo, assignee: alex.id, priority: Priority.MEDIUM, points: 3, labels: [billing.id, frontend.id] },
    { title: 'SAML assertion parsing edge cases', status: S.todo, assignee: dev.id, priority: Priority.MEDIUM, points: 5, labels: [security.id] },
    { title: 'Dashboard sharing permissions', status: S.todo, assignee: sam.id, priority: Priority.LOW, points: 3, labels: [frontend.id] },
    // Backlog (no sprint) — so the Backlog view has something to plan with.
    { title: 'Anomaly detection on spend', status: S.todo, assignee: null, priority: Priority.MEDIUM, points: 8, labels: [backend.id], inSprint: false },
    { title: 'Multi-currency invoicing', status: S.todo, assignee: null, priority: Priority.MEDIUM, points: 13, labels: [billing.id], inSprint: false },
    { title: 'Warehouse export (BigQuery, Snowflake)', status: S.todo, assignee: null, priority: Priority.LOW, points: 8, labels: [infra.id], inSprint: false },
    { title: 'Per-seat vs per-event pricing toggle', status: S.todo, assignee: null, priority: Priority.LOW, points: 5, labels: [billing.id], inSprint: false },
  ];

  const ranks = initialRanks(specs.length);
  const created: { id: string; title: string; number: number }[] = [];

  for (const [i, spec] of specs.entries()) {
    const number = i + 1;
    const issue = await prisma.issue.create({
      data: {
        number,
        title: spec.title,
        type: spec.type ?? IssueType.TASK,
        priority: spec.priority,
        storyPoints: spec.points,
        rank: ranks[i],
        projectId: project.id,
        statusId: spec.status,
        reporterId: maya.id,
        assigneeId: spec.assignee,
        sprintId: spec.inSprint === false ? null : sprint.id,
        labels: { create: spec.labels.map((labelId) => ({ labelId })) },
      },
    });
    created.push({ id: issue.id, title: issue.title, number });

    // A status transition log for each completed issue, so the burndown draws
    // a real curve instead of a cliff at the sprint's end.
    if (spec.doneOnDay !== undefined) {
      await prisma.activityLog.create({
        data: {
          issueId: issue.id,
          actorId: spec.assignee ?? maya.id,
          field: 'status',
          from: inProgress.id,
          to: done.id,
          createdAt: new Date(sprintStart.getTime() + spec.doneOnDay * DAY),
        },
      });
    }
  }

  const byTitle = (t: string) => created.find((c) => c.title.startsWith(t))!;

  // A blocked card: "Backfill…" is blocked by the ingestion-lag work. This is
  // what puts the Blocked badge on the board.
  await prisma.issueLink.create({
    data: {
      sourceId: byTitle('Alerting on ingestion lag').id,
      targetId: byTitle('Backfill historical').id,
      type: IssueLinkType.BLOCKS,
      createdById: maya.id,
    },
  });

  // Comment counts on a couple of cards.
  for (const [title, bodies] of [
    ['Proration engine', ['Edge case: downgrade on the last day of a cycle. Prorating to zero or to one day?']],
    ['Cohort retention heatmap', ['Design is in Figma — using the sequential teal ramp.', 'Careful with the colour scale: it has to stay AA against both themes.']],
  ] as const) {
    for (const body of bodies) {
      await prisma.comment.create({
        data: { issueId: byTitle(title).id, authorId: alex.id, body },
      });
    }
  }

  // ── Roadmap: epics, dated stories, releases and dependencies ────────────
  //
  // Staged to exercise every case the Gantt has to get right, because a
  // roadmap screenshot of three tidy bars proves nothing:
  //   - an epic that FITS its committed window,
  //   - an epic whose children OVERRUN it (the hatched tail),
  //   - an epic with NO dates of its own whose window is rolled up from its
  //     children — the exact case the founder reported as broken,
  //   - two release milestones,
  //   - one satisfiable dependency and one VIOLATED one (blocker finishes
  //     after the epic it blocks is due to start).
  //
  // Anchored to the start of the current month so the chart always straddles
  // "today" and the today-marker means something in every reshoot.
  const monthStart = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
  );
  const d = (dayOffset: number) =>
    new Date(monthStart.getTime() + dayOffset * DAY);

  type ChildSpec = {
    title: string;
    from: number;
    to: number;
    done?: boolean;
    points?: number;
  };
  type EpicSpec = {
    title: string;
    /** Omitted = the epic states no window and must roll up from its children. */
    own?: { from: number; to: number };
    children: ChildSpec[];
  };

  const epicSpecs: EpicSpec[] = [
    {
      title: 'Usage-based billing GA',
      own: { from: -10, to: 55 },
      children: [
        { title: 'Metering pipeline hardening', from: -8, to: 12, done: true, points: 8 },
        { title: 'Invoice preview API', from: 10, to: 30, points: 5 },
        { title: 'Plan migration tooling', from: 26, to: 50, points: 8 },
      ],
    },
    {
      // Committed to end at day 70; the work reaches day 88. This is the
      // overrun the founder asked to be able to SEE rather than have hidden.
      title: 'Insights v2',
      own: { from: 20, to: 70 },
      children: [
        { title: 'Query engine rewrite', from: 22, to: 55, points: 13 },
        { title: 'Saved views and sharing', from: 50, to: 72, points: 5 },
        { title: 'Cohort explorer', from: 60, to: 88, points: 8 },
      ],
    },
    {
      // No own dates at all — everything here comes from the children. Before
      // 2026-08-02 this rendered as a one-pixel dot on its creation date.
      title: 'Data platform hardening',
      children: [
        { title: 'Partition the events table', from: 5, to: 34, points: 8 },
        { title: 'Replay tooling for dropped batches', from: 30, to: 62, points: 5 },
        { title: 'Multi-region failover drill', from: 58, to: 95, points: 8 },
      ],
    },
    {
      title: 'Enterprise readiness',
      own: { from: 55, to: 120 },
      children: [
        { title: 'SAML and SCIM provisioning', from: 58, to: 92, points: 13 },
        { title: 'Audit log retention policies', from: 88, to: 115, points: 5 },
      ],
    },
    {
      title: 'Self-serve onboarding',
      own: { from: 95, to: 150 },
      children: [
        { title: 'Guided workspace setup', from: 98, to: 126, points: 8 },
        { title: 'Sample dataset generator', from: 120, to: 148, points: 5 },
      ],
    },
  ];

  let roadmapNumber = specs.length;
  const totalRoadmapIssues =
    epicSpecs.length + epicSpecs.reduce((n, e) => n + e.children.length, 0);
  const roadmapRanks = initialRanks(totalRoadmapIssues);
  let rankIdx = 0;
  const epicIdByTitle = new Map<string, string>();

  for (const spec of epicSpecs) {
    roadmapNumber += 1;
    const epic = await prisma.issue.create({
      data: {
        number: roadmapNumber,
        title: spec.title,
        type: IssueType.EPIC,
        priority: Priority.HIGH,
        rank: roadmapRanks[rankIdx++],
        projectId: project.id,
        statusId: spec.own && spec.own.from < 0 ? inProgress.id : todo.id,
        reporterId: maya.id,
        startDate: spec.own ? d(spec.own.from) : null,
        dueDate: spec.own ? d(spec.own.to) : null,
      },
    });
    epicIdByTitle.set(spec.title, epic.id);

    for (const c of spec.children) {
      roadmapNumber += 1;
      await prisma.issue.create({
        data: {
          number: roadmapNumber,
          title: c.title,
          type: IssueType.STORY,
          priority: Priority.MEDIUM,
          storyPoints: c.points,
          rank: roadmapRanks[rankIdx++],
          projectId: project.id,
          statusId: c.done ? done.id : c.from < 0 ? inProgress.id : todo.id,
          reporterId: maya.id,
          parentId: epic.id,
          // The point of the whole exercise: stories carry their OWN dates
          // and belong to no sprint, so only a real rollup surfaces them.
          startDate: d(c.from),
          dueDate: d(c.to),
        },
      });
    }
  }

  // Satisfiable: billing GA ends day 55, onboarding starts day 95.
  await prisma.issueLink.create({
    data: {
      sourceId: epicIdByTitle.get('Usage-based billing GA')!,
      targetId: epicIdByTitle.get('Self-serve onboarding')!,
      type: IssueLinkType.BLOCKS,
      createdById: maya.id,
    },
  });
  // VIOLATED: platform hardening rolls up to day 95, but Insights v2 is due to
  // start on day 20 — a plan that cannot happen in the order it claims.
  await prisma.issueLink.create({
    data: {
      sourceId: epicIdByTitle.get('Data platform hardening')!,
      targetId: epicIdByTitle.get('Insights v2')!,
      type: IssueLinkType.BLOCKS,
      createdById: maya.id,
    },
  });

  for (const [name, dayOffset] of [
    ['v2.0 — Billing GA', 58],
    ['v2.1 — Insights', 92],
  ] as const) {
    await prisma.version.create({
      data: { projectId: project.id, name, releaseDate: d(dayOffset) },
    });
  }

  console.log(
    `  Roadmap: ${epicSpecs.length} epics, ${totalRoadmapIssues - epicSpecs.length} dated stories, 2 releases, 2 dependencies.`,
  );

  // The board is CREATED here, not updated. Nothing has created one yet at
  // seed time (the API makes a default board lazily, on first board fetch), so
  // an `updateMany` matched zero rows and silently left a Kanban "Main Board"
  // with no colour rules — which is exactly what the first reshoot produced.
  await prisma.board.create({
    data: {
      projectId: project.id,
      name: 'Sprint Board',
      // SCRUM so the board scopes to the active sprint. On Kanban the four
      // backlog issues leak into To Do and the column count stops matching
      // the sprint the header is advertising.
      type: BoardType.SCRUM,
      isDefault: true,
      order: 0,
      colorRules: [
        { id: 'critical', query: 'priority = HIGHEST AND status != Done', color: '#ef4444', label: 'Critical' },
        { id: 'bug', query: 'type = BUG', color: '#f97316', label: 'Bug' },
      ],
    },
  });

  // ── Docs: a wiki big enough that the graph view has a real shape ─────────
  //
  // 100 pages, not six. A knowledge graph of six nodes photographs as an empty
  // canvas and tells a reader nothing about what the feature is for; the point
  // of a force-directed view is the structure that only emerges at scale —
  // clusters per area, hubs with high in-degree, a few bridges between them.
  //
  // The link topology is deliberate rather than random: every page links to
  // its section's hub, hubs link to each other, and a handful of pages link
  // across sections. That produces visible clusters joined by bridges, which
  // is what a real engineering wiki looks like — uniform random edges would
  // render as an undifferentiated hairball.
  const SECTIONS: { hub: string; prefix: string; items: string[] }[] = [
    {
      hub: 'Architecture overview',
      prefix: 'Architecture',
      items: [
        'Ingestion API', 'Event schema and versioning', 'Hourly rollup job',
        'Idempotency and deduplication', 'Storage layout', 'Read path and caching',
        'Multi-tenancy model', 'Rate limiting', 'Backpressure and queueing',
        'Schema migration strategy', 'Data retention', 'Service boundaries',
        'Failure domains', 'Capacity model', 'Cost model',
      ],
    },
    {
      hub: 'Billing model',
      prefix: 'Billing',
      items: [
        'Plans and entitlements', 'Metered vs seat pricing', 'Proration rules',
        'Invoice assembly', 'Tax handling', 'Dunning and retries',
        'Credits and refunds', 'Currency support', 'Usage caps and overage',
        'Trials and grandfathering', 'Stripe integration', 'Revenue recognition',
        'Billing reconciliation', 'Disputes and chargebacks',
      ],
    },
    {
      hub: 'Runbooks',
      prefix: 'Runbook',
      items: [
        'Deploy runbook', 'Rollback procedure', 'Database failover',
        'Rotating credentials', 'Scaling the ingestion tier', 'Clearing a stuck queue',
        'Restoring from backup', 'Cache invalidation', 'Draining a node',
        'Certificate renewal', 'Hotfix process', 'Region failover',
        'Replaying dropped events', 'On-call handover',
      ],
    },
    {
      hub: 'Decision records',
      prefix: 'ADR',
      items: [
        'ADR 001 — event-sourced metering', 'ADR 002 — Postgres over Cassandra',
        'ADR 003 — hourly not real-time rollups', 'ADR 004 — proration strategy',
        'ADR 005 — idempotency keys at the edge', 'ADR 006 — single-region first',
        'ADR 007 — no customer-managed keys in v1', 'ADR 008 — REST over gRPC',
        'ADR 009 — fractional indexing for ordering', 'ADR 010 — self-hosted object storage',
        'ADR 011 — soft delete for invoices', 'ADR 012 — synchronous webhooks',
      ],
    },
    {
      hub: 'Engineering handbook',
      prefix: 'Handbook',
      items: [
        'Code review expectations', 'Testing strategy', 'Definition of done',
        'Branching and release', 'Incident severities', 'Postmortem template',
        'Security review checklist', 'Accessibility baseline', 'Performance budgets',
        'Dependency policy', 'Feature flags', 'Documentation standards',
        'Onboarding a new engineer',
      ],
    },
    {
      hub: 'Postmortems',
      prefix: 'Postmortem',
      items: [
        'Postmortem — duplicate invoices, March', 'Postmortem — ingestion lag spike',
        'Postmortem — timezone drift in rollups', 'Postmortem — expired cert outage',
        'Postmortem — runaway backfill', 'Postmortem — Stripe webhook storm',
        'Postmortem — cache stampede', 'Postmortem — failed region failover',
        'Postmortem — duplicate webhook deliveries', 'Postmortem — invoice rounding drift',
        'Postmortem — SAML metadata expiry', 'Postmortem — noisy-neighbour tenant',
        'Postmortem — backfill exhausted disk',
      ],
    },
    {
      hub: 'Product specs',
      prefix: 'Spec',
      items: [
        'Spec — usage alerts', 'Spec — scheduled PDF export', 'Spec — cohort retention',
        'Spec — self-serve downgrade', 'Spec — anomaly detection', 'Spec — warehouse export',
        'Spec — dashboard sharing', 'Spec — funnel charts', 'Spec — SSO for enterprise',
        'Spec — audit log export', 'Spec — multi-currency invoicing',
        'Spec — per-org rate limits', 'Spec — public status page',
      ],
    },
  ];

  const hubs = SECTIONS.map((s) => s.hub);
  const titles: { title: string; body: string; parent?: string }[] = [];

  for (const [si, section] of SECTIONS.entries()) {
    // The hub links to every other hub — these become the bridges between
    // clusters, and the reason the graph reads as one wiki rather than seven.
    const siblingHubs = hubs.filter((h) => h !== section.hub);
    titles.push({
      title: section.hub,
      body:
        `# ${section.hub}\n\n` +
        `The index for ${section.prefix.toLowerCase()} material.\n\n` +
        `## Contents\n\n` +
        section.items.map((t) => `- [[${t}]]`).join('\n') +
        `\n\n## Related areas\n\n` +
        siblingHubs.map((h) => `- [[${h}]]`).join('\n') +
        '\n',
    });

    for (const [ii, item] of section.items.entries()) {
      // Each page links back to its hub, forward to the next page in its own
      // section (a readable chain), and — every third page — across to another
      // section. Cross-links are what stop the clusters from being islands.
      const next = section.items[(ii + 1) % section.items.length];
      const crossSection = SECTIONS[(si + 1 + (ii % 3)) % SECTIONS.length];
      const cross = crossSection.items[ii % crossSection.items.length];
      const links = [section.hub, next];
      if (ii % 3 === 0 && cross !== item) links.push(cross);
      titles.push({
        title: item,
        parent: section.hub,
        body:
          `# ${item}\n\n` +
          `Owned by the platform team. Last reviewed this quarter.\n\n` +
          `See also: ${links.map((l) => `[[${l}]]`).join(', ')}.\n`,
      });
    }
  }

  const pageRanks = initialRanks(titles.length);
  const pageIdByTitle = new Map<string, string>();

  // Hubs first, so a child can resolve its parent by title in one pass.
  const ordered = [
    ...titles.filter((t) => !t.parent),
    ...titles.filter((t) => t.parent),
  ];
  for (const [i, t] of ordered.entries()) {
    const row = await prisma.page.create({
      data: {
        title: t.title,
        content: t.body,
        rank: pageRanks[i],
        workspaceId: ws.id,
        projectId: project.id,
        parentId: t.parent ? (pageIdByTitle.get(t.parent) ?? null) : null,
        authorId: maya.id,
        lastEditedById: maya.id,
      },
    });
    pageIdByTitle.set(t.title, row.id);
  }

  // Wiki-link edges. `PagesService` syncs these on every save, but this seed
  // writes pages through Prisma directly, so nothing ran that sync — the first
  // reshoot produced a knowledge graph of six isolated dots, which is a
  // screenshot of the feature not working. Resolved with the SAME parser and
  // the same case-insensitive title matching the app uses, so the graph shown
  // in the docs is the graph the product would actually draw.
  const allPages = await prisma.page.findMany({
    where: { projectId: project.id },
    select: { id: true, title: true, content: true },
  });
  const byTitleLower = new Map(allPages.map((p) => [p.title.toLowerCase(), p.id]));
  let edges = 0;
  for (const p of allPages) {
    const targets = new Set(
      parseWikiLinks(p.content)
        .map((l) => byTitleLower.get(l.title.trim().toLowerCase()))
        .filter((id): id is string => Boolean(id) && id !== p.id),
    );
    for (const targetPageId of targets) {
      await prisma.pageLink.create({
        data: { sourcePageId: p.id, targetPageId },
      });
      edges += 1;
    }
  }

  console.log(`  Docs: ${allPages.length} pages, ${edges} wiki-link edges.`);
  console.log('Screenshot seed complete.');
  console.log(`  Workspace: Nova Analytics (nova)  Project: NOVA`);
  console.log(`  Login: ${PEOPLE[0].email} / nextlane`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
