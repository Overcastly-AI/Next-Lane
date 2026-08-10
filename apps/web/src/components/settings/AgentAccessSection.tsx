/**
 * AgentAccessSection
 *
 * Project Settings "Agent access" card — the switch that makes a project
 * read-only to API tokens: the MCP server, and anything else driving Next Lane
 * with a Personal Access Token. Reads are untouched, every write is refused
 * with 403, and people signed in through the browser are completely unaffected.
 * That asymmetry is the feature: it locks the robot, not the team.
 *
 * WHY THE PROJECT AND NOT A BOARD. The request was to lock a board, and a
 * board is a VIEW over a project's issues — the same issue appears on other
 * boards, in the backlog and in search. A board-level lock could always be
 * walked around by naming the issue instead of the board, so it would have
 * been a lock that looked protective without being it. The project is the
 * smallest thing every issue belongs to exactly once.
 *
 * ADMIN only, like every other control that decides who may change what.
 */
import { useState } from 'react';
import { Role } from '@next-lane/shared';
import { useProject, useUpdateProject } from '@/api/projects';
import { errorMessage } from '@/lib/errorMessage';
import { useToast } from '@/components/ui/Toast';

export function AgentAccessSection({
  projectId,
  myRole,
}: {
  projectId: string;
  /** Effective project role for the signed-in user. */
  myRole: Role | null | undefined;
}) {
  const projectQuery = useProject(projectId);
  const update = useUpdateProject(projectId);
  const toast = useToast();
  const [pending, setPending] = useState(false);

  const isAdmin = myRole === Role.ADMIN;
  const locked = projectQuery.data?.agentReadOnly ?? false;

  function toggle() {
    const next = !locked;
    setPending(true);
    update.mutate(
      { agentReadOnly: next },
      {
        onSuccess: () =>
          toast.success(
            next
              ? 'Agents can read this project but not change it.'
              : 'Agents can change this project again.',
          ),
        onError: (err) =>
          toast.error(errorMessage(err, 'Could not change agent access.')),
        onSettled: () => setPending(false),
      },
    );
  }

  return (
    <section
      className="rounded-xl border border-ink-200 bg-surface p-4 shadow-card sm:p-5"
      data-testid="agent-access-section"
    >
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-ink-900">Agent access</h2>
        <p className="mt-0.5 text-xs text-ink-500">
          Controls what API tokens can do here — the MCP server, and anything
          else automating Next Lane. It never affects people signed in to the
          app.
        </p>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <label
            htmlFor="agent-read-only"
            className="text-sm font-medium text-ink-800"
          >
            Read-only for agents
          </label>
          <p className="mt-0.5 text-xs text-ink-500">
            {locked
              ? 'Agents can read this project. Any attempt to create, edit, move or delete anything in it is refused.'
              : 'Agents can read and change this project.'}
          </p>
          {/*
           * Say the blast radius out loud. Someone arriving from a board and
           * expecting a board-shaped lock needs to know this covers the whole
           * project before they rely on it.
           */}
          <p className="mt-1.5 text-xs text-ink-400">
            Covers every board, sprint and issue in this project — a board is
            just a view of the same work, so the lock has to sit here to mean
            anything.
          </p>
          {!isAdmin && (
            <p className="mt-1.5 text-xs text-ink-400">
              Only a project admin can change this.
            </p>
          )}
        </div>

        <button
          id="agent-read-only"
          type="button"
          role="switch"
          aria-checked={locked}
          aria-label="Read-only for agents"
          data-testid="agent-read-only-toggle"
          disabled={!isAdmin || pending || projectQuery.isLoading}
          onClick={toggle}
          className={
            'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-[120ms] ' +
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-400 focus-visible:ring-offset-2 ' +
            'disabled:cursor-not-allowed disabled:opacity-50 ' +
            (locked ? 'bg-signal-600' : 'bg-ink-300')
          }
        >
          <span
            className={
              'inline-block h-4 w-4 transform rounded-full bg-surface shadow-xs transition-transform duration-[120ms] ' +
              (locked ? 'translate-x-6' : 'translate-x-1')
            }
          />
        </button>
      </div>

      {locked && (
        <p
          className="mt-4 rounded-md border border-signal-200 bg-signal-50 px-3 py-2 text-xs text-signal-800"
          data-testid="agent-read-only-note"
        >
          An agent cannot turn this off — clearing the lock is itself a write,
          so a locked project refuses it. Only a project admin, signed in here,
          can.
        </p>
      )}
    </section>
  );
}
