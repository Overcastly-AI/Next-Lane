import type { ReactNode } from 'react';
import { Logo } from '@/components/Logo';

/*
 * DISPATCH auth shell — precise, minimal.
 * Cool graphite-ink canvas, white card, no decorative gradients.
 * Space Grotesk for the heading/title.
 */
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
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3">
          <Logo />
          <div className="text-center">
            <h1 className="font-display text-xl font-bold tracking-[-0.025em] text-ink-900">{title}</h1>
            {subtitle && (
              <p className="mt-1 text-sm text-ink-500">{subtitle}</p>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-ink-200 bg-surface p-6 shadow-modal">
          {children}
        </div>
        {footer && <div className="mt-5 text-center">{footer}</div>}
        {/* Overcastly attribution — understated, ink-400, never competes with content */}
        <p className="mt-6 text-center text-xs text-ink-400">
          Built by{' '}
          <a
            href="https://overcastly.com"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Overcastly AI — opens in a new tab"
            data-testid="overcastly-credit"
            className="text-ink-400 underline decoration-ink-300 underline-offset-2 transition-colors duration-120 hover:text-ink-600 hover:decoration-ink-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-500 rounded-sm"
          >
            Overcastly AI
          </a>
        </p>
      </div>
    </div>
  );
}
