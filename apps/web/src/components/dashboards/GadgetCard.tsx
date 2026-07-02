import { DashboardGadgetVisualization, type DashboardGadgetDto, type DashboardGadgetResult } from '@next-lane/shared';
import { cn } from '@/lib/cn';
import { Spinner } from '@/components/ui/States';
import { StatGadget, TableGadget, BreakdownGadget, BurndownGadget } from './GadgetVisualizations';

const VISUALIZATION_LABELS: Record<DashboardGadgetVisualization, string> = {
  [DashboardGadgetVisualization.STAT]: 'Stat',
  [DashboardGadgetVisualization.TABLE]: 'Table',
  [DashboardGadgetVisualization.BREAKDOWN]: 'Breakdown',
  [DashboardGadgetVisualization.BURNDOWN]: 'Burndown',
};

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

export interface GadgetCardProps {
  gadget: DashboardGadgetDto;
  result: DashboardGadgetResult | undefined;
  loading: boolean;
  editable: boolean;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export function GadgetCard({
  gadget,
  result,
  loading,
  editable,
  isFirst,
  isLast,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: GadgetCardProps) {
  const wide = (gadget.config.size ?? 1) >= 2;

  return (
    <section
      data-testid="dashboard-gadget"
      data-gadget-id={gadget.id}
      className={cn(
        'flex flex-col rounded-xl border border-ink-200 bg-surface p-4 shadow-card',
        wide && 'sm:col-span-2',
      )}
      aria-label={gadget.title}
    >
      <header className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-ink-900">{gadget.title}</h3>
          <p className="text-[11px] uppercase tracking-wide text-ink-400">
            {VISUALIZATION_LABELS[gadget.visualization]}
          </p>
        </div>
        {editable && (
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton label="Move earlier" onClick={onMoveUp} disabled={isFirst} testId="gadget-move-up">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6-6 6 6M12 3v18" />
              </svg>
            </IconButton>
            <IconButton label="Move later" onClick={onMoveDown} disabled={isLast} testId="gadget-move-down">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 15l-6 6-6-6M12 21V3" />
              </svg>
            </IconButton>
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
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Spinner />
          </div>
        ) : result?.error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            {result.error}
          </p>
        ) : !result?.data ? (
          <div className="flex items-center justify-center py-8">
            <Spinner />
          </div>
        ) : result.data.kind === 'STAT' ? (
          <StatGadget data={result.data} />
        ) : result.data.kind === 'TABLE' ? (
          <TableGadget data={result.data} />
        ) : result.data.kind === 'BREAKDOWN' ? (
          <BreakdownGadget data={result.data} />
        ) : (
          <BurndownGadget data={result.data} />
        )}
      </div>
    </section>
  );
}
