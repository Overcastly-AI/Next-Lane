/**
 * VersionHistoryDrawer — right-side drawer listing a page's full edit
 * history, newest first (editor + timestamp). Expanding a row previews that
 * version's content; "Restore" reverts the page to it (with a confirm —
 * restoring itself writes a NEW version, per `PagesService.restoreVersion`,
 * so nothing already in history is ever lost).
 */
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePageVersion, usePageVersions, useRestorePageVersion } from '@/api/pages';
import type { PagesScope } from '@/api/keys';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorState, LoadingState, Spinner } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { useOverlay } from '@/lib/useOverlay';
import { errorMessage } from '@/lib/errorMessage';
import { relativeTime } from '@/lib/relativeTime';
import { cn } from '@/lib/cn';
import { PageContent } from './PageContent';

export interface VersionHistoryDrawerProps {
  scope: PagesScope;
  pageId: string;
  titleIndex: Map<string, string>;
  onClose: () => void;
  onOpenPage: (pageId: string) => void;
}

export function VersionHistoryDrawer({
  scope,
  pageId,
  titleIndex,
  onClose,
  onOpenPage,
}: VersionHistoryDrawerProps) {
  const toast = useToast();
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlay({ open: true, onClose, containerRef: panelRef });

  const versionsQuery = usePageVersions(pageId);
  const restore = useRestorePageVersion(scope);
  const [expandedVersion, setExpandedVersion] = useState<number | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<number | null>(null);

  const versions = versionsQuery.data?.pages.flatMap((p) => p.items) ?? [];
  // The list is newest-first (server contract), so the first item's
  // versionNumber IS the page's live content — the "current" one.
  const currentVersionNumber = versions[0]?.versionNumber;

  function handleRestore() {
    if (restoreTarget === null) return;
    restore.mutate(
      { pageId, versionNumber: restoreTarget },
      {
        onSuccess: () => {
          toast.success(`Restored version ${restoreTarget}.`);
          setRestoreTarget(null);
        },
        onError: (err) => {
          toast.error(errorMessage(err, 'Could not restore this version.'));
          setRestoreTarget(null);
        },
      },
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-scrim/25 backdrop-blur-[1px]" onClick={onClose} aria-hidden="true" />
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Version history"
        data-testid="page-version-history-drawer"
        className="nl-drawer-animate relative z-10 flex h-full w-full max-w-md flex-col border-l border-ink-200 bg-surface shadow-modal outline-none"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-ink-100 px-4 py-3.5">
          <h2 className="font-display text-sm font-semibold tracking-[-0.01em] text-ink-900">Version history</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 rounded p-1.5 text-ink-400 transition-colors duration-[120ms] hover:bg-ink-100 hover:text-ink-700"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {versionsQuery.isLoading ? (
            <LoadingState label="Loading history…" />
          ) : versionsQuery.isError ? (
            <div className="p-4">
              <ErrorState error={versionsQuery.error} onRetry={() => versionsQuery.refetch()} />
            </div>
          ) : versions.length === 0 ? (
            <p className="p-4 text-sm text-ink-400" data-testid="page-version-history-empty">
              No saved versions yet.
            </p>
          ) : (
            <ul>
              {versions.map((v) => {
                const isCurrent = v.versionNumber === currentVersionNumber;
                const isExpanded = expandedVersion === v.versionNumber;
                return (
                  <li key={v.id} className="border-b border-ink-100">
                    <button
                      type="button"
                      onClick={() => setExpandedVersion(isExpanded ? null : v.versionNumber)}
                      data-testid={`page-version-row-${v.versionNumber}`}
                      aria-expanded={isExpanded}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors duration-[120ms] hover:bg-ink-50"
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 truncate text-sm font-medium text-ink-800">
                          v{v.versionNumber}
                          {isCurrent && (
                            <span className="rounded-full bg-signal-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-signal-700">
                              Current
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-ink-400">
                          {v.editedBy?.name ?? 'Unknown'} · {relativeTime(v.createdAt)}
                        </p>
                      </div>
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        aria-hidden="true"
                        className={cn('shrink-0 text-ink-400 transition-transform duration-[120ms] motion-reduce:transition-none', isExpanded && 'rotate-90')}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
                      </svg>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-ink-100 bg-ink-50/50 px-4 py-3">
                        <VersionPreview pageId={pageId} versionNumber={v.versionNumber} titleIndex={titleIndex} onOpenPage={onOpenPage} />
                        {!isCurrent && (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="mt-3"
                            onClick={() => setRestoreTarget(v.versionNumber)}
                            data-testid={`page-version-restore-${v.versionNumber}`}
                          >
                            Restore this version
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {versionsQuery.hasNextPage && (
            <div className="p-3 text-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => versionsQuery.fetchNextPage()}
                loading={versionsQuery.isFetchingNextPage}
              >
                Load more
              </Button>
            </div>
          )}
        </div>
      </aside>

      <ConfirmDialog
        open={restoreTarget !== null}
        title="Restore version"
        message={
          <>
            Restore version <strong>{restoreTarget}</strong>? The current content will be replaced — but it stays
            in history too, since restoring saves a new version.
          </>
        }
        confirmLabel="Restore"
        loading={restore.isPending}
        onConfirm={handleRestore}
        onCancel={() => setRestoreTarget(null)}
      />
    </div>,
    document.body,
  );
}

function VersionPreview({
  pageId,
  versionNumber,
  titleIndex,
  onOpenPage,
}: {
  pageId: string;
  versionNumber: number;
  titleIndex: Map<string, string>;
  onOpenPage: (pageId: string) => void;
}) {
  const query = usePageVersion(pageId, versionNumber);

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-ink-400">
        <Spinner className="h-3.5 w-3.5" /> Loading version…
      </div>
    );
  }
  if (query.isError || !query.data) {
    return <ErrorState error={query.error ?? new Error('Version not found')} />;
  }
  return query.data.content ? (
    <PageContent
      content={query.data.content}
      titleIndex={titleIndex}
      onOpenPage={onOpenPage}
      onCreatePage={() => {}}
      className="max-w-none text-xs"
    />
  ) : (
    <p className="text-xs text-ink-400">(empty)</p>
  );
}
