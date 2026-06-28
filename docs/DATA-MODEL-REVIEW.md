# Data Model Review and Forward-Looking Redesign Proposal

**Status:** APPLIED — baseline_v2 migration applied 2026-06-28. All corrective fixes and Phase 5 parity tables are now in `apps/api/prisma/schema.prisma`. The single canonical migration is `20260628004947_baseline_v2`.

**Scope:** Full audit of `apps/api/prisma/schema.prisma` + 15 migrations through `20260627250000_add_board`, cross-referenced against `docs/ROADMAP.md` Phases 5–10 and the shared types in `packages/shared`.

---

## Deferred to feature slices (do not add to schema.prisma without a dedicated feature branch)

The following items from Section 2 of this review were explicitly deferred out of the baseline. Each belongs in its own feature-slice migration:

| Deferred item | Review section | Target phase |
|---|---|---|
| `AutomationRule` / `AutomationRun` + `AutomationTriggerType` / `AutomationRunStatus` enums | 2.10 | Phase 7 |
| `StandupEntry` / `StandupBlockerLink` | 2.9 | Phase 10 |
| `PersonalBoard` / `PersonalCard` + `PersonalCardState` enum | 2.8 | Phase 10 |
| `PokerSession` / `PokerItem` / `PokerVote` + `PokerSessionState` enum | 2.7 | Phase 5 (planning poker sub-feature) |
| `WorkflowTransition` | 2.6 | Phase 2 remaining / Phase 5 |
| `ScmConnection` / `IssueExternalLink` + `ScmProvider` / `ExternalLinkType` / `ExternalLinkStatus` enums | 2.11 | Phase 9 |
| `Issue.embedding Unsupported("vector(1536)")` + pgvector HNSW index | 2.12 | Phase 6 (requires `pgvector/pgvector:pg16` Docker image) |

---

---

## 1. Current-Model Audit

### 1.1 Issue: `number` vs `key` naming confusion

**Location:** `Issue` model, field `number` (schema line ~244).

The field is named `number` on the model but the column serves as the project-scoped sequential counter that forms the display key (e.g. `NL-42`). Meanwhile `Project.issueSeq` tracks the last-assigned value. The DTO layer computes `key` as `project.key + "-" + issue.number` at map time. This is an inconsistency: the source-of-truth field is called `number`, the human-facing concept is `key`, and `issueSeq` is a separate counter that must stay in sync. Renaming `number` to `seqNumber` and the counter to `nextSeq` (or just keeping it `number` but making the naming explicit in the schema comment) would remove confusion. More critically, `issueSeq` is an unprotected integer that is incremented with a bare update — under concurrent inserts this is a TOCTOU race; the sequence should be a `SEQUENCE` or incremented inside a `SELECT ... FOR UPDATE` lock. Prisma's `$transaction` with `select ... for update on Project` is the safe path.

### 1.2 Issue: `statusId` FK uses `onDelete: RESTRICT` without safety net

**Location:** `Issue.statusId` FK (schema line ~267, migration `20260626030230_init` line 247).

`Status` deletes are restricted by Postgres when any issue references the status. This prevents orphan statuses but the application has no guard that migrates existing issues to a replacement status before the delete attempt, so deletes of non-empty statuses return a 500/PrismaClientKnownRequestError. The API should enforce a "move issues first" step or the schema should encode a `defaultStatusId` on `Project` as the migration target.

### 1.3 Issue: `ActivityLog.actorId` uses `onDelete: CASCADE`

**Location:** `ActivityLog` model, actorId FK (schema line ~328, init migration line 274).

When a user is deleted, their activity log entries are also deleted — destroying the immutable audit trail of what happened to issues (status changes, priority changes, etc.). The correct behavior is `onDelete: SetNull` (matching how `AuditEvent.actorId` is handled). The CFD report relies on `ActivityLog` entries for historical reconstruction; deleting an actor should never delete history.

### 1.4 Issue: `Comment.authorId` uses `onDelete: CASCADE`

**Location:** `Comment` model, authorId FK (schema line ~313, init migration line 268).

Same problem: deleting a user destroys all their comments. Comments should survive user deletion with `onDelete: SetNull` (author becomes anonymous/"Deleted User") rather than cascade-deleting content.

### 1.5 Issue: `Attachment.uploaderId` uses `onDelete: CASCADE`

**Location:** `Attachment` model (line ~381, migration `20260627145511_add_attachment_model` line 27).

Same issue. Attachment metadata (and therefore the download link) disappears when the uploader is removed. `onDelete: SetNull` preserves the file and its metadata.

### 1.6 Issue: `Board.colorRules` is untyped JSON

**Location:** `Board.colorRules Json?` (schema line ~189).

The ROADMAP explicitly calls for conditional card colors driven by NLQL conditions. `colorRules` is currently an opaque blob. It is correct to keep this as JSON (ordered rule list; first-match wins; structure is well-defined and does not need its own table). However, the JSON schema must be validated at the application layer and the shared `BoardColorRule` interface must be the canonical shape. The recommendation is to **keep JSON** but add a `CHECK` constraint validating it's an array (added manually in migration; Prisma cannot express CHECK constraints natively). A separate `BoardColorRule` table would add unnecessary join overhead for a small ordered list that is always loaded with the board.

### 1.7 Issue: `Board.filterQuery` is an unstructured string

**Location:** `Board.filterQuery String?` (schema line ~185).

This will store NLQL query text. It is correct to keep it as a string (the NLQL is the query language; the board stores the serialized form). No structural issue here, but once NLQL is parsed and saved filters exist (Phase 5), boards should reference a `SavedFilter.id` optionally rather than duplicating NLQL text — see Section 2.3.

### 1.8 Issue: `tsvector` generated column via `Unsupported()`

**Location:** `Issue.searchVector Unsupported("tsvector")?` (schema line ~263).

