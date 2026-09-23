/**
 * NLQL validation — used by the UI for live validation and by the backend
 * before persisting a saved filter or a board color rule.
 *
 * Validation enforces:
 *  - a length cap (defense-in-depth against pathological inputs),
 *  - successful parse,
 *  - every field token resolves to an allowlisted standard field OR a
 *    registered custom field (by key or display name).
 *
 * Because field resolution is allowlist-based, hostile field names such as
 * `__proto__`, `constructor`, or `prototype` are rejected here rather than
 * reaching any property access.
 */
import type { CustomFieldType } from '../enums';
import { IssueType, Priority, StatusCategory } from '../enums';
import type {
  FieldNode,
  Node,
  Query,
  ValueNode,
} from './ast';
import { parse } from './parser';
import { NlqlParseError } from './tokenizer';
import {
  resolveStandardField,
  type FieldKind,
  type StandardField,
  type StandardFieldMeta,
} from './fields';
import type { NlqlComponent, NlqlSprint, NlqlUser } from './evaluator';

/** Maximum accepted query length, in characters. */
export const NLQL_MAX_LENGTH = 2000;

export interface ValidateCustomFieldDef {
  id: string;
  key: string;
  name: string;
  type: CustomFieldType;
}

export interface ValidateOptions {
  customFieldDefs?: ValidateCustomFieldDef[];
}

export interface ValidationResult {
  ok: boolean;
  error?: { message: string; position: number };
}

function isKnownField(
  field: FieldNode,
  defs: ValidateCustomFieldDef[] | undefined,
): boolean {
  if (!field.quoted && resolveStandardField(field.name)) return true;
  if (!defs) return false;
  const lower = field.name.toLowerCase();
  return defs.some(
    (d) => d.key.toLowerCase() === lower || d.name.toLowerCase() === lower,
  );
}

function collectFields(node: Node, out: FieldNode[]): void {
  switch (node.type) {
    case 'or':
    case 'and':
      for (const c of node.clauses) collectFields(c, out);
      return;
    case 'not':
      collectFields(node.operand, out);
      return;
    case 'comparison':
    case 'in':
    case 'isEmpty':
      out.push(node.field);
      return;
  }
}

function collectQueryFields(query: Query): FieldNode[] {
  const out: FieldNode[] = [];
  if (query.where) collectFields(query.where, out);
  if (query.orderBy) out.push(query.orderBy.field);
  return out;
}

/**
 * Validate a NLQL query string. Never throws — returns a structured result.
 */
export function validateQuery(
  query: string,
  options: ValidateOptions = {},
): ValidationResult {
  if (typeof query !== 'string') {
    return { ok: false, error: { message: 'Query must be a string', position: 0 } };
  }
  if (query.length > NLQL_MAX_LENGTH) {
    return {
      ok: false,
      error: {
        message: `Query is too long (max ${NLQL_MAX_LENGTH} characters)`,
        position: NLQL_MAX_LENGTH,
      },
    };
  }

  let ast: Query;
  try {
    ast = parse(query);
  } catch (err) {
    if (err instanceof NlqlParseError) {
      return { ok: false, error: { message: err.message, position: err.position } };
    }
    throw err;
  }

  for (const field of collectQueryFields(ast)) {
    if (!isKnownField(field, options.customFieldDefs)) {
      return {
        ok: false,
        error: {
          message: `Unknown field '${field.name}'`,
          position: field.position,
        },
      };
    }
  }

  return { ok: true };
}

/**
 * Return the set of standard-field `FieldKind`s a query references (e.g.
 * `'user'` for `assignee`/`reporter`, `'sprint'` for `sprint`). Lets a caller
 * that evaluates the query decide which side-context to batch-load — e.g. the
 * automation engine only needs to query workspace members when a rule
 * condition actually compares against a `user`-kind field, and only needs to
 * query sprints when it references `sprint`.
 *
 * Quoted field tokens (always custom-field references, which have no fixed
 * `FieldKind` here) are ignored. Returns an empty set on a parse error —
 * callers that need the query to be valid should call {@link validateQuery}
 * first.
 */
