/**
 * RichMarkdownEditor — the app's one markdown field.
 *
 * A Tiptap (ProseMirror) editor that loads and emits MARKDOWN — the storage
 * format the API, search index, MCP tools and `MarkdownRenderer` all share —
 * with a per-field `Markdown` switch to a raw textarea. Replaces the plain
 * textareas (and the `MentionComposer` / `WikiLinkTextarea` wrappers) on every
 * surface that holds markdown. See `components/editor/` for the machinery and
 * `markdownRoundTrip.test.ts` for the fidelity guarantees.
 *
 * The implementation (~350 KB of ProseMirror) is a lazy chunk: this wrapper is
 * what callers import, shows a same-height skeleton while it loads, and
 * `preloadRichMarkdownEditor()` warms it when the app is idle so the editor is
 * usually instant.
 */
import { forwardRef, lazy, Suspense, useEffect } from 'react';
import { cn } from '@/lib/cn';
import type { RichMarkdownEditorHandle, RichMarkdownEditorProps } from '@/components/editor/types';

export type { RichMarkdownEditorHandle, RichMarkdownEditorProps } from '@/components/editor/types';

const loadImpl = () =>
  import('@/components/editor/RichMarkdownEditorImpl').then((m) => ({
    default: m.RichMarkdownEditorImpl,
  }));
const Impl = lazy(loadImpl);

/** Start fetching the editor chunk (call when the app is idle). */
export function preloadRichMarkdownEditor(): void {
  void loadImpl();
}

/**
 * Warm the editor chunk once the surrounding screen is idle, so the first
 * click into a description/comment/page does not wait on a network fetch.
 */
export function usePreloadRichMarkdownEditor(): void {
  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    };
    if (w.requestIdleCallback) w.requestIdleCallback(preloadRichMarkdownEditor, { timeout: 4000 });
    else setTimeout(preloadRichMarkdownEditor, 1500);
  }, []);
}

function EditorSkeleton({
  variant = 'inline',
  minHeight,
  'aria-label': ariaLabel,
}: Pick<RichMarkdownEditorProps, 'variant' | 'minHeight' | 'aria-label'>) {
  return (
    <div
      role="status"
      aria-label={`Loading editor: ${ariaLabel}`}
      className={cn(
        'nl-editor flex flex-col',
        variant === 'inline' ? 'rounded border border-ink-200 bg-surface' : 'flex-1',
      )}
    >
      <div className="h-10 border-b border-ink-100 bg-ink-50/60 sm:h-[34px]" />
      <div
        className="animate-pulse space-y-2 px-3 py-3 motion-reduce:animate-none"
        style={{ minHeight: minHeight ?? (variant === 'canvas' ? '50vh' : '4.5rem') }}
      >
        <div className="h-3 w-2/3 rounded bg-ink-100" />
        <div className="h-3 w-1/2 rounded bg-ink-100" />
      </div>
    </div>
  );
}

export const RichMarkdownEditor = forwardRef<RichMarkdownEditorHandle, RichMarkdownEditorProps>(
  function RichMarkdownEditor(props, ref) {
    return (
      <Suspense
        fallback={
          <EditorSkeleton
            variant={props.variant}
            minHeight={props.minHeight}
            aria-label={props['aria-label']}
          />
        }
      >
        <Impl ref={ref} {...props} />
      </Suspense>
    );
  },
);
