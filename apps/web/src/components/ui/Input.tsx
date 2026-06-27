import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...rest }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900',
        'placeholder:text-slate-400 transition-all duration-150',
        'hover:border-slate-300',
        'focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200',
        'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400',
        className,
      )}
      {...rest}
    />
  ),
);
Input.displayName = 'Input';
