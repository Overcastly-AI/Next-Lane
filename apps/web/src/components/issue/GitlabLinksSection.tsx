/**
 * GitlabLinksSection ("Development")
 *
 * Rendered in the IssueDetailDrawer main column, directly beneath
 * `GithubLinksSection`. Lists GitLab merge requests, commits, and branches
 * that reference this issue's key (e.g. "NL-123"), populated by the inbound
 * GitLab webhook. Entirely hidden when the project has no GitLab integration
 * configured OR the issue has no links yet — the
 * `GET /issues/:issueId/gitlab-links` endpoint returns `[]` in both cases, so
 * a single "any links?" check covers it.
 *
 * Kept as a SEPARATE section (not merged into GithubLinksSection) so a
 * project's Development history stays legible even when both providers are
 * configured (rare, but possible during a migration) — each section's own
 * icon distinguishes the provider at a glance.
 */
import type { IssueGitlabLinkDto, GitlabLinkKind } from '@next-lane/shared';
import { useIssueGitlabLinks } from '@/api/gitlab';
import { cn } from '@/lib/cn';

const KIND_LABEL: Record<GitlabLinkKind, string> = {
  MR: 'Merge request',
  COMMIT: 'Commit',
  BRANCH: 'Branch',
};

/** GitLab's "tanuki fox" glyph, simplified to a single-path icon matching the GitHub octocat's visual weight. */
function KindIcon({ kind }: { kind: GitlabLinkKind }) {
  if (kind === 'MR') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
      </svg>
    );
  }
  if (kind === 'COMMIT') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M10.5 7.75a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm1.43.75a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5Z" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122v.756a2.251 2.251 0 0 1-1.5 2.121v3.126a2.251 2.251 0 1 1-1.5 0V8.25a.75.75 0 0 1-.75-.75V5.372A2.25 2.25 0 0 1 6 3.25a2.25 2.25 0 1 1-1.75 3.669V11.25a.75.75 0 0 1 0 .001V6.919A2.251 2.251 0 0 1 6 3.25Z" />
    </svg>
  );
}

function StateBadge({ state }: { state: string | null }) {
  if (!state) return null;
  const styles: Record<string, string> = {
    open: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    merged: 'bg-purple-50 text-purple-700 ring-purple-200',
    closed: 'bg-red-50 text-red-700 ring-red-200',
    locked: 'bg-ink-50 text-ink-600 ring-ink-200',
  };
  return (
    <span
      data-testid="gitlab-link-state"
      className={cn(
        'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset',
        styles[state] ?? 'bg-ink-50 text-ink-600 ring-ink-200',
      )}
    >
      {state}
    </span>
  );
}

function LinkRow({ link }: { link: IssueGitlabLinkDto }) {
  const label =
    link.kind === 'MR'
      ? `!${link.externalId}`
      : link.kind === 'COMMIT'
        ? link.externalId.slice(0, 7)
        : link.externalId;

  return (
    <li data-testid="gitlab-link-row" className="flex items-center gap-2 py-1.5">
      <span className="shrink-0 text-ink-400" title={KIND_LABEL[link.kind]}>
        <KindIcon kind={link.kind} />
      </span>
      <a
        href={link.url || undefined}
        target="_blank"
        rel="noreferrer"
        className={cn(
          'min-w-0 flex-1 truncate text-sm text-ink-700 transition-colors duration-[120ms]',
          link.url
            ? 'hover:text-signal-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-300 rounded'
            : 'pointer-events-none',
        )}
      >
        <span className="font-mono text-xs text-ink-500">{label}</span>{' '}
        {link.title && <span>{link.title}</span>}
      </a>
      <StateBadge state={link.state} />
    </li>
  );
}

export function GitlabLinksSection({ issueId }: { issueId: string }) {
  const linksQuery = useIssueGitlabLinks(issueId);
  const links = linksQuery.data ?? [];

  // Hidden entirely while loading (avoids a flash for the common case where
  // GitLab isn't configured / there are no links) and once loaded when empty
  // — see file header comment.
  if (linksQuery.isLoading || links.length === 0) return null;

  return (
    <section data-testid="gitlab-links-section" aria-label="GitLab Development">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-ink-500">
        GitLab
      </p>
      <ul className="divide-y divide-ink-100">
        {links.map((link) => (
          <LinkRow key={link.id} link={link} />
        ))}
      </ul>
    </section>
  );
}
