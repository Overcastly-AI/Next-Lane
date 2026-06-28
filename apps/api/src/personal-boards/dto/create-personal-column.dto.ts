import { IsString, MinLength, MaxLength } from 'class-validator';

export class CreatePersonalColumnDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}