The current approach (GENERATED ALWAYS AS ... STORED with GIN index, managed via raw SQL in migration `20260627230000_issue_full_text_search`) is architecturally correct for single-language English FTS. The limitations are:

- Fixed `english` dictionary; non-English workspaces get degraded stemming.
- Only covers `title` and `description`. Phase 5 custom fields and NLQL will want FTS on custom field values too (not practical to extend the generated column without regenerating it).
- The `Unsupported()` marker means Prisma generates no type for it; all FTS queries must go through `$queryRaw`.

Recommendation for the redesigned schema: **keep the generated tsvector column and GIN index** but document the single-language limitation and plan for Phase 6 (autopilot) to add a `pgvector` `embedding` column alongside it (not replacing it). The two can coexist: `tsvector` for keyword/BM25 FTS, `vector` for semantic similarity. See Section 2.10 for the pgvector design.

### 1.9 Issue: `Notification.projectId` is a bare string (no FK)

**Location:** `Notification` model (schema line ~353).

`projectId` is stored as plain text with no FK. If a project is deleted (cascade from workspace), notifications with a dangling `projectId` remain (their `issueId` FK is `SetNull` correctly, but `projectId` is just a dead string). Options: add FK with `onDelete: Cascade` (notifications disappear with the project), or make it nullable `onDelete: SetNull`. Given notifications are inbox items the user has already seen, cascade delete of the project should take them with it: add `projectId String` with an FK to `Project(id) onDelete: Cascade`.

### 1.10 Issue: `Notification` has no `workspaceId`

**Location:** `Notification` model.

Notifications are scoped to an issue in a project, but there is no workspace scope. When rendering the notification bell across workspaces, the API must join through `project → workspace` to scope results. Adding `workspaceId` would speed up cross-workspace notification queries and enable workspace-scoped notification clearing. This is a minor denormalization that pays off at the inbox query level.

### 1.11 Issue: Soft-delete inconsistency

**Location:** `Project.archived Boolean` (schema line ~157); no `archived` or `deletedAt` on any other model.

`Project` has `archived` (soft-delete semantics). Nothing else does. `Board`, `Sprint`, `Issue`, `Label`, `Status` are hard-deleted. This is fine for most of them, but `Sprint` arguably should have a completion audit trail beyond `state: COMPLETED`. For now the schema is adequate, but the policy should be explicitly documented: **only `Project` is soft-deleted; everything else is hard-deleted with cascade from its parent**. Recommend against adding `deletedAt` to `Issue` — the complexity and query overhead (every query must filter it) are not justified for a self-hosted tracker where admin can always restore from backup.

### 1.12 Issue: `Project.leadId` is a bare string (no FK)

**Location:** `Project.leadId String?` (schema line ~155).

`leadId` references a `User.id` but there is no FK, no `@relation`, and no `onDelete` behavior. If the lead user is deleted, the stale `leadId` stays. Add `lead User? @relation(fields: [leadId], references: [id], onDelete: SetNull)` and a corresponding index.

### 1.13 Issue: `Status` has no `updatedAt`

**Location:** `Status` model (schema line ~200).

`Status` has no `updatedAt`. This matters for cache invalidation (the client caches status lists keyed by project; if a status is renamed, there is no ETtag or timestamp to detect the change). Minor but worth adding.

### 1.14 Issue: `Sprint` has no `updatedAt`; `completedAt` is missing

**Location:** `Sprint` model (schema line ~213).

Sprints have `createdAt` but not `updatedAt` or `completedAt`. Velocity and burndown reports currently derive completion from `state = COMPLETED`; adding `completedAt DateTime?` would make the completion timestamp a first-class queryable field rather than requiring ActivityLog reconstruction.

### 1.15 Issue: `IssueType` enum includes `SUBTASK` but the hierarchy is modeled purely by `parentId`

**Location:** `Issue.type` enum + `Issue.parentId`.

An issue of any `type` can have a `parentId`, which means the hierarchy constraint (EPIC > STORY/TASK > SUBTASK) is enforced only in application code. The schema permits a SUBTASK parenting an EPIC. This is acceptable (enforced at the service layer) but the schema comment should document the intended hierarchy.

### 1.16 Issue: No workspace-level `Team` entity

**Location:** Entire schema.

Phase 10 (async standups) references a "team" concept. Currently the only grouping abstraction is Workspace (everyone) and Project (self-selected). There is no sub-workspace team. Standups, planning poker sessions, and per-team analytics all need a `Team` entity. This must be introduced — see Section 3.3.

### 1.17 Issue: Missing indexes for planned query patterns

The following indexes are absent but will be needed:

- `(workspaceId, userId)` on `Membership` — only `(workspaceId)` exists; `(userId)` is covered only for cascade, not for "find user's role in workspace" query pattern.
- `(projectId, rank)` on `Issue` — the backlog view orders by rank within a project; the existing `(statusId, rank)` doesn't help for cross-status rank ordering.
- `(projectId, type)` on `Issue` — epic list for roadmap queries `type = EPIC`.
- `(projectId, sprintId, rank)` on `Issue` — sprint board ordering is a hot path.
- `(subscriptionId)` on `WebhookDelivery` — covered by `(subscriptionId, createdAt)` composite; fine.
- `(userId, createdAt)` on `ActivityLog` — "actor" timeline queries for personal analytics (Phase 10).

### 1.18 Issue: `AuditEvent.action` and `targetType` are free strings

**Location:** `AuditEvent` model (schema line ~393).

There is no enum enforcement on `action` or `targetType`. This is reasonable for extensibility but risks inconsistent strings across code paths. A Postgres `CHECK` constraint listing valid action prefixes or an application-layer enum (`AuditAction`) in `packages/shared` would help. Not blocking but noting.

### 1.19 Summary of FK on-delete behavior

