import { useState } from 'react';
import { API_URL, getToken } from './client';

/**
 * Fetch `GET /projects/:projectId/issues.csv` with the app's Bearer token,
 * materialise the response as a Blob, and trigger a browser download via a
 * temporary object-URL anchor.
 *
 * Why not a plain <a href>?
 * The app authenticates via a Bearer token stored in localStorage — the browser
 * does NOT send it automatically on navigations, so a bare anchor would get a 401.
 * We therefore fetch manually (same path the `request()` helper uses), inject the
 * Authorization header, stream the response into a Blob, then synthesise the
 * anchor click in JS so the file lands in the browser's download tray without
 * ever navigating away from the page.
 *
 * Filename priority:
 *   1. Content-Disposition: attachment; filename="..." from the server response
 *   2. `fallbackFilename` arg (e.g. "<projectKey>-issues.csv")
 */
async function fetchCsvBlob(
  projectId: string,
  query: string | undefined,
  fallbackFilename: string,
): Promise<void> {
  const params = new URLSearchParams();
  if (query && query.trim()) params.set('q', query.trim());

  const url = `${API_URL}/api/projects/${projectId}/issues.csv${params.size ? `?${params.toString()}` : ''}`;

  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { method: 'GET', headers });

  if (!res.ok) {
    // Surface the API's own message when present (e.g. an NLQL 400 —
    // "Invalid NLQL query: unknown user \"Alex Rivera\" — ..." — MCP-QA pass
    // 1, finding 1 residual) instead of a generic "(400)" the caller can't
    // act on. Falls back to the status-only message if the body isn't the
    // usual `{ message }` JSON error shape (e.g. a proxy error page).
    let message = `Export failed (${res.status})`;
    try {
      const body: unknown = await res.json();
      if (body && typeof body === 'object' && 'message' in body) {
        const raw = (body as { message?: unknown }).message;
        const text = Array.isArray(raw) ? raw.join(', ') : raw;
        if (typeof text === 'string' && text.trim()) message = text;
      }
    } catch {
      // Non-JSON error body — keep the generic status message.
    }
    throw new Error(message);
  }

  // Derive filename from Content-Disposition if the server sends one.
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const filenameMatch = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
  const filename = filenameMatch
    ? filenameMatch[1].replace(/['"]/g, '').trim() || fallbackFilename
    : fallbackFilename;

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  // Release the object URL after a short delay so the browser has time to
  // initiate the download before we revoke the reference.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
}

export interface UseExportCsvOptions {
  projectId: string;
  /** NLQL query string to narrow the exported set (BoardPage passes this in). */
  nlqlQuery?: string;
  /** Shown in the filename when the server omits Content-Disposition. */
  projectKey?: string;
  /** Called on success — typically no-op but wired for tests. */
  onSuccess?: () => void;
  /** Called on failure — typically shows a toast. */
  onError?: (err: Error) => void;
}

export interface UseExportCsvReturn {
  exportCsv: () => void;
  isExporting: boolean;
}

/**
 * Thin hook that wraps `fetchCsvBlob` in React state so the button can reflect
 * in-flight status (disabled + spinner) and surface errors via the toast system.
 */
export function useExportCsv({
  projectId,
  nlqlQuery,
  projectKey,
  onSuccess,
  onError,
}: UseExportCsvOptions): UseExportCsvReturn {
  const [isExporting, setIsExporting] = useState(false);

  function exportCsv() {
    if (!projectId || isExporting) return;
    setIsExporting(true);
    const fallback = projectKey ? `${projectKey}-issues.csv` : 'issues.csv';
    fetchCsvBlob(projectId, nlqlQuery, fallback)
      .then(() => {
        setIsExporting(false);
        onSuccess?.();
      })
      .catch((err: unknown) => {
        setIsExporting(false);
        const error = err instanceof Error ? err : new Error('Export failed');
        onError?.(error);
      });
  }

  return { exportCsv, isExporting };
}
