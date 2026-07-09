import { describe, expect, it } from 'vitest';
import { parseWikiLinks } from './wikilink';

describe('parseWikiLinks', () => {
  it('returns an empty array for content with no links', () => {
    expect(parseWikiLinks('Just plain markdown, no links here.')).toEqual([]);
  });

  it('returns an empty array for empty/undefined content', () => {
    expect(parseWikiLinks('')).toEqual([]);
  });

  it('parses a single bare wiki-link', () => {
    expect(parseWikiLinks('See [[Onboarding Guide]] for details.')).toEqual([
      { title: 'Onboarding Guide' },
    ]);
  });

  it('parses a wiki-link with an alias', () => {
    expect(parseWikiLinks('See [[Onboarding Guide|the guide]].')).toEqual([
      { title: 'Onboarding Guide', alias: 'the guide' },
    ]);
  });

  it('parses multiple links in source order', () => {
    const md = 'First [[Page A]], then [[Page B|B]], then [[Page A]] again.';
    expect(parseWikiLinks(md)).toEqual([
      { title: 'Page A' },
      { title: 'Page B', alias: 'B' },
      { title: 'Page A' },
    ]);
  });

  it('trims surrounding whitespace from title and alias', () => {
    expect(parseWikiLinks('[[  Spacey Title  |  Spacey Alias  ]]')).toEqual([
      { title: 'Spacey Title', alias: 'Spacey Alias' },
    ]);
  });

  it('skips an empty or whitespace-only title', () => {
    expect(parseWikiLinks('[[]] and [[   ]] should be skipped')).toEqual([]);
  });

  it('does not choke on unmatched/malformed brackets', () => {
    expect(parseWikiLinks('[[unterminated')).toEqual([]);
    expect(parseWikiLinks('unopened]]')).toEqual([]);
    expect(parseWikiLinks('[single] not a wikilink')).toEqual([]);
  });

  it('resolves the innermost well-formed pair for nested brackets', () => {
    expect(parseWikiLinks('[[outer [[inner]] tail]]')).toEqual([
      { title: 'inner' },
    ]);
  });

  it('is a pure syntax extractor — an unresolved title is still returned', () => {
    // Resolution against real pages is the CALLER's job (documented in the
    // module header); the parser has no concept of "does this page exist".
    expect(parseWikiLinks('[[Not Created Yet]]')).toEqual([
      { title: 'Not Created Yet' },
    ]);
  });

  it('handles links inside a larger document with other markdown syntax', () => {
    const md = `# Title\n\n- item referencing [[Related Page]]\n\n> quote linking [[Another Page|alias]]\n`;
    expect(parseWikiLinks(md)).toEqual([
      { title: 'Related Page' },
      { title: 'Another Page', alias: 'alias' },
    ]);
  });

  it('does not treat a pipe outside brackets as part of a link', () => {
    expect(parseWikiLinks('a | b [[Real Link]]')).toEqual([
      { title: 'Real Link' },
    ]);
  });

  it('is stateless across repeated calls (no shared regex lastIndex bugs)', () => {
    const first = parseWikiLinks('[[A]]');
    const second = parseWikiLinks('[[B]]');
    expect(first).toEqual([{ title: 'A' }]);
    expect(second).toEqual([{ title: 'B' }]);
  });
});
