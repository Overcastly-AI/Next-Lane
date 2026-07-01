/**
 * WorkspaceContext — lightweight app-level active-workspace tracker.
 *
 * Tracks a single "active workspace" used for:
 *  - Applying the workspace's brandColor as CSS variables (runtime theming).
 *  - Rendering the workspace logo in AppHeader.
 *  - Determining admin access for branding settings.
 *
 * Strategy (single source of truth):
 *  - The active workspace id is persisted to localStorage so it survives
 *    reloads and navigation — you land back where you left off, not on the
 *    first workspace in the list.
 *  - On load we restore the persisted id; if it's missing or no longer valid
 *    (workspace deleted / not a member) we heal to the first workspace.
 *  - The dashboard reads/writes THIS context (no separate local selector),
 *    and project-scoped pages call setActiveWorkspaceId once they know their
 *    workspaceId so the header chip always reflects where you actually are.
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

const STORAGE_KEY = 'nl.activeWorkspaceId';

function readStoredId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredId(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode / storage disabled — fall back to in-memory only */
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const workspacesQuery = useWorkspaces();
  // Only use workspace data when authenticated; avoids API calls on login page.
  const workspaces = isAuthenticated ? (workspacesQuery.data ?? []) : [];

  // Restore the last-active workspace synchronously so the first render already
  // reflects the user's choice (no flash of "first workspace" before an effect).
  const [activeId, setActiveId] = useState<string | null>(() => readStoredId());

  // Seed / heal: fall back to the first workspace only when nothing is set or
  // the persisted one is no longer in the list (deleted / access revoked).
  useEffect(() => {
    if (!workspaces.length) return;
    if (!activeId || !workspaces.some((w) => w.id === activeId)) {
      setActiveId(workspaces[0].id);
      writeStoredId(workspaces[0].id);
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
    writeStoredId(id);
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

/**
 * Keep the header chip honest on workspace-scoped pages: call with the
 * workspace id of whatever you're viewing (e.g. a project's `workspaceId`)
 * and the active workspace follows the route. Pass `undefined` while the data
 * is still loading — it's a no-op until an id is known. This is what makes the
 * chip reflect "the workspace you actually landed on" during navigation.
 */
export function useSyncActiveWorkspace(workspaceId: string | undefined): void {
  const { activeWorkspace, setActiveWorkspaceId } = useWorkspaceContext();
  useEffect(() => {
    if (workspaceId && workspaceId !== activeWorkspace?.id) {
      setActiveWorkspaceId(workspaceId);
    }
  }, [workspaceId, activeWorkspace?.id, setActiveWorkspaceId]);
}