| Relation | Current | Recommended |
|---|---|---|
| `ActivityLog.actorId` | CASCADE | **SetNull** |
| `Comment.authorId` | CASCADE | **SetNull** |
| `Attachment.uploaderId` | CASCADE | **SetNull** |
| `Notification.issueId` | SetNull | OK |
| `Notification.actorId` | SetNull | OK |
| `Notification.projectId` | **no FK** | **Add FK, Cascade** |
| `Project.leadId` | **no FK** | **Add FK, SetNull** |
| `Issue.statusId` | RESTRICT | OK (enforce app-layer move) |
| `Issue.parentId` | SetNull | OK |

---

## 2. Forward-Looking Schema (Roadmap Phases 5–10)

All snippets below are idiomatic Prisma SDL. They are not yet in the schema file.

### 2.1 Custom Fields (Phase 5)

**Design decision: JSON value column with typed accessor fields, not EAV.**

The classic EAV alternative (one row per field value) makes ad-hoc NLQL queries across custom fields require complex pivots and is hostile to the planned color-rules evaluator. A single `Json` column per issue is simpler but unqueryable by Postgres without `jsonb_path_query`. The chosen approach uses a `Json` column for storage but stores values as a top-level flat object keyed by `CustomFieldDefinition.id` — this enables `jsonb_extract_path_text` queries in `$queryRaw` for NLQL and color-rule evaluation, while keeping the schema simple. A GIN index on `Issue.customFields` covers containment and path queries.

```prisma
enum CustomFieldType {
  TEXT
  NUMBER
  SELECT
  MULTI_SELECT
  DATE
  CHECKBOX
  URL
}

// Project-scoped definition of a custom field.
// `appliesToTypes` is empty array = applies to all issue types.
// `options` is non-null and non-empty only for SELECT / MULTI_SELECT types.
// `order` controls display order in the issue form.
model CustomFieldDefinition {
  id             String          @id @default(cuid())
  projectId      String
  name           String          // display name, e.g. "Severity"
  key            String          // snake_case machine key, e.g. "severity"
  type           CustomFieldType
  options        String[]        @default([]) // allowed values for SELECT/MULTI_SELECT
  appliesToTypes IssueType[]     @default([]) // empty = all types
  required       Boolean         @default(false)
  order          Int             @default(0)
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, key])
  @@index([projectId])
}
```

On `Issue`, add:

```prisma
  customFields Json? // flat object: { [fieldDefinitionId]: value }
```

And add a GIN index in a raw migration step:

```sql
CREATE INDEX "Issue_customFields_gin_idx" ON "Issue" USING GIN ("customFields" jsonb_path_ops);
```

The NLQL evaluator queries custom fields via:

```sql
WHERE "customFields" @> '{"cfield_abc123": "S1"}'::jsonb
-- or for numeric comparisons:
WHERE ("customFields" ->> 'cfield_abc123')::numeric > 3
```

**Why not typed columns?** Custom fields are defined per-project and vary. Adding a real column per field (ALTER TABLE per definition) is not viable in a multi-tenant system. **Why not a separate `CustomFieldValue` table?** It requires joins on every issue fetch and makes NLQL filter compilation materially harder — the entire row of custom values must be assembled before evaluation. A flat JSONB column fetches in the same row read.

**Tradeoff:** JSONB custom fields cannot have FK referencing integrity (e.g. a SELECT option that was deleted stays in existing values). The application layer must enforce option validity on write and handle stale options gracefully on read (display as "Unknown option").

### 2.2 Team entity (prerequisite for Phases 5, 7, 10)

A `Team` is a named sub-workspace group of members. It is the audience for standups, planning poker sessions, and per-team analytics. Without it, all of these features must fall back to "everyone in the project" which loses granularity.

```prisma
model Team {
  id          String   @id @default(cuid())
  workspaceId String
  name        String
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace   Workspace    @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  members     TeamMember[]
  standupEntries StandupEntry[]
  pokerSessions  PokerSession[]

  @@unique([workspaceId, name])
  @@index([workspaceId])
}

// Many-to-many: User belongs to zero or more Teams within a Workspace.
model TeamMember {
  teamId String
  userId String

  team Team @relation(fields: [teamId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([teamId, userId])
  @@index([userId])
}
```

`User` gets: `teams TeamMember[]`
`Workspace` gets: `teams Team[]`

### 2.3 NLQL Saved Filters (Phase 5)

A saved filter is an NLQL query string with metadata. It can be personal (userId only) or shared to a project (projectId set). Boards can reference a saved filter rather than duplicating NLQL text.

```prisma
model SavedFilter {
  id          String   @id @default(cuid())
  ownerId     String   // always set — the user who created it
  projectId   String?  // null = personal/cross-project; non-null = project-shared
  name        String
  query       String   // NLQL query text
  isShared    Boolean  @default(false) // visible to all project members when true
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  owner   User     @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  project Project? @relation(fields: [projectId], references: [id], onDelete: Cascade)
  boards  Board[]  @relation("boardFilter")

  @@index([ownerId])
  @@index([projectId])
}
```

`Board` gets an optional FK:

```prisma
  savedFilterId String?
  savedFilter   SavedFilter? @relation("boardFilter", fields: [savedFilterId], references: [id], onDelete: SetNull)
```

`filterQuery` on `Board` is retained for inline board-level overrides (not persisted to a `SavedFilter`). `savedFilterId` provides the linked variant.

### 2.4 Issue Links / Dependencies (Phase 5)

The parent/child hierarchy (via `parentId`) is structural — it models epic/story/subtask decomposition. Issue *links* are a separate, non-hierarchical relationship: blocks, is-blocked-by, relates-to, duplicates. These need a dedicated join table with a typed relationship.

