import type { ReactNode } from 'react';

export interface FieldProps {
  label: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  hint?: string;
  /** Inline validation message; when set it replaces the hint and is announced. */
  error?: string;
  /** Optional control aligned to the label's right edge (e.g. "Forgot password?"). */
  action?: ReactNode;
}

const LABEL_CLASS =
  'block text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500';

export function Field({ label, htmlFor, children, hint, error, action }: FieldProps) {
  return (
    <div className="space-y-1">
      {action ? (
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={htmlFor} className={LABEL_CLASS}>
            {label}
          </label>
          {action}
        </div>
      ) : (
        <label htmlFor={htmlFor} className={LABEL_CLASS}>
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-ink-500">{hint}</p>
      )}
    </div>
  );
}
