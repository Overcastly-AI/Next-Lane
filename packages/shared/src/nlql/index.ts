/**
 * NLQL (Next Lane Query Language) — public API.
 *
 * A small, safe, JQL-like query language used for board filtering, saved
 * filters, conditional card colors, and (later) the automation engine.
 *
 * Typical usage:
 *   import { filterIssues, validateQuery, NlqlParseError } from '@next-lane/shared';
 */

// Errors
export { NlqlParseError } from './tokenizer';
export { NlqlEvalError } from './evaluator';

// Tokenizer (exposed for tooling/highlighting)
export { tokenize } from './tokenizer';
export type { Token, TokenType } from './tokenizer';

// Parser + AST
export { parse } from './parser';
export type {
  Query,
  Node,
  OrNode,
  AndNode,
  NotNode,
  ComparisonNode,
  InNode,
  IsEmptyNode,
  ComparisonOp,
  ValueNode,
  FunctionName,
  FieldNode,
  OrderBy,
  SortDirection,
} from './ast';

// Fields allowlist
export {
  resolveStandardField,
  isStandardField,
} from './fields';
export type {
  StandardField,
  FieldKind,
  StandardFieldMeta,
} from './fields';

// Evaluator
export { evaluate, filterIssues } from './evaluator';
export type {
  EvalContext,
  NlqlUser,
  NlqlSprint,
  NlqlCustomFieldDef,
} from './evaluator';

// Validation
export {
  validateQuery,
  getReferencedFieldKinds,
  resolveQueryNames,
  NLQL_MAX_LENGTH,
} from './validate';
export type {
  ValidationResult,
  ValidateOptions,
  ValidateCustomFieldDef,
  ResolveNamesContext,
} from './validate';

// Autocomplete suggestion engine
export { suggestNlql } from './suggest';
export type {
  NlqlSuggestion,
  NlqlSuggestContext,
  NlqlSuggestResult,
  SuggestionKind,
} from './suggest';
