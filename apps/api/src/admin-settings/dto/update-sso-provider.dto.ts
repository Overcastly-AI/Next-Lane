import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateSsoProviderDto } from './create-sso-provider.dto';

/**
 * Body for `PATCH /admin/sso-providers/:id`. Every field optional — merges
 * onto the existing row. `type` and `slug` are immutable after creation (the
 * runtime route path and, for OIDC, the client-discovery cache key both key
 * off `slug` — changing it out from under a registered redirect URI would
 * silently break login).
 */
export class UpdateSsoProviderDto extends PartialType(
  OmitType(CreateSsoProviderDto, ['type', 'slug'] as const),
) {}
