import { Link } from 'react-router-dom';
import { useCallback, useMemo, useState } from 'react';
import { Logo } from '@/components/Logo';
import { Modal } from '@/components/ui/Modal';
import { parseChangelog } from '@/lib/changelog';

export const REPO_URL = 'https://github.com/Overcastly-AI/Next-Lane';
export const DOCS_URL = 'https://overcastly-ai.github.io/Next-Lane/';
const SEEN_KEY = 'nl.whatsNew.seenVersion';

export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
const CHANGELOG: string = typeof __APP_CHANGELOG__ === 'string' ? __APP_CHANGELOG__ : '';

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null; // storage blocked — treat as unseen
  }
}

/**
 * "New" dot state: true until the user opens What's new for the current
 * version. Persisted per version so each release re-arms it exactly once.
 */
export function useWhatsNewDot() {
  const [seen, setSeen] = useState<string | null>(readSeen);
  const markSeen = useCallback(() => {
    try {
      localStorage.setItem(SEEN_KEY, APP_VERSION);
    } catch {
      /* storage blocked — dot just reappears next load */
    }
    setSeen(APP_VERSION);
  }, []);
  return { hasNew: seen !== APP_VERSION && CHANGELOG !== '', markSeen };
}

const linkCls =
  'rounded-sm font-medium text-signal-600 underline decoration-signal-600/30 underline-offset-2 transition-colors duration-[120ms] hover:text-signal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500';

export function WhatsNewModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const entries = useMemo(() => parseChangelog(CHANGELOG, 5), []);
  return (
    <Modal open={open} onClose={onClose} title="What's new" size="max-w-xl">
      <div data-testid="whats-new-modal">
        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-500">
            Release notes aren&apos;t bundled with this build.{' '}
            <a href={`${REPO_URL}/releases`} target="_blank" rel="noopener noreferrer" className={linkCls}>
              See releases on GitHub
            </a>
            .
          </p>
        ) : (
          <ol className="space-y-6">
            {entries.map((e, i) => (
              <li key={e.version} data-testid="whats-new-entry">
                <div className="flex items-baseline gap-2">
                  <h3 className="font-display text-base font-semibold tracking-[-0.02em] text-ink-900">
                    v{e.version}
                  </h3>
                  {i === 0 && (
                    <span className="rounded-full bg-signal-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-signal-700">
                      Latest
                    </span>
                  )}
                  {e.date && <span className="text-xs text-ink-400">{e.date}</span>}
                </div>
                {e.sections.map((s) => (
                  <div key={s.title} className="mt-2">
                    <h4 className="text-xs font-semibold text-ink-500">{s.title}</h4>
                    <ul className="mt-1 space-y-1.5">
                      {s.items.map((it, j) => (
                        <li
                          key={j}
                          className="relative pl-3.5 text-sm leading-snug text-ink-700 before:absolute before:left-0 before:top-[0.55em] before:h-1 before:w-1 before:rounded-full before:bg-ink-300"
                        >
                          {it.scope && (
                            <span className="mr-1 font-mono text-xs font-semibold text-ink-500">
                              {it.scope}
                            </span>
                          )}
                          {it.text}
                          {it.refs
                            .filter((r) => r.label.startsWith('#'))
                            .map((r) => (
                              <a
                                key={r.url}
                                href={r.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`ml-1 font-mono text-xs ${linkCls}`}
                              >
                                {r.label}
                              </a>
                            ))}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </li>
            ))}
          </ol>
        )}
        <p className="mt-6 border-t border-ink-100 pt-3 text-xs text-ink-500">
          <a href={`${REPO_URL}/blob/main/CHANGELOG.md`} target="_blank" rel="noopener noreferrer" className={linkCls}>
            Full changelog
          </a>
        </p>
      </div>
    </Modal>
  );
}

export function AboutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const links = [
    { label: 'Documentation', href: DOCS_URL },
    { label: 'API reference', to: '/developers' },
    { label: 'MCP server for AI agents', href: `${DOCS_URL}guide/agents-mcp` },
    { label: 'GitHub repository', href: REPO_URL },
  ];
  return (
    <Modal open={open} onClose={onClose} title="About Next Lane" size="max-w-sm">
      <div data-testid="about-modal" className="text-center">
        <div className="flex justify-center py-2">
          <Logo />
        </div>
        <p data-testid="about-version" className="mt-1 font-mono text-xs text-ink-500">
          Version {APP_VERSION}
        </p>
        <p className="mt-3 text-sm text-ink-600">
          Free, open-source, self-hosted issue and project tracking — MIT licensed, built by{' '}
          <a href="https://overcastly.com" target="_blank" rel="noopener noreferrer" className={linkCls}>
            Overcastly AI
          </a>
          .
        </p>
        <ul className="mt-4 divide-y divide-ink-100 rounded-lg border border-ink-200 text-left text-sm">
          {links.map((l) => (
            <li key={l.label}>
              {l.href ? (
                <a
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between px-3 py-2.5 text-ink-700 transition-colors duration-[120ms] hover:bg-ink-50 focus-visible:bg-ink-50 focus-visible:outline-none"
                >
                  {l.label}
                  <span aria-hidden="true" className="text-ink-400">↗</span>
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              ) : (
                <Link
                  to={l.to ?? '/'}
                  onClick={onClose}
                  className="flex items-center justify-between px-3 py-2.5 text-ink-700 transition-colors duration-[120ms] hover:bg-ink-50 focus-visible:bg-ink-50 focus-visible:outline-none"
                >
                  {l.label}
                  <span aria-hidden="true" className="text-ink-400">→</span>
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
