import { IsString } from 'class-validator';

export class PromotePersonalCardDto {
  @IsString()
  projectId!: string;
}
