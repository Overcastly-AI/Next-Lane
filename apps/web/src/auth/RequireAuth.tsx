import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getToken } from '@/api/client';
import { useAuth } from './AuthContext';
import { LoadingState, ErrorState } from '@/components/ui/States';

/** Redirects to /login when there's no token, or when `me` rejects (bad token). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { isLoading, isError, isAuthenticated } = useAuth();

  if (!getToken()) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (isError) {
    // Token rejected by the server — bounce to login.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (isLoading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <LoadingState label="Loading your workspace…" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <ErrorState error={new Error('Not authenticated.')} />;
  }

  return <>{children}</>;
}
