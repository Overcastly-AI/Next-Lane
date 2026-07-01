/**
 * A compact accent-color picker: a "none" option plus a curated palette of
 * swatches. Stores hex; `null` means no color. Shared across surfaces (personal
 * board cards/columns) so accent colors stay consistent.
 */

export const ACCENT_PALETTE: { name: string; hex: string }[] = [
  { name: 'Slate', hex: '#64748b' },
  { name: 'Blue', hex: '#2563eb' },
  { name: 'Cyan', hex: '#0891b2' },
  { name: 'Green', hex: '#16a34a' },
  { name: 'Amber', hex: '#d97706' },
  { name: 'Red', hex: '#dc2626' },
  { name: 'Violet', hex: '#7c3aed' },
  { name: 'Pink', hex: '#db2777' },
];

export function ColorSwatchPicker({
  value,
  onChange,
  size = 'md',
}: {
  value: string | null;
  onChange: (hex: string | null) => void;
  size?: 'sm' | 'md';
}) {
  const dim = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="radiogroup"
      aria-label="Accent color"
    >
      <button
        type="button"
        onClick={() => onChange(null)}
        role="radio"
        aria-checked={value === null}
        aria-label="No color"
        title="No color"
        data-testid="color-none"
        className={`flex ${dim} items-center justify-center rounded-full border text-ink-400 ${
          value === null
            ? 'border-ink-400 ring-2 ring-ink-300 ring-offset-1'
            : 'border-ink-200 hover:border-ink-300'
        }`}
      >
        <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path strokeLinecap="round" d="M5 19L19 5" />
        </svg>
      </button>
      {ACCENT_PALETTE.map((c) => (
        <button
          key={c.hex}
          type="button"
          onClick={() => onChange(c.hex)}
          role="radio"
          aria-checked={value === c.hex}
          aria-label={c.name}
          title={c.name}
          data-testid="color-swatch"
          className={`${dim} rounded-full transition-transform ${
            value === c.hex ? 'ring-2 ring-ink-400 ring-offset-1' : 'hover:scale-110'
          }`}
          style={{ backgroundColor: c.hex }}
        />
      ))}
    </div>
  );
}
