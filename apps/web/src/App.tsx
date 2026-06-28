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
              path="/projects/:projectId/board"
              element={
                <RequireAuth>
                  <BoardPage />
                </RequireAuth>
              }
            />
            <Route
              path="/projects/:projectId/backlog"
              element={
                <RequireAuth>
                  <BacklogPage />
                </RequireAuth>
              }
            />
            <Route
              path="/projects/:projectId/reports"
              element={
                <RequireAuth>
                  <ReportsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/projects/:projectId/roadmap"
              element={
                <RequireAuth>
                  <RoadmapPage />
                </RequireAuth>
              }
            />
            <Route
              path="/projects/:projectId/triage"
              element={
                <RequireAuth>
                  <TriagePage />
                </RequireAuth>
              }
            />
            <Route
              path="/projects/:projectId/settings"
              element={
                <RequireAuth>
                  <SettingsPage />
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
            <Route
              path="/workspaces/:workspaceId/audit-log"
              element={
                <RequireAuth>
                  <WorkspaceAuditLogPage />
                </RequireAuth>
              }
            />
            <Route
              path="/projects/:projectId/standups"
              element={
                <RequireAuth>
                  <StandupsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/projects/:projectId/poker"
              element={
                <RequireAuth>
                  <PokerStartPage />
                </RequireAuth>
              }
            />
            <Route
              path="/projects/:projectId/poker/:sessionId"
              element={
                <RequireAuth>
                  <PokerSessionPage />
                </RequireAuth>
              }
            />
            {/* Public read-only board — no RequireAuth wrapper */}
            <Route path="/share/:token" element={<SharedBoardPage />} />
            <Route
              path="/workspaces/:workspaceId/members"
              element={
                <RequireAuth>
                  <WorkspaceMembersPage />
                </RequireAuth>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </CommandPaletteProvider>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
