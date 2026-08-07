/**
 * Query-string readers shared by the `rest` renderings of catalog operations.
 *
 * 0.2.13 (tier C) added seven of those renderings across four routers, and each
 * one has to turn the same three wire spellings — a positive integer, an offset,
 * a comma-separated list — into the core's input. Written per-router they drift:
 * `positiveInt` already existed twice, in `meta.ts` and `entities-router.ts`,
 * with the same body. A catalog operation must not answer differently depending
 * on which router parsed its query.
 *
 * The shared rule in all three: **an unreadable value is `undefined`, never a
 * substituted one.** `?limit=abc` lets the core's own default stand rather than
 * silently becoming a number the caller never asked for — the core owns the
 * defaults, and a transport that invented one would be the start of the next
 * drift.
 */

/** `?limit=12` → 12; absent, empty, non-numeric or non-positive → undefined. */
export function positiveInt(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * `?offset=0` → 0; absent, empty, non-numeric or negative → undefined.
 *
 * Separate from {@link positiveInt} because `0` is a legitimate offset and a
 * meaningless limit. Reading an offset with the limit's parser turns `?offset=0`
 * into `undefined`, which happens to mean the same thing today only because the
 * core's default offset is 0 — a coincidence, not a contract.
 */
export function nonNegativeInt(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/**
 * `?tags=a,b` → `['a','b']`; absent or empty → undefined.
 *
 * Empty segments are dropped (`a,,b` → `['a','b']`) and each is trimmed, so a
 * trailing comma from a shell loop does not become a request for an entity
 * called "". A parameter present but empty after that (`?tags=`, `?tags=,,`)
 * reads as ABSENT rather than as an empty list: "filter by no tags" and "do not
 * filter" are the same query, and the core's own default is the second.
 */
export function commaList(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string') return undefined;
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  return parts.length > 0 ? parts : undefined;
}

/** `?flag`, `?flag=true`, `?flag=1` → true; anything else → false. */
export function boolFlag(raw: unknown): boolean {
  return raw === '' || raw === 'true' || raw === '1';
}
