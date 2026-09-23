/**
 * Canonical "read" date format for the issue detail drawer and any other
 * surface that wants a compact, unambiguous absolute date: "Sep 19, 2026".
 *
 * Several drawer components independently called `toLocaleDateString()` /
 * `toLocaleString()` with no options (locale-default numeric, e.g.
 * "9/19/2026, 2:00:16 PM") while the Start/Due date read-only fields already
 * formatted the same kind of value as "Sep 19, 2026" — three different
 * renderings of "a date" on one screen. This is the one formatter every
 * absolute-date label in the drawer should use.
 *
 * Deliberately distinct from `sprintDates.ts`'s `formatShortDate` (which
 * omits the year for the sprint badge's compact "Jun 26" style) — dates in
 * the issue drawer read better with an explicit year.
 */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Full date + time, used as a `title` tooltip alongside the compact `formatDate` text. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}
