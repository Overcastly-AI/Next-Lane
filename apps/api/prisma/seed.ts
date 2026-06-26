/**
 * Seed a demo workspace so `docker compose up` yields a usable board.
 * Idempotent: safe to run repeatedly (clears demo data first).
 */
import { PrismaClient, IssueType, Priority, StatusCategory, SprintState, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { initialRanks } from '@next-lane/shared';

const prisma = new PrismaClient();

async function main() {
  // When invoked automatically on container boot (AUTO_SEED_GUARD=1), skip if
  // the demo data already exists so restarts don't wipe the user's changes.
  if (process.env.AUTO_SEED_GUARD === '1') {
    const existingDemo = await prisma.user.findUnique({
      where: { email: 'demo@nextlane.dev' },
    });
    if (existingDemo) {
      console.log('Seed: demo data already present, skipping.');
      return;
    }
  }

  const password = await argon2.hash('nextlane');

  // Users
  const demo = await prisma.user.upsert({
    where: { email: 'demo@nextlane.dev' },
    update: {},
    create: {
      email: 'demo@nextlane.dev',
      name: 'Demo User',
      passwordHash: password,
      avatarColor: '#6366f1',
    },
  });
  const alex = await prisma.user.upsert({
    where: { email: 'alex@nextlane.dev' },
    update: {},
    create: {
      email: 'alex@nextlane.dev',
      name: 'Alex Rivera',
      passwordHash: password,
      avatarColor: '#22c55e',
    },
  });
  const sam = await prisma.user.upsert({
    where: { email: 'sam@nextlane.dev' },
    update: {},
    create: {
      email: 'sam@nextlane.dev',
      name: 'Sam Chen',
      passwordHash: password,
      avatarColor: '#ec4899',
    },
  });

  // Workspace + memberships
  const workspace = await prisma.workspace.upsert({
    where: { slug: 'demo' },
    update: {},
    create: { name: 'Demo Workspace', slug: 'demo' },
  });
  for (const [user, role] of [
    [demo, Role.ADMIN],
    [alex, Role.MEMBER],
    [sam, Role.MEMBER],
  ] as const) {
    await prisma.membership.upsert({
      where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
      update: { role },
      create: { userId: user.id, workspaceId: workspace.id, role },
    });
  }

  // Fresh project each seed run (wipe prior demo project by key)
  const existing = await prisma.project.findUnique({
    where: { workspaceId_key: { workspaceId: workspace.id, key: 'NL' } },
  });
  if (existing) {
    await prisma.project.delete({ where: { id: existing.id } });
  }

  const project = await prisma.project.create({
    data: {
      key: 'NL',
      name: 'Next Lane',
      description: 'Building the open-source, self-hosted issue & project tracker.',
      workspaceId: workspace.id,
      leadId: demo.id,
    },
  });

  const todo = await prisma.status.create({
    data: { name: 'To Do', category: StatusCategory.TODO, order: 0, projectId: project.id },
  });
  const inProgress = await prisma.status.create({
    data: { name: 'In Progress', category: StatusCategory.IN_PROGRESS, order: 1, projectId: project.id },
  });
  const done = await prisma.status.create({
    data: { name: 'Done', category: StatusCategory.DONE, order: 2, projectId: project.id },
  });

  const bug = await prisma.label.create({
    data: { name: 'bug', color: '#ef4444', projectId: project.id },
  });
  const feature = await prisma.label.create({
    data: { name: 'feature', color: '#3b82f6', projectId: project.id },
  });
  const design = await prisma.label.create({
    data: { name: 'design', color: '#a855f7', projectId: project.id },
  });

  const sprint = await prisma.sprint.create({
    data: {
      name: 'Sprint 1',
      goal: 'Ship the MVP board',
      state: SprintState.ACTIVE,
      startDate: new Date(),
      endDate: new Date(Date.now() + 12 * 24 * 3600 * 1000),
      projectId: project.id,
    },
  });

  type Spec = {
    title: string;
    type: IssueType;
    priority: Priority;
    statusId: string;
    assigneeId: string | null;
    description?: string;
    labels?: string[];
    /** Estimate in story points; powers the velocity + burndown reports. */
    storyPoints?: number;
    /**
     * Days after the sprint start that this issue moved into a DONE status.
     * Used to seed a `status` ActivityLog transition so the burndown chart shows
     * a real curve (only meaningful for issues that end in the Done column).
     */
    completedOnDay?: number;
  };
  const specs: Spec[] = [
    { title: 'Set up Docker Compose stack', type: IssueType.TASK, priority: Priority.HIGH, statusId: done.id, assigneeId: demo.id, labels: [feature.id], storyPoints: 5, completedOnDay: 1 },
    { title: 'Design the issue data model', type: IssueType.STORY, priority: Priority.HIGH, statusId: done.id, assigneeId: alex.id, labels: [design.id], storyPoints: 8, completedOnDay: 3 },
    { title: 'Implement JWT authentication', type: IssueType.TASK, priority: Priority.MEDIUM, statusId: inProgress.id, assigneeId: demo.id, labels: [feature.id], storyPoints: 5 },
    { title: 'Kanban board drag-and-drop', type: IssueType.STORY, priority: Priority.HIGHEST, statusId: inProgress.id, assigneeId: sam.id, labels: [feature.id, design.id], storyPoints: 8 },
    { title: 'Cards lose order after refresh', type: IssueType.BUG, priority: Priority.HIGH, statusId: todo.id, assigneeId: null, labels: [bug.id], storyPoints: 3 },
    { title: 'Add issue detail modal', type: IssueType.STORY, priority: Priority.MEDIUM, statusId: todo.id, assigneeId: alex.id, storyPoints: 3 },
    { title: 'Backlog and sprint planning view', type: IssueType.STORY, priority: Priority.LOW, statusId: todo.id, assigneeId: null, labels: [feature.id], storyPoints: 5 },
    { title: 'Burndown chart', type: IssueType.TASK, priority: Priority.LOWEST, statusId: todo.id, assigneeId: sam.id, storyPoints: 2 },
  ];

  // ranks per status
  const byStatus: Record<string, Spec[]> = {};
  for (const s of specs) (byStatus[s.statusId] ??= []).push(s);

  const sprintStart = sprint.startDate ?? new Date();

  let seq = 0;
  for (const statusId of Object.keys(byStatus)) {
    const group = byStatus[statusId];
    const ranks = initialRanks(group.length);
    for (let i = 0; i < group.length; i++) {
      const s = group[i];
      seq += 1;
      const issue = await prisma.issue.create({
        data: {
          number: seq,
          projectId: project.id,
          type: s.type,
          title: s.title,
          description: s.description ?? null,
          statusId: s.statusId,
          assigneeId: s.assigneeId,
          reporterId: demo.id,
          priority: s.priority,
          storyPoints: s.storyPoints ?? null,
          sprintId: sprint.id,
          rank: ranks[i],
          labels: s.labels
            ? { create: s.labels.map((labelId) => ({ labelId })) }
            : undefined,
        },
      });
      await prisma.activityLog.create({
        data: { issueId: issue.id, actorId: demo.id, field: 'created', from: null, to: null },
      });
      // Seed a status→DONE transition for completed issues so the burndown
      // chart has real "actual remaining" data within the sprint window.
      if (s.completedOnDay !== undefined) {
        const completedAt = new Date(
          sprintStart.getTime() + s.completedOnDay * 24 * 3600 * 1000,
        );
        await prisma.activityLog.create({
          data: {
            issueId: issue.id,
            actorId: s.assigneeId ?? demo.id,
            field: 'status',
            from: todo.id,
            to: done.id,
            createdAt: completedAt,
          },
        });
      }
    }
  }

  await prisma.project.update({
    where: { id: project.id },
    data: { issueSeq: seq },
  });

  // A couple of comments
  const firstInProgress = await prisma.issue.findFirst({
    where: { projectId: project.id, statusId: inProgress.id },
  });
  if (firstInProgress) {
    await prisma.comment.create({
      data: {
        issueId: firstInProgress.id,
        authorId: alex.id,
        body: 'I can pick this up after the auth work lands.',
      },
    });
    await prisma.comment.create({
      data: {
        issueId: firstInProgress.id,
        authorId: demo.id,
        body: 'Thanks! Drag is mostly working, just polishing the rank math.',
      },
    });
  }

  console.log('Seed complete:');
  console.log('  Login: demo@nextlane.dev / nextlane');
  console.log(`  Workspace: ${workspace.name} (${workspace.slug})`);
  console.log(`  Project: ${project.key} — ${project.name} with ${seq} issues`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
