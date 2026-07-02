import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertProjectMember,
  assertProjectRole,
} from '../common/membership.util';
import { CreateCustomFieldDto, UpdateCustomFieldDto } from './dto/custom-field.dto';
import {
  CustomFieldType,
  IssueType,
  Role,
} from '@next-lane/shared';
import type {
  CustomFieldDefinitionDto,
  CustomFieldValue,
} from '@next-lane/shared';

// ---------------------------------------------------------------------------
// Internal Prisma row type
// ---------------------------------------------------------------------------

interface CustomFieldRow {
  id: string;
  projectId: string;
  name: string;
  key: string;
  type: string;
  options: string[];
  appliesToTypes: string[];
  required: boolean;
  showOnCard: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

export function toCustomFieldDefinitionDto(
  row: CustomFieldRow,
): CustomFieldDefinitionDto {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    key: row.key,
    type: row.type as CustomFieldType,
    options: row.options,
    appliesToTypes: row.appliesToTypes as IssueType[],
    required: row.required,
    showOnCard: row.showOnCard,
    order: row.order,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Key slug helpers
// ---------------------------------------------------------------------------

/**
 * Derive a stable machine key from a display name:
 *   1. Lowercase
 *   2. Replace any non-alphanumeric char with _
 *   3. Collapse consecutive underscores
 *   4. Strip leading / trailing underscores
 *   5. Guarantee non-empty (fall back to "field")
 */
export function slugifyName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  return slug || 'field';
}

// ---------------------------------------------------------------------------
// Type-validation constants
// ---------------------------------------------------------------------------

const SELECT_TYPES = new Set<CustomFieldType>([
  CustomFieldType.SELECT,
  CustomFieldType.MULTI_SELECT,
]);

/**
 * User-facing labels for each CustomFieldType, mirroring the frontend's
 * `TYPE_LABELS` (apps/web/src/components/settings/CustomFieldsSection.tsx)
 * so validation error messages read in the same voice as the type dropdown
 * instead of leaking the raw upper-case enum value (SETTINGS polish pass).
 */
const TYPE_LABELS: Record<CustomFieldType, string> = {
  [CustomFieldType.TEXT]: 'Text',
  [CustomFieldType.NUMBER]: 'Number',
  [CustomFieldType.SELECT]: 'Select (single)',
  [CustomFieldType.MULTI_SELECT]: 'Multi-select',
  [CustomFieldType.DATE]: 'Date',
  [CustomFieldType.CHECKBOX]: 'Checkbox',
  [CustomFieldType.URL]: 'URL',
};

// ---------------------------------------------------------------------------
// ISO date pattern for DATE custom field values
// ---------------------------------------------------------------------------
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class CustomFieldsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── List ──────────────────────────────────────────────────────────────────

  async findAll(
    userId: string,
    projectId: string,
  ): Promise<CustomFieldDefinitionDto[]> {
    await assertProjectMember(this.prisma, userId, projectId);
    const rows = await this.prisma.customFieldDefinition.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toCustomFieldDefinitionDto);
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async create(
    userId: string,
    projectId: string,
    dto: CreateCustomFieldDto,
  ): Promise<CustomFieldDefinitionDto> {
    await assertProjectRole(this.prisma, userId, projectId, Role.MEMBER);

    const type = dto.type as CustomFieldType;
    this.validateOptionsForType(type, dto.options ?? []);

    // Derive and ensure key uniqueness
    const key = await this.resolveUniqueKey(projectId, dto.name);

    // order = max existing order + 1
    const last = await this.prisma.customFieldDefinition.findFirst({
      where: { projectId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const order = (last?.order ?? -1) + 1;

    const row = await this.prisma.customFieldDefinition.create({
      data: {
        projectId,
        name: dto.name,
        key,
        type,
        options: dto.options ?? [],
        appliesToTypes: dto.appliesToTypes ?? [],
        required: dto.required ?? false,
        showOnCard: dto.showOnCard ?? false,
        order,
      },
    });

    return toCustomFieldDefinitionDto(row);
  }

  // ── Update ────────────────────────────────────────────────────────────────

  /**
   * `type` and `key` are immutable. The client can change name, options,
   * appliesToTypes, required, and order. When options are supplied the
   * existing type rule (SELECT/MULTI_SELECT ↔ non-empty options) is re-applied.
   */
  async update(
    userId: string,
    id: string,
    dto: UpdateCustomFieldDto,
  ): Promise<CustomFieldDefinitionDto> {
    const existing = await this.prisma.customFieldDefinition.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Custom field not found');
    await assertProjectRole(
      this.prisma,
      userId,
      existing.projectId,
      Role.MEMBER,
    );

    if (dto.options !== undefined) {
      this.validateOptionsForType(
        existing.type as CustomFieldType,
        dto.options,
      );
    }

    const row = await this.prisma.customFieldDefinition.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.options !== undefined ? { options: dto.options } : {}),
        ...(dto.appliesToTypes !== undefined
          ? { appliesToTypes: dto.appliesToTypes }
          : {}),
        ...(dto.required !== undefined ? { required: dto.required } : {}),
        ...(dto.showOnCard !== undefined ? { showOnCard: dto.showOnCard } : {}),
        ...(dto.order !== undefined ? { order: dto.order } : {}),
      },
    });

