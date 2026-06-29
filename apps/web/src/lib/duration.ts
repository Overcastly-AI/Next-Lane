/**
 * Duration helpers for the time-tracking UI.
 *
 * parseDuration  — converts a friendly string like "2h 30m", "90m", "1.5h",
 *                  or a plain integer like "90" to a number of minutes.
 *                  Returns null when the input is empty or unparseable.
 *
 * formatDuration — converts a number of minutes into the canonical "Xh Ym"
 *                  display form (e.g. 90 → "1h 30m", 45 → "45m", 60 → "1h").
 */

/**
 * Parse a human-readable duration string into integer minutes.
 *
 * Supports:
 *   "90"      → 90   (plain integer — treated as minutes)
 *   "90m"     → 90
 *   "1h"      → 60
 *   "1h 30m"  → 90
 *   "1h30m"   → 90
 *   "1.5h"    → 90
 *   "2h 0m"   → 120
 *
 * Returns null for empty / whitespace / unrecognised input.
 * Returns null (not 0) for zero-minute inputs — callers must validate >= 1.
 */
export function parseDuration(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;

  // Plain integer → treat as minutes directly.
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return n > 0 ? n : null;
  }

  let totalMinutes = 0;
  let matched = false;

  // Hours component — integer or decimal (e.g. "1.5h").
  const hoursMatch = s.match(/(\d+(?:\.\d+)?)\s*h/i);
  if (hoursMatch) {
    totalMinutes += Math.round(parseFloat(hoursMatch[1]) * 60);
    matched = true;
  }

  // Minutes component.
  const minutesMatch = s.match(/(\d+)\s*m(?:in)?/i);
  if (minutesMatch) {
    totalMinutes += parseInt(minutesMatch[1], 10);
    matched = true;
  }

  if (!matched) return null;
  return totalMinutes > 0 ? totalMinutes : null;
}

/**
 * Format an integer number of minutes into a compact "Xh Ym" string.
 *
 * Examples:
 *   0   → "0m"
 *   45  → "45m"
 *   60  → "1h"
 *   90  → "1h 30m"
 *   120 → "2h"
 */
export function formatDuration(totalMinutes: number): string {
  const mins = Math.round(totalMinutes);
  if (mins <= 0) return '0m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
