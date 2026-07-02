import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { login, getAuthProviders } from '@/api/auth';
import { API_URL, ApiError } from '@/api/client';
import { qk } from '@/api/keys';
import { AuthShell } from './AuthShell';
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
        <p className="text-sm text-ink-500">
          New here?{' '}
          <Link to="/register" className="font-medium text-signal-600 hover:text-signal-700 transition-colors duration-[120ms]">
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
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </Field>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="password" className="block text-xs font-medium text-ink-600">
              Password
            </label>
            <Link
              to="/forgot-password"
              className="text-xs font-medium text-signal-600 hover:text-signal-700 transition-colors duration-[120ms]"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        {(error || ssoError) && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
            {error ?? ssoError}
          </p>
        )}
        <Button type="submit" loading={submitting} className="w-full">
          Sign in
        </Button>
      </form>
      {ssoEnabled && (
        <>
          <div className="my-5 flex items-center gap-3" role="separator" aria-orientation="horizontal">
            <div className="h-px flex-1 bg-ink-200" />
            <span className="text-xs font-medium uppercase tracking-wide text-ink-400">or</span>
            <div className="h-px flex-1 bg-ink-200" />
          </div>
          <a
            href={`${API_URL}/api/auth/oidc/login`}
            data-testid="sso-login-button"
            className="flex w-full items-center justify-center rounded-md border border-ink-200 bg-white px-4 py-2 text-sm font-medium text-ink-700 shadow-sm transition-colors duration-[120ms] hover:bg-ink-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-500"
          >
            Continue with {ssoLabel}
          </a>
        </>
      )}
    </AuthShell>
  );
}