export function getReferencedFieldKinds(query: string): Set<FieldKind> {
  const kinds = new Set<FieldKind>();
  let ast: Query;
  try {
    ast = parse(query);
  } catch {
    return kinds;
  }
  for (const field of collectQueryFields(ast)) {
    if (field.quoted) continue;
    const meta = resolveStandardField(field.name);
    if (meta) kinds.add(meta.kind);
  }
  return kinds;
}

/**
 * Return the set of canonical {@link StandardField} *names* (not kinds) a
 * query references. Needed alongside {@link getReferencedFieldKinds} because
 * `status` shares the `'enum'` `FieldKind` with `type`/`priority`/
 * `statusCategory` even though only `status` needs a per-project side-context
 * (the project's actual status names, loaded from the DB) to fail loud on a
 * typo — the other three are closed enums checked against a fixed constant
 * list, no round trip needed. Lets a caller decide precisely whether to pay
 * for loading `ctx.statuses` rather than firing on every `'enum'`-kind query.
 * Same parse-tolerant contract as {@link getReferencedFieldKinds}: returns an
 * empty set on a parse error rather than throwing.
 */
export function getReferencedStandardFields(query: string): Set<StandardField> {
  const fields = new Set<StandardField>();
  let ast: Query;
  try {
    ast = parse(query);
  } catch {
    return fields;
  }
  for (const field of collectQueryFields(ast)) {
    if (field.quoted) continue;
    const meta = resolveStandardField(field.name);
    if (meta) fields.add(meta.field);
  }
  return fields;
}

// ── Name resolution (fail-loud prepare step) ────────────────────────────────
//
// MCP-QA pass 1, finding 1 residual: `assignee = "Alex Rivera"` and
// `sprint = "July-B"` correctly resolve via the evaluator's ctx.users/
// ctx.sprints lookup (see evaluator.ts) when the name is real. But when the
// name is a typo or refers to nobody, the evaluator's documented behavior is
// to fall back to a literal string that matches no issue — a *silent*
// zero-result query, not an error. That's the right default for the pure
// evaluator (a library consumer filtering an in-memory array shouldn't have
// unrelated network/DB failures forced onto it), but it's the wrong default
// for an agent- or human-facing *server* surface: a confidently-empty result
// set reads as "nobody has this name" instead of "there is no such user".
//
// MCP-QA pass 4 (token-efficiency pass, finding E1): the original fix above
// only ever reached `user`/`sprint`-kind comparisons. `status`, `type`,
// `priority`, `label`/`labels`, and `component`/`componentId` were left on
// the old silent-zero path — `status = "In Progres"`, `priority = URGENT`,
// `label = "backendd"`, etc. all returned a confident `{items:[],total:0}`
// instead of an error. This section now covers all eight name/value-
// checkable standard fields with the SAME mechanism (one function, one
// `ValidationResult` contract) rather than a second one, but with per-field-
// family resolution rules since the fields fall into three genuinely
// different shapes:
//
//  1. `user` / `sprint` / `component` — dynamic, per-project reference data
//     where the ISSUE'S OWN FIELD VALUE is the raw id (`assigneeId`,
//     `sprintId`, `componentId`). An operand that looks like an id but isn't
//     in the supplied context might still be a legitimate (e.g. stale/
//     cross-project) id that will genuinely compare equal at evaluation time
//     — see `looksLikeOpaqueId`. These three get the SAME id-shape leniency.
//  2. `status` / `label` — also dynamic, per-project reference data, but the
//     evaluator compares by the resolved NAME, never a raw id
//     (`getFieldValue` returns `issue.status?.name` / the labels' `.name`s).
//     An id-shaped operand here would never actually match anything at
//     evaluation time either way, so granting it the same leniency would
//     just swap one silent zero for another. These two are checked strictly
//     by name (or a known id from the supplied context, which — being a
//     REAL id for this project — is never a "typo").
//  3. `type` / `priority` / `statusCategory` — fixed, global enums
//     (`IssueType`/`Priority`/`StatusCategory`). No per-project context is
//     ever needed; the operand (case-insensitively) either is or isn't one
//     of the five-or-fewer known values.
//
// `resolveQueryNames` is a separate PREPARE step server call sites run once
// per evaluation (after `validateQuery` and alongside loading
// ctx.users/ctx.sprints/ctx.statuses/ctx.labels/ctx.components — see
// `getReferencedFieldKinds`/`getReferencedStandardFields` for cheaply
// determining which side-contexts a given query actually needs), never
// inside the evaluator's own per-issue loop.

