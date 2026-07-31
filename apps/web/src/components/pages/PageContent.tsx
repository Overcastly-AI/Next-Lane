/**
 * PageContent — read-mode rendering of a page's markdown body, with
 * `[[wiki-links]]` rendered as real clickable links:
 *   - Resolved (title matches another page in the project): a solid link
 *     that navigates straight to that page.
 *   - Unresolved (no such page yet): a dashed "create it" affordance —
 *     clicking asks the caller to create a new page with that title.
 *
 * Reuses the app's existing sanitized markdown pipeline (`renderMarkdown` /
 * `splitMermaidSegments` from `MarkdownRenderer`) unchanged — wiki-link
 * syntax is rewritten to plain markdown link syntax BEFORE it reaches
 * `marked`, so mermaid fences, tables, etc. inside a page all keep working
 * exactly as they do in issue descriptions/comments.
 *
 * Images uploaded into the body appear as `![alt](nl-image:<id>)` and are
 * resolved after render by `usePageImageResolver`, which fetches each one with
 * the reader's token and swaps in a `blob:` URL — so an embedded image is
 * exactly as private as the page holding it.
 */
import { Fragment, useMemo, useRef } from 'react';
import { Mermaid } from '@/components/ui/Mermaid';
import { renderMarkdown, splitMermaidSegments } from '@/components/ui/MarkdownRenderer';
import { transformWikiLinksForRender } from '@/lib/wikiLinks';
import { usePageImageResolver } from '@/lib/pageImages';

export interface PageContentProps {
  content: string;
  /** Case-insensitive title -> page id index for the project (see `buildTitleIndex`). */
  titleIndex: Map<string, string>;
  onOpenPage: (pageId: string) => void;
  onCreatePage: (title: string) => void;
  className?: string;
}

export function PageContent({
  content,
  titleIndex,
  onOpenPage,
  onCreatePage,
  className = '',
}: PageContentProps) {
  const segments = useMemo(
    () => (content ? splitMermaidSegments(transformWikiLinksForRender(content, titleIndex)) : []),
    [content, titleIndex],
  );

  // Images uploaded into the body are stored as `nl-image:<id>` references and
  // fetched with the reader's token at display time — see `lib/pageImages.ts`
  // for why the markdown holds a reference rather than a URL. The hook runs
  // before the early return below because hook order must not depend on
  // whether the body happens to be empty.
  const containerRef = useRef<HTMLDivElement>(null);
  usePageImageResolver(containerRef, content);

  const hasRenderable = segments.some((s) =>
    s.kind === 'mermaid' ? s.value.trim() : renderMarkdown(s.value),
  );

  if (!hasRenderable) return null;

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const anchor = (e.target as HTMLElement).closest('a[href^="#page:"], a[href^="#create-page:"]');
    if (!anchor) return;
    e.preventDefault();
    const href = anchor.getAttribute('href') ?? '';
    if (href.startsWith('#page:')) {
      onOpenPage(href.slice('#page:'.length));
    } else if (href.startsWith('#create-page:')) {
      onCreatePage(decodeURIComponent(href.slice('#create-page:'.length)));
    }
  }

  return (
    <div
      ref={containerRef}
      className={['markdown-body nl-page-content text-sm text-ink-700', className].filter(Boolean).join(' ')}
      onClick={handleClick}
      // Stable hook for asserting rendered page body in e2e — the class list
      // above is styling and must stay free to change.
      data-testid="page-content"
    >
      {segments.map((seg, i) => {
        if (seg.kind === 'mermaid') {
          return <Mermaid key={`mermaid-${i}`} code={seg.value} />;
        }
        const html = renderMarkdown(seg.value);
        if (!html) return null;
        return (
          <Fragment key={`md-${i}`}>
            {/* biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by DOMPurify in renderMarkdown */}
            <div dangerouslySetInnerHTML={{ __html: html }} />
          </Fragment>
        );
      })}
    </div>
  );
}
