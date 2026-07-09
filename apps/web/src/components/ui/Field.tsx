import type { ReactNode } from 'react';

export interface FieldProps {
  label: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  hint?: string;
  /** Inline validation message; when set it replaces the hint and is announced. */
  error?: string;
}

export function Field({ label, htmlFor, children, hint, error }: FieldProps) {
  return (
    <div className="space-y-1">
      <label
        htmlFor={htmlFor}
        className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-ink-400">{hint}</p>
      )}
    </div>
  );
}
