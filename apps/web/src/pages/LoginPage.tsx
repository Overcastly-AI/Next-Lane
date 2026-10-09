import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { login, getAuthProviders } from '@/api/auth';
import { API_URL, ApiError } from '@/api/client';
import { qk } from '@/api/keys';
import { AuthShell, AuthError, AUTH_BUTTON, AUTH_INPUT, AUTH_LINK, AUTH_SSO } from './AuthShell';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Field';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const from =
    (location.state as { from?: { pathname?: string } } | null)?.from
      ?.pathname ?? '/';

  // SSO/OIDC is entirely optional and env-configured server-side — never
  // assume it's available; only render the button once the API confirms it.
  const providersQuery = useQuery({
    queryKey: qk.authProviders,
    queryFn: getAuthProviders,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const ssoEnabled = providersQuery.data?.oidc.enabled ?? false;
  const ssoLabel = providersQuery.data?.oidc.label ?? 'Single sign-on';
  // SSO/OIDC Phase 2 — every currently-enabled row from the N-simultaneous
  // -providers list, alongside (not replacing) the legacy button above.
  const multiProviders = providersQuery.data?.providers ?? [];
  const anySsoAvailable = ssoEnabled || multiProviders.length > 0;

  // A failed SSO callback redirects back here with ?ssoError=<message>.
  const ssoError = new URLSearchParams(location.search).get('ssoError');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await login({ email, password });
      qc.setQueryData(qk.me, res.user);
      navigate(from, { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Unable to sign in. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your Next Lane workspace"
      footer={
        <p>
          New here?{' '}
          <Link to="/register" className={AUTH_LINK}>
            Create an account
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            className={AUTH_INPUT}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </Field>
        <Field
          label="Password"
          htmlFor="password"
          action={
            <Link to="/forgot-password" className={`${AUTH_LINK} text-xs`}>
              Forgot password?
            </Link>
          }
        >
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            className={AUTH_INPUT}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </Field>
        {(error || ssoError) && <AuthError>{error ?? ssoError}</AuthError>}
        <Button type="submit" loading={submitting} className={AUTH_BUTTON}>
          Sign in
        </Button>
      </form>
      {anySsoAvailable && (
        <>
          <div className="my-5 flex items-center gap-3" role="separator" aria-orientation="horizontal">
            <div className="h-px flex-1 bg-ink-200" />
            <span className="text-xs font-medium uppercase tracking-wide text-ink-500">or</span>
            <div className="h-px flex-1 bg-ink-200" />
          </div>
          <div className="space-y-2">
            {ssoEnabled && (
              <a
                href={`${API_URL}/api/auth/oidc/login`}
                data-testid="sso-login-button"
                className={AUTH_SSO}
              >
                Continue with {ssoLabel}
              </a>
            )}
            {multiProviders.map((provider) => (
              <a
                key={provider.slug}
                href={`${API_URL}/api/auth/sso/${provider.slug}/login`}
                data-testid={`sso-login-button-${provider.slug}`}
                className={AUTH_SSO}
              >
                Continue with {provider.label}
              </a>
            ))}
          </div>
        </>
      )}
    </AuthShell>
  );
}
