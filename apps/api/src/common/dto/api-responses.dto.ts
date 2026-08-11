/**
 * What the API sends BACK, described for the OpenAPI document.
 *
 * ─── Why this file exists ────────────────────────────────────────────────────
 *
 * Request bodies document themselves: the `@nestjs/swagger` CLI plugin reads
 * each `*.dto.ts` class's TypeScript types and `class-validator` decorators and
 * synthesises the schema. Responses got nothing, because the shapes the
 * handlers return live in `packages/shared/src/types.ts` as TypeScript
 * INTERFACES — erased at compile time, with no runtime presence for the plugin
 * to reflect. So 199 of 253 operations documented their response as a bare
 * `{"type": "object"}`: the reference told you what to send and stayed silent
 * on what came back, and the only way to learn a payload was to call the
 * endpoint and print the JSON.
 *
 * These are classes, so they exist at runtime and the plugin can read them.
 *
 * ─── Why they cannot drift ───────────────────────────────────────────────────
 *
 * A hand-written response schema that quietly stops matching the real payload
 * is worse than no schema at all — it is confidently wrong, and a client
 * generated from it fails at runtime rather than at generation. Two compiler
 * mechanisms make that impossible here, and neither needs anyone to remember:
 *
 *   1. `implements <TheSharedInterface>` — the class cannot omit a REQUIRED
 *      member or give one the wrong type.
 *   2. `AssertDocumented<Interface, Class>` below — catches what `implements`
 *      does not: an OPTIONAL member that was never declared. Adding a `foo?:`
 *      to a shared interface and forgetting it here is a build error.
 *
 * Together those mean the document is derived from the contract rather than
 * describing it from memory. Nothing here needs to be kept in sync by hand;
 * it fails to compile instead.
 *
 * ─── Conventions ────────────────────────────────────────────────────────────
 *
 * - The file name MUST end in `.dto.ts`. That is the plugin's
 *   `dtoFileNameSuffix` (see `apps/api/nest-cli.json`); rename it and every
 *   schema in here silently empties out.
 * - Properties are declared with `!` and no initialiser. These types are never
 *   instantiated — they exist to be read by the plugin and referenced from
 *   `@ApiOkResponse({ type: … })`. Constructing one would be a mistake.
 * - `?` on a property becomes "not required" in the schema, which is the
 *   honest rendering of a field the API only includes on some payloads.
 */
import {
  IssueType,
  Priority,
  SprintState,
  StatusCategory,
  VersionState,
} from '@next-lane/shared';
import type {
  ActivityDto,
  ChecklistItemDto,
  CommentDto,
  CustomFieldValue,
  IssueDto,
  IssueRefDto,
  LabelDto,
  PaginatedIssuesDto,
  ProjectDto,
  SprintDto,
  StatusDto,
  UserDto,
  WorkspaceDto,
} from '@next-lane/shared';

/**
 * Compile-time proof that `Doc` declares every key of `Iface`, optional ones
 * included.
 *
 * `implements` already rejects a missing required member, so this exists for
 * the case it lets through: a new `foo?: string` on the shared interface that
 * nobody adds here would document a payload with a field the reader never
 * learns about. Resolves to `true` when nothing is missing and to the missing
 * key names otherwise, so the compiler error NAMES the field to add.
 */
type AssertDocumented<Iface, Doc> =
  Exclude<keyof Iface, keyof Doc> extends never
    ? true
    : Exclude<keyof Iface, keyof Doc>;

// ---------------------------------------------------------------------------
// Building blocks — nested inside the bigger payloads below.
// ---------------------------------------------------------------------------

/** A person, as embedded in issues, comments and member lists. */
export class UserResponse implements UserDto {
  id!: string;
  /** Login address. Also how members are invited. */
  email!: string;
  name!: string;
  /** `#RRGGBB` used for this person's generated avatar. */
  avatarColor!: string;
  createdAt!: string;
  emailNotifications!: boolean;
}
const _user: AssertDocumented<UserDto, UserResponse> = true;

/** A project label. Issues reference these by id. */
export class LabelResponse implements LabelDto {
  id!: string;
  name!: string;
  /** `#RRGGBB`. */
  color!: string;
  projectId!: string;
}
const _label: AssertDocumented<LabelDto, LabelResponse> = true;

