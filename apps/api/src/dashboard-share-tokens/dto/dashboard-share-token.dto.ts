import type {
  DashboardShareTokenDto,
  CreateDashboardShareTokenResponse,
} from '@next-lane/shared';

// Re-export types from the shared package so the service/controller can
// import from a single domain path instead of referencing the package
// directly — mirrors `share-tokens/dto/share-token.dto.ts`.
export type { DashboardShareTokenDto, CreateDashboardShareTokenResponse };
