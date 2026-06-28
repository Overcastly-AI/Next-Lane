/**
 * NLQL (Next Lane Query Language) tokenizer.
 *
 * Converts a raw query string into a flat list of tokens with source
 * positions. The tokenizer is intentionally dumb: it recognizes lexical
 * shapes (strings, numbers, operators, identifiers, keywords) but makes no
 * grammatical decisions — that is the parser's job.
 *
 * Security note: the tokenizer never builds a RegExp from user input and never
 * does dynamic property access, so it cannot be used as a ReDoS or
 * prototype-pollution vector.
 */

/** A structured parse/lex error carrying a friendly message and source position. */
export class NlqlParseError extends Error {
  /** Zero-based index into the source string where the problem occurred. */
  readonly position: number;

  constructor(message: string, position: number) {
    super(message);
    this.name = 'NlqlParseError';
    this.position = position;
    // Restore prototype chain (TS targeting ES5/ES2015 down-levels can break instanceof).
    Object.setPrototypeOf(this, NlqlParseError.prototype);
  }
}

export type TokenType =
  | 'IDENT' // bare identifier / bare word (field name or value)
  | 'STRING' // quoted string literal (single or double quotes)
  | 'NUMBER' // numeric literal
  | 'OP' // comparison operator: = != > >= < <= ~ !~
  | 'LPAREN'
  | 'RPAREN'
  | 'COMMA'
  | 'KEYWORD' // AND OR NOT IN IS EMPTY ORDER BY ASC DESC (normalized upper-case)
  | 'EOF';

export interface Token {
  type: TokenType;
  /** The literal source text (for STRING this is the *unquoted* value). */
  value: string;
  /** Start index in the source string (zero-based). */
  start: number;
  /** End index (exclusive) in the source string. */
  end: number;
}

/** Keywords recognized by NLQL. Matching is case-insensitive; stored upper-case. */
const KEYWORDS = new Set([
  'AND',
  'OR',
  'NOT',
  'IN',
  'IS',
  'EMPTY',
  'ORDER',
  'BY',
  'ASC',
  'DESC',
  'TRUE',
  'FALSE',
]);

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isIdentStart(ch: string): boolean {
  // Letters, underscore. Field keys/aliases are ASCII identifiers.
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function isIdentPart(ch: string): boolean {
  // Allow dots and hyphens inside bare words so keys like "story-points" or
  // ids/keys like "NL-12" tokenize as a single bare word.
  return isIdentStart(ch) || isDigit(ch) || ch === '.' || ch === '-';
}

/**
 * Tokenize a NLQL source string.
 * @throws {NlqlParseError} on an unterminated string or an unexpected character.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const n = source.length;
  let i = 0;

  while (i < n) {
    const ch = source[i];

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f') {
      i++;
      continue;
    }

    // Parentheses / comma
    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: '(', start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ')', start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ type: 'COMMA', value: ',', start: i, end: i + 1 });
      i++;
      continue;
    }

    // Quoted strings (single or double). Supports backslash escapes for the
    // quote char and backslash itself.
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      i++; // consume opening quote
      let out = '';
      let closed = false;
      while (i < n) {
        const c = source[i];
        if (c === '\\' && i + 1 < n) {
          const next = source[i + 1];
          if (next === quote || next === '\\') {
            out += next;
            i += 2;
            continue;
          }
          // Unknown escape: keep the backslash literally.
          out += c;
          i++;
          continue;
        }
        if (c === quote) {
          closed = true;
          i++; // consume closing quote
          break;
        }
        out += c;
        i++;
      }
      if (!closed) {
        throw new NlqlParseError(
          `Unterminated quoted string starting at position ${start}`,
          start,
        );
      }
      tokens.push({ type: 'STRING', value: out, start, end: i });
      continue;
    }

    // Operators
    if (ch === '=') {
      tokens.push({ type: 'OP', value: '=', start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === '!') {
      if (source[i + 1] === '=') {
        tokens.push({ type: 'OP', value: '!=', start: i, end: i + 2 });
        i += 2;
        continue;
      }
      if (source[i + 1] === '~') {
        tokens.push({ type: 'OP', value: '!~', start: i, end: i + 2 });
        i += 2;
        continue;
      }
      throw new NlqlParseError(
        `Unexpected '!' at position ${i}; did you mean '!=' or '!~'?`,
        i,
      );
    }
    if (ch === '>') {
      if (source[i + 1] === '=') {
        tokens.push({ type: 'OP', value: '>=', start: i, end: i + 2 });
        i += 2;
        continue;
      }
      tokens.push({ type: 'OP', value: '>', start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === '<') {
      if (source[i + 1] === '=') {
        tokens.push({ type: 'OP', value: '<=', start: i, end: i + 2 });
        i += 2;
        continue;
      }
      tokens.push({ type: 'OP', value: '<', start: i, end: i + 1 });
      i++;
      continue;
    }
    if (ch === '~') {
      tokens.push({ type: 'OP', value: '~', start: i, end: i + 1 });
      i++;
      continue;
    }

    // Numbers: optional leading '-', digits, optional fractional part.
    // A leading '-' is only treated as part of a number when followed by a
    // digit; otherwise '-' is an identifier part handled below.
    if (isDigit(ch) || (ch === '-' && isDigit(source[i + 1] ?? ''))) {
      const start = i;
      if (ch === '-') i++;
      while (i < n && isDigit(source[i])) i++;
      if (source[i] === '.' && isDigit(source[i + 1] ?? '')) {
        i++; // consume '.'
        while (i < n && isDigit(source[i])) i++;
      }
      tokens.push({
        type: 'NUMBER',
        value: source.slice(start, i),
        start,
        end: i,
      });
      continue;
    }

    // Identifiers / keywords / bare words
    if (isIdentStart(ch)) {
      const start = i;
      while (i < n && isIdentPart(source[i])) i++;
      const raw = source.slice(start, i);
      const upper = raw.toUpperCase();
      if (KEYWORDS.has(upper)) {
        tokens.push({ type: 'KEYWORD', value: upper, start, end: i });
      } else {
        tokens.push({ type: 'IDENT', value: raw, start, end: i });
      }
      continue;
    }

    throw new NlqlParseError(`Unexpected character '${ch}' at position ${i}`, i);
  }

  tokens.push({ type: 'EOF', value: '', start: n, end: n });
  return tokens;
}
