import type { AuthResponse, MeDto, SsoProviderSummaryDto, UpdateProfileDto } from '@next-lane/shared';
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

export async function me(): Promise<MeDto> {
  return request<MeDto>('/auth/me');
}

export interface AuthProvidersResponse {
  /** Phase-1 legacy single-provider config (unchanged shape). */
  oidc: { enabled: boolean; label: string };
  /** SSO/OIDC Phase 2 — every currently-ENABLED row from the N-simultaneous-providers list, OIDC and/or SAML alike. */
  providers: SsoProviderSummaryDto[];
}

/**
 * Public capability probe — tells the LoginPage whether to render the
 * "Continue with <label>" SSO button. Never assume a provider is configured;
 * always check this first.
 */
export async function getAuthProviders(): Promise<AuthProvidersResponse> {
  return request<AuthProvidersResponse>('/auth/providers');
}

/**
 * Update the current user's profile (name, notification preferences). Returns
 * the fresh UserDto and refreshes the cached copy used for instant UI.
 */
export async function updateProfile(input: UpdateProfileDto): Promise<MeDto> {
  const user = await request<MeDto>('/auth/me', {
    method: 'PATCH',
    body: input,
  });
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}

export function logout(): void {
  clearAuth();
}

/** Read the cached user (best-effort) for instant UI before `me` resolves. */
export function cachedUser(): MeDto | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MeDto;
  } catch {
    return null;
  }
}

/**
 * Request a password-reset link for the given email.
 * Always resolves (the API never reveals whether the email is registered).
 */
export async function forgotPassword(email: string): Promise<void> {
  await request<{ message: string }>('/auth/forgot-password', {
    method: 'POST',
    body: { email },
  });
}

/**
 * Consume a reset token and set a new password.
 * Throws ApiError (400) when the token is invalid/expired/already-used.
 */
export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<void> {
  await request<{ message: string }>('/auth/reset-password', {
    method: 'POST',
    body: { token, newPassword },
  });
}
