/**
 * Client for page-body images.
 *
 * `GET /pages/:id/images` and `DELETE /page-images/:id` exist on the API (they
 * complete the resource and are covered by tests) but have no hook here yet —
 * there is no UI that lists or removes an image independently of its page, and
 * there deliberately isn't one that prunes unreferenced images either:
 * `PageVersion` history is append-only, so an image no longer in the LIVE body
 * may still be the illustration in a version someone can restore. Images die
 * with their page.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PageImageDto } from '@next-lane/shared';
import { API_URL, ApiError, getToken } from './client';
import { qk } from './keys';

/**
 * `POST /pages/:id/images` — upload an image into a page body.
 *
 * Uses raw `fetch` rather than the `request()` helper because the body is
 * `FormData`: `request()` sets `Content-Type: application/json` and stringifies,
 * which would destroy the multipart boundary.
 */
export function useUploadPageImage(pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<PageImageDto> => {
      const token = getToken();
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API_URL}/api/pages/${pageId}/images`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new ApiError(
          (data as { message?: string }).message ?? `Upload failed (${res.status})`,
          res.status,
        );
      }
      return data as PageImageDto;
    },
    onSuccess: (image) => {
      qc.setQueryData<PageImageDto[]>(qk.pageImages(pageId), (prev) =>
        prev ? [...prev, image] : [image],
      );
    },
  });
}

/**
 * Fetch one image's bytes with the caller's token.
 *
 * Returns a `blob:` object URL. The caller owns it and must revoke it —
 * `pageImages.ts` in `src/lib` does that bookkeeping centrally.
 */
export async function fetchPageImageBlobUrl(imageId: string): Promise<string> {
  const token = getToken();
  const res = await fetch(`${API_URL}/api/page-images/${imageId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new ApiError(`Failed to load image (${res.status})`, res.status);
  }
  return URL.createObjectURL(await res.blob());
}
