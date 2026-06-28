import { useEffect, useRef, useState } from 'react';
import type { IssueDto, LabelDto } from '@next-lane/shared';
import { useLabels } from '@/api/meta';
import {
  useCreateLabel,
  useDeleteLabel,
  useUpdateLabel,
  useToggleIssueLabel,
} from '@/api/labels';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';

/** On-brand swatches offered when creating a new label. */
const SWATCHES = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#6366f1',
  '#a855f7',
  '#ec4899',
  '#64748b',
];

/**
 * Inline label editor for the issue drawer. Shows the issue's current label
 * chips and a popover to toggle the project's labels on/off, create a new
 * label, or delete one. All mutations are optimistic with error toasts.
 */
export function LabelPicker({
  issue,
  projectId,
  boardId,
  editable = true,
}: {
  issue: IssueDto;
  projectId: string;
  /** Pass the active boardId so the boardView cache is invalidated on toggle. */
  boardId?: string;
  /** When false (VIEWER), the label chips are read-only (no Edit popover). */
  editable?: boolean;
}) {
  const labelsQuery = useLabels(projectId);
  const toggle = useToggleIssueLabel(projectId, boardId);
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close the popover on outside click / Escape (it is a non-modal surface).
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const assigned = issue.labels ?? [];
  const assignedIds = new Set(assigned.map((l) => l.id));
  const allLabels = labelsQuery.data ?? [];

  function onToggle(label: LabelDto, attached: boolean) {
    toggle.mutate(
      { issueId: issue.id, label, attached },
      {
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not update labels.')),
      },
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-xs font-medium text-slate-600">Labels</p>
        {editable && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="dialog"
            className="rounded text-xs font-medium text-brand-600 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            Edit
          </button>
        )}
      </div>

      {assigned.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {assigned.map((l) => (
            <Badge key={l.id} color={l.color}>
              {l.name}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-400">No labels</p>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Edit labels"
          className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-slate-200 bg-white p-2 shadow-cardHover"
        >
          <LabelList
            labels={allLabels}
            assignedIds={assignedIds}
            loading={labelsQuery.isLoading}
            onToggle={onToggle}
            projectId={projectId}
            editable={editable}
          />
        </div>
      )}
    </div>
  );
}

function LabelList({
  labels,
  assignedIds,
  loading,
  onToggle,
  projectId,
  editable,
}: {
  labels: LabelDto[];
  assignedIds: Set<string>;
  loading: boolean;
  onToggle: (label: LabelDto, attached: boolean) => void;
  projectId: string;
  editable: boolean;
}) {
  const toast = useToast();
  const deleteLabel = useDeleteLabel(projectId);
  const updateLabel = useUpdateLabel(projectId);
  const [pendingDelete, setPendingDelete] = useState<LabelDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingLabel, setEditingLabel] = useState<LabelDto | null>(null);

  return (
    <>
      {loading ? (
        <p className="px-1 py-2 text-xs text-slate-400">Loading…</p>
      ) : labels.length === 0 ? (
        <p className="px-1 py-2 text-xs text-slate-400">No labels yet.</p>
      ) : (
        <ul className="max-h-56 space-y-0.5 overflow-y-auto">
          {labels.map((label) => {
            const checked = assignedIds.has(label.id);
            if (editingLabel?.id === label.id) {
              return (
                <li key={label.id} className="px-1 py-1">
                  <InlineEditLabelRow
                    label={label}
                    projectId={projectId}
                    updateLabel={updateLabel}
                    onDone={() => setEditingLabel(null)}
                    toast={toast}
                  />
                </li>
              );
            }
            return (
              <li key={label.id} className="group flex items-center gap-1">
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={checked}
                  onClick={() => onToggle(label, !checked)}
                  className="flex flex-1 items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border',
                      checked
                        ? 'border-brand-600 bg-brand-600 text-white'
                        : 'border-slate-300',
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
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                  <Badge color={label.color}>{label.name}</Badge>
                </button>
                {editable && (
                  <button
                    type="button"
                    aria-label={`Rename label ${label.name}`}
                    onClick={() => setEditingLabel(label)}
                    className="rounded p-1 text-slate-300 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-600 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 group-hover:opacity-100"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                    </svg>
                  </button>
                )}
                {editable && (
                  <button
                    type="button"
                    aria-label={`Delete label ${label.name}`}
                    onClick={() => setPendingDelete(label)}
                    className="rounded p-1 text-slate-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 group-hover:opacity-100"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
                    </svg>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editable && (
        <div className="mt-1 border-t border-slate-100 pt-1">
          {creating ? (
            <CreateLabelForm
              projectId={projectId}
              onDone={() => setCreating(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-1.5 rounded px-1.5 py-1.5 text-left text-xs font-medium text-brand-600 hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" d="M12 5v14M5 12h14" />
              </svg>
              New label
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete label"
        message={
          <>
            Delete the label{' '}
            <span className="font-medium">{pendingDelete?.name}</span>? It will be
            removed from every issue in this project.
          </>
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleteLabel.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteLabel.mutate(pendingDelete.id, {
            onSuccess: () => {
              setPendingDelete(null);
              toast.success('Label deleted.');
            },
            onError: (err) => {
              setPendingDelete(null);
              toast.error(errorMessage(err, 'Could not delete the label.'));
            },
          });
        }}
      />
    </>
  );
}

/** Compact inline rename+recolor row shown inside the LabelList popover. */
function InlineEditLabelRow({
  label,
  projectId,
  updateLabel,
  onDone,
  toast,
}: {
  label: LabelDto;
  projectId: string;
  updateLabel: ReturnType<typeof useUpdateLabel>;
  onDone: () => void;
  toast: ReturnType<typeof useToast>;
}) {
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState(
    SWATCHES.includes(label.color) ? label.color : SWATCHES[5],
  );

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    updateLabel.mutate(
      { labelId: label.id, input: { name: trimmed, color } },
      {
        onSuccess: () => {
          toast.success('Label updated.');
          onDone();
        },
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not update the label.')),
      },
    );
  }

  // projectId is used by the parent to construct the mutation; suppress the
  // unused-var lint rule because the reference is structural (it reaches us via
  // the pre-created `updateLabel` object).
  void projectId;

  return (
    <div className="space-y-1.5 rounded border border-brand-100 bg-brand-50 p-1.5">
      <Input
        autoFocus
        value={name}
        aria-label="Label name"
        onChange={(e) => setName(e.target.value)}
        placeholder="Label name"
        maxLength={50}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
          if (e.key === 'Escape') { e.preventDefault(); onDone(); }
        }}
      />
      <div className="flex flex-wrap gap-1">
        {SWATCHES.map((s) => (
          <button
            key={s}
            type="button"
            aria-label={`Color ${s}`}
            aria-pressed={s === color}
            onClick={() => setColor(s)}
            style={{ backgroundColor: s }}
            className={cn(
              'h-4 w-4 rounded-full transition-transform focus:outline-none',
              s === color ? 'ring-2 ring-slate-900 ring-offset-1' : 'hover:scale-110',
            )}
          />
        ))}
      </div>
      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="sm" type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="sm"
          type="button"
          loading={updateLabel.isPending}
          disabled={!name.trim()}
          onClick={submit}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

function CreateLabelForm({
  projectId,
  onDone,
}: {
  projectId: string;
  onDone: () => void;
}) {
  const create = useCreateLabel(projectId);
  const toast = useToast();
  const [name, setName] = useState('');
  const [color, setColor] = useState(SWATCHES[5]);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(
      { name: trimmed, color },
      {
        onSuccess: () => {
          toast.success('Label created.');
          onDone();
        },
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not create the label.')),
      },
    );
  }

  return (
    <div className="space-y-2 p-1">
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Label name"
        aria-label="New label name"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="flex flex-wrap gap-1.5">
        {SWATCHES.map((s) => (
          <button
            key={s}
            type="button"
            aria-label={`Color ${s}`}
            aria-pressed={s === color}
            onClick={() => setColor(s)}
            style={{ backgroundColor: s }}
            className={cn(
              'h-5 w-5 rounded-full transition-transform focus:outline-none',
              s === color
                ? 'ring-2 ring-slate-900 ring-offset-1'
                : 'hover:scale-110',
            )}
          />
        ))}
      </div>
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" type="button" onClick={onDone}>
          Cancel
        </Button>
        <Button
          size="sm"
          type="button"
          loading={create.isPending}
          disabled={!name.trim()}
          onClick={submit}
        >
          Add
        </Button>
      </div>
    </div>
  );
}
