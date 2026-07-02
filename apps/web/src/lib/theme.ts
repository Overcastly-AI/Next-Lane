/**
 * Light / dark mode — storage + resolution helpers.
 *
 * The persisted PREFERENCE is one of 'light' | 'dark' | 'system'. The
 * RESOLVED mode ('light' | 'dark') is what's actually applied to the DOM —
 * when the preference is 'system' it tracks `prefers-color-scheme` live.
 *
 * Class strategy: `document.documentElement` gets a `.dark` class when the
 * resolved mode is dark (Tailwind `darkMode: 'class'`). Applied synchronously
 * before first paint by an inline script in `index.html` (mirrors the
 * `nl.activeWorkspaceId` / `nl.sidebarCollapsed` synchronous-restore pattern
 * already used elsewhere) so there is no flash of the wrong theme.
 */

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'nl.theme';

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export function readStoredThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    /* private mode / storage disabled — fall back to system */
  }
  return 'system';
}

export function writeStoredThemePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    /* private mode / storage disabled — in-memory only for this session */
  }
}

/** Does the OS/browser currently prefer dark mode? */
export function systemPrefersDark(): boolean {
  try {
    return window.matchMedia(DARK_MEDIA_QUERY).matches;
  } catch {
    return false;
  }
}

/** Resolve a stored preference to an actual light/dark mode. */
export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return pref;
}

/** Apply (or remove) the `.dark` class + `color-scheme` on the document root. */
export function applyResolvedTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
}

/**
 * Subscribe to OS-level `prefers-color-scheme` changes. Returns an unsubscribe
 * function. Safe to call even in environments without `matchMedia` (SSR/tests).
 */
export function watchSystemTheme(onChange: (isDark: boolean) => void): () => void {
  try {
    const mql = window.matchMedia(DARK_MEDIA_QUERY);
    const handler = (e: MediaQueryListEvent) => onChange(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  } catch {
    return () => {};
  }
}
