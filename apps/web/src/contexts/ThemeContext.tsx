/**
 * ThemeContext — app-level light/dark/system theme preference.
 *
 * Mirrors the `SidebarContext` pattern: persisted to localStorage and
 * restored SYNCHRONOUSLY (read in the `useState` initializer) so the first
 * React render already reflects the user's choice. The very first PAINT is
 * handled even earlier, by a plain inline `<script>` in `index.html` that
 * applies the `.dark` class before any CSS/JS bundle loads — that's what
 * actually prevents a flash of the wrong theme; this context keeps React
 * state in sync with that DOM class afterward and reacts to OS-level
 * `prefers-color-scheme` changes while the preference is 'system'.
 *
 * Lives above `WorkspaceProvider` in `App.tsx` — `WorkspaceContext` reads
 * `resolvedTheme` from here so runtime brand-color theming
 * (`applyBrandColor`) can regenerate its scale for the active mode whenever
 * the theme flips.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  applyResolvedTheme,
  readStoredThemePreference,
  resolveTheme,
  watchSystemTheme,
  writeStoredThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme';

interface ThemeContextValue {
  /** The user's stored choice: 'light' | 'dark' | 'system'. */
  theme: ThemePreference;
  /** What's actually applied right now ('system' resolved against the OS). */
  resolvedTheme: ResolvedTheme;
  setTheme: (pref: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(() => readStoredThemePreference());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(theme));

  // Keep the DOM class in sync with React state (idempotent — the inline
  // index.html script already applied the correct class before this ever
  // runs, so this is a no-op on initial mount in the common case).
  useEffect(() => {
    applyResolvedTheme(resolvedTheme);
  }, [resolvedTheme]);

  // While the preference is 'system', track OS changes live (no reload
  // needed if the user flips their OS theme with the app open).
  useEffect(() => {
    if (theme !== 'system') return;
    return watchSystemTheme((isDark) => setResolvedTheme(isDark ? 'dark' : 'light'));
  }, [theme]);

  const setTheme = useCallback((pref: ThemePreference) => {
    setThemeState(pref);
    writeStoredThemePreference(pref);
    setResolvedTheme(resolveTheme(pref));
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a <ThemeProvider>.');
  }
  return ctx;
}
