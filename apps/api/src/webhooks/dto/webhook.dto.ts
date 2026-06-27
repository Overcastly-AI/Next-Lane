import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { WEBHOOK_EVENT_TYPES, type WebhookEventType } from '@next-lane/shared';

// Mutable copy for class-validator's @IsIn (it expects a plain array).
const EVENT_VALUES = [...WEBHOOK_EVENT_TYPES];

export class CreateWebhookDto {
  @IsString()
  // require_tld off so admins can target internal hostnames in their own infra;
  // SSRF allowlisting is a documented follow-up (see docs/BACKLOG.md).
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  @MaxLength(2048)
  url!: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  secret?: string;

  // Subscribed event types; empty/omitted means "all events".
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(EVENT_VALUES, { each: true })
  events?: WebhookEventType[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateWebhookDto {
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  @MaxLength(2048)
  url?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  secret?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(EVENT_VALUES, { each: true })
  events?: WebhookEventType[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
