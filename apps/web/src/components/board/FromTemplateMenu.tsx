/**
 * FromTemplateMenu
 *
 * A small "From template ▾" dropdown button that lists the project's issue
 * templates. Selecting one calls `POST /issue-templates/:id/create-issue`,
 * invalidates issues/board, and surfaces the new issue via a toast + callback.
 *
 * Hidden when there are no templates for the project.
 */
import { useEffect, useRef, useState } from 'react';
import { IssueType } from '@next-lane/shared';
import { useIssueTemplates, useCreateIssueFromTemplate } from '@/api/issue-templates';
import { IssueTypeIcon } from '@/components/issue/issueMeta';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errorMessage';
import { cn } from '@/lib/cn';

export function FromTemplateMenu({
  projectId,
  onCreated,
}: {
  projectId: string;
  /** Called with the new issue's id after successful creation. */
  onCreated?: (issueId: string) => void;
}) {
  const templatesQuery = useIssueTemplates(projectId);
  const createFromTemplate = useCreateIssueFromTemplate(projectId);
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const templates = templatesQuery.data ?? [];

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Hide entirely when no templates
  if (!templatesQuery.data || templates.length === 0) return null;

  function handleSelect(templateId: string, templateName: string) {
    setOpen(false);
    createFromTemplate.mutate(
      { templateId },
      {
        onSuccess: (issue) => {
          toast.success(`Created ${issue.key} from "${templateName}".`);
          onCreated?.(issue.id);
        },
        onError: (err) => {
          toast.error(errorMessage(err, 'Could not create issue from template.'));
        },
      },
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        data-testid="new-from-template-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={createFromTemplate.isPending}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex h-9 items-center gap-1.5 rounded-md border border-ink-200 bg-white px-3.5 text-sm font-semibold text-ink-700 shadow-xs transition-all duration-[120ms]',
          'hover:bg-ink-50 hover:border-ink-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500',
          createFromTemplate.isPending && 'cursor-wait opacity-60',
        )}
      >
        From template
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
          className={cn(
            'shrink-0 transition-transform duration-150',
            open && 'rotate-180',
          )}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Issue templates"
          className={cn(
            'absolute right-0 z-50 mt-1.5 min-w-[200px] max-w-[280px] overflow-hidden rounded-lg border border-ink-200 bg-white shadow-lg',
            'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1',
          )}
        >
          <p className="border-b border-ink-100 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
            Templates
          </p>
          <ul className="py-1">
            {templates.map((tpl) => (
              <li key={tpl.id} role="none">
                <button
                  type="button"
                  role="menuitem"
                  data-testid="new-from-template-option"
                  onClick={() => handleSelect(tpl.id, tpl.name)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink-700 transition-colors hover:bg-ink-50 focus:bg-ink-50 focus:outline-none"
                >
                  <IssueTypeIcon
                    type={tpl.issueType as IssueType}
                    className="h-3.5 w-3.5 shrink-0"
                  />
                  <span className="min-w-0 truncate">{tpl.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
