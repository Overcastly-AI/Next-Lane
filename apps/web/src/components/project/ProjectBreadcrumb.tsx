import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface BreadcrumbSegment {
  label: string;
  to?: string;
}

interface ProjectBreadcrumbProps {
  /**
   * The primary "where am I" label — on a project page this is the project
   * name (or, on a page nested one level deeper like a poker session, the
   * name of that deeper resource). This is the one piece of text that must
   * stay legible at 393px; everything else in the breadcrumb yields to it.
   */
  primary?: string;
  /**
   * Optional path segment(s) rendered between "Projects" and `primary`
   * (e.g. the project name on a poker-session page, where the session name
   * is primary). Hidden on mobile so `primary` gets the room — still shown
   * from `sm:` up.
   */
  secondary?: BreadcrumbSegment[];
  /**
   * Trailing badges/content (issue key chip, active-sprint badge, etc.).
   * Desktop-only — hidden below `sm` so `primary` isn't squeezed by them.
   */
  extra?: ReactNode;
}

/**
 * Shared "Projects / … / {primary}" breadcrumb for project-scoped page
 * headers (rendered inside `<AppHeader>`).
 *
 * The workspace name is already shown by the header's workspace chip, so
 * this breadcrumb's own primary "where am I" signal is the project (or
 * deeper resource) name — it must never be truncated to a couple of
 * characters. At 393px the "Projects" label collapses to a compact
 * back-chevron icon, secondary segments and trailing badges hide, and
 * `primary` grows to fill essentially the whole available width. All of
 * that reappears at the `sm` breakpoint, so desktop is unaffected.
 */
export function ProjectBreadcrumb({
  primary,
  secondary,
  extra,
}: ProjectBreadcrumbProps) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
      <Link
        to="/"
        aria-label="Back to projects"
        className="flex shrink-0 items-center text-sm text-ink-400 transition-colors duration-[120ms] hover:text-ink-700"
      >
        <svg
          className="h-4 w-4 sm:hidden"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        <span className="hidden sm:inline">Projects</span>
      </Link>

      {secondary?.map((seg) => (
        <span key={seg.label} className="hidden shrink-0 items-center gap-2 sm:flex">
          <span className="text-ink-300">/</span>
          {seg.to ? (
            <Link
              to={seg.to}
              className="max-w-[16rem] truncate text-sm text-ink-500 hover:text-ink-700"
            >
              {seg.label}
            </Link>
          ) : (
            <span className="max-w-[16rem] truncate text-sm text-ink-500">
              {seg.label}
            </span>
          )}
        </span>
      ))}

      <span className="hidden shrink-0 text-ink-300 sm:inline">/</span>

      <span
        className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-900 sm:flex-initial"
        title={primary}
        data-testid="project-breadcrumb-name"
      >
        {primary ?? 'Project'}
      </span>

      {extra && (
        <span className="hidden shrink-0 items-center gap-2 sm:flex">{extra}</span>
      )}
    </div>
  );
}