export interface ResolveNamesContext {
  users?: NlqlUser[];
  sprints?: NlqlSprint[];
  components?: NlqlComponent[];
  /** Project statuses — checked by name (or a known id); see family 2 above. */
  statuses?: NlqlStatusRef[];
  /** Project labels — checked by name only (never by id); see family 2 above. */
  labels?: NlqlLabelRef[];
}

/** A project status, for the `status` fail-loud name check. */
export interface NlqlStatusRef {
  id: string;
  name: string;
}

/** A project label, for the `label`/`labels` fail-loud name check. */
export interface NlqlLabelRef {
  id: string;
  name: string;
}

/**
 * Heuristic for "this operand could legitimately be a raw id the caller
 * didn't happen to load into `users`/`sprints`" (e.g. a former workspace
 * member's id still referenced by historical data). Matches the ACTUAL id
 * shapes this system produces — Prisma `cuid()` (leading `c`, ≥20 lowercase
 * base-36 chars, no separators) and RFC-4122 UUIDs — rather than the looser
 * original "≥20 chars, no whitespace" (review follow-up on 169f7c1: that
 * bar also cleared long single-token real names like
 * `workflow-migration-bot-2024`, silently resurrecting the zero-results bug
 * for exactly the inputs this feature exists to catch; hyphens/digits-mixed
 * handles fail the cuid pattern and now flag properly). Only literals that
 * fail this check are eligible to be reported as an unresolved *name*.
 */
function looksLikeOpaqueId(value: string): boolean {
  // Prisma cuid()/cuid2: leading letter, then lowercase base-36, ≥20 total.
  if (/^c[a-z0-9]{19,}$/.test(value)) return true;
  // UUID (any RFC-4122 variant, case-insensitive).
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    return true;
  }
  return false;
}

interface ComparisonOperands {
  field: FieldNode;
  values: ValueNode[];
}

function collectComparisonOperands(node: Node, out: ComparisonOperands[]): void {
  switch (node.type) {
    case 'or':
    case 'and':
      for (const c of node.clauses) collectComparisonOperands(c, out);
      return;
    case 'not':
      collectComparisonOperands(node.operand, out);
      return;
    case 'comparison':
      out.push({ field: node.field, values: [node.value] });
      return;
    case 'in':
      out.push({ field: node.field, values: node.values });
      return;
    case 'isEmpty':
      // No operand to resolve.
      return;
  }
}

/** Extract the literal string an operand represents, or `null` for operands
 * that are never a name/id reference (numbers, booleans, `me()`/`now()`/etc). */
function literalOperandString(value: ValueNode): string | null {
  switch (value.kind) {
    case 'string':
    case 'word':
      return value.value;
    default:
      return null;
  }
}

function userResolves(value: string, users: NlqlUser[]): boolean {
  const lower = value.toLowerCase();
  return users.some(
    (u) => u.id === value || u.email.toLowerCase() === lower || u.name.toLowerCase() === lower,
  );
}

function sprintResolves(value: string, sprints: NlqlSprint[]): boolean {
  const lower = value.toLowerCase();
  return sprints.some((s) => s.id === value || s.name.toLowerCase() === lower);
}

function componentResolves(value: string, components: NlqlComponent[]): boolean {
  const lower = value.toLowerCase();
  return components.some((c) => c.id === value || c.name.toLowerCase() === lower);
}

