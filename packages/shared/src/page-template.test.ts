import { describe, expect, it } from 'vitest';
import {
  PAGE_TEMPLATE_STARTERS,
  PAGE_TEMPLATE_TOKENS,
  renderPageTemplate,
  usedPageTemplateTokens,
} from './index';

/** 2026-07-30 14:05 LOCAL time, whatever zone the test runs in. */
const NOW = new Date(2026, 6, 30, 14, 5, 0);
const ctx = { title: 'My Page', author: 'Ada Lovelace', now: NOW };

describe('renderPageTemplate', () => {
  it('substitutes every documented token', () => {
    const body = PAGE_TEMPLATE_TOKENS.map((t) => `${t.token}={{${t.token}}}`).join('\n');
    const out = renderPageTemplate(body, ctx);
    expect(out).toBe(
      [
        'title=My Page',
        'date=2026-07-30',
        'time=14:05',
        'datetime=2026-07-30 14:05',
        'year=2026',
        'month=07',
        'day=30',
        'author=Ada Lovelace',
      ].join('\n'),
    );
    expect(out).not.toContain('{{');
  });

  it('tolerates whitespace inside the braces and is case-insensitive', () => {
    expect(renderPageTemplate('{{ date }} {{DATE}} {{Date}}', ctx)).toBe(
      '2026-07-30 2026-07-30 2026-07-30',
    );
  });

  it('leaves an UNKNOWN token verbatim rather than blanking it', () => {
    // A fill-me-in marker must survive: silently deleting it would destroy
    // content with no signal to the author.
    expect(renderPageTemplate('Hi {{customer}}, on {{date}}', ctx)).toBe(
      'Hi {{customer}}, on 2026-07-30',
    );
  });

  it('leaves non-token brace syntax alone', () => {
    const body = 'a {{}} b {{ 1 + 1 }} c {{foo-bar}} d {{ }}';
    expect(renderPageTemplate(body, ctx)).toBe(body);
  });

  it('uses LOCAL date parts, not a UTC ISO slice', () => {
    // 21:00 local on the 30th. Slicing toISOString() in a negative-offset zone
    // would date this the 31st — a meeting note stamped tomorrow.
    const late = new Date(2026, 6, 30, 21, 0, 0);
    expect(renderPageTemplate('{{date}}', { ...ctx, now: late })).toBe('2026-07-30');
  });

  it('zero-pads month and day', () => {
    const early = new Date(2026, 0, 5, 9, 7, 0);
    expect(renderPageTemplate('{{date}} {{time}}', { ...ctx, now: early })).toBe(
      '2026-01-05 09:07',
    );
  });

  it('is a plain substitution — a token whose VALUE looks like a token is not re-expanded', () => {
    // Guards against a naive repeated-replace implementation: a page titled
    // "{{author}}" must render literally, not resolve to the author's name.
    expect(renderPageTemplate('{{title}}', { ...ctx, title: '{{author}}' })).toBe(
      '{{author}}',
    );
  });

  it('returns the body unchanged when there are no tokens', () => {
    expect(renderPageTemplate('# Just markdown\n\n- a\n', ctx)).toBe(
      '# Just markdown\n\n- a\n',
    );
  });

  it('handles an empty body', () => {
    expect(renderPageTemplate('', ctx)).toBe('');
  });
});

describe('usedPageTemplateTokens', () => {
  it('reports known tokens deduped in first-use order', () => {
    const { known, unknown } = usedPageTemplateTokens('{{date}} {{author}} {{date}}');
    expect(known).toEqual(['date', 'author']);
    expect(unknown).toEqual([]);
  });

  it('separates unknown tokens so the editor can warn before they ship', () => {
    const { known, unknown } = usedPageTemplateTokens('{{date}} {{sprint}} {{sprint}}');
    expect(known).toEqual(['date']);
    expect(unknown).toEqual(['sprint']);
  });
});

describe('PAGE_TEMPLATE_STARTERS', () => {
  it('have unique names (the workspace unique index would reject a clash at seed time)', () => {
    const names = PAGE_TEMPLATE_STARTERS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('use only KNOWN tokens — an unknown one would ship literal {{braces}} into every page', () => {
    for (const s of PAGE_TEMPLATE_STARTERS) {
      const body = usedPageTemplateTokens(s.content);
      expect({ name: s.name, unknown: body.unknown }).toEqual({
        name: s.name,
        unknown: [],
      });
      const title = usedPageTemplateTokens(s.titleTemplate);
      expect({ name: s.name, unknown: title.unknown }).toEqual({
        name: s.name,
        unknown: [],
      });
    }
  });

  it('render to titles with no wiki-link-breaking characters', () => {
    // Page titles may not contain [ ] | — a starter that produced one would
    // create a page no [[wiki-link]] could ever address.
    for (const s of PAGE_TEMPLATE_STARTERS) {
      const rendered = renderPageTemplate(s.titleTemplate, { ...ctx, title: '' }).trim();
      expect({ name: s.name, ok: /^[^[\]|]*$/.test(rendered) }).toEqual({
        name: s.name,
        ok: true,
      });
    }
  });

  it('avoid GFM task lists, which this app’s renderer cannot display', () => {
    // `MarkdownRenderer` omits `input` from DOMPurify's ALLOWED_TAGS, so a
    // `- [ ]` bullet renders as a literal "[ ]" next to a bullet rather than a
    // checkbox. Starters must look right in the renderer we actually ship.
    for (const s of PAGE_TEMPLATE_STARTERS) {
      expect({ name: s.name, hasTaskList: /^[-*]\s+\[[ xX]\]/m.test(s.content) }).toEqual({
        name: s.name,
        hasTaskList: false,
      });
    }
  });

  it('every starter has a non-empty description and body', () => {
    for (const s of PAGE_TEMPLATE_STARTERS) {
      expect(s.description.trim().length).toBeGreaterThan(0);
      expect(s.content.trim().length).toBeGreaterThan(0);
    }
  });
});
