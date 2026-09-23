import { useMemo, useState } from 'react';
import { StatusCategory, type StatusDto } from '@next-lane/shared';
import { useStatuses } from '@/api/meta';
import { useUpdateStatus, useDeleteStatus } from '@/api/statuses';
import { ColumnFormModal } from '@/components/board/ColumnFormModal';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { ApiError } from '@/api/client';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';
import { SettingsSection } from './SettingsSection';
import { IconButton } from './IconButton';

const CATEGORY_LABEL: Record<StatusCategory, string> = {
  [StatusCategory.TODO]: 'To Do',
  [StatusCategory.IN_PROGRESS]: 'In Progress',
  [StatusCategory.DONE]: 'Done',
};

const CATEGORY_DOT: Record<string, string> = {
  TODO: 'bg-gray-400',
  IN_PROGRESS: 'bg-blue-500',
  DONE: 'bg-green-500',
};

/* ------------------------------------------------------------------ columns */

export function ColumnsSection({
  projectId,
  editable,
  isAdmin,
}: {
  projectId: string;
  editable: boolean;
  isAdmin: boolean;
}) {
  const statusesQuery = useStatuses(projectId);
  const updateStatus = useUpdateStatus(projectId);
  const deleteStatus = useDeleteStatus(projectId);
  const toast = useToast();

  const [columnModal, setColumnModal] = useState<
    { mode: 'add' } | { mode: 'edit'; status: StatusDto } | null
  >(null);
  const [columnToDelete, setColumnToDelete] = useState<StatusDto | null>(null);

  const statuses = useMemo<StatusDto[]>(
    () =>
      statusesQuery.data
        ? [...statusesQuery.data].sort((a, b) => a.order - b.order)
        : [],
    [statusesQuery.data],
  );

  // Reorder a column by swapping its `order` with the adjacent neighbor.
  function moveColumn(status: StatusDto, direction: 'up' | 'down') {
    const index = statuses.findIndex((s) => s.id === status.id);
    const neighbor = statuses[direction === 'up' ? index - 1 : index + 1];
    if (!neighbor) return;
    const onError = (err: Error) =>
      toast.error(errorMessage(err, 'Could not move that column.'));
    updateStatus.mutate({ id: status.id, order: neighbor.order }, { onError });
    updateStatus.mutate({ id: neighbor.id, order: status.order }, { onError });
  }

  function confirmDeleteColumn() {
    if (!columnToDelete) return;
    const target = columnToDelete;
    deleteStatus.mutate(target.id, {
      onSuccess: () => toast.success(`Deleted "${target.name}".`),
      onError: (err) => {
        const blocked = err instanceof ApiError && err.status === 400;
        toast.error(
          blocked
            ? 'Move or delete its issues first.'
            : errorMessage(err, 'Could not delete the column.'),
          { title: blocked ? `Can't delete "${target.name}"` : undefined },
        );
      },
      onSettled: () => setColumnToDelete(null),
    });
  }

  return (
    <SettingsSection
      title="Columns"
      description="Columns are the statuses shown on the board, left to right."
      action={
        editable ? (
          <Button size="sm" onClick={() => setColumnModal({ mode: 'add' })}>
            + Add column
          </Button>
        ) : undefined
      }
    >
      {statuses.length === 0 ? (
        <p className="py-4 text-sm text-slate-400">No columns yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {statuses.map((status, index) => (
            <li
              key={status.id}
              className="flex items-center gap-3 py-2.5"
              data-testid="settings-column-row"
            >
              <span
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  CATEGORY_DOT[status.category] ?? 'bg-gray-400',
                )}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                {status.name}
              </span>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                {CATEGORY_LABEL[status.category]}
              </span>
              {editable && (
                <div className="flex shrink-0 items-center gap-0.5">
                  <IconButton
                    aria-label={`Move ${status.name} up`}
                    disabled={index === 0}
                    onClick={() => moveColumn(status, 'up')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18 15l-6-6-6 6" />
                    </svg>
                  </IconButton>
                  <IconButton
                    aria-label={`Move ${status.name} down`}
                    disabled={index === statuses.length - 1}
                    onClick={() => moveColumn(status, 'down')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                    </svg>
                  </IconButton>
                  <IconButton
                    aria-label={`Edit ${status.name}`}
                    onClick={() => setColumnModal({ mode: 'edit', status })}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                    </svg>
                  </IconButton>
                  {isAdmin && (
                    <IconButton
                      aria-label={`Delete ${status.name}`}
                      danger
                      onClick={() => setColumnToDelete(status)}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4h8v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6" />
                      </svg>
                    </IconButton>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {columnModal && (
        <ColumnFormModal
          open
          onClose={() => setColumnModal(null)}
          projectId={projectId}
          status={columnModal.mode === 'edit' ? columnModal.status : undefined}
        />
      )}

      <ConfirmDialog
        open={columnToDelete !== null}
        title="Delete column"
        message={
          <>
            Delete the column{' '}
            <span className="font-medium text-slate-900">
              {columnToDelete?.name}
            </span>
            ? Columns that still contain issues cannot be deleted — move or delete
            its issues first.
          </>
        }
        confirmLabel="Delete column"
        variant="danger"
        loading={deleteStatus.isPending}
        onConfirm={confirmDeleteColumn}
        onCancel={() => setColumnToDelete(null)}
      />
    </SettingsSection>
  );
}
