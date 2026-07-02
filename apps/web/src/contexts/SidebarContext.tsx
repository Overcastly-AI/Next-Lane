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

/**
 * "Small laptop" width band where the persistent sidebar (240px expanded)
 * visibly crowds the board's columns (Pass 12 audit finding: the `Done`
 * column's header/"+ Add issue" button gets cut off at 1024×768). The
 * sidebar itself only renders at `lg` (1024px) and up — see `AppSidebar`'s
 * `hidden lg:flex` — so this band covers every width narrower than the
 * `xl` breakpoint (1280px) where it renders at all.
 */
const SMALL_LAPTOP_MIN_WIDTH = 1024;
const SMALL_LAPTOP_MAX_WIDTH = 1279;

function readCollapsed(): boolean {
  try {
    const stored = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    // A real, explicit user preference always wins, at any viewport width.
    if (stored !== null) return stored === '1';
  } catch {
    /* private mode / storage disabled — fall through to the width default */
  }
  // No persisted preference yet: default to the collapsed rail on "small
  // laptop" widths so a first-time visitor there isn't handed a cramped
  // board with no signal that collapsing helps; wider desktops keep the
  // long-standing expanded default.
  if (typeof window !== 'undefined') {
    const width = window.innerWidth;
    if (width >= SMALL_LAPTOP_MIN_WIDTH && width <= SMALL_LAPTOP_MAX_WIDTH) {
      return true;
    }
  }
  return false;
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
