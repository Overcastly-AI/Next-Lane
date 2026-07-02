import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...rest }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded border border-ink-200 bg-surface px-3 text-sm text-ink-900',
        'placeholder:text-ink-400 transition-all duration-[120ms]',
        'hover:border-ink-300',
        'focus:border-signal-500 focus:outline-none focus:ring-2 focus:ring-signal-200',
        'disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-400',
        className,
      )}
      {...rest}
    />
  ),
);
Input.displayName = 'Input';
