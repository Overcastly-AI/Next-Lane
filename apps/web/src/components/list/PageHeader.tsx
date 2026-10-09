import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/Badge';

/**
 * Shared planning-page header: title (h1) + optional count badge + subtitle on
 * the left, actions on the right. Both rows wrap, so on a 390px viewport the
 * actions drop under the title instead of being clipped off-screen.
 */
export function PageHeader({
  title,
  count,
  description,
  actions,
}: {
  title: string;
  /** Rendered as a badge beside the title (outside the h1 so its name stays clean). */
  count?: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl font-semibold text-ink-900">{title}</h1>
          {count && <Badge>{count}</Badge>}
        </div>
        {description && (
          <p className="mt-1 text-sm text-ink-600">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
