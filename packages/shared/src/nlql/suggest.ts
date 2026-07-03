/**
 * NLQL suggestion engine — context-aware autocomplete for the query DSL.
 *
 * Pure function: given a source string, cursor position, and project context
 * (status/user/label/etc. vocabularies), returns ranked suggestions and the
 * [from,to) range of the partial token to replace.
 *
 * Never throws — malformed/partial input is handled defensively with a
 * best-effort fallback to field/keyword suggestions.
 */
import { tokenize, type Token } from './tokenizer';
import { resolveStandardField } from './fields';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SuggestionKind = 'field' | 'operator' | 'keyword' | 'function' | 'value';

export interface NlqlSuggestion {
  label: string;
  insertText: string;
  kind: SuggestionKind;
  detail?: string;
}

/** Dynamic vocabularies from the live project. */
export interface NlqlSuggestContext {
  statuses?: string[];
  types?: string[];
  priorities?: string[];
  statusCategories?: string[];
  labels?: string[];
  users?: { label: string; value: string }[];
  components?: string[];
  sprints?: string[];
  customFields?: { key: string; kind: string }[];
}

export interface NlqlSuggestResult {
  /** Start index of the partial token to replace (inclusive). */
  from: number;
  /** End index of the partial token to replace (exclusive). */
  to: number;
  suggestions: NlqlSuggestion[];
}

// ---------------------------------------------------------------------------
// Field vocabulary
// ---------------------------------------------------------------------------

/**
 * The canonical spelling for each field that the UI should suggest.
 * Keys are the exact strings we want to insert; values are human-readable
 * descriptions. We deliberately deduplicate aliases to a single preferred name.
 */
const FIELD_SUGGESTIONS: Array<{ label: string; detail: string }> = [
  { label: 'status', detail: 'Issue status' },
  { label: 'statusCategory', detail: 'Status category (TODO / IN_PROGRESS / DONE)' },
  { label: 'assignee', detail: 'Assigned user' },
  { label: 'reporter', detail: 'Reporting user' },
  { label: 'type', detail: 'Issue type (TASK / BUG / STORY …)' },
  { label: 'priority', detail: 'Issue priority (HIGHEST / HIGH / MEDIUM / LOW / LOWEST)' },
  { label: 'labels', detail: 'Labels attached to the issue' },
  { label: 'sprint', detail: 'Sprint (id or name)' },
  { label: 'startDate', detail: 'Start date' },
  { label: 'dueDate', detail: 'Due date' },
  { label: 'createdAt', detail: 'Creation date' },
  { label: 'updatedAt', detail: 'Last updated date' },
  { label: 'title', detail: 'Issue title (summary)' },
  { label: 'text', detail: 'Full text search (title + description)' },
  { label: 'storyPoints', detail: 'Story point estimate' },
  { label: 'key', detail: 'Issue key (e.g. NL-12)' },
  { label: 'parent', detail: 'Parent issue id' },
  { label: 'component', detail: 'Component id' },
];

// ---------------------------------------------------------------------------
// Operator vocabulary per field kind
// ---------------------------------------------------------------------------

interface OpSuggestion {
  label: string;
  insertText: string;
  detail?: string;
}

const OPS_ENUM: OpSuggestion[] = [
  { label: '=', insertText: '= ', detail: 'equals' },
  { label: '!=', insertText: '!= ', detail: 'not equals' },
  { label: 'IN', insertText: 'IN (', detail: 'one of' },
  { label: 'NOT IN', insertText: 'NOT IN (', detail: 'none of' },
  { label: 'IS EMPTY', insertText: 'IS EMPTY', detail: 'is not set' },
  { label: 'IS NOT EMPTY', insertText: 'IS NOT EMPTY', detail: 'is set' },
];

const OPS_USER: OpSuggestion[] = [
  { label: '=', insertText: '= ', detail: 'equals' },
  { label: '!=', insertText: '!= ', detail: 'not equals' },
  { label: 'IN', insertText: 'IN (', detail: 'one of' },
  { label: 'NOT IN', insertText: 'NOT IN (', detail: 'none of' },
  { label: 'IS EMPTY', insertText: 'IS EMPTY', detail: 'is unassigned' },
  { label: 'IS NOT EMPTY', insertText: 'IS NOT EMPTY', detail: 'is assigned' },
];

