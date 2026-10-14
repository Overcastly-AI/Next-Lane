// @vitest-environment jsdom
/**
 * Round-trip suite: markdown -> editor -> markdown.
 *
 * Storage is markdown (server parses `[[wiki-links]]` / `@mentions`, search
 * indexes the text, MCP agents read it, MarkdownRenderer renders it), so the
 * editor must never change what any of those see. Every corpus entry must:
 *   1. render IDENTICALLY through MarkdownRenderer's pipeline,
 *   2. yield the SAME `[[links]]` (shared `parseWikiLinks`, i.e. the server's),
 *   3. yield the SAME `@mentions` (the server's regex),
 *   4. be a fixed point (round-tripping the output changes nothing).
 * Entries marked `exact` must additionally come back byte-for-byte.
 */
import { describe, expect, it } from 'vitest';
import { parseWikiLinks } from '@next-lane/shared';
import { renderMarkdown } from '@/components/ui/MarkdownRenderer';
import { Editor } from '@tiptap/core';
import { createMarkdownExtensions } from './extensions';
import { editorToMarkdown, roundTripMarkdown as rt } from './markdownRoundTrip';

/** The API's mention parser (NotificationsService.resolveMentions), verbatim. */
function mentions(body: string): string[] {
  const re = /@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.push(m[1].toLowerCase());
  return out;
}

const norm = (html: string) => html.replace(/>\s+</g, '><').replace(/\s+$/g, '');

interface Case {
  name: string;
  md: string;
  /** Byte-for-byte; omit when only render/parser equivalence is promised. */
  exact?: boolean;
}