```prisma
enum IssueLinkType {
  BLOCKS          // source blocks target
  BLOCKED_BY      // source is blocked by target (inverse of BLOCKS)
  RELATES_TO      // bidirectional; store both directions as one row
  DUPLICATES      // source duplicates target
  DUPLICATED_BY   // inverse of DUPLICATES
  CLONES          // for future use
}

// Directed link between two issues. For symmetric types (RELATES_TO),
// a single row suffices; for asymmetric pairs (BLOCKS/BLOCKED_BY,
// DUPLICATES/DUPLICATED_BY), store only the canonical direction and
// derive the inverse in application code.
model IssueLink {
  id         String        @id @default(cuid())
  sourceId   String
  targetId   String
  type       IssueLinkType
  createdAt  DateTime      @default(now())
  createdById String?      // who created the link

  source    Issue  @relation("linkSource", fields: [sourceId], references: [id], onDelete: Cascade)
  target    Issue  @relation("linkTarget", fields: [targetId], references: [id], onDelete: Cascade)
  createdBy User?  @relation(fields: [createdById], references: [id], onDelete: SetNull)

  @@unique([sourceId, targetId, type])
  @@index([sourceId])
  @@index([targetId])
}
```

`Issue` gets:
```prisma
  linksFrom IssueLink[] @relation("linkSource")
  linksTo   IssueLink[] @relation("linkTarget")
```

**Design note on BLOCKED_BY / DUPLICATED_BY:** The application stores only `BLOCKS` and `DUPLICATES` rows; when querying `linksTo` the type is inverted for display. This halves link-table size for symmetric relationships.

### 2.5 Components and Versions / Releases (Phase 5)

**Components** are project-scoped sub-areas (e.g. "Mobile App", "API", "Database"). Each has an optional default assignee.

```prisma
model Component {
  id                String  @id @default(cuid())
  projectId         String
  name              String
  description       String?
  defaultAssigneeId String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  project         Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  defaultAssignee User?    @relation("componentDefaultAssignee", fields: [defaultAssigneeId], references: [id], onDelete: SetNull)
  issues          Issue[]

  @@unique([projectId, name])
  @@index([projectId])
}
```

**Versions** (also called Releases) track what target release an issue is planned for. The release lifecycle is modeled with a state enum.

```prisma
enum VersionState {
  UNRELEASED
  RELEASED
  ARCHIVED
}

model Version {
  id          String       @id @default(cuid())
  projectId   String
  name        String       // e.g. "v1.2.0"
  description String?
  state       VersionState @default(UNRELEASED)
  releaseDate DateTime?
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  project Project       @relation(fields: [projectId], references: [id], onDelete: Cascade)
  issues  IssueVersion[]

  @@unique([projectId, name])
  @@index([projectId])
}

// M:N join: an issue can target multiple versions (fix in v1.2 and backport to v1.1)
model IssueVersion {
  issueId   String
  versionId String

  issue   Issue   @relation(fields: [issueId], references: [id], onDelete: Cascade)
  version Version @relation(fields: [versionId], references: [id], onDelete: Cascade)

  @@id([issueId, versionId])
  @@index([versionId])
}
```

`Issue` gets:
```prisma
  componentId String?
  component   Component?    @relation(fields: [componentId], references: [id], onDelete: SetNull)
  versions    IssueVersion[]
```

And indexes: `@@index([componentId])`, `@@index([projectId, componentId])`.

### 2.6 Workflow Transitions (Phase 2 remaining + Phase 5)

Workflow transitions define which status-to-status moves are allowed for a given issue type. This is currently enforced only in application code with no schema backing.

```prisma
// Allowed status transition within a project.
// fromStatusId null = initial placement (issue creation).
// toStatusId null = terminal (not currently used but reserved).
// appliesToTypes empty array = all issue types.
model WorkflowTransition {
  id               String      @id @default(cuid())
  projectId        String
  fromStatusId     String?     // null = can be set as initial status
  toStatusId       String
  appliesToTypes   IssueType[] @default([])
  name             String?     // optional display name for the transition button
  requiresComment  Boolean     @default(false)
  createdAt        DateTime    @default(now())

  project    Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  fromStatus Status? @relation("transitionFrom", fields: [fromStatusId], references: [id], onDelete: Cascade)
  toStatus   Status  @relation("transitionTo", fields: [toStatusId], references: [id], onDelete: Cascade)

  @@unique([projectId, fromStatusId, toStatusId])
  @@index([projectId])
  @@index([fromStatusId])
  @@index([toStatusId])
}
```

`Status` gets back-relations:
```prisma
  transitionsFrom WorkflowTransition[] @relation("transitionFrom")
  transitionsTo   WorkflowTransition[] @relation("transitionTo")
```

**Note on validators:** Complex validators (e.g., "story points must be set before moving to In Review") are application-layer logic that reads the transition row. The `requiresComment` flag is the one schema-expressible validator. Additional validator metadata can live in a `validators Json?` column on `WorkflowTransition` as a structured array of validator type strings.

### 2.7 Planning Poker (Phase 5)

Planning poker sessions are project-scoped, linked to a sprint, and use the existing Socket.io realtime layer. The session lifecycle: PENDING → ACTIVE → REVEALED → CLOSED.

```prisma
enum PokerSessionState {
  PENDING   // waiting for facilitator to start
  ACTIVE    // voting open (votes hidden)
  REVEALED  // votes revealed, discussion phase
  CLOSED    // session over; estimates committed
}

model PokerSession {
  id        String            @id @default(cuid())
  projectId String
  sprintId  String?           // optional sprint scope
  teamId    String?           // optional team scope
  name      String?
  state     PokerSessionState @default(PENDING)
  scale     String[]          @default(["1","2","3","5","8","13","21","?"]) // deck
  createdById String
  createdAt DateTime          @default(now())
  updatedAt DateTime          @updatedAt

  project   Project      @relation(fields: [projectId], references: [id], onDelete: Cascade)
  sprint    Sprint?      @relation(fields: [sprintId], references: [id], onDelete: SetNull)
  team      Team?        @relation(fields: [teamId], references: [id], onDelete: SetNull)
  createdBy User         @relation("pokerCreator", fields: [createdById], references: [id], onDelete: Cascade)
  items     PokerItem[]

  @@index([projectId])
  @@index([sprintId])
}

// One issue/topic being estimated in a session.
model PokerItem {
  id              String   @id @default(cuid())
  sessionId       String
  issueId         String?  // optional — can estimate hypothetical items
  title           String?  // fallback title when no issue linked
  order           Int      @default(0)
  committedPoints Int?     // the agreed estimate, set on CLOSED

  session PokerSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  issue   Issue?       @relation(fields: [issueId], references: [id], onDelete: SetNull)
  votes   PokerVote[]

  @@index([sessionId])
}

// One participant's vote on one item. Hidden until state = REVEALED.
model PokerVote {
  itemId String
  userId String
  value  String   // matches a value from PokerSession.scale or null if abstained

  item PokerItem @relation(fields: [itemId], references: [id], onDelete: Cascade)
  user User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([itemId, userId])
  @@index([userId])
}
```

