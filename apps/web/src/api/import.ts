import { useQueryClient } from '@tanstack/react-query';
import { type ImportIssuesResultDto } from '@next-lane/shared';
import { API_URL, getToken, ApiError } from './client';
import { qk } from './keys';

/**
 * POST multipart/form-data to `/projects/:projectId/issues/import`.
 *
 * Uses the same bearer-token pattern as `export.ts`: the JWT is taken from
 * localStorage and injected manually so the authenticated fetch works without
 * the browser sending credentials automatically.
 *
 * @param projectId  The project to import into.
 * @param file       The CSV File object chosen by the user.
 * @param dryRun     When true the server validates without writing. Default false.
 */
async function postCsvImport(
  projectId: string,
  file: File,
  dryRun = false,
): Promise<ImportIssuesResultDto> {
  const formData = new FormData();
  formData.append('file', file);

  const params = dryRun ? '?dryRun=true' : '';
  const url = `${API_URL}/api/projects/${projectId}/issues/import${params}`;

  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  // Do NOT set Content-Type — the browser sets multipart/form-data with the
  // boundary automatically when you pass FormData to fetch().

  const res = await fetch(url, { method: 'POST', headers, body: formData });

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
    // Extract the server message the same way client.ts does.
    let message = `Import failed (${res.status})`;
    if (data && typeof data === 'object') {
      const m = (data as { message?: unknown }).message;
      if (Array.isArray(m)) message = m.join(', ');
      else if (typeof m === 'string') message = m;
    } else if (typeof data === 'string' && data) {
      message = data;
    }
    throw new ApiError(message, res.status);
  }

  return data as ImportIssuesResultDto;
}

export interface UseImportIssuesReturn {
  /**
   * Validate the CSV without writing (dry-run). Call this whenever the user
   * picks a new file to show a preview before committing.
   */
  dryRun: (file: File) => Promise<ImportIssuesResultDto>;
  /**
   * Perform the real import and invalidate the board / backlog queries so new
   * issues appear immediately.
   */
  importCsv: (file: File) => Promise<ImportIssuesResultDto>;
}

/**
 * Hook that exposes imperative helpers for CSV import.
 *
 * We deliberately use an imperative style (plain async functions rather than
 * `useMutation`) to keep the modal's state machine straightforward — the modal
 * holds in-flight / result state itself and doesn't need the full mutation
 * lifecycle object outside.
 */
export function useImportIssues(projectId: string): UseImportIssuesReturn {
  const qc = useQueryClient();

  async function dryRun(file: File): Promise<ImportIssuesResultDto> {
    return postCsvImport(projectId, file, true);
  }

  async function importCsv(file: File): Promise<ImportIssuesResultDto> {
    const result = await postCsvImport(projectId, file, false);
    // Invalidate all query keys that display issues so new rows appear without
    // a manual refresh.
    void qc.invalidateQueries({ queryKey: qk.projectIssues(projectId) });
    void qc.invalidateQueries({ queryKey: qk.board(projectId) });
    // Also invalidate any board views (keyed by board id) — we don't know the
    // board id here so invalidate the full 'boardView' prefix.
    void qc.invalidateQueries({ queryKey: ['boardView'] });
    return result;
  }

  return { dryRun, importCsv };
}
