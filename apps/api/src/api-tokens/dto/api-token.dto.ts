import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsISO8601,
  IsArray,
  IsIn,
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';
import { PAT_SCOPES } from '@next-lane/shared';

/**
 * Custom class-validator decorator that rejects ISO 8601 date strings
 * representing a moment in the past.
 *
 * Applied to `expiresAt` on CreateApiTokenDto to prevent callers from
 * creating tokens that are already expired on arrival (usability defect
 * identified in engineering audit Pass 5).
 */
function IsFutureDate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isFutureDate',
      target: (object as { constructor: Function }).constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown, _args: ValidationArguments) {
          if (typeof value !== 'string') return true; // let @IsISO8601 handle it
          const d = new Date(value);
          return !isNaN(d.getTime()) && d > new Date();
        },
        defaultMessage(_args: ValidationArguments) {
          return `${_args.property} must be a future date`;
        },
      },
    });
  };
}

export class CreateApiTokenDto {
  @IsString()
  @IsNotEmpty({ message: 'Token name is required.' })
  @MaxLength(100, { message: 'Token name must be at most 100 characters.' })
  name!: string;

  /**
   * Optional ISO 8601 datetime when the token should expire.
   * Omit (or send null) to create a non-expiring token.
   * Must be a future date — past dates are rejected with 400.
   */
  @IsOptional()
  @IsISO8601()
  @IsFutureDate({ message: 'expiresAt must be a future date' })
  expiresAt?: string;

  /**
   * Optional list of PAT scopes to restrict this token to.
   * Omit (or send []) to create an unrestricted token (full owner permissions).
   * Each entry must be one of the values in PAT_SCOPES.
   */
  @IsOptional()
  @IsArray()
  @IsIn([...PAT_SCOPES], { each: true })
  scopes?: string[];
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
  /** Granted scopes. Empty array = unrestricted. */
  scopes: string[];
}

/** Metadata-only view returned by GET /me/tokens. */
export interface ApiTokenDto {
  id: string;
  name: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  /** Granted scopes. Empty array = unrestricted (full owner permissions). */
  scopes: string[];
}