`User` gets: `pokerVotes PokerVote[]`, `pokerSessionsCreated PokerSession[] @relation("pokerCreator")`
`Sprint` gets: `pokerSessions PokerSession[]`
`Issue` gets: `pokerItems PokerItem[]`

### 2.8 Personal Workspace (Phase 10)

Personal boards are per-user private scratchpads. Cards are `PersonalCard` — distinct from `Issue` to avoid polluting the project-scoped issue space. A card can be promoted to a real issue (storing the resulting `issueId`).

```prisma
enum PersonalCardState {
  ACTIVE
  DONE
  PROMOTED // promoted to a project Issue
}

model PersonalBoard {
  id        String   @id @default(cuid())
  userId    String
  name      String
  order     Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user  User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  cards PersonalCard[]

  @@index([userId])
}

model PersonalCard {
  id          String            @id @default(cuid())
  boardId     String
  userId      String
  title       String
  description String?
  state       PersonalCardState @default(ACTIVE)
  rank        String            // fractional index within the board
  dueDate     DateTime?
  promotedTo  String?           // issueId after promotion
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt

  board          PersonalBoard @relation(fields: [boardId], references: [id], onDelete: Cascade)
  user           User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  promotedIssue  Issue?        @relation("personalCardPromotion", fields: [promotedTo], references: [id], onDelete: SetNull)

  @@index([boardId])
  @@index([userId])
}
```

`Issue` gets: `promotedFrom PersonalCard? @relation("personalCardPromotion")`

**"My Focus" board:** This is a virtual board (no DB row) — a query that joins issues assigned to the user across all their projects, ordered by priority and due date. It does not need its own table.

### 2.9 Async Standups (Phase 10)

```prisma
model StandupEntry {
  id          String   @id @default(cuid())
  userId      String
  teamId      String?  // team scope (or null = personal)
  projectId   String?  // optional project scope
  date        DateTime @db.Date // the standup date (date only, no time)
  yesterday   String?
  today       String?
  blockers    String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  user    User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  team    Team?    @relation(fields: [teamId], references: [id], onDelete: SetNull)
  project Project? @relation(fields: [projectId], references: [id], onDelete: SetNull)
  blockerLinks StandupBlockerLink[]

  @@unique([userId, teamId, date])
  @@index([teamId, date])
  @@index([userId, date])
}

// Links from a standup entry's blocker to specific issues.
model StandupBlockerLink {
  entryId String
  issueId String

  entry StandupEntry @relation(fields: [entryId], references: [id], onDelete: Cascade)
  issue Issue        @relation(fields: [issueId], references: [id], onDelete: Cascade)

  @@id([entryId, issueId])
}
```

`User` gets: `standupEntries StandupEntry[]`
`Team` gets: `standupEntries StandupEntry[]`
`Issue` gets: `standupBlockers StandupBlockerLink[]`

### 2.10 Automation Rules (Phase 7)

Automation rules are trigger → condition → action triples. The structure can be complex (nested conditions, multiple actions) but must be serializable and auditable.

**Design decision: structured JSON, not EAV table.** The trigger/condition/action representation is a tree (conditions can be AND/OR nested; actions can be sequential). A relational EAV model for this tree would require 4+ tables and complex recursive queries. JSON in a `rule` column is the right call here — it is the same pattern used by every major automation system (GitHub Actions, n8n, etc.). The `AutomationRun` audit table is relational for queryability.

```prisma
enum AutomationTriggerType {
  ISSUE_CREATED
  ISSUE_UPDATED
  ISSUE_STATUS_CHANGED
  ISSUE_ASSIGNED
  SPRINT_STARTED
  SPRINT_COMPLETED
  DUE_DATE_REACHED
  COMMENT_CREATED
  SCHEDULED // cron-style
}

model AutomationRule {
  id          String              @id @default(cuid())
  projectId   String
  name        String
  enabled     Boolean             @default(true)
  triggerType AutomationTriggerType
  // Full rule definition: { trigger, conditions: [...], actions: [...] }
  // Conditions: { field, op, value } nodes joined by AND/OR.
  // Actions: { type, params } — e.g. { type: "SET_ASSIGNEE", params: { userId } }
  rule        Json
  createdById String
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt

  project   Project         @relation(fields: [projectId], references: [id], onDelete: Cascade)
  createdBy User            @relation(fields: [createdById], references: [id], onDelete: Cascade)
  runs      AutomationRun[]

  @@index([projectId, enabled, triggerType])
}

enum AutomationRunStatus {
  SUCCESS
  FAILED
  SKIPPED // conditions not met
}

model AutomationRun {
  id         String              @id @default(cuid())
  ruleId     String
  issueId    String?             // source issue, if trigger was issue-based
  status     AutomationRunStatus
  error      String?
  actionsLog Json?               // snapshot of what was done
  createdAt  DateTime            @default(now())

  rule  AutomationRule @relation(fields: [ruleId], references: [id], onDelete: Cascade)
  issue Issue?         @relation(fields: [issueId], references: [id], onDelete: SetNull)

  @@index([ruleId, createdAt])
  @@index([issueId])
}
```

