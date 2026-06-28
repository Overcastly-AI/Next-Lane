/*
 * DISPATCH logo mark — "lanes" motif: three vertical bars of increasing height
 * represent work flowing through lanes (queued → dispatched → arrived).
 * Signal cobalt fill on the mark; Space Grotesk for the wordmark.
 */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      {/* Lane mark — three bars, cobalt signal */}
      <span className="flex h-7 w-7 items-center justify-center rounded bg-signal-600 text-white shadow-xs">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M5 19V7m7 12V11m7 8V14"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      </span>
      {!compact && (
        <span className="font-display text-[0.9375rem] font-semibold tracking-[-0.025em] text-ink-900">
          Next Lane
        </span>
      )}
    </span>
  );
}
