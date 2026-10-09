import type { ReactNode } from 'react';
import { Logo } from '@/components/Logo';

/*
 * DISPATCH auth shell — the first thing every visitor sees.
 *
 * Desktop (lg+): split layout. Left, a fixed deep-cobalt brand panel whose
 * signature is the "dispatch ledger": issue keys on a vertical lane rail, each
 * ticked with the same cobalt rail-tick the sidebar uses for the active item.
 * Right, the form sitting flat on the page surface (no card-in-a-card).
 * Mobile: the panel drops away entirely — wordmark, rail-ticked title, form —
 * so the form is above the fold at 393x852 with 44px-tall controls.
 *
 * The panel is decorative (aria-hidden) and contains none of the strings the
 * auth e2e suites match on.
 */

/** Shared auth-form sizing: 44px controls on touch, 40px on desktop. */
export const AUTH_INPUT = 'h-11 sm:h-10';
export const AUTH_BUTTON = 'h-11 w-full sm:h-10';
/** Inline text link with a >=40px hit area. */
export const AUTH_LINK =
  'inline-flex min-h-10 items-center font-medium text-signal-700 underline-offset-2 transition-colors duration-[120ms] hover:text-signal-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-500 rounded-sm';
/** Secondary full-width link button (SSO providers). */
export const AUTH_SSO =
  'flex h-11 w-full items-center justify-center rounded-md border border-ink-200 bg-surface px-4 text-sm font-medium text-ink-700 shadow-xs transition-colors duration-[120ms] hover:bg-ink-50 hover:border-ink-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-500 sm:h-10';

export function AuthError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
    >
      {children}
    </p>
  );
}

const LEDGER: { key: string; title: string; state: 'done' | 'active' | 'todo'; label: string }[] = [
  { key: 'NL-101', title: 'Cut the release branch', state: 'done', label: 'Done' },
  { key: 'NL-102', title: 'Wire the board to live updates', state: 'active', label: 'In progress' },
  { key: 'NL-103', title: 'Triage the inbound queue', state: 'todo', label: 'To do' },
  { key: 'NL-104', title: 'Hand a task to your agent', state: 'todo', label: 'To do' },
];

function BrandPanel() {
  return (
    <aside
      aria-hidden="true"
      className="nl-auth-brand hidden flex-col justify-between p-12 lg:flex xl:p-16"
      data-testid="auth-brand-panel"
    >
      <span className="inline-flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded bg-white text-[#0b1747]">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
            <path d="M5 19V7m7 12V11m7 8V14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </span>
        <span className="font-display text-lg font-semibold tracking-[-0.025em] text-white">
          Next Lane
        </span>
      </span>

      <div className="max-w-md">
        <p className="font-display text-[2.75rem] font-bold leading-[1.04] tracking-[-0.035em] text-white">
          Work moves
          <br />
          in lanes.
        </p>
        <p className="nl-auth-brand__muted mt-5 max-w-sm text-base">
          Issue and project tracking you host yourself. Unlimited seats, your
          data on your machine, and tools your agents can use too.
        </p>
        <ol className="nl-auth-ledger mt-10 list-none">
          {LEDGER.map((row) => (
            <li key={row.key} className="nl-auth-row" data-state={row.state}>
              <span className="nl-auth-row__key">{row.key}</span>
              <span className="min-w-0 truncate font-sans">{row.title}</span>
              <span className="nl-auth-row__state">{row.label}</span>
            </li>
          ))}
        </ol>
      </div>

      <p className="nl-auth-brand__muted font-mono text-xs tracking-wide">
        Open source &middot; MIT &middot; Self-hosted
      </p>
    </aside>
  );
}

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-surface lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
      <BrandPanel />
      <main className="flex min-h-screen flex-col px-5 py-6 sm:px-10 lg:min-h-0 lg:px-14 lg:py-10">
        <div className="lg:hidden">
          <Logo />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <div className="relative mb-7 pl-4 before:absolute before:bottom-1 before:left-0 before:top-1 before:w-[3px] before:rounded-full before:bg-signal-600">
            <h1 className="font-display text-2xl font-bold tracking-[-0.03em] text-ink-900">
              {title}
            </h1>
            {subtitle && <p className="mt-1 text-sm text-ink-600">{subtitle}</p>}
          </div>
          {children}
          {footer && (
            <div className="mt-6 border-t border-ink-100 pt-5 text-sm text-ink-600">{footer}</div>
          )}
        </div>
        <p className="text-center text-xs text-ink-600 lg:text-left">
          Built by{' '}
          <a
            href="https://overcastly.com"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Overcastly AI — opens in a new tab"
            data-testid="overcastly-credit"
            className="inline-flex min-h-10 items-center rounded-sm text-ink-600 underline decoration-ink-300 underline-offset-2 transition-colors duration-120 hover:text-ink-900 hover:decoration-ink-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-500"
          >
            Overcastly AI
          </a>
        </p>
      </main>
    </div>
  );
}
