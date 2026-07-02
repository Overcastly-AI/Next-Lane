import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom';
import { ApiError } from '@/api/client';
import { AuthProvider } from '@/auth/AuthContext';
import { RequireAuth } from '@/auth/RequireAuth';
import { ToastProvider } from '@/components/ui/Toast';
import { CommandPaletteProvider } from '@/components/CommandPaletteProvider';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';
import { WorkspaceScopedLayout, ProjectScopedLayout } from '@/layouts/ScopedLayouts';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { PulseDashboardPage } from '@/pages/PulseDashboardPage';
import { MyWorkPage } from '@/pages/MyWorkPage';
import { BoardPage } from '@/pages/BoardPage';
import { BacklogPage } from '@/pages/BacklogPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { RoadmapPage } from '@/pages/RoadmapPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { TriagePage } from '@/pages/TriagePage';
import { ProfileSettingsPage } from '@/pages/ProfileSettingsPage';
import { WorkspaceAuditLogPage } from '@/pages/WorkspaceAuditLogPage';
import { SharedBoardPage } from '@/pages/SharedBoardPage';
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

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
          <WorkspaceProvider>
          <CommandPaletteProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
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
            {/* Public read-only board — no RequireAuth wrapper */}
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
              <Route path="reports" element={<ReportsPage />} />
              <Route path="analytics" element={<ProjectAnalyticsPage />} />
              <Route path="roadmap" element={<RoadmapPage />} />
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
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </CommandPaletteProvider>
          </WorkspaceProvider>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
