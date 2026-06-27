import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AttachmentDto } from '@next-lane/shared';
import { getToken, API_URL } from './client';
import { qk } from './keys';
import { ApiError } from './client';

export function useAttachments(issueId: string | undefined) {
  return useQuery({
    queryKey: qk.attachments(issueId ?? ''),
    enabled: !!issueId,
    queryFn: async () => {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/issues/${issueId}/attachments`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new ApiError(`Failed to load attachments`, res.status);
      return res.json() as Promise<AttachmentDto[]>;
    },
  });
}

export function useUploadAttachment(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<AttachmentDto> => {
      const token = getToken();
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API_URL}/api/issues/${issueId}/attachments`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        const msg =
          (data as { message?: string }).message ??
          `Upload failed (${res.status})`;
        throw new ApiError(msg, res.status);
      }
      return data as AttachmentDto;
    },
    onSuccess: (attachment) => {
      qc.setQueryData<AttachmentDto[]>(
        qk.attachments(issueId),
        (prev) => (prev ? [...prev, attachment] : [attachment]),
      );
    },
  });
}

export function useDeleteAttachment(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (attachmentId: string): Promise<void> => {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/attachments/${attachmentId}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg =
          (data as { message?: string }).message ??
          `Delete failed (${res.status})`;
        throw new ApiError(msg, res.status);
      }
    },
    onMutate: async (attachmentId) => {
      await qc.cancelQueries({ queryKey: qk.attachments(issueId) });
      const previous = qc.getQueryData<AttachmentDto[]>(qk.attachments(issueId));
      qc.setQueryData<AttachmentDto[]>(qk.attachments(issueId), (prev) =>
        prev?.filter((a) => a.id !== attachmentId),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        qc.setQueryData(qk.attachments(issueId), context.previous);
      }
    },
  });
}

/** Return the direct download URL for an attachment. */
export function attachmentDownloadUrl(attachmentId: string): string {
  const token = getToken();
  // We can't inject the auth header into an <a href> tag, so we return the
  // raw URL. For now we add the token as a query param only if available as a
  // fallback; the actual download endpoint uses the auth guard which reads the
  // Bearer header, so callers should use fetch() for secure downloads.
  void token;
  return `${API_URL}/api/attachments/${attachmentId}`;
}
