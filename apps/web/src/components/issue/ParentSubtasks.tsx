import { useEffect, useRef, useState } from 'react';
import type { IssueDto, IssueRefDto } from '@next-lane/shared';
import { useIssueSearch } from '@/api/issues';
import { Input } from '@/components/ui/Input';
import { IssueTypeIcon } from '@/components/issue/issueMeta';
import { cn } from '@/lib/cn';

/**
 * Parent + sub-tasks section for the issue drawer.
 *
 * - Shows the issue's parent (if any) as a clickable chip with a clear button.
 * - Lists child issues; each opens that issue.
 * - A search popover sets/changes the parent via the update endpoint (parentId).
 *   Candidates exclude the issue itself and its direct children to avoid the
 *   obvious cycles; the API rejects deeper cycles as a backstop.
 */
export function ParentSubtasks({
  issue,
  projectId,
  editable = true,
  onPatch,
  onOpenIssue,
}: {
  issue: IssueDto;
  projectId: string;
  /** When false (VIEWER), parent set/clear affordances are hidden. */
  editable?: boolean;
  onPatch: (field: keyof IssueDto, value: unknown) => void;
  onOpenIssue: (id: string) => void;
}) {
  const parent = issue.parent ?? null;
  const children = issue.children ?? [];

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-xs font-medium text-slate-600">Parent</p>
          {parent && editable && (
            <button
              type="button"
              onClick={() => onPatch('parentId', null)}
              className="rounded text-xs font-medium text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            >
              Clear
            </button>
          )}
        </div>
        {parent ? (
          <IssueRefChip refIssue={parent} onClick={() => onOpenIssue(parent.id)} />
        ) : (
          <p className="text-xs text-slate-400">No parent</p>
        )}
        {editable && (
          <ParentPicker
            issue={issue}
            projectId={projectId}
            onSelect={(id) => onPatch('parentId', id)}
          />
        )}
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-slate-600">
          Sub-tasks{children.length > 0 ? ` (${children.length})` : ''}
        </p>
        {children.length > 0 ? (
          <ul className="space-y-1" data-testid="subtasks-list">
            {children.map((child) => (
              <li key={child.id}>
                <IssueRefChip
                  refIssue={child}
                  onClick={() => onOpenIssue(child.id)}
                  showStatus
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-400">No sub-tasks</p>
        )}
      </div>
    </div>
  );
}

function IssueRefChip({
  refIssue,
  onClick,
  showStatus = false,
}: {
  refIssue: IssueRefDto;
  onClick: () => void;
  showStatus?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5 text-left hover:border-brand-200 hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
    >
      <IssueTypeIcon type={refIssue.type} className="h-4 w-4" />
      <span className="shrink-0 text-xs font-medium text-slate-400">
        {refIssue.key}
      </span>
      <span className="flex-1 truncate text-sm text-slate-800">
        {refIssue.title}
      </span>
      {showStatus && refIssue.status && (
        <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
          {refIssue.status.name}
        </span>
      )}
    </button>
  );
}

function ParentPicker({
  issue,
  projectId,
  onSelect,
}: {
  issue: IssueDto;
  projectId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const search = useIssueSearch(projectId, query);

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

  // Exclude self and direct children to avoid the obvious cycles. Deeper cycles
  // are rejected by the API.
  const childIds = new Set((issue.children ?? []).map((c) => c.id));
  const results = (search.data ?? []).filter(
    (i) => i.id !== issue.id && !childIds.has(i.id),
  );

  return (
    <div ref={containerRef} className="relative mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="rounded text-xs font-medium text-brand-600 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
      >
        {issue.parent ? 'Change parent' : 'Set parent'}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Set parent issue"
          className="absolute left-0 z-20 mt-2 w-72 rounded-lg border border-slate-200 bg-surface p-2 shadow-cardHover"
        >
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search issues…"
            aria-label="Search issues to set as parent"
          />
          <div className="mt-1 max-h-56 overflow-y-auto">
            {query.trim().length === 0 ? (
              <p className="px-1 py-2 text-xs text-slate-400">
                Type to search issues.
              </p>
            ) : search.isLoading ? (
              <p className="px-1 py-2 text-xs text-slate-400">Searching…</p>
            ) : results.length === 0 ? (
              <p className="px-1 py-2 text-xs text-slate-400">No matches.</p>
            ) : (
              <ul className="space-y-0.5">
                {results.map((candidate) => (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(candidate.id);
                        setOpen(false);
                        setQuery('');
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-slate-50',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300',
                      )}
                    >
                      <IssueTypeIcon type={candidate.type} className="h-4 w-4" />
                      <span className="shrink-0 text-xs font-medium text-slate-400">
                        {candidate.key}
                      </span>
                      <span className="flex-1 truncate text-sm text-slate-800">
                        {candidate.title}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