/**
 * `status`/`label` resolve by name only (or a known id from the supplied
 * context) — deliberately NO {@link looksLikeOpaqueId} leniency. Unlike
 * `user`/`sprint`/`component`, the evaluator never compares these fields
 * against a raw id at evaluation time (`getFieldValue` returns the resolved
 * status NAME / the labels' NAMEs, not an id) — an id-shaped literal that
 * isn't a known id would never actually match anything either way, so
 * granting it a leniency pass would just convert one silent zero into
 * another. See the section comment above for the full family breakdown.
 */
function statusResolves(value: string, statuses: NlqlStatusRef[]): boolean {
  const lower = value.toLowerCase();
  return statuses.some((s) => s.id === value || s.name.toLowerCase() === lower);
}

function labelResolves(value: string, labels: NlqlLabelRef[]): boolean {
  const lower = value.toLowerCase();
  return labels.some((l) => l.id === value || l.name.toLowerCase() === lower);
}

const ISSUE_TYPE_VALUES: string[] = Object.values(IssueType);
const PRIORITY_VALUES: string[] = Object.values(Priority);
const STATUS_CATEGORY_VALUES: string[] = Object.values(StatusCategory);

/** Fixed, global enums (`type`/`priority`/`statusCategory`) — case-insensitive
 * membership against a hardcoded, always-in-sync-with-the-evaluator list. No
 * per-project context is ever needed. Mirrors the evaluator's own
 * case-insensitive equality (`evalStringComparison(..., false)`) so a
 * lowercase or mixed-case but genuinely valid value (e.g. `priority = high`)
 * is never flagged — only a value that is not a member of the enum AT ALL
 * (e.g. `priority = URGENT`, which this system has no such priority) is. */
function fixedEnumResolves(value: string, values: string[]): boolean {
  return values.includes(value.toUpperCase());
}

interface ResolveNamesData {
  users: NlqlUser[];
  sprints: NlqlSprint[];
  components: NlqlComponent[];
  statuses: NlqlStatusRef[];
  labels: NlqlLabelRef[];
}

/** Returns an error message when `literal` fails to resolve for `meta`'s
 * field/kind, or `null` when it resolves (or the field/kind isn't
 * name-checkable at all — dates, numbers, title/text/key/parentId, etc.). */
function checkOperand(
  meta: StandardFieldMeta,
  literal: string,
  data: ResolveNamesData,
): string | null {
  switch (meta.kind) {
    case 'user': {
      if (userResolves(literal, data.users)) return null;
      if (looksLikeOpaqueId(literal)) return null;
      return `unknown user "${literal}" — use an exact display name, an id, or me(); see list_users`;
    }
    case 'sprint': {
      if (sprintResolves(literal, data.sprints)) return null;
      if (looksLikeOpaqueId(literal)) return null;
      return `unknown sprint "${literal}" — use an exact sprint name or an id; see list_sprints`;
    }
    case 'component': {
      if (componentResolves(literal, data.components)) return null;
      if (looksLikeOpaqueId(literal)) return null;
      return `unknown component "${literal}" — use an exact component name or an id; see list_components`;
    }
    case 'array': {
      // `labels` is the only 'array'-kind standard field today.
      if (labelResolves(literal, data.labels)) return null;
      return `unknown label "${literal}" — use an exact label name; see list_labels`;
    }
    case 'enum': {
      switch (meta.field) {
        case 'status':
          if (statusResolves(literal, data.statuses)) return null;
          return `unknown status "${literal}" — use an exact status name; see list_statuses`;
        case 'type':
          if (fixedEnumResolves(literal, ISSUE_TYPE_VALUES)) return null;
          return `unknown type "${literal}" — valid types: ${ISSUE_TYPE_VALUES.join(', ')}`;
        case 'priority':
          if (fixedEnumResolves(literal, PRIORITY_VALUES)) return null;
          return `unknown priority "${literal}" — valid priorities: ${PRIORITY_VALUES.join(', ')}`;
        case 'statusCategory':
          if (fixedEnumResolves(literal, STATUS_CATEGORY_VALUES)) return null;
          return `unknown statusCategory "${literal}" — valid categories: ${STATUS_CATEGORY_VALUES.join(', ')}`;
        default:
          return null; // no other 'enum'-kind standard fields today
      }
    }
    default:
      return null; // string/number/date/id fields have no "does this exist" check
  }
}

