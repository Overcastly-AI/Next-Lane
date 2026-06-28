import { describe, expect, it } from 'vitest';
import { parse } from './parser';
import { NlqlParseError } from './tokenizer';
import type { AndNode, ComparisonNode, InNode, OrNode } from './ast';

describe('parser', () => {
  it('parses an empty query as match-everything', () => {
    const q = parse('');
    expect(q.where).toBeNull();
    expect(q.orderBy).toBeNull();
  });

  it('parses a single comparison', () => {
    const q = parse('status = Done');
    expect(q.where).toMatchObject({
      type: 'comparison',
      field: { name: 'status', quoted: false },
      op: '=',
      value: { kind: 'word', value: 'Done' },
    });
  });

  it('parses quoted field as a custom field reference', () => {
    const q = parse('"Severity" = high');
    const c = q.where as ComparisonNode;
    expect(c.field).toMatchObject({ name: 'Severity', quoted: true });
  });

  it('AND binds tighter than OR', () => {
    // a = 1 OR b = 2 AND c = 3  ==>  a=1 OR (b=2 AND c=3)
    const q = parse('a = 1 OR b = 2 AND c = 3');
    const or = q.where as OrNode;
    expect(or.type).toBe('or');
    expect(or.clauses).toHaveLength(2);
    expect(or.clauses[0]).toMatchObject({ type: 'comparison' });
    expect(or.clauses[1].type).toBe('and');
    expect((or.clauses[1] as AndNode).clauses).toHaveLength(2);
  });

  it('parentheses override precedence', () => {
    const q = parse('(a = 1 OR b = 2) AND c = 3');
    const and = q.where as AndNode;
    expect(and.type).toBe('and');
    expect(and.clauses[0].type).toBe('or');
  });

  it('parses NOT', () => {
    const q = parse('NOT status = Done');
    expect(q.where).toMatchObject({
      type: 'not',
      operand: { type: 'comparison' },
    });
  });

  it('parses IN lists', () => {
    const q = parse('type IN (BUG, TASK, STORY)');
    const node = q.where as InNode;
    expect(node.type).toBe('in');
    expect(node.negated).toBe(false);
    expect(node.values).toHaveLength(3);
    expect(node.values[0]).toMatchObject({ kind: 'word', value: 'BUG' });
  });

  it('parses NOT IN lists', () => {
    const q = parse('type NOT IN (BUG)');
    const node = q.where as InNode;
    expect(node.type).toBe('in');
    expect(node.negated).toBe(true);
  });

  it('parses IS EMPTY and IS NOT EMPTY', () => {
    expect(parse('assignee IS EMPTY').where).toMatchObject({
      type: 'isEmpty',
      negated: false,
    });
    expect(parse('assignee IS NOT EMPTY').where).toMatchObject({
      type: 'isEmpty',
      negated: true,
    });
  });

  it('parses function-call values', () => {
    const q = parse('assignee = me()');
    expect(q.where).toMatchObject({
      type: 'comparison',
      value: { kind: 'function', name: 'me' },
    });
  });

  it('parses true/false booleans', () => {
    const q = parse('"flag" = true');
    expect(q.where).toMatchObject({ value: { kind: 'boolean', value: true } });
  });

  it('parses ORDER BY with default ASC', () => {
    const q = parse('status = Done ORDER BY priority');
    expect(q.orderBy).toMatchObject({
      field: { name: 'priority' },
      direction: 'ASC',
    });
  });

  it('parses ORDER BY DESC', () => {
    const q = parse('status = Done ORDER BY priority DESC');
    expect(q.orderBy?.direction).toBe('DESC');
  });

  it('parses a bare ORDER BY with no where clause', () => {
    const q = parse('ORDER BY created DESC');
    expect(q.where).toBeNull();
    expect(q.orderBy).toMatchObject({ field: { name: 'created' }, direction: 'DESC' });
  });

  describe('parse errors', () => {
    it('friendly message: missing value after operator', () => {
      try {
        parse('status =');
        throw new Error('should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(NlqlParseError);
        expect((e as NlqlParseError).message).toMatch(/Expected a value after '='/);
      }
    });

    it('friendly message: missing operator', () => {
      expect(() => parse('status Done')).toThrow(/Expected an operator/);
    });

    it('friendly message: unbalanced parens', () => {
      expect(() => parse('(a = 1')).toThrow(/Expected '\)'/);
    });

    it('friendly message: empty IN list', () => {
      expect(() => parse('type IN ()')).toThrow(/IN list cannot be empty/);
    });

    it('friendly message: IS without EMPTY', () => {
      expect(() => parse('assignee IS')).toThrow(/Expected EMPTY/);
    });

    it('friendly message: unknown function', () => {
      expect(() => parse('assignee = bogus()')).toThrow(/Unknown function 'bogus\(\)'/);
    });

    it('carries a position', () => {
      try {
        parse('status =');
        throw new Error('should throw');
      } catch (e) {
        expect((e as NlqlParseError).position).toBe(7);
      }
    });
  });
});