const OPS_STRING: OpSuggestion[] = [
  { label: '=', insertText: '= ', detail: 'equals (exact)' },
  { label: '!=', insertText: '!= ', detail: 'not equals' },
  { label: '~', insertText: '~ ', detail: 'contains' },
  { label: '!~', insertText: '!~ ', detail: 'does not contain' },
  { label: 'IS EMPTY', insertText: 'IS EMPTY', detail: 'is empty' },
  { label: 'IS NOT EMPTY', insertText: 'IS NOT EMPTY', detail: 'is not empty' },
];

const OPS_NUMBER: OpSuggestion[] = [
  { label: '=', insertText: '= ', detail: 'equals' },
  { label: '!=', insertText: '!= ', detail: 'not equals' },
  { label: '>', insertText: '> ', detail: 'greater than' },
  { label: '>=', insertText: '>= ', detail: 'greater than or equal' },
  { label: '<', insertText: '< ', detail: 'less than' },
  { label: '<=', insertText: '<= ', detail: 'less than or equal' },
  { label: 'IS EMPTY', insertText: 'IS EMPTY', detail: 'is not set' },
  { label: 'IS NOT EMPTY', insertText: 'IS NOT EMPTY', detail: 'is set' },
];

const OPS_DATE: OpSuggestion[] = [
  { label: '=', insertText: '= ', detail: 'equals' },
  { label: '!=', insertText: '!= ', detail: 'not equals' },
  { label: '>', insertText: '> ', detail: 'after' },
  { label: '>=', insertText: '>= ', detail: 'on or after' },
  { label: '<', insertText: '< ', detail: 'before' },
  { label: '<=', insertText: '<= ', detail: 'on or before' },
  { label: 'IS EMPTY', insertText: 'IS EMPTY', detail: 'is not set' },
  { label: 'IS NOT EMPTY', insertText: 'IS NOT EMPTY', detail: 'is set' },
];

const OPS_ARRAY: OpSuggestion[] = [
  { label: '=', insertText: '= ', detail: 'contains' },
  { label: '!=', insertText: '!= ', detail: 'does not contain' },
  { label: 'IN', insertText: 'IN (', detail: 'contains any of' },
  { label: 'NOT IN', insertText: 'NOT IN (', detail: 'contains none of' },
  { label: 'IS EMPTY', insertText: 'IS EMPTY', detail: 'has no labels' },
  { label: 'IS NOT EMPTY', insertText: 'IS NOT EMPTY', detail: 'has labels' },
];

const OPS_ID: OpSuggestion[] = [
  { label: '=', insertText: '= ', detail: 'equals' },
  { label: '!=', insertText: '!= ', detail: 'not equals' },
  { label: 'IS EMPTY', insertText: 'IS EMPTY', detail: 'is not set' },
  { label: 'IS NOT EMPTY', insertText: 'IS NOT EMPTY', detail: 'is set' },
];

const OPS_SPRINT: OpSuggestion[] = [
  { label: '=', insertText: '= ', detail: 'equals (id or name)' },
  { label: '!=', insertText: '!= ', detail: 'not equals' },
  { label: 'IN', insertText: 'IN (', detail: 'one of' },
  { label: 'NOT IN', insertText: 'NOT IN (', detail: 'none of' },
  { label: 'IS EMPTY', insertText: 'IS EMPTY', detail: 'not in a sprint' },
  { label: 'IS NOT EMPTY', insertText: 'IS NOT EMPTY', detail: 'in a sprint' },
];

function opsForKind(kind: string): OpSuggestion[] {
  switch (kind) {
    case 'enum': return OPS_ENUM;
    case 'user': return OPS_USER;
    case 'string': return OPS_STRING;
    case 'number': return OPS_NUMBER;
    case 'date': return OPS_DATE;
    case 'array': return OPS_ARRAY;
    case 'id': return OPS_ID;
    case 'sprint': return OPS_SPRINT;
    default: return OPS_ENUM;
  }
}

// ---------------------------------------------------------------------------
// Value/function vocabulary per field
// ---------------------------------------------------------------------------