const CORPUS: Case[] = [
  // ── inline formatting ──────────────────────────────────────────────────
  { name: 'headings 1-6', md: '# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six', exact: true },
  { name: 'heading with inline marks', md: '## Ship `v2` **now** and *later*', exact: true },
  { name: 'bold / italic / strike / code', md: 'a **bold** b *italic* c ~~strike~~ d `code` e', exact: true },
  { name: 'nested marks', md: '**bold *and italic* text** and **~~struck bold~~** and ***both***', exact: true },
  { name: 'underscore emphasis normalises to star', md: 'an _emphasised_ word and __strong__ one' },
  { name: 'link with title', md: 'see [docs](https://example.com/a?b=1 "The docs") now', exact: true },
  { name: 'bare url autolink', md: 'visit https://example.com/path_with_underscores today', exact: true },
  { name: 'angle autolink', md: 'mail <me@example.com> or <https://example.com>', exact: true },
  { name: 'reference-style link', md: '[a][ref] and [b]\n\n[ref]: http://x.com' },
  { name: 'escaped markdown chars', md: 'a\\_b \\*not em\\* \\# \\[x\\] \\`tick\\`' },
  { name: 'backslash before punctuation', md: 'path C:\\\\dir and \\\\n' },
  // ── blocks ─────────────────────────────────────────────────────────────
  { name: 'bullet list', md: '- a\n- b\n- c', exact: true },
  { name: 'ordered list', md: '1. one\n2. two\n3. three', exact: true },
  { name: 'ordered list start number', md: '5. five\n6. six', exact: true },
  { name: 'nested bullets', md: '- a\n  - b\n    - c\n- d', exact: true },
  { name: 'ordered in bullet in ordered', md: '1. a\n   - b\n     1. c\n2. d', exact: true },
  { name: 'mixed nesting', md: '- a\n  1. b\n  2. c\n- d', exact: true },
  { name: 'loose list', md: '- a\n\n- b\n\n- c' },
  { name: 'list item with code block', md: '- a\n\n  ```js\n  x()\n  ```\n\n- b' },
  { name: 'task list', md: '- [ ] todo\n- [x] done', exact: true },
  { name: 'nested task list', md: '- [ ] parent\n  - [x] child\n  - [ ] child 2', exact: true },
  { name: 'GFM table (columns get padded)', md: '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |' },
  { name: 'GFM table canonical', md: '| a   | b   |\n| --- | --- |\n| 1   | 2   |', exact: true },
  { name: 'table alignment + inline', md: '| left | right |\n| :--- | ---: |\n| `x` | **b** |\n| [l](u) | pipe \\| here |' },
  { name: 'fenced code with language', md: '```ts\nconst a: number = 1;\nif (a < 2 && b > 1) {}\n```', exact: true },
  { name: 'fenced code without language', md: '```\nplain\n  indented\n```', exact: true },
  { name: 'code containing markdown chars', md: '```\n# not heading\n- not list\n[[not link]] _x_ *y*\n```', exact: true },
  { name: 'mermaid fence', md: '```mermaid\ngraph TD; A-->B;\n```', exact: true },
  { name: 'tilde fence normalises', md: '~~~py\nprint(1)\n~~~' },
  { name: 'indented code normalises', md: '    indented code\n    more' },
  { name: 'blockquote', md: '> quoted\n> more', exact: true },
  { name: 'nested blockquote with list', md: '> - item\n> - item 2\n>\n> > deeper' },
  { name: 'hr', md: 'above\n\n---\n\nbelow', exact: true },
  { name: 'setext headings normalise', md: 'Title\n=====\n\nSub\n---' },
  // ── images ─────────────────────────────────────────────────────────────
  { name: 'page image reference', md: '![screenshot.png](nl-image:cm0abcd1234)', exact: true },
  { name: 'image with title + inline image', md: '![alt](https://x.test/y.png "Title")\n\ntext ![i](nl-image:abc_DEF-9) more', exact: true },
  // ── product syntax ─────────────────────────────────────────────────────
  { name: 'wiki link', md: 'See [[Page Title]] for details', exact: true },
  { name: 'wiki link with alias', md: 'See [[Page Title|the page]] now', exact: true },
  { name: 'wiki link inside formatting', md: '**[[Bold Page]]** and `[[in code]]` and *[[It|alias]]*', exact: true },
  { name: 'mention inside formatting', md: '**@a@x.io** and *hi @b@x.io there*', exact: true },
  { name: 'linked image', md: '[![logo](https://x.test/l.png)](https://x.test)', exact: true },
  { name: 'wiki link with unusual chars', md: '[[Q3 2026 — Roadmap (draft)]] and [[a/b: c]]', exact: true },
  { name: 'cross-project wiki link', md: 'Linked to [[Shared Glossary]] owned by another project', exact: true },
  { name: 'adjacent wiki links', md: '[[A]][[B]] [[C|c]]', exact: true },
  { name: 'wiki link in list and quote', md: '- [[One]]\n- two [[Three|3]]\n\n> from [[Quote Page]]', exact: true },
  { name: 'unmatched brackets stay text', md: 'array[0] and [[unclosed and [single] and ]]stray' },
  { name: 'mention', md: 'ping @demo@nextlane.dev please', exact: true },
  { name: 'mention with underscores/dots/plus', md: '@first_last@sub.example.co.uk and @a.b+tag@x.io', exact: true },
  { name: 'mention at start, end, in list', md: '@a@x.io hi\n\n- @b@x.io\n- cc @c@x.io', exact: true },
  { name: 'mention next to punctuation', md: 'thanks @a@x.io, and @b@x.io.' },
  { name: 'mention in code stays code', md: 'use `@a@x.io` literally', exact: true },
  { name: 'plain email is not a mention', md: 'write to team@example.com today', exact: true },
  { name: 'issue keys', md: 'Fixes NL-12 and blocks ABC-7; see NL-1.', exact: true },
  { name: 'issue key at line start', md: 'NL-1\n\nNL-12 is done', exact: true },
  // ── text that must not be rewritten ───────────────────────────────────
  { name: 'underscores in words', md: 'snake_case_word and __dunder__init and my_var_name', },
  { name: 'underscores intraword exact', md: 'snake_case_word and my_var_name', exact: true },
  { name: 'hash numbers', md: 'see #123 and issue#45 and C# and a#b', exact: true },
  { name: 'asterisk math', md: '2*3*4 and 5 * 6 = 30 and a*b', },
  { name: 'literal asterisks spaced', md: 'a * b * c', exact: true },
  { name: 'angle brackets and ampersands', md: 'if a < b && c > d then x & y', exact: true },
  { name: 'named entity stays', md: 'copyright &copy; 2026 &mdash; ok', exact: true },
  { name: 'dollar, percent, tilde', md: 'cost $5 or 50% off, ~5 min, ~/path', exact: true },
  { name: 'pipes in text', md: 'a | b | c', exact: true },
  { name: 'emoji and unicode', md: 'Ship it 🚀 — naïve café 日本語', exact: true },
  { name: 'line-start text lookalikes', md: '\\# not a heading\n\n\\- not a list\n\n1\\. not ordered' },
  { name: 'literal brackets', md: 'see [1] and [note] and [ ] box', exact: true },
  // ── line breaks / spacing ──────────────────────────────────────────────
  { name: 'single newlines (breaks: true)', md: 'line one\nline two\nline three\n\nnew paragraph', exact: true },
  { name: 'two-space hard breaks', md: 'one  \ntwo  \nthree' },
  { name: 'multiple blank lines', md: 'a\n\n\n\nb' },
  { name: 'newline inside list item', md: '- item one\n  continues here\n- item two' },
  { name: 'newline inside quote', md: '> a\n> b\n> c', exact: true },
  { name: 'trailing newline', md: 'text\n' },
  // ── raw HTML (agents write it) ─────────────────────────────────────────
  { name: 'inline html', md: 'a <u>under</u> b <br> c <kbd>Ctrl</kbd> <!-- hidden --> d', exact: true },
  { name: 'block html details', md: '<details>\n<summary>More</summary>\n\nbody **b**\n\n</details>', exact: true },
  { name: 'block html div', md: '<div>\nhtml block\n</div>\n\nafter', exact: true },
  { name: 'html comment block', md: '<!-- note -->\n\ntext', exact: true },
  { name: 'lone br', md: '<br>', exact: true },
  { name: 'entity-encoded angle', md: 'literal &lt;b&gt; tags' },
  { name: 'table between paragraphs', md: 'before\n\n| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\nafter', exact: true },
  { name: 'raw <br> in a table cell', md: '| a   | b   |\n| --- | --- |\n| x<br>y | 2   |', },
  { name: 'chips in table cells', md: '| Page            | Owner   |\n| --------------- | ------- |\n| [[Auth Design]] | @a@x.io |', exact: true },
  { name: 'chips in headings and tasks', md: '## About [[Auth Design|auth]]\n\n- [ ] ask @a@x.io about [[Design]]', exact: true },
  { name: 'link text with brackets and underscores', md: '[my_file_name [v2]](https://x.test/a_b)' },
  { name: 'text that looks like a link but is not', md: 'f(x) = (a)[b] and ](oops) and [x]' },
  { name: 'emphasis around code and links', md: '*see `code` and [l](u)* and **[l2](u2)**', exact: true },
  { name: 'long line is not wrapped', md: 'word '.repeat(80).trim(), exact: true },
  { name: 'windows newlines', md: 'a\r\nb\r\n\r\nc' },
  { name: 'tabs in code', md: '```\n\tindented with tab\n```', exact: true },
  // ── real-world compound documents ──────────────────────────────────────
  {
    name: 'issue description template',
    md: '## Summary\n\nLogin fails on **Safari** for `demo@nextlane.dev`.\n\n## Steps\n\n1. Open /login\n2. Type credentials\n3. Press Enter\n\n## Expected\n\n- redirect to board\n- no console errors\n\n## Checklist\n\n- [ ] repro\n- [x] logs attached\n\nRelated: NL-12, [[Auth Design]], cc @demo@nextlane.dev',
    exact: true,
  },
  {
    name: 'wiki page with table and code',
    md: '# Runbook\n\nSee [[On-call|the on-call page]].\n\n| Service | Owner |\n| --- | --- |\n| api | @demo@nextlane.dev |\n| web | [[Frontend]] |\n\n```bash\npnpm test && pnpm build\n```\n\n> Never deploy on Fridays.\n\n---\n\n![diagram](nl-image:cm0xyz)',
  },
];

