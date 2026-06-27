import { getApiUrl } from './config';

/**
 * Resolved API base URL for this runtime.
 *
 * Reads window.__NL_CONFIG__.apiUrl first (injected at container start by the
 * nginx entrypoint), then falls back to the Vite build-time env var, then a
 * sane localhost default.  See src/api/config.ts for the full priority chain.
 *
 * Exported for the socket client and any legacy import sites; prefer calling
 * getApiUrl() directly in new code.
 */
export const API_URL: string = getApiUrl();

export const TOKEN_KEY = 'nl_token';
export const USER_KEY = 'nl_user';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Core request helper. Prefixes `/api`, attaches the bearer token from
 * localStorage, parses JSON, and throws an ApiError carrying the server
 * message on any non-2xx response.
 */
export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, signal } = options;
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_URL}/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  // Try to parse a JSON payload; tolerate empty/non-JSON bodies.
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const message = extractMessage(data) ?? `Request failed (${res.status})`;
    if (res.status === 401) {
      // Token is invalid/expired — clear it so guards redirect to login.
      clearAuth();
    }
    throw new ApiError(message, res.status);
  }

  return data as T;
}

/** Nest error bodies look like { message: string | string[], error, statusCode }. */
function extractMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return typeof data === 'string' && data ? data : null;
  }
  const m = (data as { message?: unknown }).message;
  if (Array.isArray(m)) return m.join(', ');
  if (typeof m === 'string') return m;
  return null;
}
