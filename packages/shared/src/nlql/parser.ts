/**
 * NLQL recursive-descent parser.
 *
 * Grammar (AND binds tighter than OR):
 *   query    := orExpr [ORDER BY field [ASC|DESC]]
 *   orExpr   := andExpr (OR andExpr)*
 *   andExpr  := notExpr (AND notExpr)*
 *   notExpr  := [NOT] term
 *   term     := '(' orExpr ')' | comparison
 *   comparison :=
 *       field op value
 *     | field IN '(' value (',' value)* ')'
 *     | field NOT IN '(' value (',' value)* ')'
 *     | field IS EMPTY | field IS NOT EMPTY
 *
 * On any malformed input it throws {@link NlqlParseError} with a friendly,
 * position-tagged message.
 */
import { NlqlParseError, tokenize, type Token } from './tokenizer';
import type {
  ComparisonNode,
  ComparisonOp,
  FieldNode,
  FunctionName,
  InNode,
  IsEmptyNode,
  Node,
  OrderBy,
  Query,
  SortDirection,
  ValueNode,
} from './ast';

const COMPARISON_OPS = new Set<ComparisonOp>([
  '=',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  '~',
  '!~',
]);

const FUNCTION_NAMES = new Set<FunctionName>([
  'me',
  'now',
  'today',
  'startOfWeek',
  'startOfDay',
]);

class Parser {
  private readonly tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private next(): Token {
    return this.tokens[this.pos++];
  }

  private atEnd(): boolean {
    return this.peek().type === 'EOF';
  }

  parseQuery(): Query {
    // Empty query → match everything.
    if (this.atEnd()) {
      return { where: null, orderBy: null };
    }

    let where: Node | null = null;
    // ORDER BY may appear with no where-clause ("ORDER BY priority DESC").
    if (!this.isOrderByAhead()) {
      where = this.parseOr();
    }

    const orderBy = this.parseOptionalOrderBy();

    if (!this.atEnd()) {
      const t = this.peek();
      throw new NlqlParseError(
        `Unexpected ${describe(t)} at position ${t.start}`,
        t.start,
      );
    }
    return { where, orderBy };
  }

  private isOrderByAhead(): boolean {
    const t = this.peek();
    return t.type === 'KEYWORD' && t.value === 'ORDER';
  }

  private parseOr(): Node {
    const clauses: Node[] = [this.parseAnd()];
    while (this.peekKeyword('OR')) {
      this.next();
      clauses.push(this.parseAnd());
    }
    return clauses.length === 1 ? clauses[0] : { type: 'or', clauses };
  }

  private parseAnd(): Node {
    const clauses: Node[] = [this.parseNot()];
    while (this.peekKeyword('AND')) {
      this.next();
      clauses.push(this.parseNot());
    }
    return clauses.length === 1 ? clauses[0] : { type: 'and', clauses };
  }

  private parseNot(): Node {
    if (this.peekKeyword('NOT')) {
      this.next();
      return { type: 'not', operand: this.parseNot() };
    }
    return this.parseTerm();
  }

  private parseTerm(): Node {
    const t = this.peek();
    if (t.type === 'LPAREN') {
      this.next();
      const inner = this.parseOr();
      const close = this.peek();
      if (close.type !== 'RPAREN') {
        throw new NlqlParseError(
          `Expected ')' to close group at position ${close.start}`,
          close.start,
        );
      }
      this.next();
      return inner;
    }
    return this.parseComparison();
  }

  private parseComparison(): Node {
    const field = this.parseField();

    const t = this.peek();

    // field IS [NOT] EMPTY
    if (t.type === 'KEYWORD' && t.value === 'IS') {
      this.next();
      let negated = false;
      if (this.peekKeyword('NOT')) {
        this.next();
        negated = true;
      }
      const emptyTok = this.peek();
      if (emptyTok.type !== 'KEYWORD' || emptyTok.value !== 'EMPTY') {
        throw new NlqlParseError(
          `Expected EMPTY after IS${negated ? ' NOT' : ''} at position ${emptyTok.start}`,
          emptyTok.start,
        );
      }
      this.next();
      const node: IsEmptyNode = {
        type: 'isEmpty',
        field,
        negated,
        position: t.start,
      };
      return node;
    }

    // field [NOT] IN (...)
    if (
      (t.type === 'KEYWORD' && t.value === 'IN') ||
      (t.type === 'KEYWORD' && t.value === 'NOT')
    ) {
      let negated = false;
      let inTok = t;
      if (t.value === 'NOT') {
        this.next();
        inTok = this.peek();
        if (inTok.type !== 'KEYWORD' || inTok.value !== 'IN') {
          throw new NlqlParseError(
            `Expected IN after NOT at position ${inTok.start}`,
            inTok.start,
          );
        }
        negated = true;
      }
      this.next(); // consume IN
      const open = this.peek();
      if (open.type !== 'LPAREN') {
        throw new NlqlParseError(
          `Expected '(' after IN at position ${open.start}`,
          open.start,
        );
      }
      this.next();
      const values: ValueNode[] = [];
      if (this.peek().type === 'RPAREN') {
        throw new NlqlParseError(
          `IN list cannot be empty at position ${this.peek().start}`,
          this.peek().start,
        );
      }
      values.push(this.parseValue());
      while (this.peek().type === 'COMMA') {
        this.next();
        values.push(this.parseValue());
      }
      const close = this.peek();
      if (close.type !== 'RPAREN') {
        throw new NlqlParseError(
          `Expected ',' or ')' in IN list at position ${close.start}`,
          close.start,
        );
      }
      this.next();
      const node: InNode = {
        type: 'in',
        field,
        negated,
        values,
        position: inTok.start,
      };
      return node;
    }

    // field op value
    if (t.type === 'OP' && COMPARISON_OPS.has(t.value as ComparisonOp)) {
      this.next();
      const value = this.parseValueAfterOp(t.value as ComparisonOp, t.start);
      const node: ComparisonNode = {
        type: 'comparison',
        field,
        op: t.value as ComparisonOp,
        value,
        position: t.start,
      };
      return node;
    }

    throw new NlqlParseError(
      `Expected an operator after field '${field.name}' but found ${describe(t)} at position ${t.start}`,
      t.start,
    );
  }

