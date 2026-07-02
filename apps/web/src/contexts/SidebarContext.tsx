/**
 * SidebarContext — app-level state for the persistent left navigation.
 *
 * Two independent pieces of state:
 *  - `collapsed`: desktop rail vs. full sidebar, persisted to localStorage
 *    and restored SYNCHRONOUSLY (read in the `useState` initializer) so the
 *    first paint already reflects the user's choice — no flash of the wrong
 *    width on load (same pattern as `WorkspaceContext`'s active-workspace
 *    restore).
 *  - `mobileOpen`: whether the below-`lg` overlay drawer is open. Toggled by
 *    a header hamburger button and closed by the drawer's own backdrop /
 *    Escape / nav-item click.
 *
 * Lives above `<Routes>` in `App.tsx` so the sidebar components it drives
 * are never remounted on navigation — only their content re-renders.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

interface SidebarContextValue {
  /** Desktop rail (icon-only, collapsed) vs. full-width sidebar. */
  collapsed: boolean;
  toggleCollapsed: () => void;
  /** Below-`lg` overlay drawer open state. */
  mobileOpen: boolean;
  openMobile: () => void;
  closeMobile: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

const COLLAPSED_STORAGE_KEY = 'nl.sidebarCollapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    /* private mode / storage disabled — falls back to in-memory only */
  }
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsed());
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      writeCollapsed(next);
      return next;
    });
  }, []);

  const openMobile = useCallback(() => setMobileOpen(true), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  const value = useMemo<SidebarContextValue>(
    () => ({ collapsed, toggleCollapsed, mobileOpen, openMobile, closeMobile }),
    [collapsed, toggleCollapsed, mobileOpen, openMobile, closeMobile],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebarContext(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error('useSidebarContext must be used within a <SidebarProvider>.');
  }
  return ctx;
}
