/**
 * issues-import.sources.ts
 *
 * Source-specific header-alias maps and enum value maps for the tracker
 * importers (Jira, GitHub, Linear). Applied as a pre-normalization step BEFORE
 * the generic CSV import pipeline, so all existing validation, dryRun, error
 * handling, and bulk-create logic is reused unchanged.
 *
 * Design:
 *  - HEADER_ALIASES_<SOURCE>: maps the tracker's column header (lower-cased)
 *    to the canonical Next Lane column name (lower-cased). Unknown columns are
 *    passed through (they'll be ignored by the generic pipeline's KNOWN_COLUMNS
 *    check anyway, so this is harmless).
 *  - TYPE_MAP_<SOURCE> / PRIORITY_MAP_<SOURCE>: map tracker enum strings
 *    (lower-cased) to the canonical Next Lane enum value. A missing key produces
 *    a `null` return, which the caller converts to a per-row error.
 *
 * Each tracker's mapping is exported as a plain data object so it can be unit-
 * tested in complete isolation without any NestJS wiring.
 */

import { IssueType, Priority } from '@next-lane/shared';

// ---------------------------------------------------------------------------
// Source type
// ---------------------------------------------------------------------------

/** The accepted values for the `source` query / body parameter. */
export type ImportSource = 'generic' | 'jira' | 'github' | 'linear';

export const IMPORT_SOURCES: readonly ImportSource[] = [
  'generic',
  'jira',
  'github',
  'linear',
];

