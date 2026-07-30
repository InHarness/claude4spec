/**
 * M39 — deterministic ordering for ranked results.
 *
 * Without a tie-break, `offset` lies: two hits with the same score can swap
 * between two calls, so page 2 re-serves a row page 1 already delivered and
 * drops one nobody ever sees. Score descending, then the identity key
 * ascending — the same shape the page-link autocomplete already sorts by
 * (`pages-link-indexer.ts`), lifted here so every ranked operation shares it.
 */

export interface Ranked {
  score: number;
  /** Globally unique within one result set: an anchor, a slug, `rootId:path:line`. */
  key: string;
}

export function compareRanked(a: Ranked, b: Ranked): number {
  return b.score - a.score || a.key.localeCompare(b.key);
}

export function sortRanked<T extends Ranked>(items: T[]): T[] {
  return items.sort(compareRanked);
}

/**
 * Substring relevance over a set of candidate strings, deliberately simple: the
 * core's contract is that ranking is DETERMINISTIC, not that it is clever. A
 * type that wants a better ranking implements `search` as an escape hatch.
 *
 * Higher is better; 0 means no match at all.
 */
export function relevance(query: string, haystacks: readonly string[], weight = 1): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  let best = 0;
  for (const raw of haystacks) {
    const text = raw.toLowerCase();
    const idx = text.indexOf(q);
    if (idx < 0) continue;
    // Exact > prefix > earlier-in-string, so an entity called `user` outranks
    // one that merely mentions `user` in paragraph nine.
    let score = 100 - Math.min(idx, 90);
    if (idx === 0) score += 100;
    if (text === q) score += 200;
    best = Math.max(best, score);
  }
  return best * weight;
}
