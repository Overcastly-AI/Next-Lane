/**
 * IssuesImportService — CSV → bulk issue creation.
 *
 * Mirrors the export columns in `IssuesService.exportCsv()` so a file
 * exported from Next Lane round-trips cleanly.
 *
 * Column set (case-insensitive header matching):
 *   Key         — not imported; keys are assigned by the target project
 *   Title       — REQUIRED; string, 1–300 chars
 *   Description — optional free-text / markdown
 *   Type        — IssueType enum (TASK/BUG/STORY/EPIC/SUBTASK); default TASK
 *   Status      — project status name; default: first TODO-category status
 *   Priority    — Priority enum (URGENT/HIGH/MEDIUM/LOW/NONE); default MEDIUM
 *   Assignee    — user email; resolved to workspace member; unknown → row error
 *   Reporter    — not imported (authorship is the importing user)
 *   Story Points — integer 0–999; optional
 *   Sprint      — not imported (see NOT IMPORTED below)
 *   Labels      — comma-or-semicolon-separated label names; create-or-match
 *   Start Date  — ISO 8601 date / datetime; optional
 *   Due Date    — ISO 8601 date / datetime; optional
 *   Parent      — issue key of the parent row IN THE SAME FILE; linked in a
 *                 second pass once every row has an id
 *   Component   — component name; create-or-match in the target project
 *   Fix Versions — comma-or-semicolon-separated version names; create-or-match
 *   Original Estimate (minutes) — integer ≥ 0
 *   CF: <name>  — custom-field value, matched to a definition of the same name
 *                 in the TARGET project and coerced to that definition's type
 *   Created     — not imported (the write's own timestamp)
 *   Updated     — not imported
 *
 * NOT IMPORTED, AND WHY IT IS SAID OUT LOUD
 * ─────────────────────────────────────────
 * Some columns cannot round-trip: `Key` is assigned by the target project,
 * `Reporter`/`Created`/`Updated` describe a write that is happening now, and
 * `Sprint` is withheld because materialising sprints would invent lifecycle
 * state (a single sprint is active per project) that the file does not carry.
 *
 * Those are defensible. Being SILENT about them was not: this importer used to
 * parse every column and apply ten of them, so a user who exported a project
 * from one instance and imported it into another was told "Imported N issues"
 * while parent links, components, fix versions, estimates and every custom
 * field were dropped on the floor. Every column the file contains and this
 * import does not apply is now returned in `unimportedColumns`, and anything
 * that failed to resolve for one row comes back in `warnings`.
 * See `csv-roundtrip.integration.spec.ts`.
 */

import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { PrismaService } from '../prisma/prisma.service';
import { IssuesService } from './issues.service';
import { assertProjectRole } from '../common/membership.util';
import {
  IssueType,
  Priority,
  StatusCategory,
  Role,
  CustomFieldType,
} from '@next-lane/shared';
import type {
  ImportIssuesResultDto,
  ImportIssueRowError,
  CustomFieldValue,
  UnimportedColumn,
} from '@next-lane/shared';
import type { CreateIssueDto } from './dto/create-issue.dto';
import {
  type ImportSource,
  isImportSource,
  looksLikeJson,
  githubJsonToRows,
  normaliseRowForSource,
} from './issues-import.sources';

/** Hard row limit per import request (header excluded). */
export const IMPORT_MAX_ROWS = 2000;

/** Default label color for auto-created labels. */
const DEFAULT_LABEL_COLOR = '#94a3b8';

/**
 * Columns (lower-cased) whose content this importer actually applies.
 *
 * Anything in the file outside this set — including the deliberate omissions
 * below and any column from a foreign tracker we don't understand — is
 * reported in `unimportedColumns` rather than ignored in silence.
 */
const APPLIED_COLUMNS = new Set([
  'title',
  'description',
  'type',
  'status',
  'priority',
  'assignee',
  'story points',
  'labels',
  'start date',
  'due date',
  'parent',
  'component',
  'fix versions',
  'original estimate (minutes)',
]);

/** Prefix marking a custom-field column in the export ("CF: Severity"). */
const CUSTOM_FIELD_PREFIX = 'cf: ';

/**
 * Columns the export writes that cannot round-trip, with the reason surfaced
 * to the user. Keyed lower-case; the value is shown alongside the column name.
 */
