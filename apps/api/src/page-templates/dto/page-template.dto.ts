import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  PAGE_TEMPLATE_CONTENT_MAX,
  PAGE_TEMPLATE_DESCRIPTION_MAX,
  PAGE_TEMPLATE_NAME_MAX,
} from '@next-lane/shared';
import {
  PAGE_TITLE_FORBIDDEN_MESSAGE,
  PAGE_TITLE_FORBIDDEN_RE,
} from '../../pages/dto/create-page.dto';

/**
 * `titleTemplate` becomes a real `Page.title`, so it inherits the page-title
 * rules — length, and the `[ ] |` ban that keeps every title addressable as a
 * `[[wiki-link]]` target.
 *
 * The regex is applied to the UNRENDERED template here. That is necessary but
 * not sufficient: `{{author}}` could expand to a display name containing `|`.
 * The service re-validates the RENDERED title before insert (see
 * `resolveTitle`), so this decorator is the fast, obvious rejection and the
 * service is the authoritative one.
 */
const TITLE_TEMPLATE_MAX = 300;

export class CreatePageTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(PAGE_TEMPLATE_NAME_MAX)
  name!: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(PAGE_TEMPLATE_DESCRIPTION_MAX)
  description?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(TITLE_TEMPLATE_MAX)
  @Matches(PAGE_TITLE_FORBIDDEN_RE, { message: PAGE_TITLE_FORBIDDEN_MESSAGE })
  titleTemplate?: string | null;

  /** Markdown body with `{{token}}` placeholders. Omitted defaults to `""`. */
  @IsOptional()
  @IsString()
  @MaxLength(PAGE_TEMPLATE_CONTENT_MAX)
  content?: string;
}

export class UpdatePageTemplateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(PAGE_TEMPLATE_NAME_MAX)
  name?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(PAGE_TEMPLATE_DESCRIPTION_MAX)
  description?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(TITLE_TEMPLATE_MAX)
  @Matches(PAGE_TITLE_FORBIDDEN_RE, { message: PAGE_TITLE_FORBIDDEN_MESSAGE })
  titleTemplate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(PAGE_TEMPLATE_CONTENT_MAX)
  content?: string;
}

/** Body for `POST /page-templates/:id/create-page`. */
export class CreatePageFromTemplateDto {
  /**
   * Destination project for a WORKSPACE-WIDE template. Omit or null to create
   * a workspace-level page. Ignored-but-validated for a project-scoped
   * template: passing a project other than the template's own is a 400 rather
   * than a silent redirect to somewhere the caller didn't ask for.
   */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  projectId?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  parentId?: string | null;

  /** Overrides the template's `titleTemplate`. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(TITLE_TEMPLATE_MAX)
  @Matches(PAGE_TITLE_FORBIDDEN_RE, { message: PAGE_TITLE_FORBIDDEN_MESSAGE })
  title?: string;
}

/** Query for `GET /projects/:projectId/page-templates`. */
export class ListProjectPageTemplatesQueryDto {
  /**
   * Include the workspace-wide templates this project inherits. Defaults to
   * true — the picker's whole point is one merged list — but the management
   * screen sets it false so "delete" is never offered for a row the project
   * doesn't own.
   */
  @IsOptional()
  @IsBoolean()
  includeInherited?: boolean;
}
