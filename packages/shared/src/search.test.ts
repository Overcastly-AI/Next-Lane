import { describe, expect, it } from 'vitest';
import {
  SEARCH_GROUPS,
  SEARCH_HIGHLIGHT_END,
  SEARCH_HIGHLIGHT_START,
  splitSearchHighlight,
  stripSearchHighlight,
} from './search';

const S = SEARCH_HIGHLIGHT_START;
const E = SEARCH_HIGHLIGHT_END;

describe('search highlight delimiters', () => {
  it('are Private Use Area code points, not markup', () => {
    expect(S).toBe('\uE000');
    expect(E).toBe('\uE001');
    // The whole point: nothing here can be parsed as HTML or markdown.
    expect(S + E).not.toMatch(/[<>*_[\]]/);
  });
});

describe('splitSearchHighlight', () => {
  it('splits a snippet into context and highlighted runs', () => {
    expect(splitSearchHighlight(`we cap the API via ${S}rate limiting${E} here`)).toEqual([
      { text: 'we cap the API via ', highlight: false },
      { text: 'rate limiting', highlight: true },
      { text: ' here', highlight: false },
    ]);
  });

  it('handles multiple matches and a leading match', () => {
    expect(splitSearchHighlight(`${S}a${E} b ${S}c${E}`)).toEqual([
      { text: 'a', highlight: true },
      { text: ' b ', highlight: false },
      { text: 'c', highlight: true },
    ]);
  });

  it('returns a single context segment when there is nothing highlighted', () => {
    expect(splitSearchHighlight('plain excerpt')).toEqual([
      { text: 'plain excerpt', highlight: false },
    ]);
  });

  it('returns nothing for an empty snippet', () => {
    expect(splitSearchHighlight('')).toEqual([]);
  });

  it('degrades gracefully on an unpaired delimiter, never emitting it', () => {
    // A user CAN type U+E000 into a page body. The worst case must be a
    // cosmetic oddity, never a stray control character reaching the DOM.
    const segments = splitSearchHighlight(`dangling ${S}start only`);
    expect(segments.map((s) => s.text).join('')).toBe('dangling start only');
    for (const seg of segments) {
      expect(seg.text).not.toContain(S);
      expect(seg.text).not.toContain(E);
    }
  });

  it('never emits a delimiter in any segment of a well-formed snippet', () => {
    for (const seg of splitSearchHighlight(`x ${S}y${E} z`)) {
      expect(seg.text).not.toContain(S);
      expect(seg.text).not.toContain(E);
    }
  });
});

describe('stripSearchHighlight', () => {
  it('removes both delimiters', () => {
    expect(stripSearchHighlight(`${S}Stripe${E} it is`)).toBe('Stripe it is');
  });

  it('is a no-op on plain text', () => {
    expect(stripSearchHighlight('nothing to strip')).toBe('nothing to strip');
  });
});

describe('SEARCH_GROUPS', () => {
  it('lists every group `GET /search` can return', () => {
    expect([...SEARCH_GROUPS]).toEqual(['issues', 'pages', 'projects', 'comments']);
  });
});
