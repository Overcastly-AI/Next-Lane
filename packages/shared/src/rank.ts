import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/**
 * Fractional-index rank helpers for ordering issues on boards / in sprints.
 *
 * A rank is a short string key. To place an item between two neighbors, compute
 * a key that sorts lexicographically between them — updating ONE row, never
 * renumbering the rest.
 *
 * ⚠️  BYTE ORDER, NOT LINGUISTIC ORDER. These keys are drawn from [0-9A-Za-z]
 * and are only correct under ASCII/byte comparison. Prepending to a list walks
 * DOWN from "a0" into the uppercase range ("Zz", "Zy", "Zx", …) precisely
 * because uppercase sorts before lowercase in ASCII — which is FALSE under a
 * linguistic collation like en_US.utf8, where case is only a tertiary weight
 * ('a0' < 'Zy' < 'Zz'). Any column storing one of these keys must therefore be
 * declared `COLLATE "C"`; see the `20260729160000_rank_columns_c_collation`
 * migration. Without it an item dragged to the top of a list silently reappears
 * at the bottom on the next read, with no error anywhere.
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
