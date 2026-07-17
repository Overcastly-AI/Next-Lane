/**
 * PageScopeBadge — the quiet cross-scope indicator (org-level-docs epic,
 * BACKLOG #12b): a linked/backlinked/graph-node page whose scope differs
 * from the page currently being viewed gets a small badge naming its OWN
 * scope — the target project's key (e.g. "NL"), or "Workspace" for a
 * workspace-docs page. Callers gate rendering on `isDifferentPageScope`
 * (`lib/pageRoute.ts`) themselves — same-scope references render no badge
 * at all, so the common case stays uncluttered.
 *
 * Built on the shared `Badge` primitive (design-token colors, not a
 * bespoke pill) so it reads as part of the same family as every other
 * badge in the app. Never color-only: the label text IS the signal, so it's
 * legible to screen readers and colorblind users alike without any extra
 * `aria-label` plumbing.
 */
import { Badge } from '@/components/ui/Badge';
import { pageScopeBadgeLabel } from '@/lib/pageRoute';

export interface PageScopeBadgeProps {
  projectId: string | null;
  projectKey?: string | null;
  className?: string;
}

export function PageScopeBadge({ projectId, projectKey, className }: PageScopeBadgeProps) {
  return (
    <Badge className={className ? `shrink-0 ${className}` : 'shrink-0'}>
      {pageScopeBadgeLabel({ projectId, projectKey })}
    </Badge>
  );
}
