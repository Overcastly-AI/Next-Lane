import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ISSUE_TYPES,
  PRIORITIES,
  IssueType,
  Priority,
  Role,
  StatusCategory,
  VersionState,
  VERSION_STATE_LABELS,
  type IssueDto,
  type StatusDto,
  type UserDto,
} from '@next-lane/shared';
import { useIssue, useUpdateIssue, useDeleteIssue, useToggleWatch, useWatcherInfo } from '@/api/issues';
import { useComponents } from '@/api/components';
import { useVersions, useSetIssueVersions } from '@/api/versions';
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
import { LinkedIssuesSection } from './LinkedIssuesSection';
import { ChecklistSection } from './ChecklistSection';
import { TimeTrackingSection } from './TimeTrackingSection';
import { useAuth } from '@/auth/AuthContext';

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
        className="absolute inset-0 bg-ink-900/25 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={panelRef}
        tabIndex={-1}
        className="nl-drawer-animate relative z-10 flex h-full w-full max-w-2xl flex-col bg-white shadow-modal outline-none border-l border-ink-200"
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

// Extend IssueDto locally to carry the watch fields the backend attaches.
type IssueWithWatch = IssueDto & {
  isWatching?: boolean;
  watcherCount?: number;
};

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
  issue: IssueWithWatch;
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
  const { user: currentUser } = useAuth();
  const [title, setTitle] = useState(issue.title);
  const toggleWatch = useToggleWatch(issue.id);
  const watcherInfo = useWatcherInfo(issue.id);
  const isWatching = watcherInfo.data?.isWatching ?? false;
  const watcherCount = watcherInfo.data?.count ?? 0;
  const [description, setDescription] = useState(issue.description ?? '');
  const [descriptionEditing, setDescriptionEditing] = useState(false);
  const descriptionCancelled = useRef(false);

  useEffect(() => setTitle(issue.title), [issue.id, issue.title]);
  useEffect(
    () => setDescription(issue.description ?? ''),
    [issue.id, issue.description],
  );

  return (
    <>
      {/* Drawer header */}
      <header className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
        <div className="flex items-center gap-2">
          <IssueTypeIcon type={issue.type} className="h-4 w-4 text-ink-400" />
          {/* Issue key — DISPATCH mono data signature */}
          <span className="nl-issue-key">{issue.key}</span>
          {saving && <span className="text-xs text-ink-400">Saving…</span>}
          {!editable && (
            <span
              data-testid="readonly-hint"
              className="inline-flex items-center gap-1 rounded-sm bg-ink-100 px-1.5 py-0.5 text-[11px] font-semibold text-ink-500"
            >
              View only
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Watch toggle — any role can watch */}
          <button
            type="button"
            data-testid="issue-watch-toggle"
            aria-label={isWatching ? 'Stop watching this issue' : 'Watch this issue'}
            aria-pressed={isWatching}
            disabled={toggleWatch.isPending}
            onClick={() => toggleWatch.mutate(isWatching)}
            className={[
              'inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors duration-[120ms]',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300',
              isWatching
                ? 'bg-brand-50 text-brand-700 hover:bg-brand-100'
                : 'text-ink-500 hover:bg-ink-100 hover:text-ink-700',
              toggleWatch.isPending ? 'opacity-60 cursor-not-allowed' : '',
            ].join(' ')}
          >
            {/* Eye icon */}
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill={isWatching ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
              <circle cx="12" cy="12" r="3" fill={isWatching ? 'white' : 'none'} />
            </svg>
            <span>{isWatching ? 'Watching' : 'Watch'}</span>
            {watcherCount > 0 && (
              <span
                className={[
                  'rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                  isWatching ? 'bg-brand-100 text-brand-700' : 'bg-ink-100 text-ink-500',
                ].join(' ')}
                aria-label={`${watcherCount} watcher${watcherCount !== 1 ? 's' : ''}`}
              >
                {watcherCount}
              </span>
            )}
          </button>

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
            className="rounded p-1.5 text-ink-400 transition-colors duration-[120ms] hover:bg-ink-100 hover:text-ink-700"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>
      </header>

      <div className="nl-scroll flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 gap-6 p-5 md:grid-cols-3">
          {/* Main column */}
          <div className="space-y-5 md:col-span-2">
            {/* Title — Space Grotesk for the display weight */}
            <input
              value={title}
              disabled={!editable}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                if (editable && title.trim() && title !== issue.title)
                  onPatch('title', title.trim());
              }}
              className="w-full rounded border border-transparent px-1 font-display text-lg font-semibold tracking-[-0.02em] text-ink-900 transition-colors duration-[120ms] hover:border-ink-200 focus:border-signal-400 focus:outline-none disabled:cursor-default disabled:hover:border-transparent"
            />

            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-500">Description</p>
                {editable && !descriptionEditing && (
                  <button
                    type="button"
                    aria-label="Edit description"
                    onClick={() => setDescriptionEditing(true)}
                    className="text-xs font-medium text-ink-400 transition-colors duration-[120ms] hover:text-signal-600 focus:outline-none"
                  >
                    Edit
                  </button>
                )}
              </div>

              {editable && descriptionEditing ? (
                <div>
                  <Textarea
                    rows={6}
                    value={description}
                    placeholder="Add a description… (Markdown supported)"
                    autoFocus
                    onChange={(e) => setDescription(e.target.value)}
                    onBlur={() => {
                      if (descriptionCancelled.current) {
                        descriptionCancelled.current = false;
                        return;
                      }
                      setDescriptionEditing(false);
                      if (description !== (issue.description ?? ''))
                        onPatch('description', description || null);
                    }}
                    onKeyDown={(e) => {
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
                  <p className="mt-1 text-[11px] text-ink-400">
                    Markdown supported — blur or press Esc to exit
                  </p>
                </div>
              ) : description ? (
                <div
                  role={editable ? 'button' : undefined}
                  tabIndex={editable ? 0 : undefined}
                  onClick={() => { if (editable) setDescriptionEditing(true); }}
                  onKeyDown={(e) => {
                    if (editable && (e.key === 'Enter' || e.key === ' '))
                      setDescriptionEditing(true);
                  }}
                  className={[
                    'min-h-[3rem] rounded border px-2 py-1.5 transition-colors duration-[120ms]',
                    editable
                      ? 'cursor-text border-transparent hover:border-ink-200 focus:border-signal-400 focus:outline-none'
                      : 'border-transparent',
                  ].join(' ')}
                  data-testid="description-rendered"
                  title={editable ? 'Click to edit description' : undefined}
                >
                  <MarkdownRenderer content={description} />
                  {editable && (
                    <p className="mt-1.5 text-[11px] text-ink-400">
                      Markdown &amp; Mermaid diagrams supported
                    </p>
                  )}
                </div>
              ) : (
                <div
                  role={editable ? 'button' : undefined}
                  tabIndex={editable ? 0 : undefined}
                  onClick={() => { if (editable) setDescriptionEditing(true); }}
                  onKeyDown={(e) => {
                    if (editable && (e.key === 'Enter' || e.key === ' '))
                      setDescriptionEditing(true);
                  }}
                  className={[
                    'min-h-[3rem] rounded border px-2 py-1.5 text-sm transition-colors duration-[120ms]',
                    editable
                      ? 'cursor-text border-dashed border-ink-200 text-ink-400 hover:border-signal-300 hover:bg-signal-50/30 focus:border-signal-400 focus:outline-none'
                      : 'border-transparent text-ink-400',
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

            <ChecklistSection
              issueId={issue.id}
              items={issue.checklist ?? []}
              progress={issue.checklistProgress ?? { done: 0, total: 0 }}
              editable={editable}
            />

            <TimeTrackingSection
              issue={issue}
              editable={editable}
              currentUserId={currentUser?.id}
              onPatchEstimate={(minutes) =>
                onPatch('originalEstimateMinutes', minutes)
              }
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

            <ComponentField
              projectId={projectId}
              componentId={issue.componentId}
              editable={editable}
              onPatch={onPatch}
            />

            <VersionsField
              issueId={issue.id}
              projectId={projectId}
              boardId={boardId}
              currentVersions={issue.versions ?? []}
              editable={editable}
            />

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

            <LinkedIssuesSection
              issueId={issue.id}
              editable={editable}
              onOpenIssue={onOpenIssue}
            />

            <CustomFieldsDrawerSection
              issueId={issue.id}
              projectId={projectId}
              issueType={issue.type}
              currentValues={issue.customFields}
              editable={editable}
            />

            <div className="border-t border-ink-100 pt-3 text-xs text-ink-400">
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
 * Component picker sidebar field.
 * Lists the project's components + a "None" option. Calls onPatch with
 * { componentId: string | null } on change.
 */
function ComponentField({
  projectId,
  componentId,
  editable,
  onPatch,
}: {
  projectId: string;
  componentId: string | null;
  editable: boolean;
  onPatch: (field: keyof IssueDto, value: unknown) => void;
}) {
  const componentsQuery = useComponents(projectId);
  const components = componentsQuery.data ?? [];

  return (
    <Field label="Component" htmlFor="d-component">
      {editable ? (
        <Select
          id="d-component"
          data-testid="issue-component-picker"
          value={componentId ?? ''}
          onChange={(e) => onPatch('componentId', e.target.value || null)}
        >
          <option value="">None</option>
          {components.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      ) : componentId && components.length > 0 ? (
        <span className="text-sm text-ink-700">
          {components.find((c) => c.id === componentId)?.name ?? 'Unknown'}
        </span>
      ) : (
        <span className="text-sm text-ink-400">None</span>
      )}
    </Field>
  );
}

/**
 * Versions multi-select sidebar field.
 * Lets users assign the issue to one or more project versions.
 * On toggle, calls PUT /issues/:id/versions with the complete updated set.
 */
function VersionsField({
  issueId,
  projectId,
  boardId,
  currentVersions,
  editable,
}: {
  issueId: string;
  projectId: string;
  boardId?: string;
  currentVersions: { id: string; name: string; state: VersionState }[];
  editable: boolean;
}) {
  const versionsQuery = useVersions(projectId);
  const setIssueVersions = useSetIssueVersions(issueId, projectId, boardId);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const versions = versionsQuery.data ?? [];

  const currentIds = new Set(currentVersions.map((v) => v.id));

  function toggleVersion(versionId: string) {
    const nextIds = new Set(currentIds);
    if (nextIds.has(versionId)) {
      nextIds.delete(versionId);
    } else {
      nextIds.add(versionId);
    }
    setIssueVersions.mutate(Array.from(nextIds), {
      onError: (err) => {
        toast.error(errorMessage(err, 'Could not update versions.'));
      },
    });
  }

  // Badge colour by state — mirrors VersionsSection
  function stateBadgeClass(state: VersionState): string {
    if (state === VersionState.RELEASED)
      return 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200';
    if (state === VersionState.ARCHIVED)
      return 'bg-ink-100 text-ink-400 ring-1 ring-inset ring-ink-200';
    return 'bg-slate-50 text-slate-500 ring-1 ring-inset ring-slate-200';
  }

  return (
    <Field label="Versions" htmlFor="d-versions">
      <div className="space-y-1.5" data-testid="issue-versions-picker">
        {/* Current version chips */}
        {currentVersions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {currentVersions.map((v) => (
              <span
                key={v.id}
                className={[
                  'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold leading-none tracking-wide',
                  stateBadgeClass(v.state),
                ].join(' ')}
              >
                {v.name}
                {editable && (
                  <button
                    type="button"
                    aria-label={`Remove version ${v.name}`}
                    onClick={() => toggleVersion(v.id)}
                    className="ml-0.5 rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-400"
                    disabled={setIssueVersions.isPending}
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        d="M6 6l12 12M6 18L18 6"
                      />
                    </svg>
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        {currentVersions.length === 0 && !editable && (
          <span className="text-sm text-ink-400">None</span>
        )}

        {/* Dropdown to add versions */}
        {editable && versions.length > 0 && (
          <div className="relative">
            <button
              type="button"
              aria-expanded={open}
              aria-haspopup="listbox"
              onClick={() => setOpen((o) => !o)}
              className="flex items-center gap-1 rounded border border-dashed border-ink-200 px-2 py-1 text-xs text-ink-400 transition-colors hover:border-signal-300 hover:bg-signal-50/30 hover:text-ink-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                aria-hidden="true"
              >
                <path strokeLinecap="round" d="M12 5v14M5 12h14" />
              </svg>
              Add version
            </button>

            {open && (
              <>
                {/* backdrop */}
                <div
                  className="fixed inset-0 z-10"
                  aria-hidden="true"
                  onClick={() => setOpen(false)}
                />
                <ul
                  role="listbox"
                  aria-multiselectable="true"
                  aria-label="Select versions"
                  className="absolute left-0 top-full z-20 mt-1 max-h-48 min-w-[180px] overflow-y-auto rounded-md border border-ink-200 bg-white py-1 shadow-md"
                >
                  {versions.map((v) => {
                    const selected = currentIds.has(v.id);
                    return (
                      <li
                        key={v.id}
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          toggleVersion(v.id);
                        }}
                        className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-ink-50"
                      >
                        <span
                          className={[
                            'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                            selected
                              ? 'border-signal-500 bg-signal-500 text-white'
                              : 'border-ink-300 bg-white',
                          ].join(' ')}
                          aria-hidden="true"
                        >
                          {selected && (
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="3"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                          )}
                        </span>
                        <span className="flex-1 truncate">{v.name}</span>
                        <span
                          className={[
                            'shrink-0 rounded-sm px-1 py-0.5 text-[10px] font-semibold leading-none tracking-wide ring-1 ring-inset',
                            stateBadgeClass(v.state),
                          ].join(' ')}
                        >
                          {VERSION_STATE_LABELS[v.state]}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        )}

        {editable && versions.length === 0 && (
          <span className="text-xs text-ink-400">
            No versions yet — add them in Settings.
          </span>
        )}
      </div>
    </Field>
  );
}

/**
 * Due date picker sidebar field.
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

  const toInputValue = (iso: string | null) => {
    if (!iso) return '';
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
              onPatch('dueDate', val ? val : null);
            }}
            className={
              'rounded border px-2 py-1 text-sm transition-colors duration-[120ms] focus:outline-none focus:ring-2 focus:ring-signal-400 ' +
              (isOverdue
                ? 'border-amber-300 bg-amber-50 text-amber-800'
                : 'border-ink-200 bg-white text-ink-700')
            }
          />
          {dueDate && (
            <button
              type="button"
              aria-label="Clear due date"
              onClick={() => onPatch('dueDate', null)}
              className="rounded p-0.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700 transition-colors duration-[120ms]"
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
            (isOverdue ? 'font-semibold text-amber-700' : 'text-ink-700')
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
        <span className="text-sm text-ink-400">None</span>
      )}
    </Field>
  );
}
