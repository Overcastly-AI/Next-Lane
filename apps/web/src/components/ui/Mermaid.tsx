/**
 * Mermaid — renders a single Mermaid diagram from its source text.
 *
 * Design notes:
 *  - mermaid is LAZY-loaded (dynamic import) the first time a diagram appears,
 *    so the ~500 KB library never enters the main bundle / is only paid for by
 *    pages that actually show a diagram.
 *  - securityLevel 'strict': mermaid disables click handlers, HTML-encodes
 *    user text in labels, and runs its OWN DOMPurify pass over the generated
 *    SVG before returning it — so the markup we insert is already sanitized.
 *    (We deliberately do NOT re-sanitize here: re-parsing the SVG string with
 *    DOMPurify strips the XHTML inside <foreignObject>, which is where mermaid
 *    puts node labels — that left diagrams as empty shapes.)
 *  - No eval / no network: the production nginx CSP is script-src 'self',
 *    font-src 'self'; mermaid v11 is ESM (no eval) and the default theme uses
 *    system fonts, so it renders within that policy.
 *  - On a parse/render error we fall back to showing the raw source in a
 *    <pre> so the author can see (and fix) what they wrote.
 */
import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';

// Lazy singleton: import + initialize mermaid exactly once.
let mermaidReady: Promise<typeof import('mermaid').default> | null = null;

function loadMermaid() {
  if (!mermaidReady) {
    mermaidReady = import('mermaid').then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'neutral',
        fontFamily: 'inherit',
      });
      return mermaid;
    });
  }
  return mermaidReady;
}

// Monotonic counter for the unique element id mermaid requires per render.
let renderSeq = 0;

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;

export function Mermaid({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Lightbox / zoom state.
  const [zoomOpen, setZoomOpen] = useState(false);
  const [scale, setScale] = useState(1);
  // Stable per-instance id fragment so concurrent diagrams never collide.
  const idRef = useRef(`nl-mermaid-${(renderSeq += 1)}`);

  function openZoom() {
    setScale(1);
    setZoomOpen(true);
  }

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(null);

    const source = code.trim();
    if (!source) return;

    loadMermaid()
      .then(async (mermaid) => {
        // parse() throws on invalid syntax before we attempt a full render.
        await mermaid.parse(source);
        // mermaid (securityLevel: 'strict') already DOMPurify-sanitized this SVG.
        const { svg: renderedSvg } = await mermaid.render(idRef.current, source);
        if (cancelled) return;
        setSvg(renderedSvg);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <div
        data-testid="mermaid-error"
        className="my-2 overflow-hidden rounded-lg border border-amber-200 bg-amber-50"
      >
        <p className="border-b border-amber-200 px-3 py-1.5 text-[11px] font-semibold text-amber-700">
          Couldn’t render this diagram
        </p>
        <pre className="overflow-x-auto px-3 py-2 text-xs text-ink-700">
          <code>{code.trim()}</code>
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div
        data-testid="mermaid-loading"
        className="my-2 flex h-24 items-center justify-center rounded-lg border border-dashed border-ink-200 text-xs text-ink-400"
        aria-busy="true"
      >
        Rendering diagram…
      </div>
    );
  }

  return (
    // Stop clicks (including ones bubbling out of the portaled zoom Modal — React
    // portals bubble through the React tree, not the DOM tree) from reaching a
    // click-to-edit ancestor like the issue description.
    <div
      onClick={(e) => e.stopPropagation()}
      // biome-ignore lint/a11y/useKeyWithClickEvents: wrapper only guards propagation; the inner button is the control
      role="presentation"
    >
      <div
        data-testid="mermaid-diagram"
        className="nl-mermaid group relative my-3 overflow-hidden rounded-lg border border-ink-100 bg-white"
      >
        {/*
          Click anywhere on the diagram to open the zoom lightbox. stopPropagation
          keeps the click from bubbling to a click-to-edit container (the issue
          description), which is what made tapping the diagram open the editor.
        */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Enlarge diagram"
          title="Click to enlarge"
          onClick={(e) => {
            e.stopPropagation();
            openZoom();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              openZoom();
            }
          }}
          className="flex cursor-zoom-in justify-center overflow-x-auto p-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal-400"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG sanitized by mermaid securityLevel:'strict'
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        {/* Hover/focus affordance so the zoom is discoverable. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-2 top-2 hidden items-center gap-1 rounded-md bg-white/90 px-1.5 py-0.5 text-[10px] font-medium text-ink-500 ring-1 ring-ink-200 backdrop-blur-sm group-hover:flex group-focus-within:flex"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.3-4.3M11 8v6M8 11h6M18 11a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Enlarge
        </span>
      </div>

      <Modal
        open={zoomOpen}
        onClose={() => setZoomOpen(false)}
        title="Diagram"
        size="max-w-[95vw]"
        footer={
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => setScale((s) => Math.max(ZOOM_MIN, +(s - ZOOM_STEP).toFixed(2)))}
              disabled={scale <= ZOOM_MIN}
              className="rounded-md border border-ink-200 px-2 py-1 text-sm font-semibold text-ink-700 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              −
            </button>
            <span className="w-12 text-center font-mono text-xs text-ink-500" data-testid="mermaid-zoom-level">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => setScale((s) => Math.min(ZOOM_MAX, +(s + ZOOM_STEP).toFixed(2)))}
              disabled={scale >= ZOOM_MAX}
              className="rounded-md border border-ink-200 px-2 py-1 text-sm font-semibold text-ink-700 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => setScale(1)}
              className="ml-1 rounded-md border border-ink-200 px-2 py-1 text-xs font-medium text-ink-600 transition-colors hover:bg-ink-50"
            >
              Reset
            </button>
          </div>
        }
      >
        <div
          data-testid="mermaid-zoom-canvas"
          className="max-h-[78vh] overflow-auto rounded-lg border border-ink-100 bg-white p-4"
        >
          <div
            className="inline-block origin-top-left transition-transform duration-100"
            style={{ transform: `scale(${scale})` }}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: same SVG, sanitized by mermaid securityLevel:'strict'
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      </Modal>
    </div>
  );
}
