import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/**
 * Fractional-index rank helpers for ordering issues on boards / in sprints.
 *
 * A rank is a short string key. To place an item between two neighbors, compute
 * a key that sorts lexicographically between them — updating ONE row, never
 * renumbering the rest.
 */

/** Rank for an item placed between `before` and `after` (either may be null for ends). */
export function rankBetween(
  before: string | null,
  after: string | null,
): string {
  return generateKeyBetween(before ?? null, after ?? null);
}

/** Generate `n` ranks between two neighbors (e.g. for seeding an ordered list). */
export function ranksBetween(
  before: string | null,
  after: string | null,
  n: number,
): string[] {
  return generateNKeysBetween(before ?? null, after ?? null, n);
}

/** Convenience: the rank for appending to the end of a list whose last rank is `last`. */
export function rankAfter(last: string | null): string {
  return generateKeyBetween(last ?? null, null);
}

/** Convenience: the rank for prepending to the start of a list whose first rank is `first`. */
export function rankBefore(first: string | null): string {
  return generateKeyBetween(null, first ?? null);
}

/** Generate `n` initial ranks for a fresh ordered list. */
export function initialRanks(n: number): string[] {
  return generateNKeysBetween(null, null, n);
}
