import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface BadgeProps {
  children: ReactNode;
  className?: string;
  /** Optional solid background color (e.g. a label color hex). */
  color?: string;
}

export function Badge({ children, className, color }: BadgeProps) {
  if (color) {
    return (
      <span
        className={cn(
          'nl-color-chip inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-semibold leading-none tracking-wide',
          className,
        )}
        style={{ '--nl-chip': color } as CSSProperties}
      >
        {children}
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none tracking-wide text-ink-600',
        className,
      )}
    >
      {children}
    </span>
  );
}
