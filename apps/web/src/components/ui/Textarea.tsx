import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...rest }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded border border-ink-200 bg-surface px-3 py-2 text-sm text-ink-900',
        'placeholder:text-ink-400 transition-all duration-[120ms] resize-y',
        'hover:border-ink-300',
        'focus:border-signal-500 focus:outline-none focus:ring-2 focus:ring-signal-200',
        'disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-400',
        className,
      )}
      {...rest}
    />
  ),
);
Textarea.displayName = 'Textarea';
