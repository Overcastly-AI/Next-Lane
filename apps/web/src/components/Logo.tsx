export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      {/* "Lanes" mark — three vertical bars of increasing height, like a momentum graph */}
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white shadow-xs">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M5 19V5m7 14V9m7 10V12"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      </span>
      {!compact && (
        <span className="text-base font-bold tracking-[-0.02em] text-slate-900">
          Next Lane
        </span>
      )}
    </span>
  );
}
