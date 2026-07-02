// Synchronous theme bootstrap — runs before any CSS/JS bundle paints so
// there is no flash of the wrong theme. Mirrors the `nl.theme` preference
// written by ThemeContext (src/contexts/ThemeContext.tsx): 'light' |
// 'dark' | 'system' (default, falls back to `prefers-color-scheme`).
//
// This file is deliberately tiny, dependency-free, and self-hosted (served
// as a static asset under the app's own origin) so it satisfies a strict
// `script-src 'self'` CSP with no 'unsafe-inline'/nonce/hash needed — it is
// loaded via a normal, BLOCKING <script src="/theme-init.js"> in <head>,
// before the app bundle, which preserves the same no-flash guarantee an
// inline script would have given.
(function () {
  try {
    var pref = localStorage.getItem('nl.theme');
    var isDark =
      pref === 'dark' ||
      (pref !== 'light' &&
        window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    var root = document.documentElement;
    if (isDark) root.classList.add('dark');
    root.style.colorScheme = isDark ? 'dark' : 'light';
  } catch (e) {
    /* localStorage/matchMedia unavailable — default to light, matches
       the CSS :root default so this is a safe no-op either way. */
  }
})();
