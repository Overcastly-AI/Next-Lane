/**
 * Instance-level SSO/OIDC admin configuration screen.
 *
 * Lets an instance admin set up SSO from a settings page instead of editing
 * env vars + redeploying the API (Ready-queue item, VISION.md "Admin
 * controls" scorecard row). Gated on `User.isInstanceAdmin` — a strictly
 * narrower, instance-wide gate than workspace `Membership.role: ADMIN`,
 * enforced server-side on every request; the client-side gate here is purely
 * for UX (no flash of a form a non-admin can't use), never the source of
 * truth.
 *
 * States:
 *  - env-managed: OIDC_ISSUER_URL/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET are set
 *    in the environment — those values win over anything saved here, so the
 *    form renders read-only with an explanatory banner (a save would be
 *    rejected by the server anyway).
 *  - editable: no env vars set — the form is live; saving takes effect on
 *    the very next login attempt / `GET /auth/providers` poll, no API
 *    restart needed.
 *
 * Route: /admin/sso
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AppHeader } from '@/components/AppHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Field';
import { LoadingState, ErrorState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth/AuthContext';
import { useOidcConfig, useUpdateOidcConfig } from '@/api/adminSettings';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';

// ── Toggle switch (mirrors NotificationPreferencesSection's accessible switch) ──

function Switch({
  checked,
  onChange,
  disabled,
  label,
  testId,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full',
        'transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 focus-visible:ring-offset-1',
        checked ? 'bg-signal-600' : 'bg-ink-300',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-3.5 w-3.5 rounded-full bg-surface shadow transition-transform duration-200',
          checked ? 'translate-x-4' : 'translate-x-1',
        )}
      />
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AdminSsoSettingsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const isInstanceAdmin = !!user?.isInstanceAdmin;

  const configQuery = useOidcConfig(isInstanceAdmin);
  const update = useUpdateOidcConfig();
  const toast = useToast();

  const config = configQuery.data;
  const envManaged = config?.envManaged ?? false;

  const [enabled, setEnabled] = useState(false);
  const [issuerUrl, setIssuerUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [label, setLabel] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Prefill form state from the loaded config exactly once — after that the
  // form is the source of truth until Save (a background refetch must never
  // clobber in-progress edits).
  useEffect(() => {
    if (config && !initialized) {
      setEnabled(config.enabled);
      setIssuerUrl(config.issuerUrl ?? '');
      setClientId(config.clientId ?? '');
      setLabel(config.label ?? '');
      setInitialized(true);
    }
  }, [config, initialized]);

  const isDirty =
    initialized &&
    !!config &&
    !envManaged &&
    (enabled !== config.enabled ||
      issuerUrl !== (config.issuerUrl ?? '') ||
      clientId !== (config.clientId ?? '') ||
      label !== (config.label ?? '') ||
      clientSecret !== '');

  // Unsaved-changes guard: warn on tab close/refresh while dirty. (In-app
  // navigation via <Link> is not intercepted — react-router v6's plain
  // BrowserRouter has no data-router blocker available here — but the native
  // browser prompt covers the highest-cost accidental-loss case.)
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  function handleSave(e: FormEvent) {
    e.preventDefault();
    setValidationError(null);

    const trimmedIssuer = issuerUrl.trim();
    const trimmedClientId = clientId.trim();
    const trimmedSecret = clientSecret.trim();
    const trimmedLabel = label.trim();

    if (enabled && (!trimmedIssuer || !trimmedClientId || (!config?.hasClientSecret && !trimmedSecret))) {
      setValidationError(
        'Issuer URL, client ID, and a client secret are all required to enable SSO.',
      );
      return;
    }

    update.mutate(
      {
        enabled,
        ...(trimmedIssuer ? { issuerUrl: trimmedIssuer } : {}),
        ...(trimmedClientId ? { clientId: trimmedClientId } : {}),
        ...(trimmedLabel ? { label: trimmedLabel } : {}),
        ...(trimmedSecret ? { clientSecret: trimmedSecret } : {}),
      },
      {
        onSuccess: (dto) => {
          toast.success('SSO configuration saved.');
          setEnabled(dto.enabled);
          setIssuerUrl(dto.issuerUrl ?? '');
          setClientId(dto.clientId ?? '');
          setLabel(dto.label ?? '');
          setClientSecret('');
        },
        onError: (err) => {
          toast.error(errorMessage(err, 'Could not save SSO configuration.'));
        },
      },
    );
  }

  // ── Access denied ─────────────────────────────────────────────────────────

  if (authLoading) {
    return (
      <Shell>
        <LoadingState label="Loading…" />
      </Shell>
    );
  }

  if (!isInstanceAdmin) {
    return (
      <Shell>
        <div
          data-testid="admin-sso-access-denied"
          className="mx-auto flex w-full max-w-3xl flex-col items-center justify-center gap-4 p-12 text-center"
        >
          <svg
            className="h-12 w-12 text-ink-300"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <h2 className="text-base font-semibold text-ink-700">
            Instance-admin access required
          </h2>
          <p className="max-w-xs text-sm text-ink-500">
            Only this instance's designated admin can manage SSO/OIDC
            configuration.
          </p>
        </div>
      </Shell>
    );
  }

  if (configQuery.isLoading) {
    return (
      <Shell>
        <LoadingState label="Loading SSO configuration…" />
      </Shell>
    );
  }

  if (configQuery.isError) {
    return (
      <Shell>
        <ErrorState
          error={configQuery.error}
          onRetry={() => void configQuery.refetch()}
        />
      </Shell>
    );
  }

  // ── Main ──────────────────────────────────────────────────────────────────

  return (
    <Shell>
      <div className="mx-auto w-full max-w-2xl p-4 sm:p-6">
        <div className="mb-5">
          <h1 className="text-lg font-semibold text-ink-900">SSO / OIDC</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            Let people sign in with your identity provider (Okta, Auth0,
            Keycloak, Authentik, or any standards-compliant OIDC provider).
          </p>
        </div>

        {envManaged && (
          <div
            data-testid="admin-sso-env-managed-banner"
            className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-3.5"
          >
            <p className="text-sm font-medium text-amber-800">
              Configured via environment variables
            </p>
            <p className="mt-1 text-xs text-amber-700">
              <code className="rounded bg-surface px-1 py-0.5 font-mono">OIDC_ISSUER_URL</code>,{' '}
              <code className="rounded bg-surface px-1 py-0.5 font-mono">OIDC_CLIENT_ID</code>, and{' '}
              <code className="rounded bg-surface px-1 py-0.5 font-mono">OIDC_CLIENT_SECRET</code>{' '}
              are set on this deployment — those values always take
              precedence, so this form is read-only. Unset them to manage SSO
              from here instead.
            </p>
          </div>
        )}

        <form
          onSubmit={handleSave}
          className="space-y-5 rounded-xl border border-ink-200 bg-surface p-4 shadow-card sm:p-5"
          data-testid="admin-sso-form"
        >
          <div className="flex items-start gap-3 rounded-lg border border-ink-200 bg-ink-50 p-3.5">
            <Switch
              checked={enabled}
              onChange={() => setEnabled((v) => !v)}
              disabled={envManaged}
              label={enabled ? 'SSO enabled — click to disable' : 'SSO disabled — click to enable'}
              testId="admin-sso-enabled-toggle"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink-800">Enable SSO login</p>
              <p className="mt-0.5 text-xs text-ink-500">
                When on, a "Continue with…" button appears on the login page.
              </p>
            </div>
          </div>

          <Field label="Issuer URL" htmlFor="admin-sso-issuer-url" hint="The provider's OIDC discovery issuer, e.g. https://your-tenant.okta.com.">
            <Input
              id="admin-sso-issuer-url"
              data-testid="admin-sso-issuer-url"
              value={issuerUrl}
              onChange={(e) => setIssuerUrl(e.target.value)}
              placeholder="https://your-tenant.okta.com"
              autoComplete="off"
              disabled={envManaged}
            />
          </Field>

          <Field label="Client ID" htmlFor="admin-sso-client-id">
            <Input
              id="admin-sso-client-id"
              data-testid="admin-sso-client-id"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="0oa1b2c3d4e5f6g7h8i9"
              autoComplete="off"
              disabled={envManaged}
            />
          </Field>

          <Field
            label="Client secret"
            htmlFor="admin-sso-client-secret"
            hint={
              config?.hasClientSecret
                ? 'Never shown after saving — leave blank to keep the current secret, or type a new one to rotate it.'
                : 'The OAuth2/OIDC client secret. Stored encrypted; never displayed again.'
            }
          >
            <Input
              id="admin-sso-client-secret"
              data-testid="admin-sso-client-secret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={config?.hasClientSecret ? '••• saved' : ''}
              autoComplete="off"
              disabled={envManaged}
            />
          </Field>

          <Field label="Button label" htmlFor="admin-sso-label" hint='Shown as "Continue with <label>" on the login page.'>
            <Input
              id="admin-sso-label"
              data-testid="admin-sso-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Single sign-on"
              autoComplete="off"
              disabled={envManaged}
            />
          </Field>

          {validationError && (
            <p role="alert" data-testid="admin-sso-validation-error" className="text-sm text-red-600">
              {validationError}
            </p>
          )}

          {!envManaged && (
            <div className="flex items-center gap-3">
              <Button
                type="submit"
                size="sm"
                loading={update.isPending}
                disabled={update.isPending || (initialized && !isDirty)}
                data-testid="admin-sso-save"
              >
                Save changes
              </Button>
              {isDirty && (
                <span className="text-xs text-ink-400" data-testid="admin-sso-unsaved-indicator">
                  Unsaved changes
                </span>
              )}
            </div>
          )}
        </form>
      </div>
    </Shell>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
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
          <span className="shrink-0 text-sm font-semibold text-ink-900">
            SSO / OIDC
          </span>
        </div>
      </AppHeader>
      <main className="flex flex-1 flex-col overflow-y-auto">{children}</main>
    </div>
  );
}