`Issue` gets: `automationRuns AutomationRun[]`

### 2.11 SCM Integration (Phase 9)

A `ScmConnection` represents an authenticated connection to a Git forge (GitHub App, GitLab OAuth token, Gitea PAT). Multiple connections per workspace are supported (one per org/group).

```prisma
enum ScmProvider {
  GITHUB
  GITLAB
  GITEA
}

model ScmConnection {
  id           String      @id @default(cuid())
  workspaceId  String
  provider     ScmProvider
  name         String      // display name, e.g. "acme-org on GitHub"
  // Encrypted credential blob. Never stored in plaintext.
  // Encryption key is derived from JWT_SECRET + workspace ID.
  credentialEnc String     // AES-GCM encrypted JSON: { installationId?, accessToken?, refreshToken? }
  baseUrl      String?     // for self-hosted GitLab/Gitea (null = SaaS default)
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt

  workspace      Workspace              @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  externalLinks  IssueExternalLink[]

  @@unique([workspaceId, provider, name])
  @@index([workspaceId])
}

enum ExternalLinkType {
  PR          // pull/merge request
  COMMIT
  BRANCH
}

enum ExternalLinkStatus {
  OPEN
  MERGED
  CLOSED
  DRAFT
  UNKNOWN
}

model IssueExternalLink {
  id           String             @id @default(cuid())
  issueId      String
  connectionId String
  type         ExternalLinkType
  status       ExternalLinkStatus @default(UNKNOWN)
  externalId   String             // provider's native ID (PR number, commit SHA, branch name)
  externalUrl  String             // full URL to the PR/commit/branch on the forge
  title        String?            // PR/commit title; null for branches
  // Last time we polled/received a webhook update for status.
  syncedAt     DateTime?
  createdAt    DateTime           @default(now())
  updatedAt    DateTime           @updatedAt

  issue      Issue         @relation(fields: [issueId], references: [id], onDelete: Cascade)
  connection ScmConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  @@unique([connectionId, externalId, type])
  @@index([issueId])
  @@index([connectionId])
}
```

`Workspace` gets: `scmConnections ScmConnection[]`
`Issue` gets: `externalLinks IssueExternalLink[]`

### 2.12 Autopilot / pgvector Embeddings (Phase 6)

Semantic search and duplicate detection require dense vector embeddings stored per issue. The correct Postgres extension is `pgvector` (`CREATE EXTENSION vector`). Prisma represents the `vector` type as `Unsupported("vector(N)")` — the same pattern already used for `tsvector`.

```prisma
// Added to Issue model:
  // 1536-dimensional embedding vector from a local Ollama model or OpenAI-compatible API.
  // Managed out-of-band by the Autopilot service; Prisma never reads/writes it directly.
  // Cosine similarity queries go through $queryRaw with the <=> operator.
  embedding Unsupported("vector(1536)")?
```

The GIN FTS index and the pgvector HNSW index coexist. The pgvector index must be created in a raw migration:

```sql
-- Enable the extension (once per database, idempotent):
CREATE EXTENSION IF NOT EXISTS vector;

-- Add the embedding column:
ALTER TABLE "Issue" ADD COLUMN IF NOT EXISTS "embedding" vector(1536);

-- HNSW index for approximate nearest-neighbor (fast at recall ~0.95):
CREATE INDEX "Issue_embedding_hnsw_idx"
  ON "Issue"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

**Dimension choice:** 1536 matches `text-embedding-ada-002` and most Ollama embedding models (nomic-embed-text is 768 — use `vector(768)` for local-only deployments). The field should be nullable; unembedded issues simply lack the column value and are excluded from semantic search until the background embedder processes them.

**Hybrid search:** For "find similar issues," a single `$queryRaw` can combine both signals:

```sql
SELECT id,
       ts_rank("searchVector", websearch_to_tsquery('english', $1)) * 0.3
       + (1 - ("embedding" <=> $2::vector)) * 0.7 AS score
