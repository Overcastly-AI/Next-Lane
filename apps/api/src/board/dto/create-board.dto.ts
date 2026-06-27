import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { BoardType } from '@next-lane/shared';

export class CreateBoardDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsEnum(BoardType)
  type!: BoardType;
}