const UNIMPORTABLE_REASONS = new Map<string, string>([
  ['key', 'keys are assigned by the target project'],
  ['reporter', 'the importing user is recorded as reporter'],
  ['sprint', 'sprints are not created by import'],
  ['created', 'set to the time of this import'],
  ['updated', 'set to the time of this import'],
]);

/** Normalise a raw cell value: trim, strip the formula-injection apostrophe guard. */
function normaliseCell(raw: string): string {
  let s = raw.trim();
  // Export prefixes leading formula starters with an apostrophe — strip it.
  if (s.startsWith("'") && s.length > 1) {
    const after = s.slice(1);
    if (/^[=+\-@]/.test(after)) {
      s = after;
    }
  }
  return s;
}

/** Parse a Priority string (case-insensitive). Returns null when unrecognised. */
function parsePriority(raw: string): Priority | null {
  const up = raw.toUpperCase();
  if (Object.values(Priority).includes(up as Priority)) return up as Priority;
  return null;
}

/** Parse an IssueType string (case-insensitive). Returns null when unrecognised. */
function parseIssueType(raw: string): IssueType | null {
  const up = raw.toUpperCase();
  if (Object.values(IssueType).includes(up as IssueType)) return up as IssueType;
  return null;
}

/** Split a label cell by comma or semicolons, returning trimmed non-empty names. */
function splitLabels(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Coerce a CSV cell into the value type a custom-field definition demands.
 *
 * The export stringifies everything (`String(value)`, arrays joined with
 * "; "), while `CustomFieldsService.validateAndNormalize` is strict — it
 * rejects `"5"` for a NUMBER field and `"true"` for a CHECKBOX. Without this
 * step a round trip would fail every row that carries a non-text custom
 * field, which is worse than dropping it.
 *
 * Returns `{ ok: false, message }` when the cell cannot be read as the
 * declared type, so the caller can warn about that one field instead of
 * failing the whole row.
 */
function coerceCustomFieldValue(
  def: { name: string; type: CustomFieldType },
  raw: string,
): { ok: true; value: CustomFieldValue } | { ok: false; message: string } {
  switch (def.type) {
    case CustomFieldType.TEXT:
    case CustomFieldType.URL:
    case CustomFieldType.SELECT:
      return { ok: true, value: raw };

    case CustomFieldType.NUMBER: {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        return {
          ok: false,
          message: `custom field "${def.name}" expects a number, got "${raw}"`,
        };
      }
      return { ok: true, value: n };
    }

    case CustomFieldType.CHECKBOX: {
      const v = raw.toLowerCase();
      if (['true', 'yes', '1'].includes(v)) return { ok: true, value: true };
      if (['false', 'no', '0'].includes(v)) return { ok: true, value: false };
      return {
        ok: false,
        message: `custom field "${def.name}" expects true/false, got "${raw}"`,
      };
    }

    case CustomFieldType.DATE: {
      // validateAndNormalize wants a bare ISO date; the export may carry a
      // full datetime, so keep the date half rather than rejecting it.
      const datePart = raw.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
        return {
          ok: false,
          message: `custom field "${def.name}" expects an ISO date, got "${raw}"`,
        };
      }
      return { ok: true, value: datePart };
    }

    case CustomFieldType.MULTI_SELECT:
      return { ok: true, value: splitLabels(raw) };

    default: {
      const _exhaustive: never = def.type;
      return {
        ok: false,
        message: `custom field "${def.name}" has an unsupported type ${String(_exhaustive)}`,
      };
    }
  }
}

export interface ImportOptions {
  /** When true, validate rows and return would-be results without writing. */
  dryRun?: boolean;
  /**
   * Source tracker that produced the file.  When non-generic, a pre-
   * normalisation step rewrites headers and maps enum values before the
   * generic pipeline runs.  Defaults to 'generic'.
   */
  source?: ImportSource;
}

