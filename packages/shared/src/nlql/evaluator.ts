/**
 * NLQL evaluator.
 *
 * Evaluates a parsed {@link Query} against an IssueDto-like object and provides
 * {@link filterIssues} for filtering + ordering a list.
 *
 * Security invariants:
 *  - Field resolution is an explicit allowlist (see {@link fields}) plus a
 *    name/key lookup against the caller-provided custom-field definitions. There
 *    is NEVER a dynamic `issue[userInput]` access, so `__proto__`, `constructor`
 *    and friends cannot be reached.
 *  - String "contains" (`~`) uses String.prototype.includes — a RegExp is never
 *    built from user input, so there is no ReDoS surface.
 *
 * Documented behavior for library consumers — unresolved user/sprint names:
 *  - `assignee`/`reporter` (`user`-kind) and `sprint` (`sprint`-kind) fields
 *    resolve a comparison operand against `ctx.users`/`ctx.sprints` (by id,
 *    then case-insensitive email/name). When the operand matches nothing,
 *    {@link resolveUserOperand}/{@link resolveSprintOperand} deliberately fall
 *    back to treating it as a literal id rather than throwing — a query
 *    referencing an unknown name therefore matches zero issues *silently*,
 *    the same as any other non-matching value. This is intentional and
 *    covered by dedicated tests (`evaluator.test.ts`, "a name that resolves
 *    to no known user/sprint silently matches nothing (no error)") so any
 *    future change here is a deliberate one, not a regression.
 *  - This is the right default for a pure, side-effect-free evaluator over an
 *    in-memory array. It is the *wrong* default for a server surface backing
 *    an agent or a human query bar, where "0 results" reads as "nobody has
 *    this name" instead of "there is no such user" (MCP-QA pass 1, finding 1
 *    residual). Callers that want fail-loud behavior should run
 *    {@link resolveQueryNames} (`./validate`) once per evaluation — as a
 *    prepare step, BEFORE calling {@link evaluate}/{@link filterIssues}, never
 *    per-issue — and reject/flag the query when it reports an unresolved
 *    name. See `apps/api/src/common/nlql-eval-context.util.ts` and its three
 *    call sites for the reference implementation.
 */
import { CustomFieldType, Priority, PRIORITY_ORDER } from '../enums';
import type { IssueDto } from '../types';
import type {
  ComparisonNode,
  ComparisonOp,
  FieldNode,
  InNode,
  IsEmptyNode,
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
} from './fields';

export interface NlqlUser {
  id: string;
  name: string;
  email: string;
}

/** A project sprint, for resolving the `sprint` field by name (not just id). */
export interface NlqlSprint {
  id: string;
  name: string;
}

export interface NlqlCustomFieldDef {
  id: string;
  key: string;
  name: string;
  type: CustomFieldType;
}

export interface EvalContext {
  currentUserId?: string;
  now?: Date;
  users?: NlqlUser[];
  /** Project sprints, used to resolve `sprint = "<name>"` (in addition to id). */
  sprints?: NlqlSprint[];
  customFieldDefs?: NlqlCustomFieldDef[];
}

/** An evaluation error distinct from a parse error (e.g. an unknown field). */
export class NlqlEvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NlqlEvalError';
    Object.setPrototypeOf(this, NlqlEvalError.prototype);
  }
}

/** Resolved description of which concrete field a token points at. */
type ResolvedField =
  | { source: 'standard'; field: StandardField; kind: FieldKind }
  | { source: 'custom'; defId: string; fieldType: CustomFieldType };

function resolveField(field: FieldNode, ctx: EvalContext): ResolvedField {
  // Bare identifiers are looked up as standard fields first.
  if (!field.quoted) {
    const std = resolveStandardField(field.name);
    if (std) return { source: 'standard', field: std.field, kind: std.kind };
  }
  // Quoted (and any unmatched bare) names may reference a custom field by key
  // or display name.
  const def = findCustomFieldDef(field.name, ctx.customFieldDefs);
  if (def) return { source: 'custom', defId: def.id, fieldType: def.type };

  throw new NlqlEvalError(
    `Unknown field '${field.name}' at position ${field.position}`,
  );
}

