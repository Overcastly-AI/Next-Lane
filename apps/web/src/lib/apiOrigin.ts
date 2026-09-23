import { API_URL } from '@/api/client';

/**
 * The API's origin as seen from the browser — the value scripts, `curl`, and
 * an MCP client's `NEXT_LANE_API_URL` all need.
 *
 * `API_URL` (`VITE_API_URL` / runtime `config.js`) is `''` in the default
 * same-origin deployment (the app and API share an origin behind one reverse
 * proxy), so the origin is `window.location.origin`; when the install points
 * at a separate API host, `API_URL` already holds that absolute origin.
 *
 * Shared by `ApiDocsPage`'s REST snippets and every MCP config generator so
 * the two surfaces can never disagree about which host they mean.
 */
export function getApiOrigin(): string {
  return API_URL || (typeof window !== 'undefined' ? window.location.origin : '');
}
