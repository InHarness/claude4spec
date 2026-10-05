/**
 * M21 — the release axis: the one order every channel lists briefs in.
 *
 * A brief takes the place of the release cycle it describes, newest cycle on
 * top, the same way `/releases` reads. The position comes from the RANK of a
 * release — its position on the M17 release axis (`spec_release.created_at`,
 * tie by `id`) — and never from its name, which is an opaque, mutable string,
 * nor from `id` alone (after a rebuild from files it is alphabetical by slug),
 * nor from any date of the brief file. The caller supplies `rankByName` (higher = newer); this module
 * stays pure so the rule can be tested without a database.
 *
 * Position key, in order:
 *   1. `to_release` set and known       → the rank of `to_release`.
 *   2. `to_release: null`, `from_release` known → the cycle AFTER `from_release`:
 *      directly above the briefs ending at `from_release`, below every higher rank.
 *   3. anything else → the tail, behind every known rank, by the positioning
 *      end's name descending (numeric segments); a brief with no name closes it.
 * Tie on the axis: `generated_at` descending, then `path` descending (numeric
 * segments).
 */

export interface ReleaseAxisItem {
  path: string;
  fromRelease: string | null;
  toRelease: string | null;
  generatedAt: string;
}

type AxisKey =
  | { zone: 'known'; rank: number; openAfter: boolean }
  | { zone: 'tail'; name: string | null };

const SEGMENTS = /\d+|\D+/g;

/**
 * Splits both strings into alternating digit / non-digit runs and compares run
 * by run: digit runs as numbers, the rest as strings. So `v0.10` > `v0.9` and
 * `0-2-108` > `0-2-71`, which a plain string compare gets backwards.
 */
export function compareNumericSegments(a: string, b: string): number {
  const as = a.match(SEGMENTS) ?? [];
  const bs = b.match(SEGMENTS) ?? [];
  const n = Math.min(as.length, bs.length);
  for (let i = 0; i < n; i++) {
    const x = as[i]!;
    const y = bs[i]!;
    const xDigit = /^\d/.test(x);
    const yDigit = /^\d/.test(y);
    if (xDigit && yDigit) {
      const bx = BigInt(x);
      const by = BigInt(y);
      if (bx !== by) return bx < by ? -1 : 1;
      continue;
    }
    if (x !== y) return x < y ? -1 : 1;
  }
  if (as.length !== bs.length) return as.length < bs.length ? -1 : 1;
  // Equal as numbers but not as text (`07` vs `7`) — still a total order.
  return a === b ? 0 : a < b ? -1 : 1;
}

function axisKey(item: ReleaseAxisItem, rankByName: ReadonlyMap<string, number>): AxisKey {
  if (item.toRelease != null) {
    const r = rankByName.get(item.toRelease);
    return r != null ? { zone: 'known', rank: r, openAfter: false } : { zone: 'tail', name: item.toRelease };
  }
  if (item.fromRelease != null) {
    const r = rankByName.get(item.fromRelease);
    return r != null ? { zone: 'known', rank: r, openAfter: true } : { zone: 'tail', name: item.fromRelease };
  }
  return { zone: 'tail', name: null };
}

function compareKeys(a: AxisKey, b: AxisKey): number {
  if (a.zone !== b.zone) return a.zone === 'known' ? -1 : 1;
  if (a.zone === 'known' && b.zone === 'known') {
    if (a.rank !== b.rank) return b.rank - a.rank;
    if (a.openAfter !== b.openAfter) return a.openAfter ? -1 : 1;
    return 0;
  }
  const an = (a as { name: string | null }).name;
  const bn = (b as { name: string | null }).name;
  if (an === bn) return 0;
  if (an === null) return 1;
  if (bn === null) return -1;
  return compareNumericSegments(bn, an);
}

/** Sort comparator: the release axis, then `generated_at` desc, then `path` desc. */
export function compareBriefsByReleaseAxis(
  a: ReleaseAxisItem,
  b: ReleaseAxisItem,
  rankByName: ReadonlyMap<string, number>,
): number {
  const byAxis = compareKeys(axisKey(a, rankByName), axisKey(b, rankByName));
  if (byAxis !== 0) return byAxis;
  if (a.generatedAt !== b.generatedAt) {
    // ISO timestamps compare as strings; a brief with none goes last.
    if (!a.generatedAt) return 1;
    if (!b.generatedAt) return -1;
    return a.generatedAt < b.generatedAt ? 1 : -1;
  }
  return compareNumericSegments(b.path, a.path);
}