function findCustomFieldDef(
  name: string,
  defs: NlqlCustomFieldDef[] | undefined,
): NlqlCustomFieldDef | undefined {
  if (!defs) return undefined;
  const lower = name.toLowerCase();
  return defs.find(
    (d) => d.key.toLowerCase() === lower || d.name.toLowerCase() === lower,
  );
}

/**
 * Map a resolved field onto the issue's value via an explicit allowlist switch.
 * Custom-field values are read from `issue.customFields[defId]` where `defId`
 * came from a server-provided definition, never from raw user input.
 */
function getFieldValue(
  resolved: ResolvedField,
  issue: IssueDto,
): unknown {
  if (resolved.source === 'custom') {
    const cf = issue.customFields;
    if (!cf) return undefined;
    // Guard against prototype-chain keys; defId is a server id but be safe.
    if (!Object.prototype.hasOwnProperty.call(cf, resolved.defId)) {
      return undefined;
    }
    return cf[resolved.defId];
  }

  switch (resolved.field) {
    case 'status':
      // Prefer the resolved status name; fall back to the id.
      return issue.status?.name ?? issue.statusId;
    case 'statusCategory':
      return issue.status?.category ?? null;
    case 'assignee':
      return issue.assigneeId;
    case 'reporter':
      return issue.reporterId;
    case 'type':
      return issue.type;
    case 'priority':
      return issue.priority;
    case 'labels':
      return (issue.labels ?? []).map((l) => l.name);
    case 'sprint':
      return issue.sprintId;
    case 'startDate':
      return issue.startDate;
    case 'dueDate':
      return issue.dueDate;
    case 'createdAt':
      return issue.createdAt;
    case 'updatedAt':
      return issue.updatedAt;
    case 'title':
      return issue.title;
    case 'text':
      // Free-text search target: title + description.
      return `${issue.title ?? ''}\n${issue.description ?? ''}`;
    case 'storyPoints':
      return issue.storyPoints;
    case 'key':
      return issue.key;
    case 'parentId':
      return issue.parentId;
    case 'componentId':
      // No first-class component field on IssueDto yet; treat as absent.
      return null;
    default: {
      // Exhaustiveness guard.
      const _never: never = resolved.field;
      return _never;
    }
  }
}

// ── Value coercion ────────────────────────────────────────────────────────────

function resolveValueNode(node: ValueNode, ctx: EvalContext): unknown {
  switch (node.kind) {
    case 'string':
      return node.value;
    case 'word':
      return node.value;
    case 'number':
      return node.value;
    case 'boolean':
      return node.value;
    case 'function':
      return resolveFunction(node.name, ctx);
    default: {
      const _never: never = node;
      return _never;
    }
  }
}

