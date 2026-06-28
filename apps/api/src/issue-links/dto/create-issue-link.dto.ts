import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { IssueLinkType } from '@next-lane/shared';

export class CreateIssueLinkDto {
  /**
   * The target issue: either a human-readable key (e.g. "NL-5") or a CUID id.
   * The key is resolved within the source issue's project; a bare id is looked
   * up globally but must belong to the same project.
   */
  @IsString()
  @IsNotEmpty()
  target!: string;

  /** The relationship type from the caller's perspective (will be normalized). */
  @IsEnum(IssueLinkType)
  type!: IssueLinkType;
}
