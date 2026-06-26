export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path
            d="M5 19V5m7 14V9m7 10V12"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      </span>
      {!compact && (
        <span className="text-lg font-bold tracking-tight text-gray-900">
          Next Lane
        </span>
      )}
    </span>
  );
}
