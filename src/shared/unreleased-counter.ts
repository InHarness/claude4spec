/**
 * 2.1.45 (M17 L2 zbc9jdnr "Licznik niezreleasowanych zmian") — THE unreleased
 * counter: the size of the unreleased delta against the newest release on the
 * release axis, i.e. the number of changed entities plus the number of changed
 * pages in the LIGHT `release_diff` map (`summaryOnly: true`) for the pair
 * newest release → `current`.
 *
 * It is a diff result, never a count of versions: several versions of one
 * element are one change, a change reverted to the released state is zero, and
 * deletions / slug renames count the way the delta counts them. Briefs and
 * patches never enter the delta, so they never enter the counter. The carrier
 * (git working tree vs. SQLite version tables) is the delta's own business —
 * the counter reads the same delta, from the same carrier, as the Compare tab.
 *
 * `total` is counted after the filters and before the page window, so the
 * light map's `total` is the whole delta even though its lists are windowed.
 */
export interface UnreleasedDeltaTotal {
  entities?: number;
  pages?: number;
}

export function unreleasedCountOf(total: UnreleasedDeltaTotal | undefined | null): number {
  return (total?.entities ?? 0) + (total?.pages ?? 0);
}