export function isImportSource(value: unknown): value is ImportSource {
  return typeof value === 'string' && (IMPORT_SOURCES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Normalised row type (after source pre-processing, before generic pipeline)
// ---------------------------------------------------------------------------

/**
 * A row after source-specific normalization. Keys are lowercase canonical
 * column names as used by the generic import pipeline.
 */
export type NormalisedRow = Record<string, string>;

// ---------------------------------------------------------------------------
// Generic source (passthrough — no transformation needed)
// ---------------------------------------------------------------------------

export function normaliseGenericRow(row: Record<string, string>): NormalisedRow {
  // Lower-case all header keys so the generic pipeline's case-insensitive
  // logic (which builds its own headerMap) continues to work.
  return row;
}

// ---------------------------------------------------------------------------
// ── Jira ──────────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------
//
// Jira CSV export columns (representative; may vary by Jira version/config):
//   Summary, Issue key, Issue id, Parent id, Issue Type, Status, Priority,
//   Resolution, Assignee, Reporter, Creator, Created, Updated, Last Viewed,
//   Resolved, Story Points, Story point estimate, Description, Labels,
//   Sprint, Start Date, Due Date, Custom fields…
//
// Duplicate column note:
//   Jira can export the "Labels" column multiple times (once per label in older
//   Jira Server exports). csv-parse with `columns: true` and `relax_column_count`
//   will keep the LAST value for duplicate keys. Our normaliser therefore also
//   joins all label-like columns it finds (Labels, Labels_2, etc.) before
//   forwarding the merged value. This handles the common case; extreme cases
//   (5+ label columns) are noted as a known limitation in the docs.

/** Jira header → canonical Next Lane header (exact lower-cased match). */
export const JIRA_HEADER_ALIASES: Record<string, string> = {
  summary: 'title',
  description: 'description',
  'issue type': 'type',
  priority: 'priority',
  status: 'status',
  assignee: 'assignee',
  labels: 'labels',
  'story points': 'story points',
  'story point estimate': 'story points',
  'start date': 'start date',
  'due date': 'due date',
  // Explicitly map columns that must be dropped / ignored:
  'issue key': 'key',
  'issue id': 'key',
  reporter: 'reporter',
  creator: 'reporter',
  sprint: 'sprint',
  resolution: '', // ignored (no equivalent)
  'last viewed': '', // ignored
  resolved: '', // ignored
};

/** Jira Issue Type → Next Lane IssueType */
export const JIRA_TYPE_MAP: Record<string, IssueType> = {
  bug: IssueType.BUG,
  story: IssueType.STORY,
  task: IssueType.TASK,
  epic: IssueType.EPIC,
  'sub-task': IssueType.SUBTASK,
  subtask: IssueType.SUBTASK,
  'technical task': IssueType.TASK,
  'new feature': IssueType.STORY,
  improvement: IssueType.STORY,
};

/** Jira Priority → Next Lane Priority */
export const JIRA_PRIORITY_MAP: Record<string, Priority> = {
  highest: Priority.HIGHEST,
  high: Priority.HIGH,
  medium: Priority.MEDIUM,
  low: Priority.LOW,
  lowest: Priority.LOWEST,
  blocker: Priority.HIGHEST,
  critical: Priority.HIGHEST,
  major: Priority.HIGH,
  minor: Priority.LOW,
  trivial: Priority.LOWEST,
};

/**
 * Normalise a single row from a Jira CSV export.
 *
 * Steps:
 *  1. Remap header names using JIRA_HEADER_ALIASES.
 *  2. Remap Type and Priority cell values using the Jira-specific maps.
 *  3. Merge any secondary label columns (Labels_2, Labels.1, etc.) into
 *     the primary "labels" value (comma-joined).
 *
 * Returns a NormalisedRow keyed by lowercase canonical column names.
 * Unknown columns that have no alias are kept as-is (they'll be ignored
 * downstream since they're not in KNOWN_COLUMNS).
 */
export function normaliseJiraRow(
  row: Record<string, string>,
): { row: NormalisedRow; notes: string[] } {
  const notes: string[] = [];
  const out: NormalisedRow = {};
  const extraLabelValues: string[] = [];

  for (const [rawKey, rawValue] of Object.entries(row)) {
    const lk = rawKey.toLowerCase().trim();
    const canonical = JIRA_HEADER_ALIASES[lk];

    if (canonical === undefined) {
      // Not in the alias map — pass through as-is so downstream can ignore it.
      out[lk] = rawValue;
    } else if (canonical === '') {
      // Explicitly ignored column — skip.
    } else if (canonical === 'labels' && out['labels'] !== undefined) {
      // Second (or later) Labels column — accumulate for merge.
      if (rawValue.trim()) extraLabelValues.push(rawValue.trim());
    } else {
      out[canonical] = rawValue;
    }

    // Also detect Jira-style duplicate label columns like "Labels_2", "Labels.1"
    if (/^labels[_.\s]?\d+$/i.test(lk) && rawValue.trim()) {
      extraLabelValues.push(rawValue.trim());
    }
  }

  // Merge extra label values into the primary labels cell.
  if (extraLabelValues.length > 0) {
    const existing = out['labels'] ?? '';
    const merged = [existing, ...extraLabelValues].filter(Boolean).join(',');
    out['labels'] = merged;
  }

  // Remap Type value.
  if (out['type']) {
    const mapped = JIRA_TYPE_MAP[out['type'].toLowerCase().trim()];
    if (mapped) {
      out['type'] = mapped;
    }
    // If not mapped, leave the raw value — the generic pipeline will emit a
    // row error with the list of valid values.
  }

  // Remap Priority value.
  if (out['priority']) {
    const mapped = JIRA_PRIORITY_MAP[out['priority'].toLowerCase().trim()];
    if (mapped) {
      out['priority'] = mapped;
    }
    // If not mapped, leave the raw value — generic pipeline emits the error.
  }

  // Assignee: Jira exports a display name or email. Flag non-email assignees
  // as a note so the caller can surface a helpful hint (the generic pipeline
  // will still attempt to match and emit a row error if no match).
  if (out['assignee']) {
    const isEmail = /[\w.+%-]+@[\w.-]+\.[a-zA-Z]{2,}/.test(out['assignee']);
    if (!isEmail) {
      notes.push(
        `Jira assignee "${out['assignee']}" is a display name, not an email — ` +
          `will only match if a workspace member has this exact email address.`,
      );
    }
  }

  return { row: out, notes };
}

// ---------------------------------------------------------------------------
// ── GitHub ────────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------
//
// GitHub Issues CSV export columns (via the GitHub UI or gh CLI):
//   id, title, body, state, author, assignees, labels, milestone, created_at,
//   updated_at, closed_at, url, number, comments, reactions, type (optional)
//
// GitHub also supports JSON exports (GitHub GraphQL / REST API dumps).
// We support both CSV and JSON; the controller layer sniffs the content.
//
// Limitations:
//   - GitHub logins are NOT email addresses.  The importer notes any assignee
//     that isn't an email but still passes it to the generic pipeline so the
//     user gets a clear "assignee not found" error row rather than a silent skip.

/** GitHub Issues CSV header → canonical Next Lane header. */
export const GITHUB_HEADER_ALIASES: Record<string, string> = {
  title: 'title',
  body: 'description',
  labels: 'labels',
  state: 'status',
  assignees: 'assignee',
  assignee: 'assignee',
  // ignored columns:
  id: 'key',
  number: 'key',
  author: 'reporter',
  created_at: 'created',
  updated_at: 'updated',
  closed_at: '', // ignored
  url: '', // ignored
  comments: '', // ignored
  reactions: '', // ignored
  milestone: '', // ignored
  type: '', // GitHub issue type (not mapped to IssueType; ignore)
};

/**
 * GitHub state → status name.
 *
 * "open" → '' (leave blank so generic pipeline defaults to the project's
 *   first TODO-category status).
 * "closed" → 'Done' (a conventional status name — will produce a row error
 *   if the project has no status named "Done"; documented behavior).
 */
export const GITHUB_STATE_STATUS_MAP: Record<string, string> = {
  open: '',
  closed: 'Done',
};

/**
 * Detect whether a string looks like JSON (array or object) vs CSV.
 * We check for a leading `[` or `{` after trimming whitespace.
 */
export function looksLikeJson(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith('[') || t.startsWith('{');
}

/**
 * A single issue as returned by the GitHub REST API (GET /repos/:owner/:repo/issues).
 * We only type the fields we actually read; the rest come in as `unknown`.
 */
export interface GitHubIssueJson {
  title?: string;
  body?: string | null;
  state?: string;
  assignee?: { login?: string; email?: string } | null;
  assignees?: Array<{ login?: string; email?: string }>;
  labels?: Array<{ name?: string } | string>;
  [key: string]: unknown;
}

/**
 * Convert a GitHub JSON issues array to the same Record<string,string> format
 * that the CSV parser produces, so the normaliser and generic pipeline can treat
 * it identically.
 */
export function githubJsonToRows(json: unknown): Record<string, string>[] {
  const arr: unknown[] = Array.isArray(json)
    ? json
    : typeof json === 'object' && json !== null && 'items' in json
      ? (json as { items: unknown[] }).items
      : [];

  return arr.map((item): Record<string, string> => {
    if (typeof item !== 'object' || item === null) return {};
    const i = item as GitHubIssueJson;

    // Labels: array of {name} objects or plain strings.
    const labelNames: string[] = [];
    if (Array.isArray(i.labels)) {
      for (const l of i.labels) {
        if (typeof l === 'string') labelNames.push(l);
        else if (typeof l === 'object' && l !== null && typeof (l as { name?: string }).name === 'string') {
          labelNames.push((l as { name: string }).name);
        }
      }
    }

    // Assignee(s): prefer email if present, fall back to login.
    let assigneeStr = '';
    const allAssignees = i.assignees?.length ? i.assignees : i.assignee ? [i.assignee] : [];
    const firstAssignee = allAssignees[0];
    if (firstAssignee) {
      assigneeStr = firstAssignee.email ?? firstAssignee.login ?? '';
    }

    return {
      title: String(i.title ?? ''),
      body: String(i.body ?? ''),
      state: String(i.state ?? ''),
      assignees: assigneeStr,
      labels: labelNames.join(','),
    };
  });
}

/**
 * Normalise a single row from a GitHub Issues CSV (or pre-converted JSON row).
 */
export function normaliseGithubRow(
  row: Record<string, string>,
): { row: NormalisedRow; notes: string[] } {
  const notes: string[] = [];
  const out: NormalisedRow = {};

  for (const [rawKey, rawValue] of Object.entries(row)) {
    const lk = rawKey.toLowerCase().trim();
    const canonical = GITHUB_HEADER_ALIASES[lk];

    if (canonical === undefined) {
      out[lk] = rawValue;
    } else if (canonical === '') {
      // Ignored column — skip.
    } else {
      out[canonical] = rawValue;
    }
  }

  // Map "state" → status name.
  if (out['status'] !== undefined) {
    const mapped = GITHUB_STATE_STATUS_MAP[out['status'].toLowerCase().trim()];
    if (mapped !== undefined) {
      out['status'] = mapped;
    }
    // If not in the map, leave as-is — the generic pipeline will error if it
    // can't find the status name in the project.
  }

  // Note non-email assignees (GitHub logins).
  if (out['assignee'] && out['assignee'].trim()) {
    const isEmail = /[\w.+%-]+@[\w.-]+\.[a-zA-Z]{2,}/.test(out['assignee']);
    if (!isEmail) {
      notes.push(
        `GitHub assignee "${out['assignee']}" is a login handle, not an email — ` +
          `will only match a workspace member whose email is this exact string.`,
      );
    }
  }

  return { row: out, notes };
}

// ---------------------------------------------------------------------------
// ── Linear ───────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------
//
// Linear CSV export columns (as of 2025):
//   ID, Title, Description, Status, Priority, Assignee, Labels, Estimate,
//   Created At, Updated At, Completed At, Cancelled At, Due Date, Team,
//   Project, Cycle, Parent, Identifier, URL

/** Linear CSV header → canonical Next Lane header. */
export const LINEAR_HEADER_ALIASES: Record<string, string> = {
  title: 'title',
  description: 'description',
  status: 'status',
  priority: 'priority',
  assignee: 'assignee',
  labels: 'labels',
  estimate: 'story points',
  'due date': 'due date',
  // ignored:
  id: 'key',
  identifier: 'key',
  'created at': 'created',
  'updated at': 'updated',
  'completed at': '', // ignored
  'cancelled at': '', // ignored
  team: '', // ignored
  project: '', // ignored
  cycle: '', // ignored (sprint equivalent — not imported to avoid side-effects)
  parent: '', // ignored
  url: '', // ignored
};

/** Linear Priority → Next Lane Priority */
export const LINEAR_PRIORITY_MAP: Record<string, Priority> = {
  urgent: Priority.HIGHEST,
  high: Priority.HIGH,
  medium: Priority.MEDIUM,
  low: Priority.LOW,
  'no priority': Priority.LOWEST,
  none: Priority.LOWEST,
};

/**
 * Normalise a single row from a Linear CSV export.
 */
export function normaliseLinearRow(
  row: Record<string, string>,
): { row: NormalisedRow; notes: string[] } {
  const notes: string[] = [];
  const out: NormalisedRow = {};

  for (const [rawKey, rawValue] of Object.entries(row)) {
    const lk = rawKey.toLowerCase().trim();
    const canonical = LINEAR_HEADER_ALIASES[lk];

    if (canonical === undefined) {
      out[lk] = rawValue;
    } else if (canonical === '') {
      // Ignored column — skip.
    } else {
      out[canonical] = rawValue;
    }
  }

  // Remap Priority value.
  if (out['priority']) {
    const mapped = LINEAR_PRIORITY_MAP[out['priority'].toLowerCase().trim()];
    if (mapped) {
      out['priority'] = mapped;
    }
    // Unknown values are left as-is; the generic pipeline emits the error.
  }

  // Linear Assignee: typically "First Last <email>" or just "First Last" or
  // just an email. Extract the email if present.
  if (out['assignee']) {
    const emailMatch = out['assignee'].match(/[\w.+%-]+@[\w.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) {
      out['assignee'] = emailMatch[0];
    } else if (out['assignee'].trim()) {
      notes.push(
        `Linear assignee "${out['assignee']}" does not contain an email address — ` +
          `will only match if a workspace member's email equals this string.`,
      );
    }
  }

  return { row: out, notes };
}

// ---------------------------------------------------------------------------
// Unified entry point
// ---------------------------------------------------------------------------

export interface NormaliseSourceResult {
  /** The row with canonical keys, ready for the generic import pipeline. */
  row: NormalisedRow;
  /**
   * Non-fatal informational notes about the normalisation (e.g. "assignee is a
   * display name"). These are appended to any row errors reported by the caller.
   */
  notes: string[];
}

/**
 * Normalise a raw CSV row (or JSON-converted row) for the given source.
 * Returns the canonical row plus any informational notes.
 */
export function normaliseRowForSource(
  source: ImportSource,
  row: Record<string, string>,
): NormaliseSourceResult {
  switch (source) {
    case 'jira':
      return normaliseJiraRow(row);
    case 'github':
      return normaliseGithubRow(row);
    case 'linear':
      return normaliseLinearRow(row);
    case 'generic':
    default:
      return { row, notes: [] };
  }
}