describe('markdown round-trip (editor never changes what the server/renderer see)', () => {
  for (const c of CORPUS) {
    describe(c.name, () => {
      const out = rt(c.md);
      it('renders identically through MarkdownRenderer', () => {
        expect(norm(renderMarkdown(out))).toBe(norm(renderMarkdown(c.md)));
      });
      it('yields the same [[wiki-links]] as the server parser', () => {
        expect(parseWikiLinks(out)).toEqual(parseWikiLinks(c.md));
      });
      it('yields the same @mentions as the server parser', () => {
        expect(mentions(out)).toEqual(mentions(c.md));
      });
      it('is a fixed point', () => {
        expect(rt(out)).toBe(out);
      });
      if (c.exact) {
        it('comes back byte-for-byte', () => {
          expect(out).toBe(c.md);
        });
      }
    });
  }
});

describe('mark nesting order', () => {
  it('~~**x**~~ becomes **~~x~~** (same text, same two marks)', () => {
    expect(rt('~~**struck bold**~~')).toBe('**~~struck bold~~**');
  });
});

describe('text authored in the editor (not parsed from markdown)', () => {
  // Characters a user types are literal text; they must serialize so that
  // parsing the result gives the same text back, without gratuitous escapes.
  const cases: Array<[string, string]> = [
    ['snake_case and #123 and NL-1', 'snake_case and #123 and NL-1'],
    ['a * b', 'a * b'],
    ['5*3*2', '5\\*3\\*2'],
    ['*star* typed literally', '\\*star\\* typed literally'],
    ['_under_ typed literally', '\\_under\\_ typed literally'],
    ['# not a heading', '\\# not a heading'],
    ['- not a list', '\\- not a list'],
    ['1. not a list', '1\\. not a list'],
    ['> not a quote', '\\> not a quote'],
    ['[[not a link yet', '[[not a link yet'],
    ['x < y > z', 'x < y > z'],
    ['<b>not html</b>', '&lt;b>not html&lt;/b>'],
    ['back\\slash \\n', 'back\\slash \\n'],
    ['end with backslash\\', 'end with backslash\\\\'],
    ['tick ` in text', 'tick \\` in text'],
  ];
  for (const [typed, expected] of cases) {
    it(`${JSON.stringify(typed)} -> ${JSON.stringify(expected)} and re-reads as the same text`, () => {
      const editor = new Editor({
        extensions: createMarkdownExtensions(),
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: typed }] }] },
      });
      const md = editorToMarkdown(editor);
      editor.destroy();
      expect(md).toBe(expected);
      const back = new Editor({ extensions: createMarkdownExtensions(), content: md, contentType: 'markdown' });
      const text = back.getText();
      back.destroy();
      expect(text).toBe(typed);
    });
  }
});

