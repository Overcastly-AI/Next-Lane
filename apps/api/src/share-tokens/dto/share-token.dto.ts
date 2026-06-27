import type { ShareTokenDto, CreateShareTokenResponse } from '@next-lane/shared';

// Re-export types from the shared package so the service/controller can import
// from a single domain path instead of referencing the package directly.
export type { ShareTokenDto, CreateShareTokenResponse };
