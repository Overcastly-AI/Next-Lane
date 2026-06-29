/**
 * BoardWorkflowSelector
 *
 * Renders:
 *  - A small workflow badge in the board header showing the active named workflow.
 *  - An admin-only select to assign / unassign a named workflow.
 *
 * testids: board-workflow-select, board-workflow-badge
 */
import { useWorkflows, useAssignBoardWorkflow } from '@/api/workflows';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';

interface BoardWorkflowSelectorProps {
  projectId: string;
  boardId: string;
  /** Current workflow id assigned to this board (null = none). */
  currentWorkflowId: string | null | undefined;
  isAdmin: boolean;
}

export function BoardWorkflowSelector({
  projectId,
  boardId,
  currentWorkflowId,
  isAdmin,
}: BoardWorkflowSelectorProps) {
  const workflowsQuery = useWorkflows(projectId);
  const workflows = workflowsQuery.data ?? [];
  const assignWorkflow = useAssignBoardWorkflow(projectId);
  const toast = useToast();

  const activeWorkflow = workflows.find((w) => w.id === currentWorkflowId);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    assignWorkflow.mutate(
      { boardId, workflowId: value === '' ? null : value },
      {
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not update board workflow.')),
      },
    );
  }

  // Show badge only (read-only for non-admins or when no workflows exist)
  if (!isAdmin) {
    if (!activeWorkflow) return null;
    return (
      <WorkflowBadge name={activeWorkflow.name} enforced={activeWorkflow.enforced} />
    );
  }

  if (workflowsQuery.isLoading) return null;

  return (
    <div className="flex items-center gap-2">
      {activeWorkflow && (
        <WorkflowBadge name={activeWorkflow.name} enforced={activeWorkflow.enforced} />
      )}
      <div className="relative">
        <select
          data-testid="board-workflow-select"
          value={currentWorkflowId ?? ''}
          onChange={handleChange}
          disabled={assignWorkflow.isPending}
          aria-label="Board workflow"
          className={cn(
            'h-7 appearance-none rounded-md border border-slate-200 bg-white pl-2 pr-7 text-xs font-medium text-slate-700',
            'transition-colors hover:border-slate-300',
            'focus:border-signal-400 focus:outline-none focus:ring-2 focus:ring-signal-200',
            assignWorkflow.isPending && 'opacity-50 cursor-not-allowed',
            "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 fill=%22none%22 viewBox=%220 0 24 24%22 stroke=%22%238b95a8%22 stroke-width=%222%22><path stroke-linecap=%22round%22 stroke-linejoin=%22round%22 d=%22M19 9l-7 7-7-7%22/></svg>')] bg-[length:12px] bg-[right_0.35rem_center] bg-no-repeat",
          )}
        >
          <option value="">No workflow</option>
          {workflows.map((wf) => (
            <option key={wf.id} value={wf.id}>
              {wf.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** Small inline badge shown in the board header. */
function WorkflowBadge({ name, enforced }: { name: string; enforced: boolean }) {
  return (
    <span
      data-testid="board-workflow-badge"
      className={cn(
        'inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[10px] font-semibold transition-colors duration-[120ms]',
        enforced
          ? 'bg-signal-50 text-signal-700 ring-1 ring-inset ring-signal-200'
          : 'bg-ink-100 text-ink-600 ring-1 ring-inset ring-ink-200',
      )}
    >
      {/* Flow arrow icon */}
      <svg
        width="9"
        height="9"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5l7 7-7 7" />
      </svg>
      {name}
      {enforced && (
        <span className="rounded-sm bg-signal-100 px-1 py-px text-[9px] font-bold text-signal-800">
          ENFORCED
        </span>
      )}
    </span>
  );
}
