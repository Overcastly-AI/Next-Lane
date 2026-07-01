import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class ReorderPersonalColumnsDto {
  /** The caller's column ids in their new left-to-right order. */
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  orderedIds!: string[];
}
