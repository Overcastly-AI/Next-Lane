import { useState } from 'react';
import type {
  DashboardShareTokenDto,
  CreateDashboardShareTokenResponse,
} from '@next-lane/shared';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';
import {
  useDashboardShareTokens,
  useCreateDashboardShareToken,
  useRevokeDashboardShareToken,
} from '@/api/share-tokens';

/** The frontend origin used to build the dashboard share URL. */
function shareUrl(rawToken: string): string {
  return `${window.location.origin}/share/dashboard/${rawToken}`;
}

/** Formats an ISO date string for display. */
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ── New-token banner: displayed once right after minting ─────────────────────

function NewTokenBanner({
  result,
  onDismiss,
}: {
  result: CreateDashboardShareTokenResponse;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const url = shareUrl(result.rawToken);

  function copy() {
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  return (
    <div
      data-testid="new-dashboard-share-token-banner"
      className="mb-4 rounded-lg border border-green-200 bg-green-50 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-green-800">
            Share link created — copy it now
          </p>
          <p className="mt-0.5 text-xs text-green-700">
            Anyone with this link can view this dashboard read-only, no
            sign-in required. Copy it before closing — the full URL is only
            shown once.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code
              data-testid="dashboard-share-token-url"
              className="min-w-0 flex-1 break-all rounded border border-green-200 bg-surface px-2.5 py-1.5 font-mono text-xs text-slate-800"
            >
              {url}
            </code>
            <Button size="sm" variant="secondary" onClick={copy} className="shrink-0">
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="shrink-0 rounded p-1 text-green-500 hover:text-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-300"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Share token row ───────────────────────────────────────────────────────────

function ShareTokenRow({
  token,
  onRevoke,
}: {
  token: DashboardShareTokenDto;
  onRevoke: () => void;
}) {
  const isActive = !token.revokedAt;

  return (
    <li className="flex items-center gap-3 py-3" data-testid="dashboard-share-token-row">
      <span
        className={cn('h-2 w-2 shrink-0 rounded-full', isActive ? 'bg-green-500' : 'bg-slate-300')}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-700">
          Created <span className="font-medium">{fmtDate(token.createdAt)}</span>
        </p>
        {token.revokedAt && (
          <p className="text-xs text-slate-400">Revoked {fmtDate(token.revokedAt)}</p>
        )}
      </div>
      <span
        className={cn(
          'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
          isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500',
        )}
      >
        {isActive ? 'Active' : 'Revoked'}
      </span>
      {isActive && (
        <button
          type="button"
          aria-label="Revoke share link"
          data-testid="revoke-dashboard-share-token-btn"
          onClick={onRevoke}
          className="shrink-0 rounded p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 6h18M8 6V4h8v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6"
            />
          </svg>
        </button>
      )}
    </li>
  );
}

// ── Main modal ─────────────────────────────────────────────────────────────

/**
 * "Share dashboard" modal — ADMIN-only. Lets an admin create a public
 * read-only link for a single dashboard, copy it, and revoke it. Mirrors
 * `ShareSection` (the project-board equivalent), adapted to a modal since a
 * dashboard has no dedicated settings page of its own.
 */
export function DashboardShareModal({
  open,
  onClose,
  dashboardId,
  dashboardName,
}: {
  open: boolean;
  onClose: () => void;
  dashboardId: string | undefined;
  dashboardName: string;
}) {
  const tokensQuery = useDashboardShareTokens(dashboardId);
  const createToken = useCreateDashboardShareToken(dashboardId);
  const revokeToken = useRevokeDashboardShareToken(dashboardId);
  const toast = useToast();

  const [newResult, setNewResult] = useState<CreateDashboardShareTokenResponse | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<DashboardShareTokenDto | null>(null);

  const tokens = tokensQuery.data ?? [];
  const activeCount = tokens.filter((t) => !t.revokedAt).length;

  function handleCreate() {
    createToken.mutate(undefined, {
      onSuccess: (data) => setNewResult(data),
      onError: (err) => toast.error(errorMessage(err, 'Could not create the share link.')),
    });
  }

  function confirmRevoke() {
    if (!pendingRevoke) return;
    const target = pendingRevoke;
    revokeToken.mutate(target.id, {
      onSuccess: () => toast.success('Share link revoked.'),
      onError: (err) => toast.error(errorMessage(err, 'Could not revoke the share link.')),
      onSettled: () => setPendingRevoke(null),
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Share "${dashboardName}"`}
      size="max-w-lg"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <p className="text-xs text-slate-500">
          Create a read-only public link that lets anyone with the URL view
          this dashboard — no account required.
        </p>
        <Button
          size="sm"
          onClick={handleCreate}
          loading={createToken.isPending}
          data-testid="create-dashboard-share-token-btn"
          className="shrink-0"
        >
          + Create link
        </Button>
      </div>

      {newResult && <NewTokenBanner result={newResult} onDismiss={() => setNewResult(null)} />}

      {tokensQuery.isLoading ? (
        <p className="py-4 text-sm text-slate-400">Loading share links…</p>
      ) : tokens.length === 0 ? (
        <p className="py-2 text-sm text-slate-400">
          No share links yet. Create one to let stakeholders view this
          dashboard without signing in.
        </p>
      ) : (
        <>
          {activeCount > 0 && (
            <p className="mb-2 text-xs text-slate-500">
              {activeCount} active link{activeCount !== 1 ? 's' : ''} — anyone
              with the URL can view this dashboard.
            </p>
          )}
          <ul className="divide-y divide-slate-100" data-testid="dashboard-share-token-list">
            {tokens.map((token) => (
              <ShareTokenRow
                key={token.id}
                token={token}
                onRevoke={() => setPendingRevoke(token)}
              />
            ))}
          </ul>
        </>
      )}

      <ConfirmDialog
        open={pendingRevoke !== null}
        title="Revoke share link"
        message="Revoke this share link? Anyone currently using it will immediately lose access."
        confirmLabel="Revoke link"
        variant="danger"
        loading={revokeToken.isPending}
        onCancel={() => setPendingRevoke(null)}
        onConfirm={confirmRevoke}
      />
    </Modal>
  );
}
