/**
 * CSV utility helpers for RFC-4180–compliant output.
 *
 * RFC-4180 rules implemented here:
 *  - Fields containing a comma, double-quote, or newline (CR or LF) MUST be
 *    enclosed in double-quotes.
 *  - Any double-quote inside an enclosed field MUST be doubled ("" → ").
 *  - Formula injection guard: a leading `=`, `+`, `-`, or `@` is prefixed with
 *    a single-quote `'` so spreadsheet apps (Excel, LibreOffice, Google Sheets)
 *    treat the cell as a text literal instead of a formula.
 */

/** Characters that require RFC-4180 quoting. */
const NEEDS_QUOTE_RE = /[,"\r\n]/;

/** Leading characters recognised as formula starters by common spreadsheets. */
const FORMULA_START_RE = /^[=+\-@]/;

/**
 * Encode a single CSV cell value.
 *
 * - `null` / `undefined` → empty string.
 * - Numbers and booleans are coerced to their string representation.
 * - Formula injection: values starting with `=`, `+`, `-`, or `@` are
 *   prefixed with `'` (apostrophe) to prevent spreadsheet formula execution.
 * - Quoting: fields that contain a comma, double-quote, or newline are
 *   wrapped in double-quotes; internal double-quotes are doubled.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  let s = String(value);

  // Formula-injection guard: prefix leading formula starters with an
  // apostrophe so the spreadsheet displays the raw text.
  if (FORMULA_START_RE.test(s)) {
    s = `'${s}`;
  }

  // RFC-4180 quoting.
  if (NEEDS_QUOTE_RE.test(s) || s.includes('"')) {
    s = `"${s.replace(/"/g, '""')}"`;
  }

  return s;
}

/**
 * Build a single CSV row from an array of cell values, joining with commas
 * and terminating with CRLF per RFC-4180.
 */
export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',') + '\r\n';
}
