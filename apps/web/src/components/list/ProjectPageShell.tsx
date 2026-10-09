import type { ReactNode } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { ProjectBreadcrumb } from '@/components/project/ProjectBreadcrumb';
import { ProjectNav } from '@/components/project/ProjectNav';

/**
 * Standard shell for project planning pages (Backlog, Triage): app header with
 * project breadcrumb, the canonical ProjectNav tab set, and a scrolling ink-50
 * canvas. Keeping a single shell means every planning surface shows the same
 * tabs, sprint chip and breadcrumb.
 */
export function ProjectPageShell({
  children,
  projectId,
  projectName,
}: {
  children: ReactNode;
  projectId: string;
  projectName?: string;
}) {
  return (
    <div className="flex h-screen flex-col overflow-x-clip">
      <AppHeader>
        <ProjectBreadcrumb primary={projectName} />
      </AppHeader>
      <ProjectNav projectId={projectId} />
      <main className="min-h-0 flex-1 overflow-y-auto bg-ink-50">{children}</main>
    </div>
  );
}

/** Centered, padded content column used inside {@link ProjectPageShell}. */
export function PageBody({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 p-4 sm:p-6">
      {children}
    </div>
  );
}