  private parseField(): FieldNode {
    const t = this.peek();
    if (t.type === 'STRING') {
      this.next();
      return { name: t.value, quoted: true, position: t.start };
    }
    if (t.type === 'IDENT') {
      this.next();
      return { name: t.value, quoted: false, position: t.start };
    }
    throw new NlqlParseError(
      `Expected a field name but found ${describe(t)} at position ${t.start}`,
      t.start,
    );
  }

  private parseValueAfterOp(op: ComparisonOp, opPos: number): ValueNode {
    const t = this.peek();
    if (
      t.type === 'STRING' ||
      t.type === 'NUMBER' ||
      t.type === 'IDENT' ||
      (t.type === 'KEYWORD' && (t.value === 'TRUE' || t.value === 'FALSE'))
    ) {
      return this.parseValue();
    }
    throw new NlqlParseError(
      `Expected a value after '${op}' at position ${opPos}`,
      opPos,
    );
  }

  private parseValue(): ValueNode {
    const t = this.peek();

    if (t.type === 'STRING') {
      this.next();
      return { kind: 'string', value: t.value };
    }
    if (t.type === 'NUMBER') {
      this.next();
      return { kind: 'number', value: Number(t.value) };
    }
    if (t.type === 'KEYWORD' && (t.value === 'TRUE' || t.value === 'FALSE')) {
      this.next();
      return { kind: 'boolean', value: t.value === 'TRUE' };
    }
    if (t.type === 'IDENT') {
      this.next();
      // Function call?  name '(' ')'
      if (this.peek().type === 'LPAREN') {
        this.next();
        const close = this.peek();
        if (close.type !== 'RPAREN') {
          throw new NlqlParseError(
            `Functions take no arguments; expected ')' at position ${close.start}`,
            close.start,
          );
        }
        this.next();
        if (!FUNCTION_NAMES.has(t.value as FunctionName)) {
          throw new NlqlParseError(
            `Unknown function '${t.value}()' at position ${t.start}`,
            t.start,
          );
        }
        return { kind: 'function', name: t.value as FunctionName };
      }
      // Bare word literals true/false also accepted lowercase as words → coerce.
      const lower = t.value.toLowerCase();
      if (lower === 'true') return { kind: 'boolean', value: true };
      if (lower === 'false') return { kind: 'boolean', value: false };
      return { kind: 'word', value: t.value };
    }

    throw new NlqlParseError(
      `Expected a value but found ${describe(t)} at position ${t.start}`,
      t.start,
    );
  }

  private parseOptionalOrderBy(): OrderBy | null {
    if (!this.isOrderByAhead()) return null;
    this.next(); // ORDER
    const by = this.peek();
    if (by.type !== 'KEYWORD' || by.value !== 'BY') {
      throw new NlqlParseError(
        `Expected BY after ORDER at position ${by.start}`,
        by.start,
      );
    }
    this.next(); // BY
    const field = this.parseField();
    let direction: SortDirection = 'ASC';
    const dir = this.peek();
    if (dir.type === 'KEYWORD' && (dir.value === 'ASC' || dir.value === 'DESC')) {
      direction = dir.value;
      this.next();
    }
    return { field, direction };
  }

  private peekKeyword(kw: string): boolean {
    const t = this.peek();
    return t.type === 'KEYWORD' && t.value === kw;
  }
}

function describe(t: Token): string {
  switch (t.type) {
    case 'EOF':
      return 'end of input';
    case 'STRING':
      return `string "${t.value}"`;
    case 'NUMBER':
      return `number ${t.value}`;
    case 'KEYWORD':
      return `keyword ${t.value}`;
    case 'OP':
      return `operator '${t.value}'`;
    case 'LPAREN':
      return "'('";
    case 'RPAREN':
      return "')'";
    case 'COMMA':
      return "','";
    default:
      return `'${t.value}'`;
  }
}

/**
 * Parse a NLQL query string into a typed {@link Query} AST.
 * @throws {NlqlParseError} on any syntax error.
 */
export function parse(source: string): Query {
  const tokens = tokenize(source);
  return new Parser(tokens).parseQuery();
}
