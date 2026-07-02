import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { me } from '@/api/auth';
import { setToken, clearAuth, USER_KEY, ApiError } from '@/api/client';
import { qk } from '@/api/keys';
import { AuthShell } from './AuthShell';

/**
 * Landing page for a successful SSO/OIDC redirect.
 *
 * The API's `/api/auth/oidc/callback` handler redirects the browser here with
 * the issued JWT in the URL *fragment* (`#token=...`), never a query
 * parameter — fragments are never sent to the server or logged in access
 * logs/Referer headers, matching how SPA auth-callback patterns keep tokens
 * out of server-side logs.
 *
 * On mount: read the token from the fragment, persist it exactly like
 * `AuthContext`/`api/auth.ts` do after a password login (`setToken` +
 * `localStorage[USER_KEY]` + seed the `qk.me` query cache), strip the
 * fragment from the URL, then land on the home page.
 */
export function SsoCompletePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    const params = new URLSearchParams(raw);
    const token = params.get('token');

    if (!token) {
      setError('No SSO token was returned. Please try signing in again.');
      return;
    }

    setToken(token);
    // Strip the token out of the URL/history immediately — it must not
    // linger in the address bar or browser history.
    window.history.replaceState(null, '', '/login/sso-complete');

    let cancelled = false;
    me()
      .then((user) => {
        if (cancelled) return;
        localStorage.setItem(USER_KEY, JSON.stringify(user));
        qc.setQueryData(qk.me, user);
        navigate('/', { replace: true });
      })
      .catch((err) => {
        if (cancelled) return;
        clearAuth();
        setError(
          err instanceof ApiError ? err.message : 'SSO sign-in failed. Please try again.',
        );
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <AuthShell
        title="Sign-in failed"
        subtitle={error}
        footer={
          <p className="text-sm text-ink-500">
            <Link
              to="/login"
              className="font-medium text-signal-600 hover:text-signal-700 transition-colors duration-[120ms]"
            >
              Back to sign in
            </Link>
          </p>
        }
      >
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Signing you in…" subtitle="Completing single sign-on">
      <div className="flex justify-center py-4" role="status" aria-live="polite">
        <span className="sr-only">Signing you in…</span>
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-ink-200 border-t-signal-500" />
      </div>
    </AuthShell>
  );
}
