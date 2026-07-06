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
import type { SsoProviderDto } from '@next-lane/shared';
import { Role, SsoProviderType } from '@next-lane/shared';
import { AppHeader } from '@/components/AppHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { Field } from '@/components/ui/Field';
import { LoadingState, ErrorState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth/AuthContext';
import {
  useOidcConfig,
  useUpdateOidcConfig,
  useSsoProviders,
  useCreateSsoProvider,
  useUpdateSsoProvider,
  useDeleteSsoProvider,
} from '@/api/adminSettings';
import { useWorkspaces } from '@/api/workspaces';
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

  const workspacesQuery = useWorkspaces();
  const workspaces = workspacesQuery.data ?? [];

  const [enabled, setEnabled] = useState(false);
  const [issuerUrl, setIssuerUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [label, setLabel] = useState('');
  // SSO/OIDC Phase 2 — JIT provisioning for this (legacy) provider. Empty
  // string = "no default workspace" (JIT off), matching the API's `null`.
  const [jitWorkspaceId, setJitWorkspaceId] = useState('');
  const [jitRole, setJitRole] = useState<Role>(Role.VIEWER);
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
      setJitWorkspaceId(config.jitDefaultWorkspaceId ?? '');
      setJitRole(config.jitDefaultRole ?? Role.VIEWER);
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
      jitWorkspaceId !== (config.jitDefaultWorkspaceId ?? '') ||
      jitRole !== config.jitDefaultRole ||
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
        jitDefaultWorkspaceId: jitWorkspaceId || null,
        jitDefaultRole: jitRole,
      },
      {
        onSuccess: (dto) => {
          toast.success('SSO configuration saved.');
          setEnabled(dto.enabled);
          setIssuerUrl(dto.issuerUrl ?? '');
          setClientId(dto.clientId ?? '');
          setLabel(dto.label ?? '');
          setJitWorkspaceId(dto.jitDefaultWorkspaceId ?? '');
          setJitRole(dto.jitDefaultRole ?? Role.VIEWER);
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

          <div className="border-t border-ink-100 pt-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">
              Just-in-time provisioning
            </p>
            <div className="space-y-4">
              <Field
                label="Default workspace"
                htmlFor="admin-sso-jit-workspace"
                hint="A brand-new SSO identity's first login auto-joins this workspace. Leave blank to require a manual invite (default)."
              >
                <Select
                  id="admin-sso-jit-workspace"
                  data-testid="admin-sso-jit-workspace"
                  value={jitWorkspaceId}
                  onChange={(e) => setJitWorkspaceId(e.target.value)}
                  disabled={envManaged}
                >
                  <option value="">No default (manual invite required)</option>
                  {workspaces.map((ws) => (
                    <option key={ws.id} value={ws.id}>
                      {ws.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Default role" htmlFor="admin-sso-jit-role" hint="Role granted on auto-join. Defaults to the least-privileged Viewer role.">
                <Select
                  id="admin-sso-jit-role"
                  data-testid="admin-sso-jit-role"
                  value={jitRole}
                  onChange={(e) => setJitRole(e.target.value as Role)}
                  disabled={envManaged || !jitWorkspaceId}
                >
                  <option value={Role.VIEWER}>Viewer</option>
                  <option value={Role.MEMBER}>Member</option>
                  <option value={Role.ADMIN}>Admin</option>
                </Select>
              </Field>
            </div>
          </div>

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

        <SsoProvidersSection workspaces={workspaces} />
      </div>
    </Shell>
  );
}

// ── SSO/OIDC Phase 2 — N-simultaneous-providers list ─────────────────────────

type WorkspaceOption = { id: string; name: string };

function SsoProvidersSection({ workspaces }: { workspaces: WorkspaceOption[] }) {
  const providersQuery = useSsoProviders();
  const providers = providersQuery.data ?? [];
  const [creating, setCreating] = useState(false);

  return (
    <div className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">Additional providers</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Configure more than one identity provider (e.g. Okta for engineering, SAML for
            corporate ADFS) — every enabled provider gets its own button on the login page.
          </p>
        </div>
        {!creating && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="admin-sso-provider-add"
            onClick={() => setCreating(true)}
          >
            Add provider
          </Button>
        )}
      </div>

      {providersQuery.isLoading && <LoadingState label="Loading providers…" />}
      {providersQuery.isError && (
        <ErrorState error={providersQuery.error} onRetry={() => void providersQuery.refetch()} />
      )}

      {!providersQuery.isLoading && !providersQuery.isError && (
        <div className="space-y-3" data-testid="admin-sso-provider-list">
          {providers.length === 0 && !creating && (
            <p className="rounded-lg border border-dashed border-ink-200 p-4 text-center text-xs text-ink-400">
              No additional providers configured yet.
            </p>
          )}
          {providers.map((provider) => (
            <SsoProviderCard key={provider.id} provider={provider} workspaces={workspaces} />
          ))}
          {creating && (
            <SsoProviderForm workspaces={workspaces} onDone={() => setCreating(false)} />
          )}
        </div>
      )}
    </div>
  );
}

function SsoProviderCard({
  provider,
  workspaces,
}: {
  provider: SsoProviderDto;
  workspaces: WorkspaceOption[];
}) {
  const [editing, setEditing] = useState(false);
  const update = useUpdateSsoProvider();
  const remove = useDeleteSsoProvider();
  const toast = useToast();

  if (editing) {
    return (
      <SsoProviderForm
        workspaces={workspaces}
        existing={provider}
        onDone={() => setEditing(false)}
      />
    );
  }

  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-ink-200 bg-surface p-3.5 shadow-card"
      data-testid={`admin-sso-provider-${provider.slug}`}
    >
      <Switch
        checked={provider.enabled}
        onChange={() =>
          update.mutate(
            { id: provider.id, input: { enabled: !provider.enabled } },
            {
              onError: (err) => toast.error(errorMessage(err, 'Could not update provider.')),
            },
          )
        }
        label={provider.enabled ? `${provider.label} enabled — click to disable` : `${provider.label} disabled — click to enable`}
        testId={`admin-sso-provider-${provider.slug}-toggle`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-ink-800">{provider.label}</p>
          <span className="shrink-0 rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500">
            {provider.type}
          </span>
        </div>
        <p className="truncate text-xs text-ink-400">/auth/sso/{provider.slug}/login</p>
      </div>
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)} data-testid={`admin-sso-provider-${provider.slug}-edit`}>
        Edit
      </Button>
      <Button
        type="button"
        size="sm"
        variant="danger"
        data-testid={`admin-sso-provider-${provider.slug}-delete`}
        onClick={() => {
          if (!window.confirm(`Delete "${provider.label}"? This cannot be undone.`)) return;
          remove.mutate(provider.id, {
            onSuccess: () => toast.success('Provider deleted.'),
            onError: (err) => toast.error(errorMessage(err, 'Could not delete provider.')),
          });
        }}
      >
        Delete
      </Button>
    </div>
  );
}

function SsoProviderForm({
  workspaces,
  existing,
  onDone,
}: {
  workspaces: WorkspaceOption[];
  existing?: SsoProviderDto;
  onDone: () => void;
}) {
  const create = useCreateSsoProvider();
  const update = useUpdateSsoProvider();
  const toast = useToast();

  const [type, setType] = useState<SsoProviderType>(existing?.type ?? SsoProviderType.OIDC);
  const [label, setLabel] = useState(existing?.label ?? '');
  const [issuerUrl, setIssuerUrl] = useState(existing?.issuerUrl ?? '');
  const [clientId, setClientId] = useState(existing?.clientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [samlEntryPoint, setSamlEntryPoint] = useState(existing?.samlEntryPoint ?? '');
  const [samlIdpIssuer, setSamlIdpIssuer] = useState(existing?.samlIdpIssuer ?? '');
  const [samlIdpCertificate, setSamlIdpCertificate] = useState('');
  const [jitWorkspaceId, setJitWorkspaceId] = useState(existing?.jitDefaultWorkspaceId ?? '');
  const [jitRole, setJitRole] = useState<Role>(existing?.jitDefaultRole ?? Role.VIEWER);
  const [validationError, setValidationError] = useState<string | null>(null);

  const isEdit = !!existing;
  const pending = create.isPending || update.isPending;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setValidationError(null);

    if (!label.trim()) {
      setValidationError('A label is required.');
      return;
    }
    if (type === SsoProviderType.OIDC) {
      if (!issuerUrl.trim() || !clientId.trim() || (!isEdit && !clientSecret.trim())) {
        setValidationError('Issuer URL, client ID, and a client secret are required for an OIDC provider.');
        return;
      }
    } else {
      if (!samlEntryPoint.trim() || !samlIdpIssuer.trim() || (!isEdit && !samlIdpCertificate.trim())) {
        setValidationError('SSO URL, IdP entity ID, and a certificate are required for a SAML provider.');
        return;
      }
    }

    const shared = {
      label: label.trim(),
      jitDefaultWorkspaceId: jitWorkspaceId || null,
      jitDefaultRole: jitRole,
    };
    const typed =
      type === SsoProviderType.OIDC
        ? {
            issuerUrl: issuerUrl.trim(),
            clientId: clientId.trim(),
            ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
          }
        : {
            samlEntryPoint: samlEntryPoint.trim(),
            samlIdpIssuer: samlIdpIssuer.trim(),
            ...(samlIdpCertificate.trim() ? { samlIdpCertificate: samlIdpCertificate.trim() } : {}),
          };

    if (isEdit) {
      update.mutate(
        { id: existing.id, input: { ...shared, ...typed } },
        {
          onSuccess: () => {
            toast.success('Provider updated.');
            onDone();
          },
          onError: (err) => toast.error(errorMessage(err, 'Could not update provider.')),
        },
      );
    } else {
      create.mutate(
        { type, ...shared, ...typed },
        {
          onSuccess: () => {
            toast.success('Provider added.');
            onDone();
          },
          onError: (err) => toast.error(errorMessage(err, 'Could not add provider.')),
        },
      );
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg border border-signal-200 bg-signal-50/30 p-4"
      data-testid="admin-sso-provider-form"
    >
      {!isEdit && (
        <Field label="Provider type" htmlFor="admin-sso-provider-type">
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="sso-provider-type"
                checked={type === SsoProviderType.OIDC}
                onChange={() => setType(SsoProviderType.OIDC)}
                data-testid="admin-sso-provider-type-oidc"
              />
              OIDC
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="sso-provider-type"
                checked={type === SsoProviderType.SAML}
                onChange={() => setType(SsoProviderType.SAML)}
                data-testid="admin-sso-provider-type-saml"
              />
              SAML 2.0
            </label>
          </div>
        </Field>
      )}

      <Field label="Label" htmlFor="admin-sso-provider-label" hint='Shown as "Continue with <label>" on the login page.'>
        <Input
          id="admin-sso-provider-label"
          data-testid="admin-sso-provider-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Okta (Engineering)"
        />
      </Field>

      {type === SsoProviderType.OIDC ? (
        <>
          <Field label="Issuer URL" htmlFor="admin-sso-provider-issuer">
            <Input
              id="admin-sso-provider-issuer"
              data-testid="admin-sso-provider-issuer"
              value={issuerUrl}
              onChange={(e) => setIssuerUrl(e.target.value)}
              placeholder="https://your-tenant.okta.com"
            />
          </Field>
          <Field label="Client ID" htmlFor="admin-sso-provider-client-id">
            <Input
              id="admin-sso-provider-client-id"
              data-testid="admin-sso-provider-client-id"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            />
          </Field>
          <Field
            label="Client secret"
            htmlFor="admin-sso-provider-client-secret"
            hint={existing?.hasClientSecret ? 'Leave blank to keep the current secret.' : undefined}
          >
            <Input
              id="admin-sso-provider-client-secret"
              data-testid="admin-sso-provider-client-secret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={existing?.hasClientSecret ? '••• saved' : ''}
            />
          </Field>
        </>
      ) : (
        <>
          <Field label="IdP SSO URL" htmlFor="admin-sso-provider-entry-point" hint="The IdP's SSO endpoint (HTTP-Redirect binding).">
            <Input
              id="admin-sso-provider-entry-point"
              data-testid="admin-sso-provider-entry-point"
              value={samlEntryPoint}
              onChange={(e) => setSamlEntryPoint(e.target.value)}
              placeholder="https://adfs.corp.example.com/adfs/ls"
            />
          </Field>
          <Field label="IdP entity ID" htmlFor="admin-sso-provider-idp-issuer">
            <Input
              id="admin-sso-provider-idp-issuer"
              data-testid="admin-sso-provider-idp-issuer"
              value={samlIdpIssuer}
              onChange={(e) => setSamlIdpIssuer(e.target.value)}
              placeholder="https://adfs.corp.example.com/adfs/services/trust"
            />
          </Field>
          <Field
            label="IdP signing certificate"
            htmlFor="admin-sso-provider-cert"
            hint={
              existing?.hasSamlIdpCertificate
                ? 'Leave blank to keep the current certificate.'
                : 'PEM-encoded X.509 certificate(s) used to verify signed assertions. Required — unsigned assertions are always rejected.'
            }
          >
            <Textarea
              id="admin-sso-provider-cert"
              data-testid="admin-sso-provider-cert"
              value={samlIdpCertificate}
              onChange={(e) => setSamlIdpCertificate(e.target.value)}
              rows={4}
              placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
              className="font-mono text-xs"
            />
          </Field>
        </>
      )}

      <div className="border-t border-ink-100 pt-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">
          Just-in-time provisioning
        </p>
        <div className="space-y-3">
          <Field label="Default workspace" htmlFor="admin-sso-provider-jit-workspace">
            <Select
              id="admin-sso-provider-jit-workspace"
              data-testid="admin-sso-provider-jit-workspace"
              value={jitWorkspaceId}
              onChange={(e) => setJitWorkspaceId(e.target.value)}
            >
              <option value="">No default (manual invite required)</option>
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Default role" htmlFor="admin-sso-provider-jit-role">
            <Select
              id="admin-sso-provider-jit-role"
              data-testid="admin-sso-provider-jit-role"
              value={jitRole}
              onChange={(e) => setJitRole(e.target.value as Role)}
              disabled={!jitWorkspaceId}
            >
              <option value={Role.VIEWER}>Viewer</option>
              <option value={Role.MEMBER}>Member</option>
              <option value={Role.ADMIN}>Admin</option>
            </Select>
          </Field>
        </div>
      </div>

      {validationError && (
        <p role="alert" data-testid="admin-sso-provider-form-error" className="text-sm text-red-600">
          {validationError}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" loading={pending} disabled={pending} data-testid="admin-sso-provider-form-save">
          {isEdit ? 'Save changes' : 'Add provider'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
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
