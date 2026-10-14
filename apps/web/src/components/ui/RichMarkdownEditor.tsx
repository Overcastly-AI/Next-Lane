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
import { forwardRef, lazy, Suspense, useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { bootBuffer } from '@/components/editor/bootBuffer';
import type { RichMarkdownEditorHandle, RichMarkdownEditorProps } from '@/components/editor/types';

export type { RichMarkdownEditorHandle, RichMarkdownEditorProps } from '@/components/editor/types';

type ImplType = typeof import('@/components/editor/RichMarkdownEditorImpl').RichMarkdownEditorImpl;
let LoadedImpl: ImplType | null = null;
const loadImpl = () =>
  import('@/components/editor/RichMarkdownEditorImpl').then((m) => {
    LoadedImpl = m.RichMarkdownEditorImpl;
    return { default: m.RichMarkdownEditorImpl };
  });
const LazyImpl = lazy(loadImpl);

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
  autoFocus,
  'aria-label': ariaLabel,
}: Pick<RichMarkdownEditorProps, 'variant' | 'minHeight' | 'aria-label' | 'autoFocus'>) {
  return (
    <div
      role="status"
      aria-label={`Loading editor: ${ariaLabel}`}
      className={cn(
        'nl-editor relative flex flex-col',
        variant === 'inline' ? 'rounded border border-ink-200 bg-surface' : 'flex-1',
      )}
    >
      {autoFocus && (
        // Catches keystrokes typed before the editor chunk arrives; the editor
        // replays them on mount (see bootBuffer).
        <textarea
          autoFocus
          aria-label={ariaLabel}
          data-testid="editor-boot-input"
          className="absolute h-0 w-0 opacity-0"
          onChange={(e) => bootBuffer.push(e.target.value)}
        />
      )}
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
    // Once the chunk has loaded, render the editor directly: going through
    // React.lazy would suspend for a tick on every mount and open a gap in
    // which a fast typist's first characters hit nothing.
    // The branch is chosen ONCE per mount: switching later (the chunk finishing
    // to load while the user types) would change the element type and re-mount
    // the editor mid-sentence.
    const [Loaded] = useState(() => LoadedImpl);
    if (Loaded) return <Loaded ref={ref} {...props} />;
    return (
      <Suspense
        fallback={
          <EditorSkeleton
            variant={props.variant}
            minHeight={props.minHeight}
            autoFocus={props.autoFocus}
            aria-label={props['aria-label']}
          />
        }
      >
        <LazyImpl ref={ref} {...props} />
      </Suspense>
    );
  },
);
