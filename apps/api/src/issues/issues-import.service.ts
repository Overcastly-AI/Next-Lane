/**
 * IssuesImportService — CSV → bulk issue creation.
 *
 * Mirrors the export columns in `IssuesService.exportCsv()` so a file
 * exported from Next Lane round-trips cleanly.
 *
 * Column set (case-insensitive header matching):
 *   Key         — ignored on import (auto-assigned)
 *   Title       — REQUIRED; string, 1–300 chars
 *   Description — optional free-text / markdown
 *   Type        — IssueType enum (TASK/BUG/STORY/EPIC/SUBTASK); default TASK
 *   Status      — project status name; default: first TODO-category status
 *   Priority    — Priority enum (URGENT/HIGH/MEDIUM/LOW/NONE); default MEDIUM
 *   Assignee    — user email; resolved to workspace member; unknown → row error
 *   Reporter    — ignored (set to the importing user)
 *   Story Points — integer 0–999; optional
 *   Sprint      — ignored (not imported to avoid cross-sprint side-effects)
 *   Labels      — comma-or-semicolon-separated label names; create-or-match
 *   Start Date  — ISO 8601 date / datetime; optional
 *   Due Date    — ISO 8601 date / datetime; optional
 *   Created     — ignored on import
 *   Updated     — ignored on import
 *
 * Unknown columns are silently ignored (forward-compatibility).
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
} from '@next-lane/shared';
import type { ImportIssuesResultDto, ImportIssueRowError } from '@next-lane/shared';
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

/** Maps the canonical column names (lower-cased) used in the export. */
const KNOWN_COLUMNS = new Set([
  'key',
  'title',
  'description',
  'type',
  'status',
  'priority',
  'assignee',
  'reporter',
  'story points',
  'sprint',
  'labels',
  'start date',
  'due date',
  'created',
  'updated',
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
    const [statuses, workspaceMembers, existingLabels] = await Promise.all([
      this.prisma.status.findMany({ where: { projectId } }),
      this.prisma.membership.findMany({
        where: { workspaceId },
        include: { user: { select: { id: true, email: true } } },
      }),
      this.prisma.label.findMany({ where: { projectId } }),
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

    // ── 6. Process rows ───────────────────────────────────────────────────────
    let created = 0;
    let skipped = 0;
    const errors: ImportIssueRowError[] = [];

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

        created += 1;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unexpected error';
        errors.push({ row: rowNum, message });
      }
    }

    return {
      created,
      skipped,
      errors,
      dryRun: opts.dryRun ?? false,
    };
  }
}
