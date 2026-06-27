import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsISO8601,
} from 'class-validator';

export class CreateApiTokenDto {
  @IsString()
  @IsNotEmpty({ message: 'Token name is required.' })
  @MaxLength(100, { message: 'Token name must be at most 100 characters.' })
  name!: string;

  /**
   * Optional ISO 8601 datetime when the token should expire.
   * Omit (or send null) to create a non-expiring token.
   */
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

/**
 * The create response: includes the raw token (shown ONCE) plus metadata.
 * On subsequent list requests, rawToken is never returned.
 */
export interface CreateApiTokenResponse {
  id: string;
  name: string;
  /** The raw "nlp_..." token — shown exactly once, never retrievable again. */
  rawToken: string;
  expiresAt: string | null;
  createdAt: string;
}

/** Metadata-only view returned by GET /me/tokens. */
export interface ApiTokenDto {
  id: string;
  name: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}
