import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateIssueDto } from './create-issue.dto';

export class UpdateIssueDto extends PartialType(
  OmitType(CreateIssueDto, ['projectId'] as const),
) {}
