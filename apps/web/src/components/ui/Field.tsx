import type { ReactNode } from 'react';

export interface FieldProps {
  label: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  hint?: string;
}

export function Field({ label, htmlFor, children, hint }: FieldProps) {
  return (
    <div className="space-y-1">
      <label
        htmlFor={htmlFor}
        className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500"
      >
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-ink-400">{hint}</p>}
    </div>
  );
}
