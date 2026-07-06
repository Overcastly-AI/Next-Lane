import type { DraggableAttributes } from '@dnd-kit/core';
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';
import { DashboardGadgetVisualization, type DashboardGadgetDto, type DashboardGadgetResult } from '@next-lane/shared';
import { cn } from '@/lib/cn';
import { Spinner } from '@/components/ui/States';
import {
  StatGadget,
  TableGadget,
  BreakdownGadget,
  BurndownGadget,
  VelocityTrendGadget,
} from './GadgetVisualizations';

export const VISUALIZATION_LABELS: Record<DashboardGadgetVisualization, string> = {
  [DashboardGadgetVisualization.STAT]: 'Stat',
  [DashboardGadgetVisualization.TABLE]: 'Table',
  [DashboardGadgetVisualization.BREAKDOWN]: 'Breakdown',
  [DashboardGadgetVisualization.BURNDOWN]: 'Burndown',
  [DashboardGadgetVisualization.VELOCITY_TREND]: 'Velocity trend',
};

/**
 * The evaluated-result rendering core shared by the authenticated
 * `GadgetCard` (editable dashboard grid) and the public read-only dashboard
 * share page (`SharedDashboardPage`) — loading spinner, per-gadget error, or
 * the visualization switch. Kept as its own component so the public page
 * reuses the exact same visualization components rather than re-implementing
 * the switch.
 */
export function GadgetResultBody({
  result,
  loading,
}: {
  result: DashboardGadgetResult | undefined;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner />
      </div>
    );
  }
  if (result?.error) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
        {result.error}
      </p>
    );
  }
  if (!result?.data) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner />
      </div>
    );
  }
  switch (result.data.kind) {
    case 'STAT':
      return <StatGadget data={result.data} />;
    case 'TABLE':
      return <TableGadget data={result.data} />;
    case 'BREAKDOWN':
      return <BreakdownGadget data={result.data} />;
    case 'BURNDOWN':
      return <BurndownGadget data={result.data} />;
    default:
      return <VelocityTrendGadget data={result.data} />;
  }
}

function IconButton({
  label,
  onClick,
  disabled,
  testId,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={cn(
        'rounded p-1 text-ink-400 transition-colors duration-[120ms]',
        'hover:bg-ink-100 hover:text-ink-700',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-300',
        'disabled:cursor-not-allowed disabled:opacity-30',
      )}
    >
      {children}
    </button>
  );
}

/** Drag-handle wiring handed down from the sortable wrapper (`useSortable`). */
export interface GadgetDragHandle {
  attributes: DraggableAttributes;
  listeners: SyntheticListenerMap | undefined;
}

export interface GadgetCardProps {
  gadget: DashboardGadgetDto;
  result: DashboardGadgetResult | undefined;
  loading: boolean;
  editable: boolean;
  onEdit: () => void;
  onDelete: () => void;
  /** Present (and rendered as a grab handle) only when `editable` — reordering is a write. */
  dragHandle?: GadgetDragHandle;
  isDragging?: boolean;
}

export function GadgetCard({
  gadget,
  result,
  loading,
  editable,
  onEdit,
  onDelete,
  dragHandle,
  isDragging,
}: GadgetCardProps) {
  const wide = (gadget.config.size ?? 1) >= 2;

  return (
    <section
      data-testid="dashboard-gadget"
      data-gadget-id={gadget.id}
      className={cn(
        'flex flex-col rounded-xl border border-ink-200 bg-surface p-4 shadow-card',
        'transition-shadow duration-[120ms]',
        wide && 'sm:col-span-2',
        isDragging && 'shadow-cardHover opacity-50',
      )}
      aria-label={gadget.title}
    >
      <header className="mb-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-1.5">
          {editable && dragHandle && (
            <button
              type="button"
              {...dragHandle.attributes}
              {...dragHandle.listeners}
              aria-label={`Reorder gadget ${gadget.title}`}
              data-testid="gadget-drag-handle"
              className={cn(
                // ~40px touch target (mobile tap-target floor) while the icon
                // itself stays visually small; shrinks back to a tight
                // pointer-precision hit area at `sm:` and up.
                'mt-0.5 flex min-h-10 min-w-10 shrink-0 items-center justify-center',
                'sm:min-h-0 sm:min-w-0',
                'cursor-grab touch-none rounded p-0.5 text-ink-300',
                'transition-colors duration-[120ms] hover:bg-ink-100 hover:text-ink-600',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-300',
                'active:cursor-grabbing',
              )}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
                <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
                <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
              </svg>
            </button>
          )}
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-ink-900">{gadget.title}</h3>
            <p className="text-[11px] uppercase tracking-wide text-ink-400">
              {VISUALIZATION_LABELS[gadget.visualization]}
            </p>
          </div>
        </div>
        {editable && (
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton label="Edit gadget" onClick={onEdit} testId="gadget-edit">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
              </svg>
            </IconButton>
            <IconButton label="Delete gadget" onClick={onDelete} testId="gadget-delete">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16z" />
              </svg>
            </IconButton>
          </div>
        )}
      </header>

      <div className="flex flex-1 flex-col justify-center">
        <GadgetResultBody result={result} loading={loading} />
      </div>
    </section>
  );
}
