import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ISSUE_TYPES,
  PRIORITIES,
  IssueType,
  Priority,
  type IssueDto,
  type StatusDto,
  type UserDto,
} from '@next-lane/shared';
import { useIssue, useUpdateIssue, useDeleteIssue } from '@/api/issues';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Field } from '@/components/ui/Field';
import { useOverlay } from '@/lib/useOverlay';
import { errorMessage } from '@/lib/errorMessage';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { IssueTypeIcon, titleCase } from '@/components/issue/issueMeta';
import { LabelPicker } from './LabelPicker';
import { ParentSubtasks } from './ParentSubtasks';
import { CommentsPanel } from './CommentsPanel';
import { ActivityPanel } from './ActivityPanel';

/** Common agile estimate values offered in the Story Points select. */
const STORY_POINT_VALUES = [1, 2, 3, 5, 8, 13] as const;

export function IssueDetailDrawer({
  issueId,
  projectId,
  statuses,
  users,
  onClose,
  onOpenIssue,
}: {
  issueId: string;
  projectId: string;
  statuses: StatusDto[];
  users: UserDto[];
  onClose: () => void;
  onOpenIssue: (id: string) => void;
}) {
  const issueQuery = useIssue(issueId);
  const update = useUpdateIssue();
  const remove = useDeleteIssue(projectId);
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const panelRef = useRef<HTMLElement>(null);

  useOverlay({ open: true, onClose, containerRef: panelRef });

  function patch(field: keyof IssueDto, value: unknown) {
    if (!issueQuery.data) return;
    update.mutate(
      {
        id: issueId,
        projectId,
        patch: { [field]: value } as never,
      },
      {
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not save your change.')),
      },
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-gray-900/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={panelRef}
        tabIndex={-1}
        className="relative z-10 flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl outline-none"
        role="dialog"
        aria-modal="true"
      >
        {issueQuery.isLoading ? (
          <LoadingState />
        ) : issueQuery.isError || !issueQuery.data ? (
          <div className="p-6">
            <ErrorState
              error={issueQuery.error ?? new Error('Issue not found')}
              onRetry={() => issueQuery.refetch()}
            />
          </div>
        ) : (
          <DrawerBody
            issue={issueQuery.data}
            projectId={projectId}
            statuses={statuses}
            users={users}
            onClose={onClose}
            onOpenIssue={onOpenIssue}
            onPatch={patch}
            saving={update.isPending}
            onDelete={() => setConfirmDelete(true)}
            deleting={remove.isPending}
          />
        )}
      </aside>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete issue"
        message="Delete this issue? This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        loading={remove.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() =>
          remove.mutate(issueId, {
            onSuccess: () => {
              setConfirmDelete(false);
              toast.success('Issue deleted.');
              onClose();
            },
            onError: (err) => {
              setConfirmDelete(false);
              toast.error(errorMessage(err, 'Could not delete this issue.'));
            },
          })
        }
      />
    </div>,
    document.body,
  );
}

function DrawerBody({
  issue,
  projectId,
  statuses,
  users,
  onClose,
  onOpenIssue,
  onPatch,
  saving,
  onDelete,
  deleting,
}: {
  issue: IssueDto;
  projectId: string;
  statuses: StatusDto[];
  users: UserDto[];
  onClose: () => void;
  onOpenIssue: (id: string) => void;
  onPatch: (field: keyof IssueDto, value: unknown) => void;
  saving: boolean;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [title, setTitle] = useState(issue.title);
  const [description, setDescription] = useState(issue.description ?? '');

  // Re-sync local editable fields when the underlying issue changes (realtime).
  useEffect(() => setTitle(issue.title), [issue.id, issue.title]);
  useEffect(
    () => setDescription(issue.description ?? ''),
    [issue.id, issue.description],
  );

  return (
    <>
      <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <IssueTypeIcon type={issue.type} />
          <span className="font-medium">{issue.key}</span>
          {saving && <span className="text-xs text-gray-400">Saving…</span>}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            loading={deleting}
            className="text-red-600 hover:bg-red-50"
          >
            Delete
          </Button>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>
      </header>

      <div className="nl-scroll flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 gap-6 p-5 md:grid-cols-3">
          {/* Main column */}
          <div className="space-y-5 md:col-span-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                if (title.trim() && title !== issue.title)
                  onPatch('title', title.trim());
              }}
              className="w-full rounded-md border border-transparent px-1 text-lg font-semibold text-gray-900 hover:border-gray-200 focus:border-brand-400 focus:outline-none"
            />

            <div>
              <p className="mb-1 text-xs font-medium text-gray-600">
                Description
              </p>
              <Textarea
                rows={6}
                value={description}
                placeholder="Add a description…"
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => {
                  if (description !== (issue.description ?? ''))
                    onPatch('description', description || null);
                }}
              />
            </div>

            <CommentsPanel issueId={issue.id} />
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <Field label="Status" htmlFor="d-status">
              <Select
                id="d-status"
                value={issue.statusId}
                onChange={(e) => onPatch('statusId', e.target.value)}
              >
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Assignee" htmlFor="d-assignee">
              <Select
                id="d-assignee"
                value={issue.assigneeId ?? ''}
                onChange={(e) =>
                  onPatch('assigneeId', e.target.value || null)
                }
              >
                <option value="">Unassigned</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Priority" htmlFor="d-priority">
              <Select
                id="d-priority"
                value={issue.priority}
                onChange={(e) =>
                  onPatch('priority', e.target.value as Priority)
                }
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {titleCase(p)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Type" htmlFor="d-type">
              <Select
                id="d-type"
                value={issue.type}
                onChange={(e) => onPatch('type', e.target.value as IssueType)}
              >
                {ISSUE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {titleCase(t)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Story Points" htmlFor="d-story-points">
              <Select
                id="d-story-points"
                value={issue.storyPoints == null ? '' : String(issue.storyPoints)}
                onChange={(e) =>
                  onPatch(
                    'storyPoints',
                    e.target.value === '' ? null : Number(e.target.value),
                  )
                }
              >
                <option value="">None</option>
                {STORY_POINT_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>

            <LabelPicker issue={issue} projectId={projectId} />

            <ParentSubtasks
              issue={issue}
              projectId={projectId}
              onPatch={onPatch}
              onOpenIssue={onOpenIssue}
            />

            <div className="border-t border-gray-100 pt-3 text-xs text-gray-400">
              Created {new Date(issue.createdAt).toLocaleDateString()}
            </div>

            <ActivityPanel
              issueId={issue.id}
              statuses={statuses}
              users={users}
            />
          </div>
        </div>
      </div>
    </>
  );
}
