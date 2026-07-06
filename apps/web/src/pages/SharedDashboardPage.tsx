import { useParams } from 'react-router-dom';
import type { DashboardGadgetResult } from '@next-lane/shared';
import { usePublicDashboard } from '@/api/share-tokens';
import { GadgetResultBody, VISUALIZATION_LABELS } from '@/components/dashboards/GadgetCard';
import { LoadingState } from '@/components/ui/States';
import { cn } from '@/lib/cn';

// ── Read-only gadget card (no edit/delete/drag affordances) ─────────────────

function ReadOnlyGadgetCard({ result }: { result: DashboardGadgetResult }) {
  const wide = (result.config.size ?? 1) >= 2;

  return (
    <section
      data-testid="dashboard-gadget"
      data-gadget-id={result.gadgetId}
      className={cn(
        'flex flex-col rounded-xl border border-slate-200 bg-surface p-4 shadow-card',
        wide && 'sm:col-span-2',
      )}
      aria-label={result.title}
    >
      <header className="mb-2">
        <h3 className="truncate text-sm font-semibold text-slate-900">{result.title}</h3>
        <p className="text-[11px] uppercase tracking-wide text-slate-400">
          {VISUALIZATION_LABELS[result.visualization]}
        </p>
      </header>
      <div className="flex flex-1 flex-col justify-center">
        <GadgetResultBody result={result} loading={false} />
      </div>
    </section>
  );
}

// ── Error / invalid token view ────────────────────────────────────────────────

function ShareErrorView({ message }: { message: string }) {
  const isRevoked =
    message.toLowerCase().includes('revoked') || message.toLowerCase().includes('not found');
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-surface p-8 shadow-card text-center">
        <div className="mb-4 flex justify-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-red-500"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <path strokeLinecap="round" d="M15 9l-6 6M9 9l6 6" />
            </svg>
          </span>
        </div>
        <h1 className="mb-2 text-lg font-semibold text-slate-900">
          {isRevoked ? 'Link revoked or invalid' : 'Dashboard unavailable'}
        </h1>
        <p className="text-sm text-slate-500">
          {isRevoked
            ? 'This share link has been revoked or is no longer valid. Please ask the project owner for a new link.'
            : message}
        </p>
      </div>
    </div>
  );
}

// ── Main shared dashboard page ────────────────────────────────────────────────

/**
 * Standalone read-only dashboard view at /share/dashboard/:token. No
 * authentication required.
 *
 * Fetches the fully-evaluated public dashboard snapshot and renders the same
 * gadget grid the authenticated dashboard page shows, minus every write
 * affordance (no add/edit/delete/reorder gadget, no rename/delete dashboard).
 * A gadget whose query calls `me()` shows a per-gadget error instead of data
 * — there is no signed-in identity on a public link (see
 * `DashboardsService.evaluateGadget`'s `me()`-degradation contract).
 */
export function SharedDashboardPage() {
  const { token = '' } = useParams();
  const dashboardQuery = usePublicDashboard(token);
  const snapshot = dashboardQuery.data;

  if (dashboardQuery.isLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50">
        <LoadingState label="Loading shared dashboard…" />
      </div>
    );
  }

  if (dashboardQuery.isError || !snapshot) {
    const message = dashboardQuery.error?.message ?? 'This share link is not valid.';
    return <ShareErrorView message={message} />;
  }

  return (
    <div className="flex h-screen flex-col overflow-x-clip bg-slate-50">
      {/* Read-only banner */}
      <header
        data-testid="shared-dashboard-header"
        className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-surface px-4 py-3 shadow-sm"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-lg font-bold tracking-tight text-brand-600">Next Lane</span>
          <span className="text-slate-300">|</span>
          <span className="min-w-0 truncate text-sm font-semibold text-slate-900">
            {snapshot.dashboard.name}
          </span>
          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500">
            {snapshot.project.key}
          </span>
        </div>

        <span
          data-testid="readonly-badge"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500"
          aria-label="Read-only shared view"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          Read-only shared view
        </span>
      </header>

      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto w-full max-w-5xl">
          {snapshot.gadgets.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <p className="text-sm text-slate-400">This dashboard has no gadgets yet.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {snapshot.gadgets.map((result) => (
                <ReadOnlyGadgetCard key={result.gadgetId} result={result} />
              ))}
            </div>
          )}
          {snapshot.issuesTruncated && (
            <p className="mt-4 text-xs text-slate-400">
              This project has more issues than the dashboard evaluates at once — results may be
              partial.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
