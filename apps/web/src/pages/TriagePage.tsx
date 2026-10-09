/**
 * TriagePage — fast keyboard-driven issue triage view.
 *
 * Route: /projects/:projectId/triage
 * Entry: command palette "Triage" action, ProjectNav "Triage" tab, or direct URL.
 *
 * Keyboard model:
 *   j / ArrowDown  — move selection down
 *   k / ArrowUp    — move selection up
 *   Enter          — open issue drawer for selected row
 *   a              — assign (opens member picker inline)
 *   p              — set priority (opens priority picker inline)
 *   l              — add/remove label (opens label picker inline)
 *   s              — change status (opens status picker inline)
 *   f              — focus filter input
 *   ?              — toggle keyboard shortcut legend
 *   Escape         — close any open picker, then exit triage (navigate back)
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  PRIORITIES,
  Priority,
  SprintState,
  StatusCategory,
  type IssueDto,
  type LabelDto,
  type StatusDto,
  type UserDto,
} from '@next-lane/shared';
import { useProjectIssues, useUpdateIssue, useBoard, useBulkUpdateIssues } from '@/api/issues';
import { useUsers, useLabels, useSprints } from '@/api/meta';
import { useMyRole } from '@/api/workspaces';
import { useToggleIssueLabel } from '@/api/labels';
import { canEdit } from '@/lib/permissions';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';
import { ProjectPageShell as Shell, PageBody } from '@/components/list/ProjectPageShell';
import { PageHeader } from '@/components/list/PageHeader';
import { IssueListRow } from '@/components/list/IssueListRow';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { ErrorState, LoadingState, EmptyState } from '@/components/ui/States';
import { IssueDetailDrawer } from '@/components/issue/IssueDetailDrawer';
import { PriorityIcon, titleCase } from '@/components/issue/issueMeta';
import { BulkActionBar, BulkSelectAll } from '@/components/issue/BulkActionBar';
import { useToast } from '@/components/ui/Toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActivePicker = 'assign' | 'priority' | 'label' | 'status' | null;

// Status category colour map
const CATEGORY_COLORS: Record<StatusCategory, string> = {
  [StatusCategory.TODO]: '#9ca3af',
  [StatusCategory.IN_PROGRESS]: '#3b82f6',
  [StatusCategory.DONE]: '#22c55e',
};

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export function TriagePage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const issuesQuery = useProjectIssues(projectId);
  const boardQuery = useBoard(projectId);
  const usersQuery = useUsers();
  const labelsQuery = useLabels(projectId);
  const sprintsQuery = useSprints(projectId);

  const update = useUpdateIssue();
  const toggleLabel = useToggleIssueLabel(projectId);
  const bulkUpdate = useBulkUpdateIssues();

  const myRole = useMyRole(boardQuery.data?.project.workspaceId);
  const editable = canEdit(myRole);

  // Sorted issue list
  const issues = useMemo<IssueDto[]>(() => {
    const list = issuesQuery.data ?? [];
    return [...list].sort((a, b) =>
      a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0,
    );
  }, [issuesQuery.data]);

  const statuses = useMemo<StatusDto[]>(
    () =>
      boardQuery.data
        ? [...boardQuery.data.statuses].sort((a, b) => a.order - b.order)
        : [],
    [boardQuery.data],
  );

  const users: UserDto[] = usersQuery.data ?? [];
  const labels: LabelDto[] = labelsQuery.data ?? [];
  // Planning sprints for the bulk sprint picker (PLANNED + ACTIVE only)
  const planningSprints = useMemo(
    () =>
      (sprintsQuery.data ?? []).filter((s) => s.state !== SprintState.COMPLETED),
    [sprintsQuery.data],
  );

  // ---------------------------------------------------------------------------
  // UI state
  // ---------------------------------------------------------------------------
  const [filterText, setFilterText] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [openIssueId, setOpenIssueId] = useState<string | null>(null);
  const [activePicker, setActivePicker] = useState<ActivePicker>(null);
  const [showHelp, setShowHelp] = useState(false);

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const filterInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLOListElement>(null);

  function toggleSelect(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function clearBulkSelection() {
    setSelectedIds(new Set());
  }

  function handleBulkApply(changes: Parameters<typeof bulkUpdate.mutate>[0]['changes']) {
    const ids = Array.from(selectedIds);
    bulkUpdate.mutate(
      { projectId, ids, changes },
      {
        onSuccess: (result) => {
          toast.success(`Updated ${result.updated} ${result.updated === 1 ? 'issue' : 'issues'}.`);
          if (result.failed.length > 0) {
            toast.error(
              `${result.failed.length} ${result.failed.length === 1 ? 'issue' : 'issues'} could not be updated.`,
            );
          }
          clearBulkSelection();
        },
        onError: (err) => toast.error(errorMessage(err, 'Bulk update failed.')),
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Filtered list
  // ---------------------------------------------------------------------------
  const filteredIssues = useMemo<IssueDto[]>(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return issues;
    return issues.filter(
      (i) =>
        i.title.toLowerCase().includes(q) || i.key.toLowerCase().includes(q),
    );
  }, [issues, filterText]);

  const selectedIssue: IssueDto | undefined = filteredIssues[selectedIndex];

  // Keep selectedIndex in range when list changes
  useEffect(() => {
    setSelectedIndex((i) =>
      filteredIssues.length === 0 ? 0 : Math.min(i, filteredIssues.length - 1),
    );
  }, [filteredIssues.length]);

  // Scroll selected row into view
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${selectedIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------
  function patchIssue(
    id: string,
    patch: Parameters<typeof update.mutate>[0]['patch'],
  ) {
    if (!editable) return;
    update.mutate(
      { id, projectId, patch },
      {
        onError: (err) => toast.error(errorMessage(err, 'Could not save.')),
      },
    );
  }

  function handleAssign(userId: string | null) {
    if (!selectedIssue) return;
    patchIssue(selectedIssue.id, { assigneeId: userId });
    setActivePicker(null);
  }

  function handlePriority(priority: Priority) {
    if (!selectedIssue) return;
    patchIssue(selectedIssue.id, { priority });
    setActivePicker(null);
  }

  function handleStatus(statusId: string) {
    if (!selectedIssue) return;
    patchIssue(selectedIssue.id, { statusId });
    setActivePicker(null);
  }

  function handleLabelToggle(label: LabelDto) {
    if (!selectedIssue || !editable) return;
    const attached =
      selectedIssue.labels?.some((l) => l.id === label.id) ?? false;
    toggleLabel.mutate(
      { issueId: selectedIssue.id, label, attached: !attached },
      {
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not update labels.')),
      },
    );
    // Don't close picker so user can toggle multiple labels
  }

  // ---------------------------------------------------------------------------
  // Keyboard handler
  // ---------------------------------------------------------------------------
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Never fire when user is typing in a focused input/textarea (except our filter)
      const target = e.target as HTMLElement;
      const inInput =
        (target.tagName === 'INPUT' && target !== filterInputRef.current) ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;
      if (inInput) return;

      // If any picker is open, Escape closes it
      if (activePicker && e.key === 'Escape') {
        e.preventDefault();
        setActivePicker(null);
        return;
      }

      // If help modal is open, Escape or ? closes it
      if (showHelp && (e.key === 'Escape' || e.key === '?')) {
        e.preventDefault();
        setShowHelp(false);
        return;
      }

      // Issue drawer handles its own keyboard events
      if (openIssueId) return;

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          setActivePicker(null);
          setSelectedIndex((i) =>
            filteredIssues.length === 0
              ? 0
              : (i + 1) % filteredIssues.length,
          );
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          setActivePicker(null);
          setSelectedIndex((i) =>
            filteredIssues.length === 0
              ? 0
              : (i - 1 + filteredIssues.length) % filteredIssues.length,
          );
          break;
        case 'Enter':
          e.preventDefault();
          if (selectedIssue) setOpenIssueId(selectedIssue.id);
          break;
        case 'a':
          if (editable) {
            e.preventDefault();
            setActivePicker((v) => (v === 'assign' ? null : 'assign'));
          }
          break;
        case 'p':
          if (editable) {
            e.preventDefault();
            setActivePicker((v) => (v === 'priority' ? null : 'priority'));
          }
          break;
        case 'l':
          if (editable) {
            e.preventDefault();
            setActivePicker((v) => (v === 'label' ? null : 'label'));
          }
          break;
        case 's':
          if (editable) {
            e.preventDefault();
            setActivePicker((v) => (v === 'status' ? null : 'status'));
          }
          break;
        case 'f':
          e.preventDefault();
          filterInputRef.current?.focus();
          filterInputRef.current?.select();
          break;
        case '?':
          e.preventDefault();
          setShowHelp((v) => !v);
          break;
        case 'Escape':
          if (filterText) {
            e.preventDefault();
            setFilterText('');
            return;
          }
          e.preventDefault();
          navigate(-1);
          break;
      }
    },
    [
      activePicker,
      showHelp,
      openIssueId,
      filteredIssues.length,
      selectedIssue,
      editable,
      filterText,
      navigate,
    ],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ---------------------------------------------------------------------------
  // Loading / error states
  // ---------------------------------------------------------------------------
  if (issuesQuery.isLoading || boardQuery.isLoading) {
    return (
      <Shell projectId={projectId} projectName={boardQuery.data?.project.name}>
        <LoadingState label="Loading issues for triage…" />
      </Shell>
    );
  }
  if (issuesQuery.isError || boardQuery.isError) {
    return (
      <Shell projectId={projectId} projectName={boardQuery.data?.project.name}>
        <ErrorState
          error={
            issuesQuery.error ?? boardQuery.error ?? new Error('Failed to load')
          }
          onRetry={() => {
            void issuesQuery.refetch();
            void boardQuery.refetch();
          }}
        />
      </Shell>
    );
  }

  const statusById = new Map(statuses.map((s) => [s.id, s]));

  const countLabel = `${filteredIssues.length} ${filteredIssues.length === 1 ? 'issue' : 'issues'}`;

  return (
    <Shell projectId={projectId} projectName={boardQuery.data?.project.name}>
      <PageBody>
        <PageHeader
          title="Triage"
          count={countLabel}
          description="Work through issues from the keyboard."
          actions={
            <>
              <label htmlFor="triage-filter" className="sr-only">
                Filter issues
              </label>
              <div className="relative flex items-center">
                <svg
                  className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -tranink-y-1/2 text-ink-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path strokeLinecap="round" d="M21 21l-4.3-4.3" />
                </svg>
                <input
                  id="triage-filter"
                  ref={filterInputRef}
                  type="search"
                  value={filterText}
                  onChange={(e) => {
                    setFilterText(e.target.value);
                    setSelectedIndex(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setFilterText('');
                      filterInputRef.current?.blur();
                    }
                  }}
                  placeholder="Filter… (f)"
                  aria-label="Filter issues by title or key"
                  className="block h-9 w-48 rounded border border-ink-200 bg-surface pl-8 pr-3 text-sm text-ink-900 transition-all duration-[120ms] placeholder:text-ink-400 hover:border-ink-300 focus:border-signal-500 focus:outline-none focus:ring-2 focus:ring-signal-200 sm:w-56"
                />
              </div>
              {!editable && (
                <span
                  data-testid="readonly-hint"
                  className="inline-flex items-center gap-1 rounded-md bg-ink-100 px-2 py-1 text-xs font-medium text-ink-600"
                  title="View-only access"
                >
                  View only
                </span>
              )}
              <button
                type="button"
                onClick={() => setShowHelp((v) => !v)}
                aria-label="Show keyboard shortcuts (?)"
                title="Keyboard shortcuts (?)"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-ink-200 bg-surface text-sm font-semibold text-ink-600 shadow-xs transition-colors duration-[120ms] hover:border-ink-300 hover:bg-ink-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
              >
                ?
              </button>
            </>
          }
        />

        {showHelp && (
          <ShortcutHelp editable={editable} onClose={() => setShowHelp(false)} />
        )}

        <section className="rounded-xl border border-ink-200 bg-surface shadow-card">
          {filteredIssues.length > 0 && (
            <header className="flex items-center gap-3 border-b border-ink-100 px-2 py-2 sm:px-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center sm:w-6">
                <BulkSelectAll
                  total={filteredIssues.length}
                  selectedCount={
                    filteredIssues.filter((i) => selectedIds.has(i.id)).length
                  }
                  onChange={(selectAll) => {
                    setSelectedIds(() => {
                      if (!selectAll) return new Set<string>();
                      return new Set(filteredIssues.map((i) => i.id));
                    });
                  }}
                />
              </span>
              <span className="text-xs font-medium text-ink-500">
                {selectedIds.size > 0
                  ? `${selectedIds.size} selected`
                  : 'Select all'}
              </span>
            </header>
          )}

          <div className="relative p-1 sm:p-2">
            {filteredIssues.length === 0 ? (
              <EmptyState
                title={
                  filterText
                    ? 'No issues match your filter'
                    : 'No issues in this project'
                }
                description={
                  filterText
                    ? 'Try a different search term.'
                    : 'Create issues on the board or backlog to start triaging.'
                }
              />
            ) : (
              <ol
                ref={listRef}
                role="listbox"
                aria-label="Issues for triage"
                aria-activedescendant={
                  selectedIssue ? `triage-issue-${selectedIssue.id}` : undefined
                }
                className="divide-y divide-ink-100 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
                // eslint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && selectedIssue) {
                    e.preventDefault();
                    setOpenIssueId(selectedIssue.id);
                  }
                }}
              >
                {filteredIssues.map((issue, idx) => (
                  <TriageRow
                    key={issue.id}
                    issue={issue}
                    idx={idx}
                    isSelected={idx === selectedIndex}
                    isChecked={selectedIds.has(issue.id)}
                    assignee={users.find((u) => u.id === issue.assigneeId) ?? null}
                    status={statusById.get(issue.statusId)}
                    onSelect={() => {
                      setSelectedIndex(idx);
                      setActivePicker(null);
                    }}
                    onToggleCheck={(checked) => toggleSelect(issue.id, checked)}
                    onOpen={() => setOpenIssueId(issue.id)}
                  />
                ))}
              </ol>
            )}

            {/* Inline picker (assign / priority / status / label) */}
            {activePicker && selectedIssue && (
              <InlinePicker
                picker={activePicker}
                issue={selectedIssue}
                users={users}
                statuses={statuses}
                labels={labels}
                onAssign={handleAssign}
                onPriority={handlePriority}
                onStatus={handleStatus}
                onLabelToggle={handleLabelToggle}
                onClose={() => setActivePicker(null)}
                selectedIndex={selectedIndex}
                listRef={listRef}
              />
            )}
          </div>

          <footer
            className="hidden flex-wrap items-center gap-4 border-t border-ink-100 px-4 py-2 sm:flex"
            aria-label="Keyboard shortcut legend"
          >
            <KbdHint keys="j/k" label="Navigate" />
            <KbdHint keys="Enter" label="Open" />
            {editable && (
              <>
                <KbdHint keys="a" label="Assign" />
                <KbdHint keys="p" label="Priority" />
                <KbdHint keys="s" label="Status" />
                <KbdHint keys="l" label="Labels" />
              </>
            )}
            <KbdHint keys="f" label="Filter" />
            <KbdHint keys="?" label="Help" />
            <KbdHint keys="Esc" label="Exit" />
          </footer>
        </section>
      </PageBody>

      {/* Issue detail drawer */}
      {openIssueId && (
        <IssueDetailDrawer
          issueId={openIssueId}
          projectId={projectId}
          statuses={statuses}
          users={users}
          editable={editable}
          viewerRole={myRole ?? undefined}
          onClose={() => setOpenIssueId(null)}
          onOpenIssue={setOpenIssueId}
        />
      )}

      <BulkActionBar
        selectedCount={selectedIds.size}
        statuses={statuses}
        users={users}
        labels={labels}
        sprints={planningSprints}
        showSprint={false}
        isPending={bulkUpdate.isPending}
        onApply={handleBulkApply}
        onClear={clearBulkSelection}
      />
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Triage row
// ---------------------------------------------------------------------------

