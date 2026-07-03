/**
 * Runtime configuration for the Next Lane MCP server.
 *
 * Configured entirely via environment variables so it can be launched by an MCP
 * host (Claude Desktop / Claude Code) with a small JSON/CLI config block.
 *
 *   NEXT_LANE_API_URL  Base URL of the Next Lane API. Defaults to
 *                      http://localhost:4000. The "/api" global prefix is added
 *                      automatically by the client, so point this at the host
 *                      root (NOT including /api).
 *   NEXT_LANE_TOKEN    A Next Lane Personal Access Token (starts with "nlp_").
 *                      REQUIRED — the server fails fast if it is missing.
 *   NEXT_LANE_MCP_STRICT_PROJECT_KEY
 *                      Optional ("1"/"true" to enable). When set, create_issue
 *                      requires `expectedProjectKey` on every call — omitting
 *                      it is a hard error (no issue created) instead of a
 *                      soft recommendation. Read directly from process.env by
 *                      the create_issue tool handler (apps/mcp/src/tools/
 *                      index.ts), not part of the NextLaneConfig object below,
 *                      since it only affects tool-level validation, not the
 *                      API client.
 */

export interface NextLaneConfig {
  /** Host root, e.g. http://localhost:4000 (no trailing slash, no /api). */
  apiUrl: string;
  /** Personal Access Token sent as `Authorization: Bearer <token>`. */
  token: string;
}

export const DEFAULT_API_URL = 'http://localhost:4000';

/** Thrown when required configuration is missing or invalid. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Resolve configuration from the environment. Throws {@link ConfigError} with a
 * clear, actionable message when NEXT_LANE_TOKEN is absent.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): NextLaneConfig {
  const token = (env.NEXT_LANE_TOKEN ?? '').trim();
  if (!token) {
    throw new ConfigError(
      'NEXT_LANE_TOKEN is required. Create a Personal Access Token in Next Lane ' +
        '(Settings → API Tokens) and set it as the NEXT_LANE_TOKEN environment ' +
        'variable for this MCP server.',
    );
  }

  const rawUrl = (env.NEXT_LANE_API_URL ?? '').trim() || DEFAULT_API_URL;
  // Normalize: strip a trailing slash and an accidental trailing "/api" so the
  // client can append the global prefix consistently.
  const apiUrl = rawUrl.replace(/\/+$/, '').replace(/\/api$/i, '');

  return { apiUrl, token };
}
