/**
 * NLQL Abstract Syntax Tree node types.
 *
 * The AST is a small, fully-typed tree. Comparison operands ("values") are
 * normalized into a discriminated union so the evaluator can switch on `kind`
 * without re-parsing literals.
 */

/** Comparison operators. `~` = contains, `!~` = not-contains. */
export type ComparisonOp = '=' | '!=' | '>' | '>=' | '<' | '<=' | '~' | '!~';

/** A literal or function-call value appearing on the right-hand side. */
export type ValueNode =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'word'; value: string } // bare word (e.g. an enum like DONE)
  | { kind: 'function'; name: FunctionName };

/** Supported zero-arg functions. */
export type FunctionName = 'me' | 'now' | 'today' | 'startOfWeek' | 'startOfDay';

/** A field reference. `quoted` marks custom-field-by-name/key references. */
export interface FieldNode {
  name: string;
  quoted: boolean;
  /** Source position of the field token, for error reporting. */
  position: number;
}

export type Node =
  | OrNode
  | AndNode
  | NotNode
  | ComparisonNode
  | InNode
  | IsEmptyNode;

export interface OrNode {
  type: 'or';
  clauses: Node[];
}

export interface AndNode {
  type: 'and';
  clauses: Node[];
}

export interface NotNode {
  type: 'not';
  operand: Node;
}

export interface ComparisonNode {
  type: 'comparison';
  field: FieldNode;
  op: ComparisonOp;
  value: ValueNode;
  /** Source position of the operator, for error reporting. */
  position: number;
}

/** `field IN (a, b, c)` or `field NOT IN (...)`. */
export interface InNode {
  type: 'in';
  field: FieldNode;
  negated: boolean;
  values: ValueNode[];
  position: number;
}

/** `field IS EMPTY` or `field IS NOT EMPTY`. */
export interface IsEmptyNode {
  type: 'isEmpty';
  field: FieldNode;
  negated: boolean;
  position: number;
}

export type SortDirection = 'ASC' | 'DESC';

export interface OrderBy {
  field: FieldNode;
  direction: SortDirection;
}

/** The full parsed query: a boolean expression plus optional ordering. */
export interface Query {
  /** The where-clause expression. `null` means "match everything". */
  where: Node | null;
  orderBy: OrderBy | null;
}
