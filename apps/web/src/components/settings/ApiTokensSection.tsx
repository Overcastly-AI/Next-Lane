import { useState, type FormEvent } from 'react';
import type { ApiTokenDto, CreateApiTokenResponse } from '@next-lane/shared';
import { PAT_SCOPES } from '@next-lane/shared';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';
import {
  useApiTokens,
  useCreateApiToken,
  useRevokeApiToken,
} from '@/api/api-tokens';

/** Human-readable label for each scope string. */
const SCOPE_LABELS: Record<string, string> = {
  'issues:read': 'Issues — read',
  'issues:write': 'Issues — write',
  'projects:read': 'Projects — read',
  'projects:write': 'Projects — write',
  'webhooks:read': 'Webhooks — read',
  'webhooks:write': 'Webhooks — write',
  'comments:read': 'Comments — read',
  'comments:write': 'Comments — write',
};

/** Formats an ISO date string for display. */
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Card wrapper mirroring the Settings page section style. */
function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-card sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs text-gray-500">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Modal that captures token name + optional expiry + optional scopes, then shows the raw token once. */
function CreateTokenModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const create = useCreateApiToken();
  const toast = useToast();

  const [name, setName] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [result, setResult] = useState<CreateApiTokenResponse | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setName('');
    setExpiresAt('');
    setSelectedScopes([]);
    setResult(null);
    setCopied(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function toggleScope(scope: string) {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(
      {
        name: trimmed,
        expiresAt: expiresAt || undefined,
        // Pass scopes only when at least one is selected; empty = unrestricted.
        scopes: selectedScopes.length > 0 ? selectedScopes : [],
      },
      {
        onSuccess: (data) => setResult(data),
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not create the API token.')),
      },
    );
  }

  function copyToken() {
    if (!result) return;
    void navigator.clipboard.writeText(result.rawToken).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Modal open={open} onClose={handleClose} title="Create API token">
      {!result ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Token name" htmlFor="pat-name">
            <Input
              id="pat-name"
              placeholder="e.g. CI pipeline, Local scripts"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              maxLength={100}
              required
            />
          </Field>

          <Field
            label="Expiry (optional)"
            htmlFor="pat-expires"
          >
            <Input
              id="pat-expires"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
            />
            <p className="mt-1 text-xs text-gray-400">
              Leave blank to create a non-expiring token.
            </p>
          </Field>

          {/* Scope selection */}
          <fieldset>
            <legend className="mb-1.5 text-xs font-medium text-gray-700">
              Scopes (optional)
            </legend>
            <p className="mb-2 text-xs text-gray-400">
              Leave all unchecked for an unrestricted token with full owner
              permissions. Selecting scopes restricts this token to only those
              operations.
            </p>
            <div
              className="grid grid-cols-2 gap-x-4 gap-y-1.5"
              data-testid="pat-scope-checkboxes"
            >
              {PAT_SCOPES.map((scope) => (
                <label
                  key={scope}
                  className="flex cursor-pointer items-center gap-2 text-sm text-gray-700"
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    checked={selectedScopes.includes(scope)}
                    onChange={() => toggleScope(scope)}
                    data-testid={`pat-scope-${scope}`}
                  />
                  {SCOPE_LABELS[scope] ?? scope}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={create.isPending}
              disabled={!name.trim()}
            >
              Create token
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-semibold text-amber-800">
              Copy your token now
            </p>
            <p className="mt-1 text-xs text-amber-700">
              This token will not be shown again. Store it somewhere safe — if
              you lose it you will need to create a new one.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Your new token
            </p>
            <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 p-2.5">
              <code
                data-testid="pat-raw-token"
                className="min-w-0 flex-1 break-all font-mono text-xs text-gray-800"
              >
                {result.rawToken}
              </code>
              <Button
                size="sm"
                variant="secondary"
                onClick={copyToken}
                className="shrink-0"
              >
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-500">Name</p>
              <p className="font-medium text-gray-900">{result.name}</p>
            </div>
            {result.expiresAt && (
              <div>
                <p className="text-xs text-gray-500">Expires</p>
                <p className="font-medium text-gray-900">
                  {fmtDate(result.expiresAt)}
                </p>
              </div>
            )}
            <div>
              <p className="text-xs text-gray-500">Created</p>
              <p className="font-medium text-gray-900">
                {fmtDate(result.createdAt)}
              </p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-gray-500">Scopes</p>
              <p className="font-medium text-gray-900">
                {result.scopes.length > 0
                  ? result.scopes.map((s) => SCOPE_LABELS[s] ?? s).join(', ')
                  : 'Unrestricted (full owner permissions)'}
              </p>
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <Button onClick={handleClose}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * API Tokens settings section: allows any authenticated user to create, list,
 * and revoke personal access tokens (PATs) for scripting and CI use.
 *
 * This section is user-scoped — each user manages their own tokens only.
 * Rendered in the user profile / personal settings area (e.g. under /me/settings).
 */
export function ApiTokensSection() {
  const tokensQuery = useApiTokens();
  const revokeToken = useRevokeApiToken();
  const toast = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<ApiTokenDto | null>(null);

  const tokens = tokensQuery.data ?? [];

  function confirmRevoke() {
    if (!pendingRevoke) return;
    const target = pendingRevoke;
    revokeToken.mutate(target.id, {
      onSuccess: () => toast.success(`Token "${target.name}" revoked.`),
      onError: (err) =>
        toast.error(errorMessage(err, 'Could not revoke the token.')),
      onSettled: () => setPendingRevoke(null),
    });
  }

  return (
    <SectionCard
      title="API tokens"
      description="Use personal access tokens to authenticate API calls from scripts, CI pipelines, or automation tools — without a browser session."
      action={
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          + Create token
        </Button>
      }
    >
      {tokensQuery.isLoading ? (
        <p className="py-4 text-sm text-gray-400">Loading tokens…</p>
      ) : tokens.length === 0 ? (
        <p className="py-2 text-sm text-gray-400">
          No tokens yet. Create one to authenticate scripts and CI pipelines.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100" data-testid="pat-token-list">
          {tokens.map((token) => (
            <TokenRow
              key={token.id}
              token={token}
              onRevoke={() => setPendingRevoke(token)}
            />
          ))}
        </ul>
      )}

      <CreateTokenModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />

      <ConfirmDialog
        open={pendingRevoke !== null}
        title="Revoke token"
        message={
          <>
            Revoke{' '}
            <span className="font-medium text-gray-900">
              {pendingRevoke?.name}
            </span>
            ? Any scripts or integrations using this token will stop working
            immediately.
          </>
        }
        confirmLabel="Revoke token"
        variant="danger"
        loading={revokeToken.isPending}
        onCancel={() => setPendingRevoke(null)}
        onConfirm={confirmRevoke}
      />
    </SectionCard>
  );
}

function TokenRow({
  token,
  onRevoke,
}: {
  token: ApiTokenDto;
  onRevoke: () => void;
}) {
  const isRevoked = !!token.revokedAt;
  const isExpired =
    !isRevoked && token.expiresAt
      ? new Date(token.expiresAt) < new Date()
      : false;
  const isActive = !isRevoked && !isExpired;

  return (
    <li
      className="flex items-center gap-3 py-3"
      data-testid="pat-token-row"
    >
      {/* Status dot */}
      <span
        className={cn(
          'h-2 w-2 shrink-0 rounded-full',
          isActive ? 'bg-green-500' : 'bg-gray-300',
        )}
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-800">
          {token.name}
        </p>
        <p className="text-xs text-gray-500">
          {isRevoked
            ? `Revoked ${fmtDate(token.revokedAt!)}`
            : isExpired
              ? `Expired ${fmtDate(token.expiresAt!)}`
              : token.expiresAt
                ? `Expires ${fmtDate(token.expiresAt)}`
                : 'No expiry'}
          {' · '}
          {token.lastUsedAt
            ? `Last used ${fmtDate(token.lastUsedAt)}`
            : 'Never used'}
        </p>
        {/* Scope pills */}
        {token.scopes && token.scopes.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1" data-testid="pat-scopes">
            {token.scopes.map((scope) => (
              <span
                key={scope}
                className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700"
              >
                {SCOPE_LABELS[scope] ?? scope}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-0.5 text-xs text-gray-400" data-testid="pat-scopes-unrestricted">
            Unrestricted
          </p>
        )}
      </div>

      {/* Status badge */}
      <span
        className={cn(
          'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
          isRevoked
            ? 'bg-red-100 text-red-700'
            : isExpired
              ? 'bg-orange-100 text-orange-700'
              : 'bg-green-100 text-green-700',
        )}
      >
        {isRevoked ? 'Revoked' : isExpired ? 'Expired' : 'Active'}
      </span>

      {/* Revoke button (only for active/expired, not already-revoked) */}
      {!isRevoked && (
        <button
          type="button"
          aria-label={`Revoke token ${token.name}`}
          onClick={onRevoke}
          className="shrink-0 rounded p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
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
