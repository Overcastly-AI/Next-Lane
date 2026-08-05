import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { ApiError } from '@/api/client';
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { RequireAuth } from '@/auth/RequireAuth';
import { ToastProvider } from '@/components/ui/Toast';
import { CommandPaletteProvider } from '@/components/CommandPaletteProvider';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { SidebarProvider } from '@/contexts/SidebarContext';
import { UnsavedChangesGuardProvider } from '@/lib/unsavedChangesGuard';
import { AppSidebar } from '@/components/nav/AppSidebar';
import { MobileSidebarDrawer } from '@/components/nav/MobileSidebarDrawer';
import { WorkspaceScopedLayout, ProjectScopedLayout } from '@/layouts/ScopedLayouts';
import { LoginPage } from '@/pages/LoginPage';
import { SsoCompletePage } from '@/pages/SsoCompletePage';
import { RegisterPage } from '@/pages/RegisterPage';
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { PulseDashboardPage } from '@/pages/PulseDashboardPage';
import { MyWorkPage } from '@/pages/MyWorkPage';
import { BoardPage } from '@/pages/BoardPage';
import { BacklogPage } from '@/pages/BacklogPage';
import { DashboardsPage } from '@/pages/DashboardsPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { RoadmapPage } from '@/pages/RoadmapPage';
import { RoadmapPresentPage } from '@/pages/RoadmapPresentPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { TriagePage } from '@/pages/TriagePage';
import { ProfileSettingsPage } from '@/pages/ProfileSettingsPage';
import { WorkspaceAuditLogPage } from '@/pages/WorkspaceAuditLogPage';
import { SharedBoardPage } from '@/pages/SharedBoardPage';
import { SharedDashboardPage } from '@/pages/SharedDashboardPage';
import { WorkspaceMembersPage } from '@/pages/WorkspaceMembersPage';
import { PokerStartPage } from '@/pages/PokerStartPage';
import { PokerSessionPage } from '@/pages/PokerSessionPage';
import { StandupsPage } from '@/pages/StandupsPage';
import { PersonalBoardPage } from '@/pages/PersonalBoardPage';
import { PersonalAnalyticsPage } from '@/pages/PersonalAnalyticsPage';
import { ProjectAnalyticsPage } from '@/pages/ProjectAnalyticsPage';
import { AutomationsPage } from '@/pages/AutomationsPage';
import { WorkspaceBrandingPage } from '@/pages/WorkspaceBrandingPage';
import { WorkspaceSettingsPage } from '@/pages/WorkspaceSettingsPage';
import { NotificationsPage } from '@/pages/NotificationsPage';
import { AdminSsoSettingsPage } from '@/pages/AdminSsoSettingsPage';
import { PagesPage } from '@/pages/PagesPage';
import { WorkspaceDocsPage } from '@/pages/WorkspaceDocsPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Don't retry auth/permission failures.
        if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
          return false;
        }
        return failureCount < 2;
      },
    },
  },
});

/**
 * Routes that render their own full-bleed chrome (auth screens, the public
 * read-only share view) and must NOT get the persistent sidebar frame.
 * Checked by prefix so nested paths (e.g. `/share/:token`) match too.
 */
const CHROMELESS_PREFIXES = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/share/',
];

/**
 * Chromeless by TERMINAL SEGMENT rather than by prefix.
 *
 * The prefixes above are whole route families that live at the root. A
 * presenting view isn't a family — it's a leaf on a page that otherwise has
 * full chrome (`/projects/:id/roadmap/present`), so it can't be expressed as a
 * prefix without also hiding the shell for `/projects/:id/roadmap` itself.
 */
const CHROMELESS_SUFFIXES = ['/present'];

/**
 * App.tsx-level shell: renders the persistent sidebar + mobile drawer as
 * SIBLINGS of the routed page content, not inside any per-page layout — so
 * they mount ONCE and simply re-render on navigation instead of remounting
 * on every route change (this is also what makes the sidebar's collapsed
 * state and any future collapse-persisted UI, e.g. QuickLinks, survive
 * navigation without a flash). Falls through to bare `children` on
 * auth/public-chrome routes and before authentication resolves.
 */
