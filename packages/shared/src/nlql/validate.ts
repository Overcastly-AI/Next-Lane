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
import type {
  FieldNode,
  Node,
  Query,
  ValueNode,
} from './ast';
import { parse } from './parser';
import { NlqlParseError } from './tokenizer';
import { resolveStandardField, type FieldKind } from './fields';
import type { NlqlSprint, NlqlUser } from './evaluator';

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
// `resolveQueryNames` is a separate PREPARE step server call sites run once
// per evaluation (after `validateQuery` and alongside loading
// ctx.users/ctx.sprints), never inside the evaluator's own per-issue loop. It
// walks the same AST looking only at `user`/`sprint`-kind comparisons and
// flags an operand as unresolved when it is neither `me()` nor an opaque-id-
// shaped literal (see `looksLikeOpaqueId`) and matches no entry in the
// supplied context.

export interface ResolveNamesContext {
  users?: NlqlUser[];
  sprints?: NlqlSprint[];
}

/**
 * Heuristic for "this operand could legitimately be a raw id the caller
 * didn't happen to load into `users`/`sprints`" (e.g. a former workspace
 * member's id still referenced by historical data). Prisma ids (`cuid()`,
 * 25 chars) and UUIDs (36 chars) both clear this bar; real display names and
 * sprint names ("Alex Rivera", "July-B", "Sprint 1 - Checkout Foundations")
 * do not — they either contain whitespace or are short. Only literals that
 * fail this check are eligible to be reported as an unresolved *name*.
 */
function looksLikeOpaqueId(value: string): boolean {
  return !/\s/.test(value) && value.length >= 20;
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

/**
 * Fail-loud prepare step for `user`/`sprint`-kind comparisons: returns
 * `{ ok: false }` when a comparison's operand looks like a name (not `me()`,
 * not opaque-id-shaped — see {@link looksLikeOpaqueId}) but resolves to no
 * entry in `ctx.users`/`ctx.sprints`. Never throws on a parse error — mirrors
 * {@link validateQuery}'s structured-result contract so callers can treat the
 * two checks uniformly (run `validateQuery` first; only call this once that
 * passes, since it assumes a syntactically valid, field-resolvable query).
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

  const users = ctx.users ?? [];
  const sprints = ctx.sprints ?? [];

  for (const { field, values } of operands) {
    if (field.quoted) continue; // custom fields are never 'user'/'sprint' kind
    const meta = resolveStandardField(field.name);
    if (!meta || (meta.kind !== 'user' && meta.kind !== 'sprint')) continue;

    for (const value of values) {
      const literal = literalOperandString(value);
      if (literal === null) continue; // me()/number/boolean — never a name
      if (looksLikeOpaqueId(literal)) continue; // could be a legitimate raw id

      const resolved =
        meta.kind === 'user' ? userResolves(literal, users) : sprintResolves(literal, sprints);
      if (resolved) continue;

      const hint =
        meta.kind === 'user'
          ? 'use an exact display name, an id, or me(); see list_users'
          : 'use an exact sprint name or an id; see list_sprints';
      return {
        ok: false,
        error: {
          message: `unknown ${meta.kind} "${literal}" — ${hint}`,
          position: field.position,
        },
      };
    }
  }

  return { ok: true };
}
