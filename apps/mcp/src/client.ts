/**
 * Thin HTTP client for the Next Lane REST API.
 *
 * Centralizes base URL + bearer auth + JSON encoding/decoding and surfaces the
 * API's own error message (and status) when a request fails, so MCP tool
 * handlers can stay tiny.
 */

import type { NextLaneConfig } from './config.js';

/** Error raised for any non-2xx API response. Carries the HTTP status. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  /** JSON-serializable request body (omitted for GET/DELETE without a body). */
  body?: unknown;
  /** Query parameters; undefined/null values are skipped. */
  query?: Record<string, string | number | boolean | undefined | null>;
}

/**
 * Extract a human-readable message from a parsed error body. NestJS typically
 * returns `{ message: string | string[], error, statusCode }`.
 */
function extractErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const m = (body as { message?: unknown }).message;
    if (typeof m === 'string' && m.trim()) return m;
    if (Array.isArray(m) && m.length) return m.join('; ');
    const e = (body as { error?: unknown }).error;
    if (typeof e === 'string' && e.trim()) return e;
  }
  if (typeof body === 'string' && body.trim()) return body;
  return fallback;
}

export class NextLaneClient {
  /** Fully-qualified API base including the `/api` global prefix. */
  private readonly baseUrl: string;

  constructor(
    private readonly config: NextLaneConfig,
    /** Injectable fetch for testing; defaults to global fetch (Node >= 18). */
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = `${config.apiUrl}/api`;
  }

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  /**
   * Perform a request. Returns the parsed JSON body (or `null` for empty/204
   * responses). Throws {@link ApiError} on a non-2xx status with the API's
   * error message attached.
   */
  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, query } = options;
    const url = this.buildUrl(path, query);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.token}`,
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new ApiError(
        `Network error calling Next Lane API at ${url}: ${reason}. ` +
          `Check NEXT_LANE_API_URL and that the API is running.`,
        0,
      );
    }

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      const message = extractErrorMessage(
        parsed,
        `Next Lane API request failed (${res.status} ${res.statusText})`,
      );
      throw new ApiError(`${message} [HTTP ${res.status}]`, res.status);
    }

    return parsed as T;
  }

  get<T = unknown>(path: string, query?: RequestOptions['query']): Promise<T> {
    return this.request<T>(path, { method: 'GET', query });
  }

  post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'POST', body });
  }

  patch<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PATCH', body });
  }

  put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: 'PUT', body });
  }

  delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }
}
