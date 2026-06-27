import type { ReactNode } from 'react';
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
          'inline-flex items-center rounded-sm px-1.5 py-0.5 text-[11px] font-semibold leading-none tracking-wide',
          className,
        )}
        style={{ backgroundColor: hexWithAlpha(color, 0.14), color: darken(color) }}
      >
        {children}
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold leading-none tracking-wide text-slate-600',
        className,
      )}
    >
      {children}
    </span>
  );
}

function hexWithAlpha(hex: string, alpha: number): string {
  const c = hex.replace('#', '');
  if (c.length !== 6) return hex;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function darken(hex: string): string {
  const c = hex.replace('#', '');
  if (c.length !== 6) return hex;
  const r = Math.round(parseInt(c.slice(0, 2), 16) * 0.6);
  const g = Math.round(parseInt(c.slice(2, 4), 16) * 0.6);
  const b = Math.round(parseInt(c.slice(4, 6), 16) * 0.6);
  return `rgb(${r}, ${g}, ${b})`;
}
