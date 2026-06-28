/**
 * WorkspaceContext — lightweight app-level active-workspace tracker.
 *
 * Tracks a single "active workspace" used for:
 *  - Applying the workspace's brandColor as CSS variables (runtime theming).
 *  - Rendering the workspace logo in AppHeader.
 *  - Determining admin access for branding settings.
 *
 * Strategy (simple, no router dependency):
 *  - After workspaces load, default to the user's first workspace.
 *  - Pages that are workspace-scoped (members, audit log, branding) call
 *    setActiveWorkspaceId to scope the header to their workspace.
 *  - Project-scoped pages can call it too once they know their workspaceId.
 *  - The dashboard has its own ws selector but propagates the selection here.
 *
 * This is purposely minimal — it doesn't re-implement routing or
 * create a "selected workspace" UX separate from the dashboard selector.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { WorkspaceDto } from '@next-lane/shared';
import { applyBrandColor } from '@/lib/applyBrandColor';
import { useWorkspaces } from '@/api/workspaces';
import { useAuth } from '@/auth/AuthContext';

interface WorkspaceContextValue {
  /** The workspace currently treated as "active" for theming and header display. */
  activeWorkspace: WorkspaceDto | null;
  /** All workspaces the user belongs to. */
  workspaces: WorkspaceDto[];
  /** Explicitly set the active workspace by id (called by workspace-scoped pages). */
  setActiveWorkspaceId: (id: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const workspacesQuery = useWorkspaces();
  // Only use workspace data when authenticated; avoids API calls on login page.
  const workspaces = isAuthenticated ? (workspacesQuery.data ?? []) : [];

  const [activeId, setActiveId] = useState<string | null>(null);

  // Seed / maintain: default to first workspace when none is set or the
  // previously set one disappears from the list.
  useEffect(() => {
    if (!workspaces.length) return;
    if (!activeId || !workspaces.some((w) => w.id === activeId)) {
      setActiveId(workspaces[0].id);
    }
  }, [workspaces, activeId]);

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeId) ?? null,
    [workspaces, activeId],
  );

  // Apply (or remove) CSS variable overrides whenever the active workspace or
  // its brandColor changes.
  useEffect(() => {
    applyBrandColor(activeWorkspace?.brandColor ?? null);
  }, [activeWorkspace?.brandColor, activeWorkspace?.id]);

  const setActiveWorkspaceId = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const value = useMemo<WorkspaceContextValue>(
    () => ({ activeWorkspace, workspaces, setActiveWorkspaceId }),
    [activeWorkspace, workspaces, setActiveWorkspaceId],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

/** Access the active workspace context. Must be used inside <WorkspaceProvider>. */
export function useWorkspaceContext(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspaceContext must be used within a <WorkspaceProvider>.');
  }
  return ctx;
}
