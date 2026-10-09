import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Global keyboard shortcuts (single keys, no modifiers — Cmd/Ctrl-K belongs to
 * the command palette).
 *
 *   ?        keyboard-shortcuts cheat-sheet
 *   c        create an issue in the current project
 *   g b/l/d/r  go to board / backlog / dashboards / roadmap
 *   /        focus the page's search (`[data-shortcut-search]`)
 *   j / k    move focus between `[data-nav-item]` cards/rows
 *
 * Suppressed while typing, while any modal/dialog is open, and on Triage
 * (which owns its own key map).
 */

/** Selector for elements j/k walk through (board cards, backlog rows). */
export const NAV_ITEM_SELECTOR = '[data-nav-item]';
/** Selector for the page's primary search field (`/` target). */
export const SEARCH_SELECTOR = '[data-shortcut-search]';

const GO_TARGETS: Record<string, string> = {
  b: 'board',
  l: 'backlog',
  d: 'dashboards',
  r: 'roadmap',
};
const GO_TIMEOUT_MS = 1200;

/** Project id from a `/projects/:id/...` pathname, if any. */
export function projectIdFromPath(pathname: string): string | null {
  const m = /^\/projects\/([^/]+)/.exec(pathname);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Routes whose pages own their keyboard map. */
export function ownsKeyboard(pathname: string): boolean {
  return /^\/projects\/[^/]+\/triage(\/|$)/.test(pathname);
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const el = target as HTMLElement;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el.isContentEditable || el.getAttribute('contenteditable') === 'true';
}

export function isDialogOpen(doc: Document = document): boolean {
  return (
    doc.querySelector(
      '[role="dialog"], [role="alertdialog"], [aria-modal="true"]',
    ) !== null
  );
}

/** Next index for j (+1) / k (-1); first press lands on the first/last item. */
export function nextNavIndex(
  current: number,
  count: number,
  dir: 1 | -1,
): number {
  if (count <= 0) return -1;
  if (current < 0) return dir === 1 ? 0 : count - 1;
  return Math.min(count - 1, Math.max(0, current + dir));
}

function visibleNavItems(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(NAV_ITEM_SELECTOR),
  ).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
}

export interface GlobalShortcutOptions {
  enabled: boolean;
  onShowHelp: () => void;
}

export function useGlobalShortcuts({ enabled, onShowHelp }: GlobalShortcutOptions) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const helpRef = useRef(onShowHelp);
  helpRef.current = onShowHelp;

  useEffect(() => {
    if (!enabled) return;
    let goArmedUntil = 0;

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.isComposing || e.repeat) return;
      if (isTypingTarget(e.target) || isDialogOpen()) return;
      const path = pathRef.current;
      if (ownsKeyboard(path)) return;
      const projectId = projectIdFromPath(path);
      const key = e.key;

      if (key === '?') {
        e.preventDefault();
        helpRef.current();
        return;
      }

      if (goArmedUntil > Date.now()) {
        goArmedUntil = 0;
        const dest = GO_TARGETS[key.toLowerCase()];
        if (dest && projectId) {
          e.preventDefault();
          navigate(`/projects/${projectId}/${dest}`);
        }
        return;
      }

      switch (key) {
        case 'c':
          if (!projectId) return;
          e.preventDefault();
          navigate(`/projects/${projectId}/board?new=1`);
          return;
        case 'g':
          if (!projectId) return;
          e.preventDefault();
          goArmedUntil = Date.now() + GO_TIMEOUT_MS;
          return;
        case '/': {
          const el = document.querySelector<HTMLElement>(SEARCH_SELECTOR);
          if (!el) return;
          e.preventDefault();
          el.focus();
          return;
        }
        case 'j':
        case 'k': {
          const items = visibleNavItems();
          if (items.length === 0) return;
          e.preventDefault();
          const active = document.activeElement as HTMLElement | null;
          const current = active
            ? items.findIndex((el) => el === active || el.contains(active))
            : -1;
          const next = items[nextNavIndex(current, items.length, key === 'j' ? 1 : -1)];
          next?.focus({ preventScroll: false });
          next?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          return;
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, navigate]);
}