/** A workflow status — one column of a board. */
export class StatusResponse implements StatusDto {
  id!: string;
  name!: string;
  /**
   * Which of the three lanes this status counts as. Use this rather than the
   * name when deciding whether work is finished: names are per-project and
   * arbitrary, the category is not.
   */
  category!: StatusCategory;
  /** Position of the column on the board, ascending. */
  order!: number;
  projectId!: string;
  /** WIP limit for this column; null means no limit. */
  wipLimit!: number | null;
}
const _status: AssertDocumented<StatusDto, StatusResponse> = true;

/** A slim reference to an issue, used for parents and children. */
export class IssueRefResponse implements IssueRefDto {
  id!: string;
  /** Human-facing identifier, e.g. `NL-12`. */
  key!: string;
  type!: IssueType;
  title!: string;
  statusId!: string;
  status?: StatusResponse;
}
const _issueRef: AssertDocumented<IssueRefDto, IssueRefResponse> = true;

/** One checklist row on an issue. */
export class ChecklistItemResponse implements ChecklistItemDto {
  id!: string;
  issueId!: string;
  text!: string;
  done!: boolean;
  order!: number;
  createdAt!: string;
}
const _checklistItem: AssertDocumented<
  ChecklistItemDto,
  ChecklistItemResponse
> = true;

/**
 * Small inline shapes. These are declared inline on the shared interface
 * rather than as named types, so they get named classes here — an anonymous
 * object in a schema renders as an unhelpful bare `object`.
 */
export class IssueComponentSummaryResponse {
  id!: string;
  name!: string;
}

export class IssueVersionSummaryResponse {
  id!: string;
  name!: string;
  state!: VersionState;
}

export class PrLinkSummaryResponse {
  /** Linked pull/merge requests still open. */
  open!: number;
  /** Linked pull/merge requests already merged. Closed-unmerged is in neither. */
  merged!: number;
}

export class ChecklistProgressResponse {
  done!: number;
  total!: number;
}

// ---------------------------------------------------------------------------
// The main payloads.
// ---------------------------------------------------------------------------

/**
 * An issue.
 *
 * Several fields are OPTIONAL by design rather than by accident: the API
 * returns the heavier relations only on the endpoints that need them, so a
 * board payload carries `blockedByCount` while a plain fetch does not. A field
 * marked "not required" below means "this endpoint may omit it", not "it may
 * be null" — those are different, and the nullable ones say `| null`.
 */
export class IssueResponse implements IssueDto {
  id!: string;
  /** Human-facing identifier, e.g. `NL-12`. Stable; safe to show and to search. */
  key!: string;
  /** The numeric half of `key`, unique within the project. */
  number!: number;
  projectId!: string;
  type!: IssueType;
  title!: string;
  description!: string | null;
  statusId!: string;
  /** Expanded status. Prefer `status.category` over the name for logic. */
  status?: StatusResponse;
  assigneeId!: string | null;
  assignee?: UserResponse | null;
  reporterId!: string | null;
  reporter?: UserResponse | null;
  priority!: Priority;
  storyPoints!: number | null;
  parentId!: string | null;
  parent?: IssueRefResponse | null;
  children?: IssueRefResponse[];
  sprintId!: string | null;
  /** ISO 8601 date, or null when no start date is set. */
  startDate!: string | null;
  /** ISO 8601 date, or null when no due date is set. */
  dueDate!: string | null;
  /** Fractional index deciding order within a column. Compare as a STRING. */
  rank!: string;
  labels?: LabelResponse[];
  commentCount?: number;
  /** Unresolved blockers — issues linked as BLOCKS with this one as target. */
  blockedByCount?: number;
  prLinkSummary?: PrLinkSummaryResponse;
  /**
   * Custom field values keyed by CustomFieldDefinition id. The value's shape
   * follows the field's type (string, number, boolean, string[], ISO date).
   * An absent key means no value is set.
   */
  customFields?: Record<string, CustomFieldValue>;
  componentId!: string | null;
  component?: IssueComponentSummaryResponse | null;
  /** Versions this issue targets. Empty array means none. */
  versions?: IssueVersionSummaryResponse[];
  /** Checklist items, ordered by `order` ascending. */
  checklist?: ChecklistItemResponse[];
  /** Only present when `checklist` is loaded. */
  checklistProgress?: ChecklistProgressResponse;
  /** Original estimate in minutes; null when not estimated. */
  originalEstimateMinutes!: number | null;
  /** Sum of logged work in minutes. Present when work logs are loaded. */
  timeSpentMinutes?: number;
  createdAt!: string;
  updatedAt!: string;
}
const _issue: AssertDocumented<IssueDto, IssueResponse> = true;