FROM "Issue"
WHERE "projectId" = $3
ORDER BY score DESC
LIMIT 20;
```

---

## 3. Cross-Cutting Recommendations

### 3.1 ID Strategy

**Keep CUID for now; plan migration to UUIDv7 post-v1.**

CUIDs are currently used everywhere (`@default(cuid())`). They are sortable by creation time (which is useful), URL-safe, and have a low collision probability. The main downside is they are non-standard — libraries, external systems, and OpenAPI tooling expect UUIDs.

UUIDv7 (time-ordered UUID) provides the same sortability property as CUID while being a proper UUID standard, compatible with all PostgreSQL UUID operators and indexing. For a clean-baseline migration (recommended — see Section 4), switching to `@default(dbgenerated("gen_random_uuid()"))` for UUIDv4, or `@default(dbgenerated("extensions.uuid_generate_v7()"))` for UUIDv7 (requires `pg_uuidv7` extension), is the right time to make the switch.

**Recommendation:** Stay with CUID for v1. In the clean-baseline migration for v2, switch all PKs to UUIDv7 with `@db.Uuid`. This makes the change once with no incremental migration pain.

### 3.2 `createdAt` / `updatedAt` conventions

**Standard:** every model that represents a mutable entity should have both `createdAt DateTime @default(now())` and `updatedAt DateTime @updatedAt`. Current gaps:

| Model | createdAt | updatedAt |
|---|---|---|
| `Status` | missing | missing |
| `Sprint` | present | **missing** |
| `Label` | missing | missing |
| `IssueLabel` | missing | not needed (join table) |
| `Watcher` | missing | not needed (join table) |
| `Membership` | present | **missing** |

Add `createdAt` + `updatedAt` to `Status`, `Label`, and `Membership`. Add `updatedAt` to `Sprint`. Add `completedAt DateTime?` to `Sprint`.

### 3.3 Soft-Delete vs Hard-Delete Policy

**Recommended uniform policy:**

| Entity | Policy | Rationale |
|---|---|---|
| `Workspace` | Hard delete (admin action; all data cascades) | Self-hosted; admin decision |
| `Project` | **Soft delete** (`archived`, existing) | Referenced by notifications/links |
| `Issue` | Hard delete (cascades all children) | History in ActivityLog survives |
| `Status` | Hard delete (RESTRICT FK forces migration first) | Small set; predictable |
| `Sprint` | Hard delete (SetNull on issues) | Completed sprints kept for reports |
| `User` | Hard delete (actor fields SetNull; owned content preserved) | GDPR-style erasure |
| `Team` | Hard delete (cascades members/standups) | Admin-managed |
| All others | Hard delete with cascade | Simple |

**No `deletedAt` on issues.** The overhead of filtering every query is not justified for a self-hosted tool where the admin has direct DB access for recovery. If issue archival is needed later, add a dedicated `IssueArchive` table (move + delete pattern) rather than soft-delete.

### 3.4 Indexing Strategy for NLQL and Analytics

NLQL will compile to SQL `WHERE` clauses combining: `projectId`, `type`, `priority`, `statusId`, `assigneeId`, `sprintId`, `dueDate`, `labels`, `customFields`, and FTS. The multi-condition nature means single-column indexes are often not selective enough. Recommended composite indexes to add:

```prisma
// On Issue — in addition to existing indexes:
@@index([projectId, type])                      // epic list, type filter
@@index([projectId, priority])                  // priority filter on backlog
@@index([projectId, assigneeId, statusId])      // "my open issues in project"
@@index([projectId, sprintId, rank])            // sprint board ordering (replaces sprintId alone)
@@index([projectId, dueDate])                   // overdue queries scoped to project
@@index([workspaceId])                          // add workspaceId to Issue? No — go through Project join
```

For analytics/reports (Phase 7 Glass Box, Phase 10 personal analytics):

```prisma
// On ActivityLog:
@@index([actorId, createdAt])     // "what did user X do this week"
@@index([field, createdAt])       // "all status changes this month" for CFD
```

Note: `@@index([projectId, sprintId, rank])` should **replace** the existing bare `@@index([sprintId])` since the new index starts with `projectId` and covers the old one for project-scoped queries, while also covering sprint board rank ordering.

### 3.5 Multi-Tenant Isolation — FK Discipline

Every new table that is project-scoped must carry `projectId` with an FK to `Project(id) onDelete: Cascade`. Every workspace-scoped table must carry `workspaceId` with FK to `Workspace(id) onDelete: Cascade`. The isolation contract:

- **No cross-project FKs.** `IssueLink.targetId` must reference an issue in the same project; this is an application-layer constraint (checked in service code before insert). The schema cannot express this directly.
- **No cross-workspace FKs.** `ScmConnection` is workspace-scoped; `IssueExternalLink` is issue-scoped (inherits project scope). The chain is intact.
- **All user-facing content FKs use `onDelete: SetNull`** (not Cascade) so deleted users don't destroy data. The exception: user-owned private data (PersonalBoard, PersonalCard) should Cascade on user delete since they have no meaning without the owner.

### 3.6 Team Entity Scope

The `Team` entity (Section 2.2) is workspace-scoped, not project-scoped. A team can work across multiple projects (standups, poker sessions). Team membership is separate from project membership. This mirrors how most organizations work: the "Platform team" exists at the workspace level and works on multiple projects.

Projects can optionally reference a default team via `defaultTeamId String?` (for automatically assigning standup scope). This is optional and can be added later without breaking the core team model.

---

## 4. Migration Strategy

### 4.1 Recommendation: Clean-Baseline Squash

**Squash all 15 existing migrations into a single baseline.** Since there is no production data and the user has authorized breaking changes, this is the correct path. The advantages:

- One migration file to review, understand, and audit.
- Removes 15 incremental diffs (many with backfill data steps) that are no longer instructive.
- Enables clean enumeration of all extensions, indexes, and constraints from scratch.
- Makes the `prisma migrate deploy` startup hook faster (1 DDL transaction vs 15).

**How to squash:**
```bash
# 1. Delete the migrations directory contents
rm -rf apps/api/prisma/migrations/

# 2. Apply the new schema to a fresh DB, generate the baseline:
pnpm --filter @next-lane/api prisma migrate dev --name baseline_v2

# 3. The resulting single migration file becomes the new history.
```

### 4.2 Extension Setup (must precede table creation)

The baseline migration must begin with:

```sql
-- Required for pgvector (Phase 6 Autopilot):
CREATE EXTENSION IF NOT EXISTS vector;

