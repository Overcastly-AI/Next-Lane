import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...rest }, ref) => (
    <select
      ref={ref}
      className={cn(
        'h-9 w-full appearance-none rounded border border-ink-200 bg-surface px-3 pr-8 text-sm text-ink-900',
        'transition-all duration-[120ms]',
        'hover:border-ink-300',
        'focus:border-signal-500 focus:outline-none focus:ring-2 focus:ring-signal-200',
        'disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-400',
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 fill=%22none%22 viewBox=%220 0 24 24%22 stroke=%22%238b95a8%22 stroke-width=%222%22><path stroke-linecap=%22round%22 stroke-linejoin=%22round%22 d=%22M19 9l-7 7-7-7%22/></svg>')] bg-[length:14px] bg-[right_0.5rem_center] bg-no-repeat",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';
