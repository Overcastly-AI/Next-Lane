/**
 * Built-in starter doc templates.
 *
 * These are seeded as ORDINARY workspace-scoped `PageTemplate` rows the first
 * time a workspace needs them — not special-cased read-only rows. Once seeded
 * they are fully editable and deletable like any template the user writes,
 * which is the whole point: they are a starting position, not a fixture. The
 * `builtIn` column records where a row came from (so the UI can label it and
 * so re-seeding can skip it), and it never grants the row special powers.
 *
 * Kept in `packages/shared` so the seeder, the docs, and any future
 * "restore the starters" affordance all read one definition.
 */

/** Shape of a starter definition (pre-persistence — no ids or scope yet). */
export interface PageTemplateStarter {
  name: string;
  description: string;
  /** Default page title; supports the same `{{tokens}}` as the body. */
  titleTemplate: string;
  content: string;
}

export const PAGE_TEMPLATE_STARTERS: readonly PageTemplateStarter[] = [
  {
    name: 'Meeting notes',
    description: 'Agenda, discussion, decisions and action items for a single meeting.',
    titleTemplate: 'Meeting notes — {{date}}',
    content: `# Meeting notes — {{date}}

**Date:** {{datetime}}
**Attendees:**
**Scribe:** {{author}}

## Agenda

1.

## Discussion

## Decisions

> Record the decision itself, not the debate. Link the issue it affects.

-

## Action items

| Owner | Action | Due |
| --- | --- | --- |
|  |  |  |
`,
  },
  {
    name: 'Decision record',
    description:
      'Lightweight ADR — the context, the options weighed, the call, and what it costs.',
    titleTemplate: 'Decision: ',
    content: `# Decision: {{title}}

**Status:** Proposed <!-- Proposed | Accepted | Superseded -->
**Date:** {{date}}
**Deciders:** {{author}}

## Context

What forced a decision? Include the constraint that makes this non-obvious —
if there isn't one, this probably doesn't need a record.

## Options considered

### Option A —

- **Pros:**
- **Cons:**

### Option B —

- **Pros:**
- **Cons:**

## Decision

State the choice in one sentence, in the active voice.

## Consequences

What becomes easier, what becomes harder, and what we've now committed to.
Include the cost — a decision record with only upsides is marketing.

## Revisit when

The signal that should make us reopen this.
`,
  },
  {
    name: 'Runbook',
    description: 'Operational procedure — symptoms, diagnosis, and the exact steps to fix.',
    titleTemplate: 'Runbook: ',
    content: `# Runbook: {{title}}

**Owner:**
**Last reviewed:** {{date}}

## When to use this

The symptom or alert that brings someone here.

## Impact

Who is affected and how badly, so the reader can judge urgency.

## Prerequisites

- Access needed:
- Tools needed:

## Diagnosis

1.

## Resolution

> Exact commands. Assume the reader is tired and it is 3am.

\`\`\`bash

\`\`\`

## Verification

How to confirm it's actually fixed — not just that the error stopped.

## Rollback

## If this doesn't work

Who to escalate to, and what to hand them.
`,
  },
  {
    name: 'Spec / PRD',
    description: 'Problem, proposal, scope and success criteria for a piece of work.',
    titleTemplate: 'Spec: ',
    content: `# Spec: {{title}}

**Author:** {{author}}
**Date:** {{date}}
**Status:** Draft

## Problem

Whose problem is it, and what does it cost them today? Evidence beats
assertion — link the ticket, quote the user.

## Goals

-

## Non-goals

Explicitly out of scope. This section prevents the most expensive
misunderstandings, so it is not optional.

-

## Proposal

## Alternatives considered

## Success criteria

How we'll know it worked — measurable, and decided before we build.

-

## Risks & open questions

-
`,
  },
  {
    name: 'Retrospective',
    description: 'What went well, what didn’t, and the changes we commit to.',
    titleTemplate: 'Retro — {{date}}',
    content: `# Retrospective — {{date}}

**Participants:**
**Facilitator:** {{author}}
**Period covered:**

## What went well

-

## What didn't

Describe the system, not the person.

-

## What we learned

-

## Action items

Each one needs an owner and a date, or it won't happen.

| Owner | Action | Due |
| --- | --- | --- |
|  |  |  |

## Carried over from last retro

Actions we said we'd take and didn't — the most useful section on the page.

-
`,
  },
  {
    name: 'How-to guide',
    description: 'Task-oriented walkthrough for someone who needs to get one thing done.',
    titleTemplate: 'How to ',
    content: `# How to {{title}}

**Last updated:** {{date}}

## What you'll end up with

One sentence describing the finished state, so the reader can tell whether
this is the right page before investing time.

## Before you start

-

## Steps

1.

## Check it worked

## Common problems

| Symptom | Cause | Fix |
| --- | --- | --- |
|  |  |  |

## Related
`,
  },
] as const;
