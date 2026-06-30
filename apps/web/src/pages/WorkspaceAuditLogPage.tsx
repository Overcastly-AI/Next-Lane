/**
 * Workspace Audit Log — ADMIN-only page.
 *
 * Shows a cursor-paginated table of security- and governance-relevant events
 * (membership changes, project lifecycle, webhook config, API-token operations).
 *
 * Only visible to workspace ADMINs; MEMBER/VIEWER see a 403 from the API
 * which the page converts to an access-denied message.
 *
 * Route: /workspaces/:workspaceId/audit-log
 */
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Role } from '@next-lane/shared';
import type { AuditEventDto } from '@next-lane/shared';
import { AppHeader } from '@/components/AppHeader';
import { WorkspaceSettingsNav } from '@/components/WorkspaceSettingsNav';
import { Button } from '@/components/ui/Button';
import { ErrorState, LoadingState, EmptyState } from '@/components/ui/States';
import { useAuditLog } from '@/api/audit';
import { useMyRole } from '@/api/workspaces';
import { useWorkspaces } from '@/api/workspaces';
import { relativeTime } from '@/lib/relativeTime';

// ── Action label map ──────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  'membership.add': 'Member added',
  'membership.remove': 'Member removed',
  'membership.role_change': 'Role changed',
  'project.create': 'Project created',
  'project.archive': 'Project archived',
  'webhook.create': 'Webhook created',
  'webhook.update': 'Webhook updated',
  'webhook.delete': 'Webhook deleted',
  'token.create': 'API token created',
  'token.revoke': 'API token revoked',
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

// ── Target type color ─────────────────────────────────────────────────────────

const TARGET_COLORS: Record<string, string> = {
  Membership: 'bg-blue-100 text-blue-700',
  Project: 'bg-green-100 text-green-700',
  WebhookSubscription: 'bg-purple-100 text-purple-700',
  ApiToken: 'bg-orange-100 text-orange-700',
};

function targetBadgeClass(targetType: string): string {
  return TARGET_COLORS[targetType] ?? 'bg-slate-100 text-slate-600';
}

// ── Row ───────────────────────────────────────────────────────────────────────

