import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useCommandPalette } from '@/components/CommandPaletteProvider';
import { Logo } from '@/components/Logo';

// Link-styled buttons: same recipe as ui/Button (a <Link> can't be a <button>).
const BTN =
  'inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold tracking-[-0.01em] transition-all duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2';
const BTN_PRIMARY = `${BTN} border border-signal-700/20 bg-signal-600 text-white shadow-xs hover:bg-signal-700`;
const BTN_SECONDARY = `${BTN} border border-ink-200 bg-surface text-ink-700 shadow-xs hover:border-ink-300 hover:bg-ink-50`;

/**
 * Catch-all for unknown URLs. Renders inside the app shell when signed in and
 * standalone when signed out, so a mistyped link never silently dumps you on a
 * different page (the old behaviour) or on a login wall with no explanation.
 */
export function NotFoundPage() {
  const { isAuthenticated } = useAuth();
  const { open: openPalette } = useCommandPalette();
  const { pathname } = useLocation();

  useEffect(() => {
    document.title = 'Page not found · Next Lane';
    return () => {
      document.title = 'Next Lane';
    };
  }, []);

  return (
    <main
      data-testid="not-found-page"
      className="flex min-h-screen items-center justify-center bg-ink-50 px-4 py-10"
    >
      <div className="w-full max-w-md text-center">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        {/* Signature: the lane mark with its third bar knocked off the lane. */}
        <svg
          viewBox="0 0 96 64"
          className="mx-auto h-16 w-24"
          fill="none"
          aria-hidden="true"
        >
          <path d="M14 56V24" strokeWidth="9" strokeLinecap="round" className="stroke-signal-600" />
          <path d="M44 56V12" strokeWidth="9" strokeLinecap="round" className="stroke-signal-600" />
          <path d="M82 46l-8-26" strokeWidth="9" strokeLinecap="round" className="stroke-ink-300" />
        </svg>
        <p className="mt-6 font-mono text-xs font-semibold tracking-widest text-signal-600">
          ERROR 404
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-[-0.025em] text-ink-900">
          This lane doesn&apos;t go anywhere
        </h1>
        <p className="mt-2 text-sm text-ink-500">
          Nothing lives at{' '}
          <code className="break-all rounded bg-ink-100 px-1 py-0.5 font-mono text-xs text-ink-800">
            {pathname}
          </code>
          . It may have moved, or the link is mistyped.
        </p>
        <div className="mt-7 flex flex-col justify-center gap-2 sm:flex-row">
          <Link to="/" data-testid="not-found-home" className={BTN_PRIMARY}>
            {isAuthenticated ? 'Go to dashboard' : 'Go to sign in'}
          </Link>
          {isAuthenticated && (
            <button
              type="button"
              onClick={openPalette}
              data-testid="not-found-search"
              className={BTN_SECONDARY}
            >
              Open search
              <kbd className="rounded border border-ink-200 bg-ink-50 px-1 py-0.5 font-mono text-[10px] leading-none text-ink-400">
                ⌘K
              </kbd>
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