function TriageRow({
  issue,
  idx,
  isSelected,
  isChecked,
  assignee,
  status,
  onSelect,
  onToggleCheck,
  onOpen,
}: {
  issue: IssueDto;
  idx: number;
  isSelected: boolean;
  isChecked: boolean;
  assignee: UserDto | null;
  status: StatusDto | undefined;
  onSelect: () => void;
  onToggleCheck: (checked: boolean) => void;
  onOpen: () => void;
}) {
  return (
    <IssueListRow
      issue={issue}
      assignee={assignee}
      status={status}
      checked={isChecked}
      active={isSelected}
      onToggleCheck={onToggleCheck}
      liProps={{
        id: `triage-issue-${issue.id}`,
        role: 'option',
        'aria-selected': isSelected,
        'data-idx': idx,
        'data-testid': 'triage-row',
        'data-issue-key': issue.key,
        onClick: onSelect,
        onDoubleClick: onOpen,
        className: 'cursor-pointer',
      }}
      trailing={
        <button
          type="button"
          aria-label={`Open ${issue.key}`}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-ink-500 hover:bg-ink-100 hover:text-ink-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 sm:hidden"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" />
          </svg>
        </button>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Inline picker (assign / priority / status / label)
// ---------------------------------------------------------------------------

function InlinePicker({
  picker,
  issue,
  users,
  statuses,
  labels,
  onAssign,
  onPriority,
  onStatus,
  onLabelToggle,
  onClose,
  selectedIndex,
  listRef,
}: {
  picker: NonNullable<ActivePicker>;
  issue: IssueDto;
  users: UserDto[];
  statuses: StatusDto[];
  labels: LabelDto[];
  onAssign: (userId: string | null) => void;
  onPriority: (p: Priority) => void;
  onStatus: (statusId: string) => void;
  onLabelToggle: (label: LabelDto) => void;
  onClose: () => void;
  selectedIndex: number;
  listRef: React.RefObject<HTMLOListElement | null>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Compute top offset relative to the list element
  const rowEl = listRef.current?.querySelector<HTMLElement>(
    `[data-idx="${selectedIndex}"]`,
  );
  const listRect = listRef.current?.parentElement?.getBoundingClientRect();
  const rowRect = rowEl?.getBoundingClientRect();
  const topOffset =
    rowRect && listRect ? rowRect.bottom - listRect.top : 40;

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="dialog"
      aria-label={`Picker: ${picker}`}
      data-testid={`triage-picker-${picker}`}
      className="absolute right-2 z-20 max-h-72 min-w-48 overflow-y-auto rounded-xl border border-ink-200 bg-surface p-1 shadow-xl outline-none sm:right-3"
      style={{ top: topOffset + 4 }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {picker === 'assign' && (
        <>
          <PickerHeader label="Assign to" />
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-ink-700 hover:bg-ink-50"
            onClick={() => onAssign(null)}
          >
            <Avatar user={null} size="sm" />
            Unassigned
          </button>
          {users.map((u) => (
            <button
              key={u.id}
              type="button"
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-ink-700 hover:bg-ink-50',
                issue.assigneeId === u.id &&
                  'bg-signal-50 font-medium text-signal-700',
              )}
              onClick={() => onAssign(u.id)}
            >
              <Avatar user={u} size="sm" />
              {u.name}
            </button>
          ))}
        </>
      )}

      {picker === 'priority' && (
        <>
          <PickerHeader label="Set priority" />
          {PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-ink-700 hover:bg-ink-50',
                issue.priority === p &&
                  'bg-signal-50 font-medium text-signal-700',
              )}
              onClick={() => onPriority(p)}
            >
              <PriorityIcon priority={p} className="h-4 w-4" />
              {titleCase(p)}
            </button>
          ))}
        </>
      )}

      {picker === 'status' && (
        <>
          <PickerHeader label="Change status" />
          {statuses.map((s) => (
            <button
              key={s.id}
              type="button"
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-ink-700 hover:bg-ink-50',
                issue.statusId === s.id &&
                  'bg-signal-50 font-medium text-signal-700',
              )}
              onClick={() => onStatus(s.id)}
            >
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{
                  backgroundColor:
                    CATEGORY_COLORS[s.category] ?? '#9ca3af',
                }}
                aria-hidden="true"
              />
              {s.name}
            </button>
          ))}
        </>
      )}

      {picker === 'label' && (
        <>
          <PickerHeader label="Toggle labels" />
          {labels.length === 0 ? (
            <p className="px-2.5 py-2 text-xs text-ink-400">
              No labels in this project yet.
            </p>
          ) : (
            labels.map((label) => {
              const checked =
                issue.labels?.some((l) => l.id === label.id) ?? false;
              return (
                <button
                  key={label.id}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={checked}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-ink-50"
                  onClick={() => onLabelToggle(label)}
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      checked
                        ? 'border-signal-600 bg-signal-600 text-white'
                        : 'border-ink-300',
                    )}
                  >
                    {checked && (
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </span>
                  <Badge color={label.color}>{label.name}</Badge>
                </button>
              );
            })
          )}
          <div className="mt-1 border-t border-ink-100 pt-1">
            <button
              type="button"
              className="w-full rounded-lg px-2.5 py-1.5 text-left text-xs text-ink-500 hover:bg-ink-50"
              onClick={onClose}
            >
              Done
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keyboard shortcut help overlay
// ---------------------------------------------------------------------------

function ShortcutHelp({
  editable,
  onClose,
}: {
  editable: boolean;
  onClose: () => void;
}) {
  const shortcuts: { key: string; label: string; editOnly?: boolean }[] = [
    { key: 'j / ↓', label: 'Move selection down' },
    { key: 'k / ↑', label: 'Move selection up' },
    { key: 'Enter', label: 'Open issue drawer' },
    { key: 'a', label: 'Assign (member picker)', editOnly: true },
    { key: 'p', label: 'Set priority', editOnly: true },
    { key: 's', label: 'Change status', editOnly: true },
    { key: 'l', label: 'Toggle labels', editOnly: true },
    { key: 'f', label: 'Focus filter input' },
    { key: '?', label: 'Toggle this help' },
    { key: 'Esc', label: 'Close picker / clear filter / exit' },
  ];

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      data-testid="triage-help-overlay"
    >
      <div
        className="absolute inset-0 bg-ink-900/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-50 w-full max-w-sm rounded-xl bg-surface p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-900">
            Triage keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts help"
            className="rounded p-1 text-ink-400 hover:bg-ink-100"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>
        <dl className="space-y-2">
          {shortcuts.map((s) =>
            s.editOnly && !editable ? null : (
              <div
                key={s.key}
                className="flex items-center justify-between gap-4"
              >
                <dt>
                  <kbd className="rounded border border-ink-200 bg-ink-50 px-1.5 py-0.5 font-sans text-[11px] text-ink-600">
                    {s.key}
                  </kbd>
                </dt>
                <dd className="text-sm text-ink-600">{s.label}</dd>
              </div>
            ),
          )}
        </dl>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function PickerHeader({ label }: { label: string }) {
  return (
    <p className="mb-1 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
      {label}
    </p>
  );
}

function KbdHint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-[11px] text-ink-400">
      <kbd className="rounded border border-ink-200 bg-ink-50 px-1.5 py-0.5 font-sans text-[10px] text-ink-500">
        {keys}
      </kbd>
      {label}
    </span>
  );
}
