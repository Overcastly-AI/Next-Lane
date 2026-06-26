import type { AuthResponse, UserDto } from '@next-lane/shared';
import { request, setToken, clearAuth, USER_KEY } from './client';

export interface RegisterInput {
  email: string;
  name: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

function persist(res: AuthResponse): AuthResponse {
  setToken(res.accessToken);
  localStorage.setItem(USER_KEY, JSON.stringify(res.user));
  return res;
}

export async function register(input: RegisterInput): Promise<AuthResponse> {
  const res = await request<AuthResponse>('/auth/register', {
    method: 'POST',
    body: input,
  });
  return persist(res);
}

export async function login(input: LoginInput): Promise<AuthResponse> {
  const res = await request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: input,
  });
  return persist(res);
}

export async function me(): Promise<UserDto> {
  return request<UserDto>('/auth/me');
}

export function logout(): void {
  clearAuth();
}

/** Read the cached user (best-effort) for instant UI before `me` resolves. */
export function cachedUser(): UserDto | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserDto;
  } catch {
    return null;
  }
}