/**
 * A page of issues.
 *
 * Cursor-based, not offset-based: pass `nextCursor` back as the `cursor`
 * parameter to get the following page, and stop when it comes back null.
 */
export class PaginatedIssuesResponse implements PaginatedIssuesDto {
  items!: IssueResponse[];
  /** Pass as `cursor` for the next page. Null means this was the last one. */
  nextCursor!: string | null;
}
const _paginated: AssertDocumented<
  PaginatedIssuesDto,
  PaginatedIssuesResponse
> = true;

/** A project — the container issues belong to, and the unit boards scope to. */
export class ProjectResponse implements ProjectDto {
  id!: string;
  /** Short prefix used in issue keys, e.g. `NL`. */
  key!: string;
  name!: string;
  description!: string | null;
  leadId!: string | null;
  workspaceId!: string;
  archived!: boolean;
  createdAt!: string;
  /** When true, only defined workflow transitions are legal. */
  workflowEnforced!: boolean;
  /**
   * When true this project is read-only to API-token callers — the MCP server
   * and anything else holding a PAT. Reads work; writes are refused with 403.
   * Browser sessions are unaffected.
   */
  agentReadOnly!: boolean;
}
const _project: AssertDocumented<ProjectDto, ProjectResponse> = true;

/** A workspace — the tenant boundary that owns projects and members. */
export class WorkspaceResponse implements WorkspaceDto {
  id!: string;
  name!: string;
  /** Globally unique URL segment. */
  slug!: string;
  createdAt!: string;
  /** Accent colour `#RRGGBB`, or null for the product default. */
  brandColor!: string | null;
  /** Path to the custom logo relative to the API base, or null when unset. */
  logoUrl!: string | null;
}
const _workspace: AssertDocumented<WorkspaceDto, WorkspaceResponse> = true;

/** A sprint. */
export class SprintResponse implements SprintDto {
  id!: string;
  name!: string;
  goal!: string | null;
  state!: SprintState;
  /** ISO 8601, or null when unplanned. */
  startDate!: string | null;
  /** ISO 8601, or null when unplanned. */
  endDate!: string | null;
  projectId!: string;
}
const _sprint: AssertDocumented<SprintDto, SprintResponse> = true;

/** A comment on an issue. `body` is markdown. */
export class CommentResponse implements CommentDto {
  id!: string;
  /** Markdown. May contain `@mentions` and `[[wiki-links]]`. */
  body!: string;
  issueId!: string;
  author!: UserResponse;
  createdAt!: string;
  updatedAt!: string;
}
const _comment: AssertDocumented<CommentDto, CommentResponse> = true;

/** One entry in an issue's change history. */
export class ActivityResponse implements ActivityDto {
  id!: string;
  issueId!: string;
  actor!: UserResponse;
  /** Which field changed, e.g. `status`, `assignee`, `priority`. */
  field!: string;
  /** Previous value, rendered as text. Null when there was none. */
  from!: string | null;
  /** New value, rendered as text. Null when the field was cleared. */
  to!: string | null;
  createdAt!: string;
}
const _activity: AssertDocumented<ActivityDto, ActivityResponse> = true;

/**
 * A single issue fetched by id — the LIST shape plus its discussion and
 * history, which `GET /issues` deliberately does not carry.
 *
 * Modelled as its own class rather than reusing `IssueResponse` because the
 * service's return type really is `IssueDto & { comments; activities }`, and a
 * document that showed the two endpoints returning the same thing would be
 * quietly wrong about the one people fetch when they want the detail.
 */
export class IssueDetailResponse extends IssueResponse {
  comments!: CommentResponse[];
  /** Newest first. */
  activities!: ActivityResponse[];
}

/*
 * The assertions above are consumed here so `noUnusedLocals` (and any linter
 * that would "helpfully" delete them) sees them as live. Their VALUE is
 * irrelevant — the type-checking already happened at each declaration; this
 * only stops the guards being tidied away.
 */
export const DOCUMENTED_RESPONSE_CONTRACTS = [
  _user,
  _label,
  _status,
  _issueRef,
  _checklistItem,
  _issue,
  _paginated,
  _project,
  _workspace,
  _sprint,
  _comment,
  _activity,
] as const;
