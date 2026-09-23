import { useId } from 'react';
import { cn } from '@/lib/cn';

export interface SettingsSectionProps {
  title: string;
  description?: string;
  /** Right-aligned control in the header — usually an "Add…" button. */
  action?: React.ReactNode;
  children: React.ReactNode;
  /** Extra classes for the rare section that needs a different border. */
  className?: string;
  'data-testid'?: string;
}

/**
 * The one card every settings section sits in, across every scope.
 *
 * Before this, each surface wrote its own: the project page had a private
 * `Section` helper on `border-slate-200`, the workspace page inlined the same
 * card on `border-ink-200`, and several sections under this directory wrote a
 * third. That is most of why the four settings scopes did not feel like one
 * product.
 *
 * The heading is wired to the section through `aria-labelledby` rather than
 * left as a loose `<h2>`: with a rail of six groups, a screen-reader user
 * landing mid-page needs the region to announce which setting they are in.
 */
export function SettingsSection({
  title,
  description,
  action,
  children,
  className,
  'data-testid': testId,
}: SettingsSectionProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-testid={testId}
      className={cn(
        'rounded-xl border border-ink-200 bg-surface p-4 shadow-card sm:p-5',
        className,
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 id={headingId} className="text-sm font-semibold text-ink-900">
            {title}
          </h2>
          {description && (
            <p className="mt-0.5 text-xs text-ink-500">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