-- Optional: for UUID v7 if switching ID strategy:
-- CREATE EXTENSION IF NOT EXISTS "pg_uuidv7";
```

`vector` extension availability depends on the Postgres image. The official `pgvector/pgvector:pg16` Docker image includes it. The `docker-compose.yml` `db` service image must be updated from `postgres:16` to `pgvector/pgvector:pg16`. The Helm chart `image.repository` for the DB subchart should also note this. If pgvector is not available at deploy time, the `embedding` column addition should be in a separate, gated migration that runs only when the extension is confirmed present.

### 4.3 Ordering of DDL in the Baseline

The baseline migration should follow this order:

1. `CREATE EXTENSION IF NOT EXISTS vector;`
2. All `CREATE TYPE` (enum) statements.
3. Core entity tables with no inter-entity FKs: `User`, `Workspace`.
4. Join entity: `Membership`.
5. `Project` (references `Workspace`, `User` for lead).
6. `Team`, `TeamMember` (references `Workspace`, `User`).
7. `Status`, `Sprint`, `Label`, `Board`, `Component`, `Version` (all reference `Project`).
8. `CustomFieldDefinition` (references `Project`).
9. `SavedFilter` (references `User`, `Project`).
10. `WorkflowTransition` (references `Project`, `Status`).
11. `Issue` (references `Project`, `Status`, `Sprint`, `User`, `Component`).
12. `IssueLabel`, `IssueVersion`, `IssueLink` (join tables on `Issue`).
13. `Comment`, `ActivityLog`, `Watcher`, `Attachment`, `Notification` (children of `Issue`/`User`).
14. `PokerSession`, `PokerItem`, `PokerVote`.
15. `StandupEntry`, `StandupBlockerLink`.
16. `PersonalBoard`, `PersonalCard`.
17. `AutomationRule`, `AutomationRun`.
18. `ScmConnection`, `IssueExternalLink`.
19. `ApiToken`, `PasswordResetToken`, `ShareToken`, `AuditEvent`, `WebhookSubscription`, `WebhookDelivery`.
20. All `CREATE INDEX` statements (collected at the end for clarity).
21. Generated column + GIN FTS index for `Issue.searchVector`.
22. HNSW index for `Issue.embedding` (pgvector).

### 4.4 Breaking Changes Inventory

All changes are breaking (clean slate). For clarity, the changes relative to the current schema that would break the existing API if applied incrementally:

| Change | Breaking? | Notes |
|---|---|---|
| `ActivityLog.actorId` onDelete → SetNull | Yes (behavior) | Actor deletion no longer cascades |
| `Comment.authorId` onDelete → SetNull | Yes (behavior) | Deleted user's comments preserved |
| `Attachment.uploaderId` onDelete → SetNull | Yes (behavior) | Attachment metadata preserved |
| Add `Project.leadId` FK + relation | Schema-additive | New behavior |
| Add `Notification.projectId` FK | Schema-additive | Enforces referential integrity |
| Add `Status.createdAt`, `updatedAt` | Schema-additive | |
| Add `Sprint.updatedAt`, `completedAt` | Schema-additive | |
| Add `Label.createdAt`, `updatedAt` | Schema-additive | |
| Add `Membership.updatedAt` | Schema-additive | |
| Add `Issue.componentId` | Schema-additive | Nullable |
| Add `Issue.customFields Json?` | Schema-additive | Nullable |
| Add `Board.savedFilterId` | Schema-additive | Nullable |
| All new models | Additive | New tables |

### 4.5 Seed Script Updates

After the baseline migration, the seed script (`apps/api/prisma/seed.ts`) must be updated to:
- Create a default `Team` per workspace.
- Seed `CustomFieldDefinition` examples.
- Create default `WorkflowTransition` rows for the seeded project's statuses.
- No seed data needed for `PokerSession`, `StandupEntry`, `PersonalBoard`, `AutomationRule`, `ScmConnection`.

---

## Executive Summary

### Top Current-Model Issues

1. **Wrong `onDelete` on three FKs** (`ActivityLog.actorId`, `Comment.authorId`, `Attachment.uploaderId` all CASCADE instead of SetNull) — deleting a user destroys issue history, comments, and attachment metadata. This is the most severe correctness bug in the current schema.

2. **`Project.leadId` has no FK** — stale lead references after user deletion; also no index.

3. **`Notification.projectId` has no FK** — referential integrity gap; hard to catch in tests.

4. **Missing `Team` entity** — Phases 5, 7, and 10 all reference a team concept that the schema has no model for. This is the largest gap between the current model and the roadmap.

5. **Missing `updatedAt` / `createdAt` on `Status`, `Label`, `Sprint`, `Membership`** — cache invalidation and audit trails are incomplete.

### Biggest Design Decisions

| Decision | Choice | Key Tradeoff |
|---|---|---|
| Custom field storage | JSONB column on Issue (`customFields`) | Queryable by NLQL via `jsonb_path_ops` GIN index; no schema changes per new field. Loses FK integrity on SELECT options and requires `$queryRaw` for typed comparisons. Chose over EAV (too complex for NLQL) and typed columns (not viable per-project). |
| Issue links | Dedicated `IssueLink` table with `IssueLinkType` enum | Stores only canonical direction (BLOCKS, DUPLICATES); inverse derived in code. Chose over extending `parentId` (structural vs non-structural distinction is important). |
| Automation rules | Structured JSON in `rule` column | Full tree flexibility for condition/action modeling; same pattern as major automation tools. Chose over EAV (prohibitive query complexity for nested conditions). |
| pgvector embeddings | `Unsupported("vector(1536)")` alongside tsvector | Two-index hybrid search (BM25 keyword + cosine semantic). Requires `pgvector/pgvector:pg16` Docker image. Deferred to Phase 6 — column is nullable and HNSW index is independent of FTS. |
| Clean-baseline squash | Squash all 15 migrations into one | Correct choice given zero production data; eliminates incremental backfill debt; enables all breaking FK/index changes in one pass. |
| Team entity scope | Workspace-scoped (not project-scoped) | Teams work across projects; project-scope would require team duplication. Tradeoff: joining through workspace when querying project-team relationships requires an extra join. |

### Recommended Migration Approach

1. Update the Docker DB image to `pgvector/pgvector:pg16` in `docker-compose.yml` and the Helm chart.
2. Apply all schema changes to the Prisma SDL file (schema.prisma).
3. Delete `apps/api/prisma/migrations/` entirely.
4. Run `pnpm --filter @next-lane/api prisma migrate dev --name baseline_v2` against a fresh database — this generates the single canonical baseline migration.
5. Run `pnpm --filter @next-lane/api prisma generate` to regenerate the client.
6. Update the seed script for new required relations.
7. Commit schema + migration + updated seed + updated `docs/ARCHITECTURE.md` data-model section in one atomic commit.

The pgvector HNSW index and embedding column can be in the baseline (nullable column, index only activates when embeddings are present) or deferred to a Phase 6 additive migration — the latter is lower risk since pgvector availability depends on the Docker image change being deployed first.