function resolveFunction(name: string, ctx: EvalContext): unknown {
  const now = ctx.now ?? new Date();
  switch (name) {
    case 'me':
      return ctx.currentUserId ?? null;
    case 'now':
      return now;
    case 'today':
      return startOfDay(now);
    case 'startOfDay':
      return startOfDay(now);
    case 'startOfWeek':
      return startOfWeek(now);
    default:
      throw new NlqlEvalError(`Unknown function '${name}()'`);
  }
}

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function startOfWeek(d: Date): Date {
  // Week starts Monday.
  const r = startOfDay(d);
  const day = r.getDay(); // 0=Sun..6=Sat
  const diff = (day + 6) % 7; // days since Monday
  r.setDate(r.getDate() - diff);
  return r;
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function toComparableString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

// ── User matching ─────────────────────────────────────────────────────────────

/**
 * Resolve a comparison value for a user field into a user id. Accepts a raw id,
 * me(), or a name/email matched via ctx.users. Returns null when unresolvable
 * (so "= someone-who-doesnt-exist" never matches).
 */
function resolveUserOperand(raw: unknown, ctx: EvalContext): string | null {
  if (raw === null || raw === undefined) return null;
  const str = String(raw);
  // Direct id match against known users.
  const users = ctx.users ?? [];
  const byId = users.find((u) => u.id === str);
  if (byId) return byId.id;
  // Match by email or name (case-insensitive).
  const lower = str.toLowerCase();
  const byEmailOrName = users.find(
    (u) => u.email.toLowerCase() === lower || u.name.toLowerCase() === lower,
  );
  if (byEmailOrName) return byEmailOrName.id;
  // Unknown user reference: fall back to treating it as a literal id so that an
  // id not in ctx.users still compares correctly.
  return str;
}

/**
 * Resolve a comparison value for the `sprint` field into a sprint id. Accepts
 * a raw id or a name matched via ctx.sprints (case-insensitive, exact match —
 * mirrors {@link resolveUserOperand}). Falls back to treating the raw value as
 * a literal id when it matches no known sprint, so an id not present in
 * ctx.sprints (e.g. a stale/cross-project id) still compares correctly.
 */
function resolveSprintOperand(raw: unknown, ctx: EvalContext): string | null {
  if (raw === null || raw === undefined) return null;
  const str = String(raw);
  const sprints = ctx.sprints ?? [];
  const byId = sprints.find((s) => s.id === str);
  if (byId) return byId.id;
  const lower = str.toLowerCase();
  const byName = sprints.find((s) => s.name.toLowerCase() === lower);
  if (byName) return byName.id;
  return str;
}

// ── Comparison engine ─────────────────────────────────────────────────────────

const PRIORITY_RANK = PRIORITY_ORDER;

function priorityRank(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const upper = value.toUpperCase() as Priority;
  return upper in PRIORITY_RANK ? PRIORITY_RANK[upper] : null;
}

function compareNumeric(left: number, op: ComparisonOp, right: number): boolean {
  switch (op) {
    case '=':
      return left === right;
    case '!=':
      return left !== right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    case '~':
      return left === right;
    case '!~':
      return left !== right;
  }
}

function evalComparison(
  node: ComparisonNode,
  issue: IssueDto,
  ctx: EvalContext,
): boolean {
  const resolved = resolveField(node.field, ctx);
  const fieldValue = getFieldValue(resolved, issue);
  const operand = resolveValueNode(node.value, ctx);
  const kind = resolvedKind(resolved);

  switch (kind) {
    case 'array':
      return evalArrayComparison(fieldValue, node.op, operand);
    case 'user':
      return evalUserComparison(fieldValue, node.op, operand, ctx);
    case 'sprint':
      return evalSprintComparison(fieldValue, node.op, operand, ctx);
    case 'date':
      return evalDateComparison(fieldValue, node.op, operand);
    case 'number':
      return evalNumberComparison(fieldValue, node.op, operand);
    case 'enum':
      return evalEnumComparison(resolved, fieldValue, node.op, operand);
    case 'id':
      return evalStringComparison(fieldValue, node.op, operand, true);
    case 'string':
    default:
      return evalStringComparison(fieldValue, node.op, operand, false);
  }
}

/** The comparison "kind" for a resolved field (custom fields map by type). */
function resolvedKind(resolved: ResolvedField): FieldKind {
  if (resolved.source === 'standard') return resolved.kind;
  switch (resolved.fieldType) {
    case CustomFieldType.NUMBER:
      return 'number';
    case CustomFieldType.DATE:
      return 'date';
    case CustomFieldType.CHECKBOX:
      return 'enum'; // boolean compared via enum/string path
    case CustomFieldType.MULTI_SELECT:
      return 'array';
    case CustomFieldType.SELECT:
    case CustomFieldType.TEXT:
    case CustomFieldType.URL:
    default:
      return 'string';
  }
}

function evalArrayComparison(
  fieldValue: unknown,
  op: ComparisonOp,
  operand: unknown,
): boolean {
  const arr = Array.isArray(fieldValue) ? fieldValue.map(toComparableString) : [];
  const needle = toComparableString(operand);
  const lowerArr = arr.map((s) => s.toLowerCase());
  const lowerNeedle = needle.toLowerCase();
  switch (op) {
    case '=':
      // membership (case-insensitive)
      return lowerArr.includes(lowerNeedle);
    case '!=':
      return !lowerArr.includes(lowerNeedle);
    case '~':
      // any element contains the needle as a substring (literal, no RegExp)
      return lowerArr.some((s) => s.includes(lowerNeedle));
    case '!~':
      return !lowerArr.some((s) => s.includes(lowerNeedle));
    default:
      // ordering ops are meaningless on arrays
      return false;
  }
}

function evalUserComparison(
  fieldValue: unknown,
  op: ComparisonOp,
  operand: unknown,
  ctx: EvalContext,
): boolean {
  const fieldId = fieldValue === null || fieldValue === undefined ? null : String(fieldValue);
  const operandId = resolveUserOperand(operand, ctx);
  switch (op) {
    case '=':
      return fieldId !== null && fieldId === operandId;
    case '!=':
      return fieldId !== operandId;
    case '~':
      return fieldId !== null && operandId !== null && fieldId.includes(operandId);
    case '!~':
      return !(fieldId !== null && operandId !== null && fieldId.includes(operandId));
    default:
      return false;
  }
}

function evalSprintComparison(
  fieldValue: unknown,
  op: ComparisonOp,
  operand: unknown,
  ctx: EvalContext,
): boolean {
  const fieldId = fieldValue === null || fieldValue === undefined ? null : String(fieldValue);
  const operandId = resolveSprintOperand(operand, ctx);
  switch (op) {
    case '=':
      return fieldId !== null && fieldId === operandId;
    case '!=':
      return fieldId !== operandId;
    case '~':
      return fieldId !== null && operandId !== null && fieldId.includes(operandId);
    case '!~':
      return !(fieldId !== null && operandId !== null && fieldId.includes(operandId));
    default:
      return false;
  }
}

function evalDateComparison(
  fieldValue: unknown,
  op: ComparisonOp,
  operand: unknown,
): boolean {
  const left = parseDate(fieldValue);
  const right = parseDate(operand);
  if (left === null || right === null) {
    // Equality/inequality still defined when one side is empty.
    if (op === '=') return left === right; // both null
    if (op === '!=') return left !== right;
    return false;
  }
  return compareNumeric(left.getTime(), op, right.getTime());
}

function evalNumberComparison(
  fieldValue: unknown,
  op: ComparisonOp,
  operand: unknown,
): boolean {
  const left = typeof fieldValue === 'number' ? fieldValue : Number(fieldValue);
  const right = typeof operand === 'number' ? operand : Number(operand);
  if (Number.isNaN(left) || Number.isNaN(right)) {
    if (op === '!=') return true; // a non-number never equals a number
    return false;
  }
  return compareNumeric(left, op, right);
}

function evalEnumComparison(
  resolved: ResolvedField,
  fieldValue: unknown,
  op: ComparisonOp,
  operand: unknown,
): boolean {
  // Priority supports ordering by rank.
  const isPriority =
    resolved.source === 'standard' && resolved.field === 'priority';
  if (isPriority && (op === '>' || op === '>=' || op === '<' || op === '<=')) {
    const lRank = priorityRank(fieldValue);
    const rRank = priorityRank(operand);
    if (lRank === null || rRank === null) return false;
    return compareNumeric(lRank, op, rRank);
  }
  return evalStringComparison(fieldValue, op, operand, false);
}

function evalStringComparison(
  fieldValue: unknown,
  op: ComparisonOp,
  operand: unknown,
  caseSensitive: boolean,
): boolean {
  const rawLeft = toComparableString(fieldValue);
  const rawRight = toComparableString(operand);
  const left = caseSensitive ? rawLeft : rawLeft.toLowerCase();
  const right = caseSensitive ? rawRight : rawRight.toLowerCase();
  switch (op) {
    case '=':
      return left === right;
    case '!=':
      return left !== right;
    case '~':
      // substring contains — String.includes, never a RegExp (no ReDoS).
      return left.includes(right);
    case '!~':
      return !left.includes(right);
    case '>':
      return left > right;
    case '>=':
      return left >= right;
    case '<':
      return left < right;
    case '<=':
      return left <= right;
  }
}

function evalIn(node: InNode, issue: IssueDto, ctx: EvalContext): boolean {
  // Reuse the `=` comparison for each candidate; OR them together.
  const anyMatch = node.values.some((v) => {
    const synthetic: ComparisonNode = {
      type: 'comparison',
      field: node.field,
      op: '=',
      value: v,
      position: node.position,
    };
    return evalComparison(synthetic, issue, ctx);
  });
  return node.negated ? !anyMatch : anyMatch;
}

function evalIsEmpty(
  node: IsEmptyNode,
  issue: IssueDto,
  ctx: EvalContext,
): boolean {
  const resolved = resolveField(node.field, ctx);
  const value = getFieldValue(resolved, issue);
  const empty = isEmptyValue(value);
  return node.negated ? !empty : empty;
}

function evalNode(node: Node, issue: IssueDto, ctx: EvalContext): boolean {
  switch (node.type) {
    case 'or':
      return node.clauses.some((c) => evalNode(c, issue, ctx));
    case 'and':
      return node.clauses.every((c) => evalNode(c, issue, ctx));
    case 'not':
      return !evalNode(node.operand, issue, ctx);
    case 'comparison':
      return evalComparison(node, issue, ctx);
    case 'in':
      return evalIn(node, issue, ctx);
    case 'isEmpty':
      return evalIsEmpty(node, issue, ctx);
    default: {
      const _never: never = node;
      return _never;
    }
  }
}

/**
 * Evaluate a parsed query's where-clause against a single issue.
 * A query with no where-clause matches everything.
 * @throws {NlqlEvalError} when a field cannot be resolved.
 */
export function evaluate(ast: Query, issue: IssueDto, ctx: EvalContext): boolean {
  if (ast.where === null) return true;
  return evalNode(ast.where, issue, ctx);
}

// ── ORDER BY ──────────────────────────────────────────────────────────────────

function sortComparator(
  resolved: ResolvedField,
  a: IssueDto,
  b: IssueDto,
): number {
  const va = getFieldValue(resolved, a);
  const vb = getFieldValue(resolved, b);
  const kind = resolvedKind(resolved);

  // Nulls/empties sort last (for ASC).
  const aEmpty = isEmptyValue(va);
  const bEmpty = isEmptyValue(vb);
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  if (kind === 'number') {
    return Number(va) - Number(vb);
  }
  if (kind === 'date') {
    const da = parseDate(va);
    const db = parseDate(vb);
    if (da && db) return da.getTime() - db.getTime();
  }
  if (resolved.source === 'standard' && resolved.field === 'priority') {
    const ra = priorityRank(va) ?? 0;
    const rb = priorityRank(vb) ?? 0;
    return ra - rb;
  }
  return toComparableString(va).localeCompare(toComparableString(vb));
}

/**
 * Parse `query` once, evaluate it against every issue, and apply ORDER BY when
 * present. Returns a new array (input is not mutated).
 * @throws {NlqlParseError} on a syntax error (callers catch and surface it).
 * @throws {NlqlEvalError} on an unknown field.
 */
export function filterIssues(
  issues: IssueDto[],
  query: string,
  ctx: EvalContext,
): IssueDto[] {
  const ast = parse(query);
  const filtered = issues.filter((issue) => evaluate(ast, issue, ctx));

  if (ast.orderBy) {
    const resolved = resolveField(ast.orderBy.field, ctx);
    const dir = ast.orderBy.direction === 'DESC' ? -1 : 1;
    // Stable sort with index tiebreaker.
    const indexed = filtered.map((issue, idx) => ({ issue, idx }));
    indexed.sort((x, y) => {
      const cmp = sortComparator(resolved, x.issue, y.issue);
      if (cmp !== 0) return cmp * dir;
      return x.idx - y.idx;
    });
    return indexed.map((e) => e.issue);
  }

  return filtered;
}

export { NlqlParseError };
