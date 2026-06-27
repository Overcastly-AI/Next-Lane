import { useCallback, useRef, useState } from 'react';
import {
  useAttachments,
  useUploadAttachment,
  useDeleteAttachment,
  attachmentDownloadUrl,
} from '@/api/attachments';
import { Spinner, ErrorState } from '@/components/ui/States';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { useAuth } from '@/auth/AuthContext';
import { getToken } from '@/api/client';
import { Role, type AttachmentDto } from '@next-lane/shared';

/** 10 MB — kept in sync with the API default. */
const MAX_BYTES = 10 * 1024 * 1024;

/** Allowed MIME types (must mirror the API allowlist). */
const ACCEPT =
  'image/*,application/pdf,text/plain,text/markdown,text/csv,' +
  'application/msword,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/vnd.ms-excel,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
  'application/vnd.ms-powerpoint,' +
  'application/vnd.openxmlformats-officedocument.presentationml.presentation,' +
  'application/zip,application/x-tar,application/gzip';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileTypeIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'IMG';
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType.startsWith('text/')) return 'TXT';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'XLS';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'PPT';
  if (mimeType.includes('word')) return 'DOC';
  if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('gzip')) return 'ZIP';
  return 'FILE';
}

/**
 * Trigger a browser download for an attachment, injecting the auth Bearer token
 * via fetch (since <a href> cannot set headers). Creates a temporary object URL.
 */
async function downloadFile(
  attachmentId: string,
  filename: string,
): Promise<void> {
  const token = getToken();
  const url = attachmentDownloadUrl(attachmentId);
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
}

export function AttachmentsPanel({
  issueId,
  editable = true,
  viewerRole,
}: {
  issueId: string;
  /** When false (VIEWER), upload and delete controls are hidden. */
  editable?: boolean;
  /**
   * The current viewer's workspace role. When Role.ADMIN, the delete button is
   * shown for ALL attachments (not just those the viewer uploaded), matching the
   * server-side rule: uploader OR project ADMIN may delete.
   */
  viewerRole?: Role;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const query = useAttachments(issueId);
  const upload = useUploadAttachment(issueId);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      if (file.size > MAX_BYTES) {
        toast.error(`File too large: max ${formatBytes(MAX_BYTES)}`);
        return;
      }
      upload.mutate(file, {
        onSuccess: () => toast.success(`${file.name} uploaded`),
        onError: (err) => toast.error(errorMessage(err, 'Upload failed.')),
      });
    },
    [upload, toast],
  );

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    handleFiles(e.target.files);
    // Reset so the same file can be re-selected
    if (inputRef.current) inputRef.current.value = '';
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragging(true);
  }
  function onDragLeave() {
    setDragging(false);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (!editable) return;
    handleFiles(e.dataTransfer.files);
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-slate-600">Attachments</p>

      {/* Drop zone / upload button */}
      {editable && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload attachment — drag and drop or click"
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
          }}
          className={[
            'flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed px-4 py-4 text-center transition-colors',
            dragging
              ? 'border-brand-400 bg-brand-50'
              : 'border-slate-200 hover:border-brand-300 hover:bg-slate-50',
          ].join(' ')}
          data-testid="attachment-drop-zone"
        >
          {upload.isPending ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner />
              <span>Uploading…</span>
            </div>
          ) : (
            <>
              <svg
                className="mb-1.5 h-6 w-6 text-slate-400"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                />
              </svg>
              <span className="text-xs text-slate-500">
                Drag & drop or{' '}
                <span className="font-medium text-brand-600">browse</span>
              </span>
              <span className="mt-0.5 text-[11px] text-slate-400">
                Images, PDF, docs, zip · max {formatBytes(MAX_BYTES)}
              </span>
            </>
          )}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        aria-hidden="true"
        data-testid="attachment-input"
        onChange={onInputChange}
      />

      {/* List */}
      {query.isLoading ? (
        <div className="flex justify-center py-2">
          <Spinner />
        </div>
      ) : query.isError ? (
        <ErrorState
          error={query.error}
          onRetry={() => query.refetch()}
        />
      ) : query.data && query.data.length > 0 ? (
        <ul className="space-y-1.5" data-testid="attachment-list">
          {query.data.map((a) => (
            <AttachmentRow
              key={a.id}
              attachment={a}
              issueId={issueId}
              canDelete={
                editable &&
                !!user &&
                (a.uploaderId === user.id || viewerRole === Role.ADMIN)
              }
            />
          ))}
        </ul>
      ) : (
        <p className="py-1 text-sm text-slate-400">No attachments yet.</p>
      )}
    </div>
  );
}

function AttachmentRow({
  attachment,
  issueId,
  canDelete,
}: {
  attachment: AttachmentDto;
  issueId: string;
  canDelete: boolean;
}) {
  const toast = useToast();
  const remove = useDeleteAttachment(issueId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadFile(attachment.id, attachment.filename);
    } catch (err) {
      toast.error(errorMessage(err, 'Download failed.'));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <li
      className="group flex items-center gap-2 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm"
      data-testid="attachment-row"
    >
      {/* Icon badge */}
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-200 text-[10px] font-bold text-slate-600">
        {fileTypeIcon(attachment.mimeType)}
      </span>

      {/* Details */}
      <div className="min-w-0 flex-1">
        <p
          className="truncate font-medium text-slate-800"
          title={attachment.filename}
        >
          {attachment.filename}
        </p>
        <p className="text-[11px] text-slate-400">
          {formatBytes(attachment.sizeBytes)} · {attachment.uploader.name} ·{' '}
          {new Date(attachment.createdAt).toLocaleDateString()}
        </p>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          aria-label={`Download ${attachment.filename}`}
          className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-800 disabled:opacity-50"
          data-testid="attachment-download"
        >
          {downloading ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
              />
            </svg>
          )}
        </button>
        {canDelete && (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            aria-label={`Delete ${attachment.filename}`}
            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
            data-testid="attachment-delete"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
              />
            </svg>
          </button>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete attachment"
        message={`Remove "${attachment.filename}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={remove.isPending}
        onConfirm={() => {
          remove.mutate(attachment.id, {
            onSuccess: () => {
              setConfirmDelete(false);
              toast.success('Attachment deleted.');
            },
            onError: (err) => {
              setConfirmDelete(false);
              toast.error(errorMessage(err, 'Could not delete attachment.'));
            },
          });
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </li>
  );
}