/**
 * Fail-loud prepare step: returns `{ ok: false }` when a comparison's operand
 * fails to resolve for its field (see {@link checkOperand} for the exact
 * per-family rules — `user`/`sprint`/`component` names-or-ids,
 * `status`/`label` names, `type`/`priority`/`statusCategory` fixed enums).
 * Never throws on a parse error — mirrors {@link validateQuery}'s structured-
 * result contract so callers can treat the two checks uniformly (run
 * `validateQuery` first; only call this once that passes, since it assumes a
 * syntactically valid, field-resolvable query).
 *
 * Intentionally NOT called by {@link evaluate}/{@link filterIssues} — those
 * stay pure and keep their documented silent-fallback semantics for library
 * consumers (see the "evaluator — sprints"/"functions & users" test suites
 * locking that behavior in). Server call sites that evaluate NLQL against
 * real data (CSV export, dashboard gadgets, automation conditions) should
 * call this once per evaluation, right after loading the side-context via
 * `loadNlqlEvalContext`, and reject/flag the query before ever calling
 * `filterIssues`/`evaluate`.
 */
export function resolveQueryNames(
  query: string,
  ctx: ResolveNamesContext = {},
): ValidationResult {
  let ast: Query;
  try {
    ast = parse(query);
  } catch (err) {
    if (err instanceof NlqlParseError) {
      return { ok: false, error: { message: err.message, position: err.position } };
    }
    throw err;
  }

  const operands: ComparisonOperands[] = [];
  if (ast.where) collectComparisonOperands(ast.where, operands);

  const data: ResolveNamesData = {
    users: ctx.users ?? [],
    sprints: ctx.sprints ?? [],
    components: ctx.components ?? [],
    statuses: ctx.statuses ?? [],
    labels: ctx.labels ?? [],
  };

  for (const { field, values } of operands) {
    if (field.quoted) continue; // custom fields are never name-checked here
    const meta = resolveStandardField(field.name);
    if (!meta) continue;

    for (const value of values) {
      const literal = literalOperandString(value);
      if (literal === null) continue; // me()/number/boolean — never a name

      const message = checkOperand(meta, literal, data);
      if (message === null) continue;

      return { ok: false, error: { message, position: field.position } };
    }
  }

  return { ok: true };
}

/**
 * Does this query's WHERE clause call `me()` anywhere (e.g.
 * `assignee = me()`, `reporter != me()`, `assignee IN (me(), "Bob")`)?
 *
 * `me()` resolves to `ctx.currentUserId` in the evaluator (see
 * `resolveFunction` in `./evaluator`) — there is no such identity for an
 * anonymous caller. A server surface with no authenticated user (the public
 * dashboard share endpoint) must check this BEFORE evaluating a gadget's
 * query: silently falling through to `ctx.currentUserId ?? null` would turn
 * `assignee = me()` into `assignee = null` (i.e. "unassigned"), a confusing,
 * silently-wrong result rather than the honest "this gadget needs a signed-in
 * user" error. Never throws on a parse error — returns `false` (an invalid
 * query is already reported by `validateQuery`).
 */
export function queryReferencesMe(query: string): boolean {
  let ast: Query;
  try {
    ast = parse(query);
  } catch {
    return false;
  }
  const operands: ComparisonOperands[] = [];
  if (ast.where) collectComparisonOperands(ast.where, operands);
  return operands.some(({ values }) =>
    values.some((v) => v.kind === 'function' && v.name === 'me'),
  );
}
