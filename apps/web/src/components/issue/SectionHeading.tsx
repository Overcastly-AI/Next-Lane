import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * The one "peer section header" treatment for blocks in the issue detail
 * drawer's main column (Description / Attachments / Checklist / Time
 * Tracking / Comments / Activity): a 10px bold uppercase tracked label in
 * `ink-500`. Matches `Field`'s sidebar label treatment so every top-level
 * heading in the drawer — main column or sidebar — reads as one system.
 *
 * Previously Attachments/Comments/Activity used a completely different
 * treatment (`text-xs font-medium text-slate-600`, sentence case) that
 * rendered at a visibly different color and weight next to Description/
 * Checklist/Time Tracking right above or below them. This component is the
 * single source of truth going forward — no more per-file drift.
 *
 * `action` renders a right-aligned slot (e.g. a progress count) on the same
 * row, matching how Checklist already pairs its label with a "2/5" badge.
 */
export function SectionHeading({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-2', className)}>
      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-500">
        {children}
      </p>
      {action}
    </div>
  );
}
