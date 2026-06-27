/**
 * Runtime API URL resolution.
 *
 * Priority (highest to lowest):
 *   1. window.__NL_CONFIG__.apiUrl  — injected at container start via /config.js
 *      (nginx envsubst or sh entrypoint; enables ONE built image across envs)
 *   2. import.meta.env.VITE_API_URL — set at Vite build time (pnpm dev / CI)
 *   3. 'http://localhost:4000'      — safe local default
 *
 * In development (`pnpm dev` / `vite preview`) config.js is never loaded, so
 * the fallback chain resolves to the Vite env var or the hardcoded default —
 * no extra setup required.
 *
 * In the production container the entrypoint writes:
 *   window.__NL_CONFIG__ = { apiUrl: "https://api.example.com" };
 * to /usr/share/nginx/html/config.js, which index.html loads as the very first
 * script tag. The bundle reads this helper at module-initialisation time.
 */

declare global {
  interface Window {
    __NL_CONFIG__?: { apiUrl?: string };
  }
}

/**
 * Return the base API URL for this runtime environment.
 * Call this once per module; the value is stable for the page lifetime.
 */
export function getApiUrl(): string {
  return (
    window.__NL_CONFIG__?.apiUrl ??
    import.meta.env.VITE_API_URL ??
    'http://localhost:4000'
  );
}
