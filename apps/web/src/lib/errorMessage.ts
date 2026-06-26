import { ApiError } from '@/api/client';

/**
 * Normalize any thrown value into a human-readable message for surfacing in a
 * toast. Prefers the server message carried by ApiError, falls back to a
 * caller-supplied default.
 */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.message) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