@Injectable()
export class IssuesImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly issues: IssuesService,
  ) {}

  /**
   * Import issues from a CSV (or JSON) string into a project.
   *
   * @param userId     — The authenticated user performing the import (MEMBER+).
   * @param projectId  — Target project.
   * @param csvText    — Raw CSV content (UTF-8 string) OR a JSON array for
   *                     GitHub source.
   * @param opts       — Import options (dryRun, source).
   * @returns          — Summary with created/skipped/errors counts.
   */
  async importCsv(
    userId: string,
    projectId: string,
    csvText: string,
    opts: ImportOptions = {},
  ): Promise<ImportIssuesResultDto> {
    // ── 0. Validate source ────────────────────────────────────────────────────
    const source: ImportSource =
      opts.source && isImportSource(opts.source) ? opts.source : 'generic';

    // ── 1. Authorisation (MEMBER+ required to create issues) ─────────────────
    const project = await assertProjectRole(
      this.prisma,
      userId,
      projectId,
      Role.MEMBER,
    );
    const workspaceId = project.workspaceId;

    // ── 2. Parse CSV (or JSON for GitHub source) ──────────────────────────────
    let rawRows: Record<string, string>[];

    // GitHub source: detect JSON vs CSV by content sniff.
    if (source === 'github' && looksLikeJson(csvText)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(csvText);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'JSON parse error';
        throw new BadRequestException(`GitHub JSON parse error: ${msg}`);
      }
      rawRows = githubJsonToRows(parsed);
    } else {
      try {
        rawRows = parse(csvText, {
          columns: true,          // use first row as header keys
          skip_empty_lines: true,
          trim: true,
          relax_column_count: true,
          bom: true,              // strip UTF-8 BOM if present
        }) as Record<string, string>[];
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'CSV parse error';
        throw new BadRequestException(`CSV parse error: ${msg}`);
      }
    }

    // ── 3. Row-count limit ────────────────────────────────────────────────────
    if (rawRows.length > IMPORT_MAX_ROWS) {
      throw new BadRequestException(
        `CSV exceeds the maximum of ${IMPORT_MAX_ROWS} data rows (got ${rawRows.length})`,
      );
    }

    // ── 3b. Source pre-normalisation ─────────────────────────────────────────
    //    For non-generic sources, remap headers and enum values to the canonical
    //    Next Lane column names.  Per-row notes from this step are stored so
    //    they can be appended to any error messages.  Normalised rows always use
    //    lowercase canonical keys, so the header-map step below works the same.
    interface NormalisedWithNotes {
      row: Record<string, string>;
      notes: string[];
    }
    let normalisedRows: NormalisedWithNotes[];
    if (source === 'generic') {
      normalisedRows = rawRows.map((r) => ({ row: r, notes: [] }));
    } else {
      normalisedRows = rawRows.map((r) => normaliseRowForSource(source, r));
    }

    // ── 4. Normalise headers (case-insensitive) ───────────────────────────────
    //    For the generic source, csv-parse uses raw header strings as keys;
    //    build a lowercase→raw map.  For non-generic sources the normaliser has
    //    already down-cased and renamed all keys, so the map is identity.
    const headers =
      normalisedRows.length > 0 ? Object.keys(normalisedRows[0].row) : [];
    /** Map from lower-cased header → key in the normalised row objects. */
    const headerMap = new Map<string, string>();
    for (const h of headers) {
      headerMap.set(h.toLowerCase(), h);
    }

    /** Get a normalised cell by canonical (lower-case) column name. */
    const getCell = (row: Record<string, string>, colName: string): string => {
      const key = headerMap.get(colName);
      if (!key) return '';
      return normaliseCell(row[key] ?? '');
    };

    // ── 5. Pre-load project-level data for lookup ─────────────────────────────
    const [
      statuses,
      workspaceMembers,
      existingLabels,
      existingComponents,
      existingVersions,
      customFieldDefs,
    ] = await Promise.all([
      this.prisma.status.findMany({ where: { projectId } }),
      this.prisma.membership.findMany({
        where: { workspaceId },
        include: { user: { select: { id: true, email: true } } },
      }),
      this.prisma.label.findMany({ where: { projectId } }),
      this.prisma.component.findMany({ where: { projectId } }),
      this.prisma.version.findMany({ where: { projectId } }),
      this.prisma.customFieldDefinition.findMany({ where: { projectId } }),
    ]);

    /** Status name (lower-cased) → status id */
    const statusByName = new Map<string, string>();
    let defaultStatusId: string | null = null;
    for (const s of statuses) {
      statusByName.set(s.name.toLowerCase(), s.id);
    }
    // Default to first TODO-category status, then first status overall.
    const todoStatus = statuses
      .filter((s) => s.category === StatusCategory.TODO)
      .sort((a, b) => a.order - b.order)[0];
    const firstStatus = statuses.sort((a, b) => a.order - b.order)[0];
    defaultStatusId = todoStatus?.id ?? firstStatus?.id ?? null;

    /** User email (lower-cased) → user id */
    const memberByEmail = new Map<string, string>();
    for (const m of workspaceMembers) {
      memberByEmail.set(m.user.email.toLowerCase(), m.user.id);
    }

    /** Label name (lower-cased) → label id (pre-existing labels) */
    const labelIdByName = new Map<string, string>();
    for (const l of existingLabels) {
      labelIdByName.set(l.name.toLowerCase(), l.id);
    }

    /** Component / version name (lower-cased) → id, grown as rows create them. */
    const componentIdByName = new Map<string, string>();
    for (const c of existingComponents) {
      componentIdByName.set(c.name.toLowerCase(), c.id);
    }
    const versionIdByName = new Map<string, string>();
    for (const v of existingVersions) {
      versionIdByName.set(v.name.toLowerCase(), v.id);
    }

    /**
     * "cf: <name>" (lower-cased, as it appears in the header) → the target
     * project's definition. A `CF:` column with no definition of that name
     * here is reported as unimported: guessing a type from a string cell
     * would invent a schema the user never asked for.
     */
    const customFieldByColumn = new Map<
      string,
      { id: string; name: string; type: CustomFieldType }
    >();
    for (const def of customFieldDefs) {
      customFieldByColumn.set(`${CUSTOM_FIELD_PREFIX}${def.name.toLowerCase()}`, {
        id: def.id,
        name: def.name,
        type: def.type as CustomFieldType,
      });
    }

    // ── 5b. Classify the file's columns ───────────────────────────────────────
    //    Everything present in the header that this import will not apply is
    //    named back to the caller. Silence here is what made the data loss
    //    invisible in the first place.
    const unimportedColumns: UnimportedColumn[] = [];
    for (const rawHeader of headers) {
      const lower = rawHeader.toLowerCase().trim();
      if (!lower) continue;
      if (APPLIED_COLUMNS.has(lower)) continue;
      if (lower.startsWith(CUSTOM_FIELD_PREFIX) && customFieldByColumn.has(lower)) {
        continue;
      }

      const knownReason = UNIMPORTABLE_REASONS.get(lower);
      if (knownReason) {
        unimportedColumns.push({ column: rawHeader, reason: knownReason });
      } else if (lower.startsWith(CUSTOM_FIELD_PREFIX)) {
        unimportedColumns.push({
          column: rawHeader,
          reason:
            'no custom field of that name in this project — create it, then re-import',
        });
      } else {
        unimportedColumns.push({
          column: rawHeader,
          reason: 'not a Next Lane column',
        });
      }
    }

    // ── 6. Process rows ───────────────────────────────────────────────────────
    let created = 0;
    let skipped = 0;
    const errors: ImportIssueRowError[] = [];
    const warnings: ImportIssueRowError[] = [];

    /**
     * Source issue key → created issue id, for the parent pass below. A file
     * exported from Next Lane carries the parent's key, and the parent is a
     * row in the same file — but it may appear AFTER its child, so parents
     * can only be linked once every row has an id.
     */
    const createdIdBySourceKey = new Map<string, string>();
    /** Rows whose Parent cell needs resolving in pass two. */
    const pendingParents: { rowNum: number; childId: string; parentKey: string }[] =
      [];

    for (let i = 0; i < normalisedRows.length; i += 1) {
      const rowNum = i + 1; // 1-based (header = row 0)
      const { row, notes: rowNotes } = normalisedRows[i];

      // Skip rows that are entirely empty after normalisation.
      const allEmpty = Object.values(row).every((v) => v.trim() === '');
      if (allEmpty) {
        skipped += 1;
        continue;
      }

      // ── Validate + map fields ─────────────────────────────────────────────

      const title = getCell(row, 'title');
      if (!title) {
        errors.push({ row: rowNum, message: 'Title is required' });
        continue;
      }
      if (title.length > 300) {
        errors.push({
          row: rowNum,
          message: `Title exceeds 300 characters (got ${title.length})`,
        });
        continue;
      }

      const description = getCell(row, 'description') || undefined;

      // Type
      const rawType = getCell(row, 'type');
      let issueType: IssueType | undefined;
      if (rawType) {
        const parsed = parseIssueType(rawType);
        if (!parsed) {
          errors.push({
            row: rowNum,
            message: `Unknown issue type: "${rawType}". Valid values: ${Object.values(IssueType).join(', ')}`,
          });
          continue;
        }
        issueType = parsed;
      }

      // Priority
      const rawPriority = getCell(row, 'priority');
      let priority: Priority | undefined;
      if (rawPriority) {
        const parsed = parsePriority(rawPriority);
        if (!parsed) {
          errors.push({
            row: rowNum,
            message: `Unknown priority: "${rawPriority}". Valid values: ${Object.values(Priority).join(', ')}`,
          });
          continue;
        }
        priority = parsed;
      }

      // Status
      const rawStatus = getCell(row, 'status');
      let statusId: string | undefined;
      if (rawStatus) {
        const id = statusByName.get(rawStatus.toLowerCase());
        if (!id) {
          errors.push({
            row: rowNum,
            message: `Unknown status: "${rawStatus}". Use one of the project's configured status names.`,
          });
          continue;
        }
        statusId = id;
      }

      // Assignee (email → userId)
      const rawAssignee = getCell(row, 'assignee');
      let assigneeId: string | undefined;
      if (rawAssignee) {
        // The export uses "Name" or "Name (email)" — try to extract an email.
        // Strategies: look for an email-shaped token or treat the whole cell as email.
        const emailMatch = rawAssignee.match(/[\w.+%-]+@[\w.-]+\.[a-zA-Z]{2,}/);
        const emailToLookup = emailMatch
          ? emailMatch[0].toLowerCase()
          : rawAssignee.toLowerCase();

        const uid = memberByEmail.get(emailToLookup);
        if (!uid) {
          // Append any source-normaliser notes for context (e.g. "this is a
          // display name, not an email" for Jira/GitHub assignees).
          const noteSuffix =
            rowNotes.length > 0 ? ` (${rowNotes.join('; ')})` : '';
          errors.push({
            row: rowNum,
            message: `Assignee not found in workspace: "${rawAssignee}"${noteSuffix}`,
          });
          continue;
        }
        assigneeId = uid;
      }

      // Story Points
      const rawPoints = getCell(row, 'story points');
      let storyPoints: number | undefined;
      if (rawPoints) {
        const n = parseInt(rawPoints, 10);
        if (isNaN(n) || n < 0 || n > 999) {
          errors.push({
            row: rowNum,
            message: `Invalid story points: "${rawPoints}". Must be an integer 0–999.`,
          });
          continue;
        }
        storyPoints = n;
      }

      // Start Date
      const rawStart = getCell(row, 'start date');
      let startDate: string | undefined;
      if (rawStart) {
        const d = new Date(rawStart);
        if (isNaN(d.getTime())) {
          errors.push({
            row: rowNum,
            message: `Invalid start date: "${rawStart}". Must be an ISO 8601 date.`,
          });
          continue;
        }
        startDate = rawStart;
      }

      // Due Date
      const rawDue = getCell(row, 'due date');
      let dueDate: string | undefined;
      if (rawDue) {
        const d = new Date(rawDue);
        if (isNaN(d.getTime())) {
          errors.push({
            row: rowNum,
            message: `Invalid due date: "${rawDue}". Must be an ISO 8601 date.`,
          });
          continue;
        }
        dueDate = rawDue;
      }

      // Labels — resolve names; auto-create if missing (same behavior as project label management)
      const rawLabels = getCell(row, 'labels');
      const labelNames = splitLabels(rawLabels);
      const resolvedLabelIds: string[] = [];

      let labelError = false;
      for (const name of labelNames) {
        const existing = labelIdByName.get(name.toLowerCase());
        if (existing) {
          resolvedLabelIds.push(existing);
        } else if (!opts.dryRun) {
          // Auto-create the label on first use (matches the spirit of the
          // per-issue label-name approach used elsewhere in the product).
          const created = await this.prisma.label.create({
            data: { projectId, name, color: DEFAULT_LABEL_COLOR },
          });
          labelIdByName.set(name.toLowerCase(), created.id);
          resolvedLabelIds.push(created.id);
        }
        // In dryRun mode unknown labels are ignored (we can't create them).
      }
      if (labelError) continue;

      // Original Estimate — a plain integer field the exporter has always
      // written and the importer never read.
      const rawEstimate = getCell(row, 'original estimate (minutes)');
      let originalEstimateMinutes: number | undefined;
      if (rawEstimate) {
        const n = parseInt(rawEstimate, 10);
        if (isNaN(n) || n < 0) {
          errors.push({
            row: rowNum,
            message: `Invalid original estimate: "${rawEstimate}". Must be a non-negative integer (minutes).`,
          });
          continue;
        }
        originalEstimateMinutes = n;
      }

      // Custom fields — one column per definition, matched by NAME against the
      // target project (ids differ across instances, so the id in the source
      // file is meaningless here). A cell that will not coerce warns and is
      // left unset rather than failing the row: losing one field is better
      // than losing the issue.
      const customFields: Record<string, CustomFieldValue> = {};
      for (const [column, def] of customFieldByColumn) {
        const raw = getCell(row, column);
        if (!raw) continue;
        const coerced = coerceCustomFieldValue(def, raw);
        if (!coerced.ok) {
          warnings.push({ row: rowNum, message: coerced.message });
          continue;
        }
        customFields[def.id] = coerced.value;
      }

      // Component — create-or-match by name, exactly as labels already do.
      const rawComponent = getCell(row, 'component');
      let componentId: string | undefined;
      if (rawComponent) {
        const existing = componentIdByName.get(rawComponent.toLowerCase());
        if (existing) {
          componentId = existing;
        } else if (!opts.dryRun) {
          const createdComponent = await this.prisma.component.create({
            data: { projectId, name: rawComponent },
          });
          componentIdByName.set(rawComponent.toLowerCase(), createdComponent.id);
          componentId = createdComponent.id;
        }
      }

      // Fix Versions — same create-or-match, one row can carry several.
      const versionNames = splitLabels(getCell(row, 'fix versions'));
      const resolvedVersionIds: string[] = [];
      for (const name of versionNames) {
        const existing = versionIdByName.get(name.toLowerCase());
        if (existing) {
          resolvedVersionIds.push(existing);
        } else if (!opts.dryRun) {
          const createdVersion = await this.prisma.version.create({
            data: { projectId, name },
          });
          versionIdByName.set(name.toLowerCase(), createdVersion.id);
          resolvedVersionIds.push(createdVersion.id);
        }
      }

      // ── Skip write on dryRun ───────────────────────────────────────────────
      if (opts.dryRun) {
        created += 1; // count as "would be created"
        continue;
      }

      // ── Create the issue ──────────────────────────────────────────────────
      try {
        const createDto: CreateIssueDto = {
          projectId,
          title,
          description,
          type: issueType,
          priority,
          statusId: statusId ?? defaultStatusId ?? undefined,
          assigneeId,
          storyPoints,
          startDate,
          dueDate,
          componentId,
          originalEstimateMinutes,
          ...(Object.keys(customFields).length > 0 ? { customFields } : {}),
        };

        const issue = await this.issues.create(userId, createDto);

        // Attach labels via IssueLabel upsert (same pattern as bulkUpdate).
        for (const labelId of resolvedLabelIds) {
          await this.prisma.issueLabel.upsert({
            where: { issueId_labelId: { issueId: issue.id, labelId } },
            update: {},
            create: { issueId: issue.id, labelId },
          });
        }

        // Fix versions use the same join-row upsert as labels.
        for (const versionId of resolvedVersionIds) {
          await this.prisma.issueVersion.upsert({
            where: { issueId_versionId: { issueId: issue.id, versionId } },
            update: {},
            create: { issueId: issue.id, versionId },
          });
        }

        // Remember this row's source key so a child row elsewhere in the file
        // can point at it, and queue our own parent for pass two.
        const sourceKey = getCell(row, 'key');
        if (sourceKey) {
          createdIdBySourceKey.set(sourceKey.toLowerCase(), issue.id);
        }
        const parentKey = getCell(row, 'parent');
        if (parentKey) {
          pendingParents.push({ rowNum, childId: issue.id, parentKey });
        }

        created += 1;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unexpected error';
        errors.push({ row: rowNum, message });
      }
    }

    // ── 7. Second pass: parent links ─────────────────────────────────────────
    //    Deferred until every row exists, because a file is free to list a
    //    child before its epic. Routed through `IssuesService.update` rather
    //    than a raw Prisma write so the cycle guard, type rules and activity
    //    log all apply exactly as they would to a parent set by hand.
    for (const { rowNum, childId, parentKey } of pendingParents) {
      const parentId = createdIdBySourceKey.get(parentKey.toLowerCase());
      if (!parentId) {
        warnings.push({
          row: rowNum,
          message: `parent "${parentKey}" is not a row in this file — the issue was imported without its parent link`,
        });
        continue;
      }
      try {
        await this.issues.update(userId, childId, { parentId });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unexpected error';
        warnings.push({
          row: rowNum,
          message: `could not link to parent "${parentKey}": ${message}`,
        });
      }
    }

    return {
      created,
      skipped,
      errors,
      warnings,
      unimportedColumns,
      dryRun: opts.dryRun ?? false,
    };
  }
}
