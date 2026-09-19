import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /**
   * `lg` is 40px — meets the ~40px touch-target guideline `md` (36px, the
   * default) falls short of. Opt-in for rows where this control is a primary
   * touch target, not a blanket replacement for `md`. Named `uiSize` (not
   * `size`) because native `<select size>` is a different attribute (visible
   * option rows).
   */
  uiSize?: 'md' | 'lg';
}

const sizes = {
  md: 'h-9 px-3 pr-8 text-sm',
  lg: 'h-10 px-3.5 pr-9 text-sm',
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, uiSize = 'md', ...rest }, ref) => (
    <select
      ref={ref}
      className={cn(
        'w-full appearance-none rounded border border-ink-200 bg-surface text-ink-900',
        sizes[uiSize],
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