    return toCustomFieldDefinitionDto(row);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  /**
   * Deletes the definition. Orphaned values already stored in Issue.customFields
   * under this definition's id are harmless: they are simply unknown keys and
   * are silently ignored when the issue is read. We intentionally do NOT rewrite
   * every issue row — that would be an expensive O(N) operation for a non-visible
   * side-effect.
   */
  async remove(userId: string, id: string): Promise<{ id: string }> {
    const existing = await this.prisma.customFieldDefinition.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Custom field not found');
    await assertProjectRole(
      this.prisma,
      userId,
      existing.projectId,
      Role.MEMBER,
    );

    await this.prisma.customFieldDefinition.delete({ where: { id } });
    return { id };
  }

  // ── Validation helper (used by IssuesService) ─────────────────────────────

  /**
   * Validates and normalises a `customFields` payload before writing to an issue.
   *
   * Rules applied per entry:
   *   - The definition id must exist in the project.
   *   - `appliesToTypes` non-empty → the issue type must be in the list.
   *   - Value type must match the definition's CustomFieldType:
   *       TEXT / URL  → string
   *       NUMBER      → number
   *       CHECKBOX    → boolean
   *       DATE        → ISO date string (YYYY-MM-DD or full ISO-8601)
   *       SELECT      → one of definition.options
   *       MULTI_SELECT→ array of strings, all within definition.options
   *   - null / undefined → clears the key (returned as null in the normalised object).
   *
   * Returns a normalised `Record<string, CustomFieldValue | null>` suitable
   * for merging into Issue.customFields. Throws BadRequestException with a
   * descriptive message on any violation.
   *
   * @param projectId  The project the issue belongs to.
   * @param issueType  The (possibly updated) type of the issue.
   * @param payload    Raw customFields from the request body.
   */
  async validateAndNormalize(
    projectId: string,
    issueType: IssueType,
    payload: Record<string, CustomFieldValue>,
  ): Promise<Record<string, CustomFieldValue>> {
    if (Object.keys(payload).length === 0) return {};

    // Load all definitions for the project in one query.
    const definitions = await this.prisma.customFieldDefinition.findMany({
      where: { projectId },
    });
    const defMap = new Map(definitions.map((d) => [d.id, d]));

    const result: Record<string, CustomFieldValue> = {};

    for (const [fieldId, value] of Object.entries(payload)) {
      const def = defMap.get(fieldId);
      if (!def) {
        throw new BadRequestException(
          `Custom field "${fieldId}" does not exist in this project`,
        );
      }

      // appliesToTypes: empty = applies to all issue types
      // Prisma returns $Enums.IssueType[] which is string-backed — cast through
      // string[] for the includes() check to satisfy TypeScript without `any`.
      if (
        def.appliesToTypes.length > 0 &&
        !(def.appliesToTypes as string[]).includes(issueType as string)
      ) {
        throw new BadRequestException(
          `Custom field "${def.name}" (${def.key}) does not apply to issue type "${issueType}"`,
        );
      }

      // null → clear the field
      if (value === null || value === undefined) {
        result[fieldId] = null;
        continue;
      }

      // Type-specific validation
      const fieldType = def.type as CustomFieldType;
      switch (fieldType) {
        case CustomFieldType.TEXT:
        case CustomFieldType.URL:
          if (typeof value !== 'string') {
            throw new BadRequestException(
              `Custom field "${def.name}" (${def.key}) expects a string value`,
            );
          }
          result[fieldId] = value;
          break;

        case CustomFieldType.NUMBER:
          if (typeof value !== 'number') {
            throw new BadRequestException(
              `Custom field "${def.name}" (${def.key}) expects a number value`,
            );
          }
          result[fieldId] = value;
          break;

        case CustomFieldType.CHECKBOX:
          if (typeof value !== 'boolean') {
            throw new BadRequestException(
              `Custom field "${def.name}" (${def.key}) expects a boolean value`,
            );
          }
          result[fieldId] = value;
          break;

        case CustomFieldType.DATE:
          if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) {
            throw new BadRequestException(
              `Custom field "${def.name}" (${def.key}) expects an ISO date string (e.g. "2024-06-15")`,
            );
          }
          result[fieldId] = value;
          break;

        case CustomFieldType.SELECT: {
          if (typeof value !== 'string') {
            throw new BadRequestException(
              `Custom field "${def.name}" (${def.key}) expects a string value (one of: ${def.options.join(', ')})`,
            );
          }
          if (!def.options.includes(value)) {
            throw new BadRequestException(
              `"${value}" is not a valid option for custom field "${def.name}" (${def.key}). Valid options: ${def.options.join(', ')}`,
            );
          }
          result[fieldId] = value;
          break;
        }

        case CustomFieldType.MULTI_SELECT: {
          if (
            !Array.isArray(value) ||
            !(value as unknown[]).every((v) => typeof v === 'string')
          ) {
            throw new BadRequestException(
              `Custom field "${def.name}" (${def.key}) expects an array of strings`,
            );
          }
          const values = value as string[];
          const invalid = values.filter((v) => !def.options.includes(v));
          if (invalid.length > 0) {
            throw new BadRequestException(
              `Invalid option(s) for custom field "${def.name}" (${def.key}): ${invalid.join(', ')}. Valid options: ${def.options.join(', ')}`,
            );
          }
          result[fieldId] = values;
          break;
        }

        default: {
          // Exhaustiveness guard — should never happen if the enum is in sync.
          const _exhaustive: never = fieldType;
          throw new BadRequestException(
            `Unknown custom field type: ${String(_exhaustive)}`,
          );
        }
      }
    }

