import { Controller, Get, Header, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { IssuesService } from './issues.service';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';
import { RequireScope } from '../auth/require-scope.decorator';

@ApiTags('issues')
@ApiBearerAuth()
@Controller()
export class IssuesCsvController {
  constructor(private readonly issues: IssuesService) {}

  /**
   * Export all issues in a project as a CSV file.
   *
   * GET /projects/:projectId/issues.csv?q=<optional NLQL>
   *
   * Response:
   *   Content-Type: text/csv; charset=utf-8
   *   Content-Disposition: attachment; filename="<projectKey>-issues.csv"
   *
   * Authorization: project member (VIEWER+).
   * Optional `q` NLQL filter: validated (400 on invalid) and evaluated against
   * issue rows using the same evaluator as the board (filterIssues).
   */
  @Get('projects/:projectId/issues.csv')
  @RequireScope('issues:read')
  async exportCsv(
    @CurrentUser() user: AuthUser,
    @Param('projectId') projectId: string,
    @Query('q') q: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { csv, projectKey, truncated } = await this.issues.exportCsv(user.id, projectId, q);

    // Sanitize the project key for use in the filename: keep only safe chars.
    const safeKey = projectKey.replace(/[^\w-]/g, '_');
    const filename = `${safeKey}-issues.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    if (truncated) {
      res.setHeader('X-Next-Lane-Truncated', 'true');
    }
    res.send(csv);
  }
}