function AppShellFrame({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const { pathname } = useLocation();
  const isChromeless =
    CHROMELESS_PREFIXES.some((p) => pathname.startsWith(p)) ||
    CHROMELESS_SUFFIXES.some((p) => pathname.endsWith(p));

  if (!isAuthenticated || isChromeless) {
    return <>{children}</>;
  }

  return (
    <div className="lg:flex">
      {/*
       * Skip link — first focusable thing in the document.
       *
       * The sidebar comes before the page content in DOM order, so a keyboard
       * user tabbed through the workspace switcher, every project, every
       * project view, four personal items and the workspace group before
       * reaching anything on the page — measured at 10+ presses, and it scales
       * with the number of projects, on EVERY page load. This is the standard
       * fix: off-screen until focused, then a real, visible control.
       *
       * `sr-only focus:not-sr-only` rather than `display: none`, because a
       * hidden element cannot receive focus and the link would never appear.
       */}
      <a
        href="#main-content"
        data-testid="skip-to-content"
        className="sr-only rounded-md bg-signal-600 px-4 py-2 text-sm font-medium text-white focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:outline-none focus:ring-2 focus:ring-signal-300 focus:ring-offset-2"
      >
        Skip to content
      </a>
      <AppSidebar />
      {/*
       * `tabIndex={-1}` so the skip link's target can actually take focus —
       * without it the browser scrolls here but leaves focus on the link, and
       * the next Tab drops the user right back into the sidebar.
       */}
      <div id="main-content" tabIndex={-1} className="min-w-0 flex-1 focus:outline-none">
        {children}
      </div>
      <MobileSidebarDrawer />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
          <ThemeProvider>
          <WorkspaceProvider>
          <SidebarProvider>
          <UnsavedChangesGuardProvider>
          <CommandPaletteProvider>
          <AppShellFrame>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/login/sso-complete" element={<SsoCompletePage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <PulseDashboardPage />
                </RequireAuth>
              }
            />
            <Route
              path="/my-work"
              element={
                <RequireAuth>
                  <MyWorkPage />
                </RequireAuth>
              }
            />
            <Route
              path="/my-board"
              element={
                <RequireAuth>
                  <PersonalBoardPage />
                </RequireAuth>
              }
            />
            <Route
              path="/me/analytics"
              element={
                <RequireAuth>
                  <PersonalAnalyticsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/me/settings"
              element={
                <RequireAuth>
                  <ProfileSettingsPage />
                </RequireAuth>
              }
            />
            {/* Public read-only board/dashboard — no RequireAuth wrapper. The
                dashboard route is registered first (more specific literal
                "dashboard" segment) so it isn't shadowed by /share/:token. */}
            <Route path="/share/dashboard/:token" element={<SharedDashboardPage />} />
            <Route path="/share/:token" element={<SharedBoardPage />} />
            <Route
              path="/notifications"
              element={
                <RequireAuth>
                  <NotificationsPage />
                </RequireAuth>
              }
            />
            {/*
              Instance-level admin settings — gated inside the page on
              User.isInstanceAdmin (client-side UX only; the server enforces
              it independently on every request). Not workspace/project
              scoped, so it lives alongside the other top-level routes.
            */}
            <Route
              path="/admin/sso"
              element={
                <RequireAuth>
                  <AdminSsoSettingsPage />
                </RequireAuth>
              }
            />
            {/*
              `/admin` is the front door for instance-wide configuration,
              reached from "Instance settings" in the user menu. SSO/OIDC is
              currently its only section, so it lands there directly rather
              than on a hub page listing one thing. The existing `/admin/sso`
              URL keeps working — it is in docs, and it is what anyone who
              bookmarked the page has.
            */}
            <Route path="/admin" element={<Navigate to="/admin/sso" replace />} />

            {/*
              Project-scoped routes: ProjectScopedLayout resolves the
              project's workspaceId and syncs the active-workspace context so
              every page under here (and any future one) gets the header
              chip in sync for free — no per-page useSyncActiveWorkspace call
              required.
            */}
            <Route
              path="/projects/:projectId"
              element={
                <RequireAuth>
                  <ProjectScopedLayout />
                </RequireAuth>
              }
            >
              <Route path="board" element={<BoardPage />} />
              <Route path="backlog" element={<BacklogPage />} />
              <Route path="pages" element={<PagesPage />} />
              <Route path="pages/graph" element={<PagesPage />} />
              <Route path="pages/:pageId" element={<PagesPage />} />
              <Route path="dashboards" element={<DashboardsPage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="analytics" element={<ProjectAnalyticsPage />} />
              <Route path="roadmap" element={<RoadmapPage />} />
              <Route
                path="roadmap/present"
                element={<RoadmapPresentPage />}
              />
              <Route path="triage" element={<TriagePage />} />
              <Route path="automations" element={<AutomationsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="standups" element={<StandupsPage />} />
              <Route path="poker" element={<PokerStartPage />} />
              <Route path="poker/:sessionId" element={<PokerSessionPage />} />
            </Route>

            {/*
              Workspace-scoped routes: WorkspaceScopedLayout syncs the
              active-workspace context to :workspaceId structurally.
            */}
            <Route
              path="/workspaces/:workspaceId"
              element={
                <RequireAuth>
                  <WorkspaceScopedLayout />
                </RequireAuth>
              }
            >
              <Route path="audit-log" element={<WorkspaceAuditLogPage />} />
              <Route path="members" element={<WorkspaceMembersPage />} />
              <Route path="branding" element={<WorkspaceBrandingPage />} />
              <Route path="settings" element={<WorkspaceSettingsPage />} />
              <Route path="docs" element={<WorkspaceDocsPage />} />
              <Route path="docs/graph" element={<WorkspaceDocsPage />} />
              <Route path="docs/:pageId" element={<WorkspaceDocsPage />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </AppShellFrame>
          </CommandPaletteProvider>
          </UnsavedChangesGuardProvider>
          </SidebarProvider>
          </WorkspaceProvider>
          </ThemeProvider>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
