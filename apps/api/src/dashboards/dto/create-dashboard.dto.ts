import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateDashboardDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;
}
