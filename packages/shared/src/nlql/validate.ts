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
} from './ast';
import { parse } from './parser';
import { NlqlParseError } from './tokenizer';
import { resolveStandardField, type FieldKind } from './fields';

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