const DATE_FUNCTIONS: NlqlSuggestion[] = [
  { label: 'now()', insertText: 'now()', kind: 'function', detail: 'current date and time' },
  { label: 'today()', insertText: 'today()', kind: 'function', detail: 'start of today' },
  { label: 'startOfWeek()', insertText: 'startOfWeek()', kind: 'function', detail: 'start of current week' },
  { label: 'startOfDay()', insertText: 'startOfDay()', kind: 'function', detail: 'start of current day (same as today())' },
];

const USER_FUNCTIONS: NlqlSuggestion[] = [
  { label: 'me()', insertText: 'me()', kind: 'function', detail: 'the currently logged-in user' },
];

/**
 * Quote a value string for insertion if it contains spaces or special chars.
 */
function quoteIfNeeded(v: string): string {
  if (/[\s,()=!<>~"']/.test(v)) {
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return v;
}

function valuesForField(
  fieldName: string,
  kind: string,
  ctx: NlqlSuggestContext,
): NlqlSuggestion[] {
  const lower = fieldName.toLowerCase();

  // User fields
  if (kind === 'user' || lower === 'assignee' || lower === 'reporter') {
    const suggestions: NlqlSuggestion[] = [...USER_FUNCTIONS];
    for (const u of ctx.users ?? []) {
      suggestions.push({
        label: u.label,
        insertText: quoteIfNeeded(u.value),
        kind: 'value',
        detail: u.label,
      });
    }
    return suggestions;
  }

  // Date fields
  if (kind === 'date') {
    return [...DATE_FUNCTIONS];
  }

  // Status
  if (lower === 'status') {
    return (ctx.statuses ?? []).map((s) => ({
      label: s,
      insertText: quoteIfNeeded(s),
      kind: 'value' as SuggestionKind,
    }));
  }

  // Status category
  if (lower === 'statuscategory' || lower === 'category') {
    return (ctx.statusCategories ?? ['TODO', 'IN_PROGRESS', 'DONE']).map((c) => ({
      label: c,
      insertText: c,
      kind: 'value' as SuggestionKind,
    }));
  }

  // Issue type
  if (lower === 'type' || lower === 'issuetype') {
    const types = ctx.types ?? ['TASK', 'BUG', 'STORY', 'EPIC', 'SUBTASK'];
    return types.map((t) => ({
      label: t,
      insertText: t,
      kind: 'value' as SuggestionKind,
    }));
  }

  // Priority
  if (lower === 'priority') {
    const priorities = ctx.priorities ?? ['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'];
    return priorities.map((p) => ({
      label: p,
      insertText: p,
      kind: 'value' as SuggestionKind,
    }));
  }

  // Labels / array kind
  if (kind === 'array' || lower === 'label' || lower === 'labels') {
    return (ctx.labels ?? []).map((l) => ({
      label: l,
      insertText: quoteIfNeeded(l),
      kind: 'value' as SuggestionKind,
    }));
  }

  // Sprint
  if (lower === 'sprint') {
    return (ctx.sprints ?? []).map((s) => ({
      label: s,
      insertText: quoteIfNeeded(s),
      kind: 'value' as SuggestionKind,
    }));
  }

  // Component
  if (lower === 'component' || lower === 'componentid') {
    return (ctx.components ?? []).map((c) => ({
      label: c,
      insertText: quoteIfNeeded(c),
      kind: 'value' as SuggestionKind,
    }));
  }

  return [];
}

// ---------------------------------------------------------------------------
// Logical keyword suggestions (post-comparison)
// ---------------------------------------------------------------------------

const LOGICAL_KEYWORDS: NlqlSuggestion[] = [
  { label: 'AND', insertText: 'AND ', kind: 'keyword', detail: 'logical and' },
  { label: 'OR', insertText: 'OR ', kind: 'keyword', detail: 'logical or' },
  { label: 'ORDER BY', insertText: 'ORDER BY ', kind: 'keyword', detail: 'sort results' },
];

const ORDER_DIRECTION: NlqlSuggestion[] = [
  { label: 'ASC', insertText: 'ASC', kind: 'keyword', detail: 'ascending' },
  { label: 'DESC', insertText: 'DESC', kind: 'keyword', detail: 'descending' },
];

// ---------------------------------------------------------------------------
// Parser state inference
// ---------------------------------------------------------------------------

/**
 * The parser position we've inferred from tokens up to the cursor.
 */
type ParseState =
  | { phase: 'field'; fieldPrefix: string }
  | { phase: 'operator'; fieldName: string; fieldKind: string; opPrefix: string }
  | { phase: 'value'; fieldName: string; fieldKind: string; valuePrefix: string; inInList: boolean }
  | { phase: 'logical'; logicalPrefix: string }
  | { phase: 'orderByField'; fieldPrefix: string }
  | { phase: 'orderByDirection'; directionPrefix: string }
  | { phase: 'unknown' };

/**
 * Tokenize the source up to the cursor. On error, returns whatever tokens were
 * successfully produced (the tokenizer stops on error). We re-tokenize just the
 * prefix `source.slice(0, cursor)` so we never have to worry about invalid tokens
 * AFTER the cursor confusing our state machine.
 */
function tokenizePrefix(source: string, cursor: number): Token[] {
  const prefix = source.slice(0, cursor);
  try {
    return tokenize(prefix);
  } catch {
    // The tokenizer threw on an invalid character or unterminated string.
    // Try to get partial tokens by walking back character-by-character.
    for (let i = prefix.length - 1; i >= 0; i--) {
      try {
        const partial = tokenize(prefix.slice(0, i));
        return partial;
      } catch {
        // continue
      }
    }
    return [];
  }
}

/**
 * Determine what to suggest based on the token sequence ending at `cursor`.
 *
 * State machine rules (tokens before the cursor):
 *   []                                   → field
 *   [FIELD/KEYWORD(AND|OR|NOT)]           → field (possibly partial prefix)
 *   [FIELD, OP|KEYWORD(IN|NOT|IS...)]    → (already after op → value)
 *   [FIELD]                              → operator
 *   [FIELD, OP]                          → value
 *   [FIELD, IN, LPAREN, value, COMMA]    → value (in-list continuation)
 *   [... KEYWORD(AND|OR) ]               → field
 *   [... KEYWORD(ORDER) ]                → need BY (suggest nothing useful yet)
 *   [... KEYWORD(ORDER), KEYWORD(BY) ]   → field for ORDER BY
 *   [... KEYWORD(ORDER), KEYWORD(BY), FIELD] → ASC/DESC
 *   [... completed comparison ]          → logical keyword
 */
function inferState(tokens: Token[], cursor: number, source: string): ParseState {
  // Remove EOF token if present
  const toks = tokens.filter((t) => t.type !== 'EOF');

  // Determine if cursor is mid-token (partial) or at a token boundary.
  const lastTok = toks[toks.length - 1];

  // The "current" partial word the cursor is at the end of — we use this to
  // know the prefix the user has typed so we can filter suggestions.
  const cursorChar = source[cursor - 1] ?? '';
  const isWhitespace = cursorChar === ' ' || cursorChar === '\t' || cursorChar === '\r' || cursorChar === '\n' || cursorChar === '';

  // If we're on whitespace, the last token is complete (user finished a token).
  // If we're mid-token, we need to pop the last token as the "partial" being typed.
  let completedToks: Token[];
  let partialTok: Token | null;

  if (!lastTok || isWhitespace) {
    completedToks = toks;
    partialTok = null;
  } else {
    // The last token ends at the cursor — treat it as a partial token being typed.
    completedToks = toks.slice(0, -1);
    partialTok = lastTok;
  }

  // Walk completed tokens to figure out where we are in the grammar.
  return inferFromCompleted(completedToks, partialTok, source);
}

function inferFromCompleted(
  completedToks: Token[],
  partialTok: Token | null,
  _source: string,
): ParseState {
  const n = completedToks.length;

  // Empty or after AND/OR/NOT/LPAREN → expect a field (or partial field).
  if (n === 0) {
    return { phase: 'field', fieldPrefix: partialTok?.value ?? '' };
  }

  const last = completedToks[n - 1];
  const secondLast = n >= 2 ? completedToks[n - 2] : null;
  const thirdLast = n >= 3 ? completedToks[n - 3] : null;

  // After AND/OR/NOT/LPAREN → field suggestion
  if (
    last.type === 'KEYWORD' &&
    (last.value === 'AND' || last.value === 'OR' || last.value === 'NOT')
  ) {
    return { phase: 'field', fieldPrefix: partialTok?.value ?? '' };
  }
  if (last.type === 'LPAREN') {
    // After `IN (` we want value suggestions.
    if (secondLast?.type === 'KEYWORD' && secondLast.value === 'IN') {
      const fieldTok = n >= 3 ? completedToks[n - 3] : null;
      if (fieldTok?.type === 'IDENT') {
        const meta = resolveStandardField(fieldTok.value);
        return {
          phase: 'value',
          fieldName: fieldTok.value,
          fieldKind: meta?.kind ?? 'enum',
          valuePrefix: partialTok?.value ?? '',
          inInList: true,
        };
      }
    }
    // After `NOT IN (` — fieldTok is at n-4
    if (secondLast?.type === 'KEYWORD' && secondLast.value === 'IN') {
      const notTok = n >= 3 ? completedToks[n - 3] : null;
      if (notTok?.type === 'KEYWORD' && notTok.value === 'NOT') {
        const fieldTok = n >= 4 ? completedToks[n - 4] : null;
        if (fieldTok?.type === 'IDENT') {
          const meta = resolveStandardField(fieldTok.value);
          return {
            phase: 'value',
            fieldName: fieldTok.value,
            fieldKind: meta?.kind ?? 'enum',
            valuePrefix: partialTok?.value ?? '',
            inInList: true,
          };
        }
      }
    }
    // Generic LPAREN (grouping expression) → suggest field
    return { phase: 'field', fieldPrefix: partialTok?.value ?? '' };
  }

  // After COMMA in an IN list → more values
  if (last.type === 'COMMA') {
    // Walk back to find the field: FIELD IN ( value , value , ... ,
    const openIdx = findMatchingLParen(completedToks, n - 1);
    if (openIdx !== null && openIdx >= 2) {
      const inKwIdx = openIdx - 1;
      const fieldIdx = inKwIdx - 1;
      const inKw = completedToks[inKwIdx];
      const fieldTok = completedToks[fieldIdx];
      if (
        inKw?.type === 'KEYWORD' &&
        inKw.value === 'IN' &&
        (fieldTok?.type === 'IDENT' || fieldTok?.type === 'STRING')
      ) {
        const meta = resolveStandardField(fieldTok.value);
        return {
          phase: 'value',
          fieldName: fieldTok.value,
          fieldKind: meta?.kind ?? 'enum',
          valuePrefix: partialTok?.value ?? '',
          inInList: true,
        };
      }
    }
    return { phase: 'field', fieldPrefix: partialTok?.value ?? '' };
  }

  // ORDER BY handling
  if (last.type === 'KEYWORD' && last.value === 'ORDER') {
    return { phase: 'unknown' }; // await BY
  }
  if (last.type === 'KEYWORD' && last.value === 'BY') {
    if (secondLast?.type === 'KEYWORD' && secondLast.value === 'ORDER') {
      return { phase: 'orderByField', fieldPrefix: partialTok?.value ?? '' };
    }
  }
  // After ORDER BY field (completed) → ASC/DESC
  if (
    last.type === 'IDENT' &&
    secondLast?.type === 'KEYWORD' && secondLast.value === 'BY' &&
    thirdLast?.type === 'KEYWORD' && thirdLast.value === 'ORDER'
  ) {
    return { phase: 'orderByDirection', directionPrefix: partialTok?.value ?? '' };
  }
  if (last.type === 'KEYWORD' && (last.value === 'ASC' || last.value === 'DESC')) {
    // After ASC/DESC → logical or end
    return { phase: 'logical', logicalPrefix: partialTok?.value ?? '' };
  }

  // After a complete IS EMPTY / IS NOT EMPTY → logical
  if (last.type === 'KEYWORD' && last.value === 'EMPTY') {
    return { phase: 'logical', logicalPrefix: partialTok?.value ?? '' };
  }

  // After a complete comparison value (IDENT/STRING/NUMBER as value) → logical keyword suggestions
  if (last.type === 'IDENT') {
    // Check if this IDENT is in a value position (after OP or comma)
    if (isValueContext(completedToks, n - 1)) {
      return { phase: 'logical', logicalPrefix: partialTok?.value ?? '' };
    }
    // Check if it's a known field name → operator suggestions
    const meta = resolveStandardField(last.value);
    if (meta) {
      return {
        phase: 'operator',
        fieldName: last.value,
        fieldKind: meta.kind,
        opPrefix: partialTok?.value ?? '',
      };
    }
    // Otherwise could be a partial field being typed
    return { phase: 'field', fieldPrefix: last.value };
  }

  if (last.type === 'STRING' || last.type === 'NUMBER') {
    if (isValueContext(completedToks, n - 1)) {
      return { phase: 'logical', logicalPrefix: partialTok?.value ?? '' };
    }
    return { phase: 'field', fieldPrefix: partialTok?.value ?? '' };
  }

  // After RPAREN (end of IN list) → logical
  if (last.type === 'RPAREN') {
    return { phase: 'logical', logicalPrefix: partialTok?.value ?? '' };
  }

  // After an OP → value
  if (last.type === 'OP') {
    // Find field: FIELD OP
    if (n >= 2) {
      const fieldTok = completedToks[n - 2];
      if (fieldTok?.type === 'IDENT' || fieldTok?.type === 'STRING') {
        const meta = resolveStandardField(fieldTok.value);
        return {
          phase: 'value',
          fieldName: fieldTok.value,
          fieldKind: meta?.kind ?? 'string',
          valuePrefix: partialTok?.value ?? '',
          inInList: false,
        };
      }
    }
    return { phase: 'value', fieldName: '', fieldKind: 'string', valuePrefix: partialTok?.value ?? '', inInList: false };
  }

  // After KEYWORD IN/NOT → partial operator context OR entering IN list
  if (last.type === 'KEYWORD' && (last.value === 'IN' || last.value === 'NOT')) {
    if (n >= 2) {
      const fieldTok = completedToks[n - 2];
      if (fieldTok?.type === 'IDENT') {
        const meta = resolveStandardField(fieldTok.value);
        // If the partial token is `(`, we just opened the IN list — suggest values
        if (partialTok?.type === 'LPAREN' && last.value === 'IN') {
          return {
            phase: 'value',
            fieldName: fieldTok.value,
            fieldKind: meta?.kind ?? 'enum',
            valuePrefix: '',
            inInList: true,
          };
        }
        return {
          phase: 'operator',
          fieldName: fieldTok.value,
          fieldKind: meta?.kind ?? 'enum',
          opPrefix: partialTok?.value ?? '',
        };
      }
    }
  }

  // After KEYWORD IS → partial operator (user typing IS EMPTY etc.)
  if (last.type === 'KEYWORD' && last.value === 'IS') {
    if (n >= 2) {
      const fieldTok = completedToks[n - 2];
      if (fieldTok?.type === 'IDENT') {
        const meta = resolveStandardField(fieldTok.value);
        return {
          phase: 'operator',
          fieldName: fieldTok.value,
          fieldKind: meta?.kind ?? 'enum',
          opPrefix: 'IS ',
        };
      }
    }
  }

  // Fallback
  return { phase: 'field', fieldPrefix: partialTok?.value ?? '' };
}

/** Return true if the token at `idx` in `toks` is in a value position. */
function isValueContext(toks: Token[], idx: number): boolean {
  // Walk backwards from idx to see if there's an OP or a COMMA (in-list) before us.
  for (let i = idx - 1; i >= 0; i--) {
    const t = toks[i];
    if (t.type === 'OP') return true;
    if (t.type === 'COMMA') return true;
    if (t.type === 'LPAREN') return true;
    if (t.type === 'IDENT' || t.type === 'STRING' || t.type === 'NUMBER') continue; // skip values
    if (t.type === 'KEYWORD' && t.value === 'IN') return true;
    break;
  }
  return false;
}

/** Find the matching LPAREN before `fromIdx`, returning its index or null. */
function findMatchingLParen(toks: Token[], fromIdx: number): number | null {
  let depth = 0;
  for (let i = fromIdx; i >= 0; i--) {
    if (toks[i].type === 'RPAREN') depth++;
    if (toks[i].type === 'LPAREN') {
      if (depth === 0) return i;
      depth--;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Replacement range computation
// ---------------------------------------------------------------------------

/**
 * Compute the [from, to) range of the token the cursor is inside/at the end of.
 * If the cursor is in whitespace, from === to === cursor.
 */
function replacementRange(
  tokens: Token[],
  cursor: number,
): { from: number; to: number } {
  // Find a token whose range contains cursor (end-exclusive = overlapping).
  for (const tok of tokens) {
    if (tok.type === 'EOF') continue;
    if (tok.start <= cursor && tok.end >= cursor) {
      return { from: tok.start, to: tok.end };
    }
  }
  return { from: cursor, to: cursor };
}

// ---------------------------------------------------------------------------
// Main suggest function
// ---------------------------------------------------------------------------

/**
 * Produce autocomplete suggestions for the NLQL query at the given cursor position.
 *
 * @param source  The full query string
 * @param cursor  The cursor position (0-based character index)
 * @param ctx     Dynamic project context (statuses, users, labels, etc.)
 */
export function suggestNlql(
  source: string,
  cursor: number,
  ctx: NlqlSuggestContext,
): NlqlSuggestResult {
  // Clamp cursor
  const pos = Math.max(0, Math.min(cursor, source.length));

  const tokens = tokenizePrefix(source, pos);
  const state = inferState(tokens, pos, source);

  const { from, to } = replacementRange(tokens, pos);

  switch (state.phase) {
    case 'field': {
      const prefix = state.fieldPrefix.toLowerCase();
      const fieldSuggs: NlqlSuggestion[] = FIELD_SUGGESTIONS
        .filter((f) => f.label.toLowerCase().startsWith(prefix))
        .map((f) => ({
          label: f.label,
          insertText: f.label + ' ',
          kind: 'field' as SuggestionKind,
          detail: f.detail,
        }));

      // Also add custom fields
      for (const cf of ctx.customFields ?? []) {
        if (cf.key.toLowerCase().startsWith(prefix)) {
          fieldSuggs.push({
            label: cf.key,
            insertText: cf.key + ' ',
            kind: 'field',
            detail: `Custom field (${cf.kind})`,
          });
        }
      }

      return { from, to, suggestions: fieldSuggs };
    }

    case 'operator': {
      const prefix = state.opPrefix.toLowerCase();
      const ops = opsForKind(state.fieldKind);
      const opSuggs: NlqlSuggestion[] = ops
        .filter((o) => o.label.toLowerCase().startsWith(prefix))
        .map((o) => ({
          label: o.label,
          insertText: o.insertText,
          kind: 'operator' as SuggestionKind,
          detail: o.detail,
        }));
      return { from, to, suggestions: opSuggs };
    }

    case 'value': {
      const prefix = state.valuePrefix.toLowerCase();
      const values = valuesForField(state.fieldName, state.fieldKind, ctx);
      const filtered = values.filter((v) =>
        v.label.toLowerCase().startsWith(prefix),
      );
      return { from, to, suggestions: filtered };
    }

    case 'logical': {
      const prefix = state.logicalPrefix.toLowerCase();
      const kws = LOGICAL_KEYWORDS.filter((k) =>
        k.label.toLowerCase().startsWith(prefix),
      );
      return { from, to, suggestions: kws };
    }

    case 'orderByField': {
      const prefix = state.fieldPrefix.toLowerCase();
      const fieldSuggs: NlqlSuggestion[] = FIELD_SUGGESTIONS
        .filter((f) => f.label.toLowerCase().startsWith(prefix))
        .map((f) => ({
          label: f.label,
          insertText: f.label + ' ',
          kind: 'field' as SuggestionKind,
          detail: f.detail,
        }));
      return { from, to, suggestions: fieldSuggs };
    }

    case 'orderByDirection': {
      const prefix = state.directionPrefix.toLowerCase();
      const dirs = ORDER_DIRECTION.filter((d) =>
        d.label.toLowerCase().startsWith(prefix),
      );
      return { from, to, suggestions: dirs };
    }

    case 'unknown':
    default:
      return { from, to, suggestions: [] };
  }
}
