import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeDto } from '@next-lane/shared';
import { me as fetchMe, cachedUser, logout as doLogout } from '@/api/auth';
import { getToken } from '@/api/client';
import { qk } from '@/api/keys';

interface AuthContextValue {
  user: MeDto | null;
  isLoading: boolean;
  isError: boolean;
  isAuthenticated: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const hasToken = !!getToken();

  const query = useQuery({
    queryKey: qk.me,
    queryFn: fetchMe,
    enabled: hasToken,
    initialData: hasToken ? (cachedUser() ?? undefined) : undefined,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      user: query.data ?? null,
      isLoading: hasToken && query.isLoading,
      isError: query.isError,
      isAuthenticated: hasToken && !query.isError,
      logout: () => {
        doLogout();
        qc.clear();
        window.location.href = '/login';
      },
    }),
    [query.data, query.isLoading, query.isError, hasToken, qc],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