    return result;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Ensure options are provided (and non-empty) for SELECT/MULTI_SELECT,
   * and absent (or empty) for all other types.
   */
  private validateOptionsForType(
    type: CustomFieldType,
    options: string[],
  ): void {
    const needsOptions = SELECT_TYPES.has(type);
    const label = TYPE_LABELS[type] ?? type;
    if (needsOptions && options.length === 0) {
      throw new BadRequestException(
        `The "${label}" field type requires at least one option`,
      );
    }
    if (!needsOptions && options.length > 0) {
      throw new BadRequestException(
        `The "${label}" field type must not have options`,
      );
    }
  }

  /**
   * Slugify `name` and ensure uniqueness within the project by appending
   * a numeric suffix (_2, _3, …) if the base key is already taken.
   */
  private async resolveUniqueKey(
    projectId: string,
    name: string,
  ): Promise<string> {
    const base = slugifyName(name);

    // Fetch all keys with the same base or base_N prefix in one query.
    const existing = await this.prisma.customFieldDefinition.findMany({
      where: {
        projectId,
        key: { startsWith: base },
      },
      select: { key: true },
    });
    const taken = new Set(existing.map((r) => r.key));

    if (!taken.has(base)) return base;

    let suffix = 2;
    while (taken.has(`${base}_${suffix}`)) {
      suffix += 1;
    }
    return `${base}_${suffix}`;
  }
}
