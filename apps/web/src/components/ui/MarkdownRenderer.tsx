/**
 * MarkdownRenderer — renders user-authored markdown as sanitized HTML.
 *
 * Security contract:
 *  - marked converts markdown to HTML.
 *  - DOMPurify strips any remaining XSS vectors (raw <script>, on* attrs, etc.)
 *    before insertion into the DOM.
 *  - External links get target=_blank + rel=noopener noreferrer.
 *  - No raw HTML passthrough — the DOMPurify allowlist only permits safe elements.
 *
 * @mention tokens (e.g. `@user@example.com`) are preserved as-is by marked
 * (they appear inline in text nodes, not parsed as special syntax) and survive
 * the DOMPurify pass unchanged, so they render as plain readable text.
 */

import { Fragment, useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify, { type Config as DOMPurifyConfig } from 'dompurify';
import { Mermaid } from './Mermaid';

// Configure marked once: no HTML passthrough, gfm + line breaks enabled.
const renderer = new marked.Renderer();

// Override link rendering: all links open in a new tab with rel=noopener.
renderer.link = ({ href, title, tokens }) => {
  const text = tokens.map((t) => ('raw' in t ? t.raw : '')).join('');
  const titleAttr = title ? ` title="${title}"` : '';
  const safeHref = href ?? '';
  return `<a href="${safeHref}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
};

marked.use({
  renderer,
  gfm: true,
  breaks: true,
});

/** DOMPurify config: allow safe HTML elements, strip scripts and raw handlers. */
const PURIFY_CONFIG: DOMPurifyConfig = {
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr',
    'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins',
    'ul', 'ol', 'li',
    'a',
    'code', 'pre',
    'blockquote',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'span', 'div',
  ],
  ALLOWED_ATTR: [
    'href', 'title', 'target', 'rel',
    'class',
  ],
  // Force any remaining on* attributes or javascript: hrefs to be stripped.
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
  // Do not allow any DOM clobbering.
  ALLOW_DATA_ATTR: false,
};

/**
 * Convert markdown text to sanitized HTML. Returns an empty string for
 * falsy input rather than throwing.
 */
export function renderMarkdown(raw: string): string {
  if (!raw) return '';
  // marked.parse is synchronous when walkTokens is not async.
  const html = marked.parse(raw) as string;
  return DOMPurify.sanitize(html, { ...PURIFY_CONFIG, RETURN_DOM_FRAGMENT: false, RETURN_DOM: false }) as string;
}

/**
 * A parsed markdown segment: either a run of normal markdown (rendered to
 * sanitized HTML) or a ```mermaid code fence (rendered as a diagram).
 */
type Segment =
  | { kind: 'markdown'; value: string }
  | { kind: 'mermaid'; value: string };

// Fenced `mermaid` block: ```mermaid\n ... \n```. Matched anywhere; the body is
// captured so it can be rendered by the Mermaid component instead of marked.
const MERMAID_FENCE = /```mermaid[ \t]*\r?\n([\s\S]*?)```/g;

/** Split raw markdown into ordered markdown / mermaid segments. */
export function splitMermaidSegments(raw: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  MERMAID_FENCE.lastIndex = 0;
  while ((match = MERMAID_FENCE.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: 'markdown', value: raw.slice(lastIndex, match.index) });
    }
    segments.push({ kind: 'mermaid', value: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < raw.length) {
    segments.push({ kind: 'markdown', value: raw.slice(lastIndex) });
  }
  return segments;
}

/**
 * Renders a markdown string inside a styled prose container. Normal markdown is
 * converted to sanitized HTML; fenced ```mermaid blocks are rendered as
 * diagrams. Use in read/view mode; edit mode should use a plain textarea.
 */
export function MarkdownRenderer({
  content,
  className = '',
}: {
  content: string;
  /** Additional Tailwind classes appended to the wrapper div. */
  className?: string;
}) {
  const segments = useMemo(
    () => (content ? splitMermaidSegments(content) : []),
    [content],
  );

  // Nothing to show (and no diagram blocks) → render nothing, matching prior
  // behaviour where empty markdown produced no node.
  const hasRenderable = segments.some((s) =>
    s.kind === 'mermaid' ? s.value.trim() : renderMarkdown(s.value),
  );
  if (!hasRenderable) {
    return null;
  }

  return (
    <div
      className={[
        // Prose-style typography for rendered markdown.
        'markdown-body text-sm text-slate-700',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {segments.map((seg, i) => {
        if (seg.kind === 'mermaid') {
          return <Mermaid key={`mermaid-${i}`} code={seg.value} />;
        }
        const html = renderMarkdown(seg.value);
        if (!html) return null;
        return (
          <Fragment key={`md-${i}`}>
            <div
              // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by DOMPurify in renderMarkdown
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </Fragment>
        );
      })}
    </div>
  );
}
