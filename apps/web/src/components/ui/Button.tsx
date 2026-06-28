import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

/*
 * DISPATCH button system:
 * - primary: cobalt signal fill — the one bold action
 * - secondary: ink surface + ink border — precise, not soft
 * - ghost: transparent — navigation + inline controls
 * - danger: red fill — destructive confirmation
 */
const variants: Record<Variant, string> = {
  primary:
    'bg-signal-600 text-white hover:bg-signal-700 focus-visible:ring-signal-500 disabled:bg-signal-300 shadow-xs border border-signal-700/20',
  secondary:
    'bg-white text-ink-700 border border-ink-200 hover:bg-ink-50 hover:border-ink-300 focus-visible:ring-signal-500 shadow-xs',
  ghost:
    'bg-transparent text-ink-600 hover:bg-ink-100 hover:text-ink-900 focus-visible:ring-signal-500',
  danger:
    'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500 disabled:bg-red-300 shadow-xs border border-red-700/20',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs rounded gap-1.5 font-semibold',
  md: 'h-9 px-3.5 text-sm rounded-md gap-2 font-semibold',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = 'primary', size = 'md', loading, className, children, disabled, ...rest },
    ref,
  ) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-semibold tracking-[-0.01em] transition-all',
        'duration-[120ms]',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
        'disabled:cursor-not-allowed disabled:opacity-55',
        'active:scale-[0.975]',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';