function AuditRow({ event }: { event: AuditEventDto }) {
  return (
    <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
      {/* Time */}
      <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-400 sm:px-4">
        <time
          dateTime={event.createdAt}
          title={new Date(event.createdAt).toLocaleString()}
        >
          {relativeTime(event.createdAt)}
        </time>
      </td>

      {/* Actor */}
      <td className="px-3 py-3 sm:px-4">
        {event.actor ? (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-900">
              {event.actor.name}
            </p>
            <p className="truncate text-xs text-slate-400">{event.actor.email}</p>
          </div>
        ) : (
          <span className="text-xs text-slate-400 italic">System / deleted user</span>
        )}
      </td>

      {/* Action */}
      <td className="px-3 py-3 sm:px-4">
        <span className="text-sm text-slate-800">{actionLabel(event.action)}</span>
      </td>

      {/* Target */}
      <td className="px-3 py-3 sm:px-4">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${targetBadgeClass(event.targetType)}`}
        >
          {event.targetType.replace('Subscription', '')}
        </span>
      </td>

      {/* Details */}
      <td className="px-3 py-3 text-xs text-slate-500 sm:px-4 max-w-xs">
        {event.metadata ? (
          <MetadataSnippet metadata={event.metadata} action={event.action} />
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>

      {/* IP */}
      <td className="hidden px-3 py-3 font-mono text-xs text-slate-400 sm:table-cell sm:px-4">
        {event.ip ?? '—'}
      </td>
    </tr>
  );
}

/** Renders a human-friendly one-liner from the event metadata. */
function MetadataSnippet({
  metadata,
  action,
}: {
  metadata: Record<string, unknown>;
  action: string;
}) {
  if (action === 'membership.add' || action === 'membership.role_change') {
    const email = metadata.targetEmail as string | undefined;
    const role = metadata.role as string | undefined;
    const prev = metadata.previousRole as string | undefined;
    if (prev) return <span>{email} — {prev} → {role}</span>;
    return <span>{email} — {role}</span>;
  }
  if (action === 'membership.remove') {
    const email = metadata.targetEmail as string | undefined;
    return <span>{email}</span>;
  }
  if (action === 'project.create' || action === 'project.archive') {
    const name = metadata.name as string | undefined;
    const key = metadata.key as string | undefined;
    return <span>{key}: {name}</span>;
  }
  if (action === 'webhook.create' || action === 'webhook.update' || action === 'webhook.delete') {
    const url = metadata.url as string | undefined;
    return <span className="truncate block max-w-[12rem]">{url}</span>;
  }
  if (action === 'token.create' || action === 'token.revoke') {
    const name = metadata.name as string | undefined;
    return <span>&quot;{name}&quot;</span>;
  }
  // Fallback: key=value pairs.
  const pairs = Object.entries(metadata)
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(', ');
  return <span>{pairs}</span>;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function WorkspaceAuditLogPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();

  const myRole = useMyRole(workspaceId);
  const isAdmin = myRole === Role.ADMIN;

  const workspacesQuery = useWorkspaces();
  const workspaceName = useMemo(
    () => workspacesQuery.data?.find((w) => w.id === workspaceId)?.name,
    [workspacesQuery.data, workspaceId],
  );

  const auditQuery = useAuditLog(isAdmin ? workspaceId : undefined);

  const allEvents = useMemo(
    () => auditQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [auditQuery.data],
  );

  // ── Access denied ─────────────────────────────────────────────────────────

  // While the role is still loading (null), show a loading state; once we know
  // the role, render the appropriate content.
  if (myRole === null && workspacesQuery.isLoading) {
    return (
      <Shell workspaceName={workspaceName} workspaceId={workspaceId}>
        <LoadingState label="Loading…" />
      </Shell>
    );
  }

  if (!isAdmin) {
    return (
      <Shell workspaceName={workspaceName} workspaceId={workspaceId}>
        <div className="mx-auto flex w-full max-w-4xl flex-col items-center justify-center gap-4 p-12 text-center">
          <svg
            className="h-12 w-12 text-slate-300"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <h2 className="text-base font-semibold text-slate-700">
            Admin access required
          </h2>
          <p className="max-w-xs text-sm text-slate-500">
            Only workspace administrators can view the audit log.
          </p>
        </div>
      </Shell>
    );
  }

  // ── Main view ─────────────────────────────────────────────────────────────

  return (
    <Shell workspaceName={workspaceName} workspaceId={workspaceId}>
      <div className="mx-auto w-full max-w-6xl p-4 sm:p-6" data-testid="audit-log-page">
        <div className="mb-5">
          <h1 className="text-lg font-semibold text-slate-900">Audit log</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Security- and governance-relevant actions in this workspace.
          </p>
        </div>

        {auditQuery.isLoading ? (
          <LoadingState label="Loading audit events…" />
        ) : auditQuery.isError ? (
          <ErrorState
            error={auditQuery.error}
            onRetry={() => void auditQuery.refetch()}
          />
        ) : allEvents.length === 0 ? (
          <EmptyState
            icon={
              <svg
                className="h-10 w-10 text-slate-300"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
              </svg>
            }
            title="No audit events yet"
            description="Events will appear here as you manage membership, projects, webhooks, and API tokens."
          />
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
              <table
                className="min-w-full text-left"
                aria-label="Audit log events"
                data-testid="audit-log-table"
              >
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400 sm:px-4">
                      Time
                    </th>
                    <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400 sm:px-4">
                      Actor
                    </th>
                    <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400 sm:px-4">
                      Action
                    </th>
                    <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400 sm:px-4">
                      Target
                    </th>
                    <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400 sm:px-4">
                      Details
                    </th>
                    <th className="hidden px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400 sm:table-cell sm:px-4">
                      IP
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {allEvents.map((event) => (
                    <AuditRow key={event.id} event={event} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Load more */}
            {auditQuery.hasNextPage && (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="ghost"
                  loading={auditQuery.isFetchingNextPage}
                  onClick={() => void auditQuery.fetchNextPage()}
                  data-testid="audit-log-load-more"
                >
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────────

function Shell({
  children,
  workspaceName,
  workspaceId,
}: {
  children: React.ReactNode;
  workspaceName: string | undefined;
  workspaceId: string;
}) {
  return (
    <div className="flex h-screen flex-col overflow-x-clip">
      <AppHeader>
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          <Link
            to="/"
            className="shrink-0 text-sm text-ink-400 hover:text-ink-600"
            aria-label="Back to dashboard"
          >
            Dashboard
          </Link>
          <span className="shrink-0 text-ink-300">/</span>
          <span className="min-w-0 truncate text-sm text-ink-500">
            {workspaceName ?? 'Workspace'}
          </span>
          <span className="shrink-0 text-ink-300">/</span>
          <span className="shrink-0 text-sm font-semibold text-ink-900">
            Audit log
          </span>
        </div>
      </AppHeader>
      <WorkspaceSettingsNav workspaceId={workspaceId} />
      <main className="flex flex-1 flex-col overflow-y-auto">{children}</main>
    </div>
  );
}
