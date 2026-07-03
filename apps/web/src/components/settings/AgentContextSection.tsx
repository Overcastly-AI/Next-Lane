/**
 * AgentContextSection
 *
 * Project Settings "Agent context" card — the human-visible surface for the
 * per-project agent handoff document already shipped over the API/MCP
 * (`GET/PUT /projects/:id/agent-context`, commit 8ffc160). One shared
 * markdown document per project: AI agents write a handoff for the next
 * session/agent, and it's equally a place for a human teammate to leave
 * working notes. Read for any project member (VIEWER+); edit for effective
 * project MEMBER+ (a per-project role override, when present, governs this
 * the same as everywhere else).
 *
 * Realtime: the caller (SettingsPage) subscribes via `useBoardRealtime`,
 * which invalidates `qk.projectAgentContext(projectId)` on both the
 * `project-agent-context.updated` event (someone saved a new document) and
 * any issue/audit event (the staleness count depends on project activity).
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Role } from '@next-lane/shared';
import { useAgentContext, useUpdateAgentContext } from '@/api/agentContext';
import { useProjectMembers } from '@/api/projectMembers';
import { useAuth } from '@/auth/AuthContext';
import { canEdit } from '@/lib/permissions';
import { relativeTime } from '@/lib/relativeTime';
import { errorMessage } from '@/lib/errorMessage';
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { LoadingState, ErrorState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';

/** Card wrapper matching the other Settings section cards. */
function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-xl border border-ink-200 bg-surface p-4 shadow-card sm:p-5"
      data-testid="agent-context-section"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs text-ink-500">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Effective role for the CURRENT user on this project: prefers the
 * per-project override (from the effective-members list, shared cache with
 * MembersSection) and falls back to the workspace-wide role while that list
 * is still loading or the caller isn't in it yet.
 */
function useEffectiveRole(
  projectId: string,
  fallback: Role | null | undefined,
): Role | null | undefined {
  const { user } = useAuth();
  const membersQuery = useProjectMembers(projectId);
  const mine = membersQuery.data?.find((m) => m.userId === user?.id);
  return mine?.effectiveRole ?? fallback;
}

export function AgentContextSection({
  projectId,
  myRole,
}: {
  projectId: string;
  myRole: Role | null | undefined;
}) {
  const effectiveRole = useEffectiveRole(projectId, myRole);
  const editable = canEdit(effectiveRole);

  const query = useAgentContext(projectId);
  const update = useUpdateAgentContext(projectId);
  const toast = useToast();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  const doc = query.data;

  function startEditing() {
    setDraft(doc?.content ?? '');
    setSaveError(null);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setSaveError(null);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setSaveError(null);
    update.mutate(draft, {
      onSuccess: () => {
        toast.success('Agent context saved.');
        setEditing(false);
      },
      onError: (err) => {
        setSaveError(errorMessage(err, 'Could not save the agent context.'));
      },
    });
  }

  // If someone else's realtime update lands while we're not editing, nothing
  // extra to do — the query cache just refreshes underneath. If it lands
  // while we ARE editing, leave the draft alone (don't clobber in-progress
  // typing) — the user can Cancel to pick up the latest content.
  useEffect(() => {
    if (!editing) setDraft(doc?.content ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.content]);

  const staleCount = doc?.staleness.changesSinceUpdate ?? 0;

  return (
    <SectionCard
      title="Agent context"
      description="Persistent handoff memory for AI agents working in this project — also editable by humans."
      action={
        editable && !editing && doc ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={startEditing}
            data-testid="agent-context-edit"
          >
            Edit
          </Button>
        ) : undefined
      }
    >
      {query.isLoading ? (
        <LoadingState label="Loading agent context…" />
      ) : query.isError ? (
        <ErrorState
          error={query.error ?? new Error('Could not load the agent context')}
          onRetry={() => query.refetch()}
        />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
            {doc?.updatedAt ? (
              <span data-testid="agent-context-updated-at">
                Updated {relativeTime(doc.updatedAt)}
                {doc.updatedBy && (
                  <>
                    {' by '}
                    <span
                      className="font-medium text-ink-700"
                      data-testid="agent-context-updated-by"
                    >
                      {doc.updatedBy.name}
                    </span>
                  </>
                )}
              </span>
            ) : (
              <span>Never updated</span>
            )}
            {staleCount > 0 && (
              <span
                data-testid="agent-context-staleness-pill"
                title="Project activity has happened since this document was last updated."
                className="inline-flex items-center gap-0.5 rounded-sm bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200"
              >
                {staleCount} {staleCount === 1 ? 'change' : 'changes'} since last update
              </span>
            )}
          </div>

          {editing ? (
            <form onSubmit={submit} className="space-y-2">
              <label htmlFor="agent-context-textarea" className="sr-only">
                Agent context content (Markdown)
              </label>
              <Textarea
                id="agent-context-textarea"
                data-testid="agent-context-textarea"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={12}
                autoFocus
                placeholder="Write the handoff for the next agent (or teammate)… Markdown supported."
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelEditing();
                  }
                }}
              />
              <p className="text-[11px] text-ink-400">
                Markdown supported — max 64 KB. Esc to cancel.
              </p>
              {saveError && (
                <p
                  role="alert"
                  data-testid="agent-context-save-error"
                  className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700"
                >
                  {saveError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={cancelEditing}
                  data-testid="agent-context-cancel"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  loading={update.isPending}
                  data-testid="agent-context-save"
                >
                  Save
                </Button>
              </div>
            </form>
          ) : doc?.content ? (
            <div
              className="rounded-lg border border-ink-100 bg-ink-50/40 px-3 py-2.5"
              data-testid="agent-context-rendered"
            >
              <MarkdownRenderer content={doc.content} />
            </div>
          ) : (
            <div
              className="rounded-lg border border-dashed border-ink-200 px-3 py-6 text-center text-sm text-ink-400"
              data-testid="agent-context-empty"
            >
              No agent handoff yet — agents (and you) can write working context
              here.
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
