import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ISSUE_TYPES,
  PRIORITIES,
  IssueType,
  Priority,
  Role,
  StatusCategory,
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
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer';
import { LabelPicker } from './LabelPicker';
import { ParentSubtasks } from './ParentSubtasks';
import { CommentsPanel } from './CommentsPanel';
import { ActivityPanel } from './ActivityPanel';
import { AttachmentsPanel } from './AttachmentsPanel';
import { CustomFieldsDrawerSection } from './CustomFieldsDrawerSection';

/** Common agile estimate values offered in the Story Points select. */
const STORY_POINT_VALUES = [1, 2, 3, 5, 8, 13] as const;

export function IssueDetailDrawer({
  issueId,
  projectId,
  boardId,
  statuses,
  users,
  editable = true,
  viewerRole,
  onClose,
  onOpenIssue,
}: {
  issueId: string;
  projectId: string;
  /** Pass the active boardId so label/status mutations invalidate the boardView cache. */
  boardId?: string;
  statuses: StatusDto[];
  users: UserDto[];
  /** When false (VIEWER), all edit controls are hidden/disabled. */
  editable?: boolean;
  /** The viewer's workspace role, used to determine admin-level permissions (e.g. delete any attachment). */
  viewerRole?: Role;
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
        className="absolute inset-0 bg-slate-900/30 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={panelRef}
        tabIndex={-1}
        className="nl-drawer-animate relative z-10 flex h-full w-full max-w-2xl flex-col bg-white shadow-modal outline-none border-l border-slate-200"
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
            boardId={boardId}
            statuses={statuses}
            users={users}
            editable={editable}
            viewerRole={viewerRole}
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
  boardId,
  statuses,
  users,
  editable,
  viewerRole,
  onClose,
  onOpenIssue,
  onPatch,
  saving,
  onDelete,
  deleting,
}: {
  issue: IssueDto;
  projectId: string;
  boardId?: string;
  statuses: StatusDto[];
  users: UserDto[];
  editable: boolean;
  viewerRole?: Role;
  onClose: () => void;
  onOpenIssue: (id: string) => void;
  onPatch: (field: keyof IssueDto, value: unknown) => void;
  saving: boolean;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [title, setTitle] = useState(issue.title);
  const [description, setDescription] = useState(issue.description ?? '');
  // When true, the description is shown as a plain textarea for editing.
  // When false (default), it is rendered as formatted markdown.
  const [descriptionEditing, setDescriptionEditing] = useState(false);
  // Tracks whether Escape was pressed in the description editor so the onBlur
  // handler knows to skip saving (cancel, not save).
  const descriptionCancelled = useRef(false);

  // Re-sync local editable fields when the underlying issue changes (realtime).
  useEffect(() => setTitle(issue.title), [issue.id, issue.title]);
  useEffect(
    () => setDescription(issue.description ?? ''),
    [issue.id, issue.description],
  );

  return (
    <>
      <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <div className="flex items-center gap-2">
          <IssueTypeIcon type={issue.type} className="h-4 w-4 text-slate-400" />
          {/* Issue key — monospace teal signature */}
          <span className="nl-issue-key">{issue.key}</span>
          {saving && <span className="text-xs text-slate-400">Saving…</span>}
          {!editable && (
            <span
              data-testid="readonly-hint"
              className="inline-flex items-center gap-1 rounded-sm bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500"
            >
              View only
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {editable && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              loading={deleting}
              className="text-red-600 hover:bg-red-50 hover:text-red-700"
            >
              Delete
            </Button>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
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
              disabled={!editable}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                if (editable && title.trim() && title !== issue.title)
                  onPatch('title', title.trim());
              }}
              className="w-full rounded-md border border-transparent px-1 text-lg font-semibold tracking-[-0.01em] text-slate-900 transition-colors hover:border-slate-200 focus:border-brand-400 focus:outline-none disabled:cursor-default disabled:hover:border-transparent"
            />

            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Description</p>
                {editable && !descriptionEditing && (
                  <button
                    type="button"
                    aria-label="Edit description"
                    onClick={() => setDescriptionEditing(true)}
                    className="text-xs font-medium text-slate-400 transition-colors hover:text-brand-600 focus:outline-none"
                  >
                    Edit
                  </button>
                )}
              </div>

              {editable && descriptionEditing ? (
                /* Edit mode: plain textarea */
                <div>
                  <Textarea
                    rows={6}
                    value={description}
                    placeholder="Add a description… (Markdown supported)"
                    autoFocus
                    onChange={(e) => setDescription(e.target.value)}
                    onBlur={() => {
                      if (descriptionCancelled.current) {
                        // Escape was pressed — discard, do not save
                        descriptionCancelled.current = false;
                        return;
                      }
                      setDescriptionEditing(false);
                      if (description !== (issue.description ?? ''))
                        onPatch('description', description || null);
                    }}
                    onKeyDown={(e) => {
                      // Escape cancels the edit without saving. We stop
                      // immediate propagation so useOverlay's document-level
                      // Escape handler doesn't also close the drawer.
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        e.nativeEvent.stopImmediatePropagation();
                        descriptionCancelled.current = true;
                        setDescription(issue.description ?? '');
                        setDescriptionEditing(false);
                      }
                    }}
                    data-testid="description-editor"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    Markdown supported — blur or press Esc to exit
                  </p>
                </div>
              ) : description ? (
                /* View mode: rendered markdown, click to edit */
                <div
                  role={editable ? 'button' : undefined}
                  tabIndex={editable ? 0 : undefined}
                  onClick={() => { if (editable) setDescriptionEditing(true); }}
                  onKeyDown={(e) => {
                    if (editable && (e.key === 'Enter' || e.key === ' '))
                      setDescriptionEditing(true);
                  }}
                  className={[
                    'min-h-[3rem] rounded-md border px-2 py-1.5 transition-colors duration-150',
                    editable
                      ? 'cursor-text border-transparent hover:border-slate-200 focus:border-brand-400 focus:outline-none'
                      : 'border-transparent',
                  ].join(' ')}
                  data-testid="description-rendered"
                  title={editable ? 'Click to edit description' : undefined}
                >
                  <MarkdownRenderer content={description} />
                  {editable && (
                    <p className="mt-1.5 text-[11px] text-slate-400">
                      Markdown supported
                    </p>
                  )}
                </div>
              ) : (
                /* Empty state */
                <div
                  role={editable ? 'button' : undefined}
                  tabIndex={editable ? 0 : undefined}
                  onClick={() => { if (editable) setDescriptionEditing(true); }}
                  onKeyDown={(e) => {
                    if (editable && (e.key === 'Enter' || e.key === ' '))
                      setDescriptionEditing(true);
                  }}
                  className={[
                    'min-h-[3rem] rounded-md border px-2 py-1.5 text-sm transition-colors duration-150',
                    editable
                      ? 'cursor-text border-dashed border-slate-200 text-slate-400 hover:border-brand-300 hover:bg-brand-50/30 focus:border-brand-400 focus:outline-none'
                      : 'border-transparent text-slate-400',
                  ].join(' ')}
                  data-testid="description-empty"
                >
                  {editable ? 'Add a description… (Markdown supported)' : 'No description'}
                </div>
              )}
            </div>

            <AttachmentsPanel
              issueId={issue.id}
              editable={editable}
              viewerRole={viewerRole}
            />

            <CommentsPanel issueId={issue.id} users={users} editable={editable} />
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <Field label="Status" htmlFor="d-status">
              <Select
                id="d-status"
                value={issue.statusId}
                disabled={!editable}
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
                disabled={!editable}
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
                disabled={!editable}
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
                disabled={!editable}
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
                disabled={!editable}
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

            <DueDateField
              dueDate={issue.dueDate ?? null}
              statusCategory={issue.status?.category}
              editable={editable}
              onPatch={onPatch}
            />

            <LabelPicker
              issue={issue}
              projectId={projectId}
              boardId={boardId}
              editable={editable}
            />

            <ParentSubtasks
              issue={issue}
              projectId={projectId}
              editable={editable}
              onPatch={onPatch}
              onOpenIssue={onOpenIssue}
            />

            <CustomFieldsDrawerSection
              issueId={issue.id}
              projectId={projectId}
              issueType={issue.type}
              currentValues={issue.customFields}
              editable={editable}
            />

            <div className="border-t border-slate-100 pt-3 text-xs text-slate-400">
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

/**
 * Due date picker sidebar field. Shows a native date input when editable,
 * or a read-only formatted date when not. Displays in an overdue warning
 * color (amber) when the issue is past due and not in a Done-category status.
 */
function DueDateField({
  dueDate,
  statusCategory,
  editable,
  onPatch,
}: {
  dueDate: string | null;
  statusCategory: string | undefined;
  editable: boolean;
  onPatch: (field: keyof IssueDto, value: unknown) => void;
}) {
  const isDone = statusCategory === StatusCategory.DONE;
  const isOverdue =
    !isDone && dueDate !== null && new Date(dueDate) < new Date();

  // Format a stored ISO datetime as a YYYY-MM-DD string for the date input.
  const toInputValue = (iso: string | null) => {
    if (!iso) return '';
    // Take just the date part (handles both full ISO and date-only strings).
    return iso.slice(0, 10);
  };

  return (
    <Field label="Due date" htmlFor="d-due-date">
      {editable ? (
        <div className="flex items-center gap-1.5">
          <input
            id="d-due-date"
            type="date"
            aria-label="Due date"
            value={toInputValue(dueDate)}
            onChange={(e) => {
              const val = e.target.value;
              // val is '' when the user clears via the date input's clear button.
              onPatch('dueDate', val ? val : null);
            }}
            className={
              'rounded-md border px-2 py-1 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 ' +
              (isOverdue
                ? 'border-amber-300 bg-amber-50 text-amber-800'
                : 'border-slate-200 bg-white text-slate-700')
            }
          />
          {dueDate && (
            <button
              type="button"
              aria-label="Clear due date"
              onClick={() => onPatch('dueDate', null)}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
              </svg>
            </button>
          )}
        </div>
      ) : dueDate ? (
        <span
          className={
            'text-sm ' +
            (isOverdue ? 'font-semibold text-amber-700' : 'text-slate-700')
          }
        >
          {new Date(dueDate).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
          {isOverdue && (
            <span className="ml-1.5 rounded-sm bg-amber-100 px-1 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
              Overdue
            </span>
          )}
        </span>
      ) : (
        <span className="text-sm text-slate-400">None</span>
      )}
    </Field>
  );
}
