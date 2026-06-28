/**
 * Card color evaluation utilities.
 *
 * Evaluates a board's colorRules against a single issue and returns the
 * first matching rule's color (first-match-wins). Guards against
 * unparseable / invalid rule queries so this is safe to call in render.
 */
import {
  parse,
  evaluate,
  type BoardColorRule,
  type EvalContext,
  type IssueDto,
  NlqlParseError,
} from '@next-lane/shared';
import type { Query } from '@next-lane/shared';

/** Pre-parsed AST cache — keyed by rule id so we parse each query once. */
const astCache = new Map<string, Query | null>();

/**
 * Attempt to parse a rule's query, caching the result.
 * Returns null if the query is unparseable (the rule is silently skipped).
 */
function getParsedAst(rule: BoardColorRule): Query | null {
  const cacheKey = `${rule.id}:${rule.query}`;
  if (astCache.has(cacheKey)) return astCache.get(cacheKey) ?? null;
  try {
    const ast = parse(rule.query);
    astCache.set(cacheKey, ast);
    return ast;
  } catch (err) {
    if (err instanceof NlqlParseError) {
      astCache.set(cacheKey, null);
      return null;
    }
    throw err;
  }
}

/**
 * Find the first color rule whose NLQL query matches the given issue.
 * Returns null if no rule matches.
 *
 * This never throws — invalid/unparseable queries are skipped gracefully.
 */
export function resolveCardColor(
  rules: BoardColorRule[],
  issue: IssueDto,
  ctx: EvalContext,
): BoardColorRule | null {
  for (const rule of rules) {
    if (!rule.query.trim()) continue;
    const ast = getParsedAst(rule);
    if (!ast) continue;
    try {
      if (evaluate(ast, issue, ctx)) return rule;
    } catch {
      // NlqlEvalError from an unknown field — skip this rule.
      continue;
    }
  }
  return null;
}

/**
 * Invalidate the AST cache for a specific rule id prefix.
 * Call this after colorRules are updated so stale parses are evicted.
 */
export function invalidateAstCache(ruleId?: string): void {
  if (!ruleId) {
    astCache.clear();
    return;
  }
  for (const key of astCache.keys()) {
    if (key.startsWith(`${ruleId}:`)) astCache.delete(key);
  }
}

/** Accessible preset color palette for the color picker. */
export const PRESET_COLORS = [
  { hex: '#ef4444', label: 'Red' },
  { hex: '#f97316', label: 'Orange' },
  { hex: '#eab308', label: 'Amber' },
  { hex: '#22c55e', label: 'Green' },
  { hex: '#06b6d4', label: 'Cyan' },
  { hex: '#3b82f6', label: 'Blue' },
  { hex: '#8b5cf6', label: 'Violet' },
  { hex: '#ec4899', label: 'Pink' },
  { hex: '#64748b', label: 'Slate' },
  { hex: '#1e293b', label: 'Dark' },
] as const;
