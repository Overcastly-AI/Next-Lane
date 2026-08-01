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

  // ── Docs: a wiki with real cross-links, so the graph view has a shape ─────
  const pageRanks = initialRanks(6);
  const page = async (title: string, content: string, rank: string, parentId?: string) =>
    prisma.page.create({
      data: {
        title,
        content,
        rank,
        workspaceId: ws.id,
        projectId: project.id,
        parentId: parentId ?? null,
        authorId: maya.id,
        lastEditedById: maya.id,
      },
    });

  const arch = await page(
    'Architecture overview',
    '# Architecture overview\n\nNova ingests metered events, rolls them up hourly, and bills from the rollups.\n\nSee [[Metering pipeline]] and [[Billing model]].\n',
    pageRanks[0],
  );
  await page(
    'Metering pipeline',
    '# Metering pipeline\n\nEvents land on the ingestion API, are deduplicated by idempotency key, then rolled up.\n\nFailure modes are covered in [[Deploy runbook]].\n',
    pageRanks[1],
  );
  await page(
    'Billing model',
    '# Billing model\n\nPlans, entitlements and proration. Invoices are assembled from hourly rollups.\n\nDecisions live in [[ADR 004 — proration strategy]].\n',
    pageRanks[2],
  );
  await page(
    'Deploy runbook',
    '# Deploy runbook\n\n1. Drain the ingestion node.\n2. Roll the pipeline.\n3. Watch the error rate for ten minutes.\n\nEscalation path: [[Incident response]].\n',
    pageRanks[3],
  );
  await page(
    'Incident response',
    '# Incident response\n\nSeverities, who to page, and how to write the postmortem.\n\nContext: [[Architecture overview]].\n',
    pageRanks[4],
  );
  await page(
    'ADR 004 — proration strategy',
    '# ADR 004 — proration strategy\n\n**Status:** accepted\n\nWe prorate to the second, not the day, because a plan change on the last day of a cycle otherwise rounds to a full period.\n\nSupersedes the approach in [[Billing model]].\n',
    pageRanks[5],
    arch.id,
  );

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
