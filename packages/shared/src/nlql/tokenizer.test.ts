import { describe, expect, it } from 'vitest';
import { NlqlParseError, tokenize, type Token } from './tokenizer';

function types(tokens: Token[]): string[] {
  return tokens.map((t) => t.type);
}

describe('tokenizer', () => {
  it('tokenizes a simple comparison', () => {
    const t = tokenize('status = Done');
    expect(types(t)).toEqual(['IDENT', 'OP', 'IDENT', 'EOF']);
    expect(t[0]).toMatchObject({ type: 'IDENT', value: 'status', start: 0, end: 6 });
    expect(t[1]).toMatchObject({ type: 'OP', value: '=' });
    expect(t[2]).toMatchObject({ type: 'IDENT', value: 'Done' });
  });

  it('records source positions', () => {
    const t = tokenize('a = 1');
    expect(t[0].start).toBe(0);
    expect(t[1].start).toBe(2);
    expect(t[2].start).toBe(4);
  });

  it('handles double-quoted strings (with the quotes stripped)', () => {
    const t = tokenize('"Custom Field" = "hello world"');
    expect(t[0]).toMatchObject({ type: 'STRING', value: 'Custom Field' });
    expect(t[2]).toMatchObject({ type: 'STRING', value: 'hello world' });
  });

  it('handles single-quoted strings', () => {
    const t = tokenize("title ~ 'bug fix'");
    expect(t[2]).toMatchObject({ type: 'STRING', value: 'bug fix' });
  });

  it('handles escaped quotes inside strings', () => {
    const t = tokenize('title = "say \\"hi\\""');
    expect(t[2].value).toBe('say "hi"');
  });

  it('tokenizes integers and decimals and negatives', () => {
    const t = tokenize('points >= 3 AND points < -2.5');
    const nums = t.filter((x) => x.type === 'NUMBER').map((x) => x.value);
    expect(nums).toEqual(['3', '-2.5']);
  });

  it('tokenizes all comparison operators', () => {
    const t = tokenize('= != > >= < <= ~ !~');
    expect(t.filter((x) => x.type === 'OP').map((x) => x.value)).toEqual([
      '=',
      '!=',
      '>',
      '>=',
      '<',
      '<=',
      '~',
      '!~',
    ]);
  });

  it('normalizes keywords case-insensitively', () => {
    const t = tokenize('a = 1 and b = 2 Or c = 3 not d is empty');
    const kws = t.filter((x) => x.type === 'KEYWORD').map((x) => x.value);
    expect(kws).toEqual(['AND', 'OR', 'NOT', 'IS', 'EMPTY']);
  });

  it('recognizes ORDER BY ASC DESC IN IS keywords', () => {
    const t = tokenize('ORDER BY priority DESC');
    expect(t.filter((x) => x.type === 'KEYWORD').map((x) => x.value)).toEqual([
      'ORDER',
      'BY',
      'DESC',
    ]);
  });

  it('tokenizes parens and commas for IN lists', () => {
    const t = tokenize('type IN (BUG, TASK)');
    expect(types(t)).toEqual([
      'IDENT',
      'KEYWORD',
      'LPAREN',
      'IDENT',
      'COMMA',
      'IDENT',
      'RPAREN',
      'EOF',
    ]);
  });

  it('allows dotted and hyphenated bare words', () => {
    const t = tokenize('key = NL-12');
    expect(t[2]).toMatchObject({ type: 'IDENT', value: 'NL-12' });
  });

  it('throws on an unterminated string with a position', () => {
    try {
      tokenize('title = "oops');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(NlqlParseError);
      expect((e as NlqlParseError).position).toBe(8);
    }
  });

  it('throws on an unexpected character', () => {
    expect(() => tokenize('a = @b')).toThrow(NlqlParseError);
  });

  it('emits an EOF token at the end', () => {
    const t = tokenize('a = 1');
    expect(t[t.length - 1].type).toBe('EOF');
  });
});
