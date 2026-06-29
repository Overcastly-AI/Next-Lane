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

export function Mermaid({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Stable per-instance id fragment so concurrent diagrams never collide.
  const idRef = useRef(`nl-mermaid-${(renderSeq += 1)}`);

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
    <div
      data-testid="mermaid-diagram"
      className="nl-mermaid my-3 flex justify-center overflow-x-auto rounded-lg border border-ink-100 bg-white p-3"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG sanitized by mermaid securityLevel:'strict'
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