describe('hard break inside a table cell', () => {
  it('cannot split the row', () => {
    const editor = new Editor({
      extensions: createMarkdownExtensions(),
      content: {
        type: 'doc',
        content: [
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'h' }] }] },
                ],
              },
              {
                type: 'tableRow',
                content: [
                  {
                    type: 'tableCell',
                    content: [
                      {
                        type: 'paragraph',
                        content: [
                          { type: 'text', text: 'one' },
                          { type: 'hardBreak' },
                          { type: 'text', text: 'two' },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    const md = editorToMarkdown(editor);
    editor.destroy();
    const lines = md.split('\n');
    expect(lines).toHaveLength(3); // header, delimiter, ONE body row
    expect(rt(md)).toBe(md);
  });
});

describe('blank paragraphs', () => {
  it('pressing Enter repeatedly does not litter the markdown', () => {
    const editor = new Editor({
      extensions: createMarkdownExtensions(),
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
          { type: 'paragraph' },
          { type: 'paragraph' },
          { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
          { type: 'paragraph' },
        ],
      },
    });
    const md = editorToMarkdown(editor);
    editor.destroy();
    expect(md).toBe('one\n\ntwo');
  });
});

describe('empty input', () => {
  it('stays empty', () => {
    expect(rt('')).toBe('');
    expect(rt('\n\n')).toBe('');
  });
});
