/**
 * M39 — `search_pages`, the replacement for grepping the specification.
 *
 * This is the one intention the entity graph CANNOT serve: by definition it
 * looks for what fell out of the graph — a bare HTTP path written in prose, a
 * DTO named in a sentence and never tagged. So `regex` is first-class, not a
 * bolt-on.
 *
 * There is no full-text index in this project (no FTS table exists in any
 * migration), so this is an honest disk scan across the roots. That cost is the
 * reason the mode ladder exists and the reason the default limit is not infinite.
 *
 * 0.2.40 — reworked, with breaking contract changes:
 *
 *   - The modes are a LADDER of cost: `count` then `map` then `hits`. There is
 *     no fourth rung and there is no `pages` mode; a caller that wants "give me
 *     the section" goes to `get_sections` with the anchor this hands back. The
 *     default moved from `hits` to `map`, so the cheap identity answer is what
 *     you get for not choosing.
 *   - The unit of a HIT is a SECTION; the unit of a MATCH is still a line. Two
 *     matches in one section collapse into one hit carrying `matchCount`, and no
 *     two hits ever share an `anchor`. Per-line hits made a page-wide term
 *     return the same section thirty times and pushed everything else past the
 *     window.
 *   - Enumeration ORDER is part of the contract: `(rootId, path, line_start)`
 *     ascending, tie-broken by anchor. A declared order is what makes a full
 *     `limit`/`offset` traversal return each hit exactly once; "some
 *     deterministic tie-break" did not, because `score` collided constantly and
 *     the resolution was never stated.
 *   - Three cost valves narrow the scan before it happens, at three
 *     granularities: `rootId` (coarse), then `pathInclude`/`pathExclude` (which
 *     rejects a page before its bytes are read), then `anchors` (sharpest, a
 *     named set of sections).
 *
 * Hit IDENTITY degrades with the root, it is not gated by it: a section-indexed
 * root answers with an `anchor`, a root without an index collapses per PAGE and
 * answers without one. Both are addressable; one is just coarser.
 */

import type { Database } from 'better-sqlite3';
import { invalidArgument } from '../errors.js';
import type { PageSource } from '../page-source.js';
import { DEFAULT_LIMITS, resolvePageRequest } from '../pagination.js';
import { fitToBudget } from '../budget.js';
import type { RootSet } from '../roots.js';
import type { SearchPageHit, SearchPagesInput, SearchPagesResult } from '../types.js';

/**
 * The character ceiling on ONE hunk, and therefore on one contiguous run of
 * context. Applied per block rather than per hit so a hit with three separate
 * matches shows all three, instead of spending its whole allowance on the first.
 */
const MAX_HUNK_CHARS = 600;

export async function searchPages(
  db: Database,
  pages: PageSource,
  roots: RootSet,
  input: SearchPagesInput,
): Promise<SearchPagesResult> {
  const matcher = buildMatcher(input);
  const pathFilter = buildPathFilter(input);
  const targets = input.rootId ? [roots.require(input.rootId, 'search_pages')] : [...roots.all];
  /**
   * 0.2.40 — `map`, not `hits`.
   *
   * The rung a caller lands on by NOT choosing should be the one that answers
   * "where is this" without paying to carry the prose. Defaulting to `hits`
   * meant every incidental search shipped full bodies into a context that
   * usually wanted a list of anchors to feed `get_sections`.
   */
  const mode = input.mode ?? 'map';
  const context = resolveContext(input.context);
  const anchorFilter = input.anchors && input.anchors.length > 0 ? new Set(input.anchors) : null;

  let matches = 0;
  /** One accumulator per (root, path, anchor-or-none): a hit is a SECTION, not a line. */
  const bySection = new Map<string, HitAccumulator>();

  for (const root of targets) {
    /*
     * The anchor index is the largest allocation on this path — every section
     * row of the root, materialized up front. Unlike before 0.2.40 it is loaded
     * even for `count`: the unit being counted is now a section, so a count that
     * skipped the index would be counting something the other two rungs do not
     * report. A ladder whose bottom rung answers a different question from the
     * two above it is not a ladder. The file scan dominates the cost regardless;
     * this is one indexed SELECT per root.
     */
    const anchors = root.sectionIndexed ? anchorIndex(db, root.id) : null;
    if (anchorFilter && !anchors) continue; // an unindexed root has no sections to name

    for (const rel of await safeList(pages, root.id)) {
      // Valve 2: reject the page BEFORE opening it. The point of a path filter
      // is to not pay for the read, so it cannot live after `readBody`.
      if (!pathFilter(rel)) continue;

      const pageAnchors = anchors?.filter((a) => a.path === rel) ?? null;
      if (anchorFilter && !pageAnchors?.some((a) => anchorFilter.has(a.anchor))) continue;

      let content: string;
      try {
        // Frontmatter-stripped: a match's line has to be comparable with the
        // section index's line ranges, or the anchor attached to it is wrong.
        content = await pages.readBody(root.id, rel);
      } catch {
        continue;
      }
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const text = lines[i] ?? '';
        if (!matcher(text)) continue;
        const line = i + 1;
        const section = pageAnchors ? innermost(pageAnchors, line) : undefined;
        // Valve 3: the sharpest one — only the named sections count at all.
        if (anchorFilter && !(section && anchorFilter.has(section.anchor))) continue;
        matches++;

        const key = section ? `${root.id} ${rel} ${section.anchor}` : `${root.id} ${rel}`;
        let acc = bySection.get(key);
        if (!acc) {
          acc = {
            kind: section ? 'section' : 'page',
            rootId: root.id,
            path: rel,
            anchor: section?.anchor,
            heading: section?.headingText,
            headingPath: section?.headingPath ? section.headingPath.split('/') : undefined,
            // The SORT key: a section sorts by where the section starts, a page
            // by its first match. Both are stable across calls, which is what
            // `offset` stands on.
            sortLine: section ? section.start : line,
            matchCount: 0,
            matchLines: [],
          };
          bySection.set(key, acc);
        }
        acc.matchCount++;
        if (mode === 'hits') acc.matchLines.push(line);
      }
    }
  }

  const ordered = [...bySection.values()].sort(compareHits);

  if (mode === 'count') {
    /**
     * Both sums, because they answer different questions and the difference is
     * exactly what changed in 0.2.40: `total` is how many HITS a full traversal
     * would enumerate (so it agrees with `map`/`hits` pagination), `matches` is
     * how many lines matched.
     */
    return { mode: 'count', total: ordered.length, matches };
  }

  /*
   * Slice BEFORE rendering, which is why this does not call `paginate`.
   *
   * `paginate` takes an already-rendered array, and rendering is the expensive
   * half here: a query matching five hundred sections would cut five hundred
   * hits' worth of hunks out of the page bodies and then throw all but twenty
   * away. The window is the only part anyone reads, so it is the only part
   * built. The budget rule is unchanged — `fitToBudget` is the same width cut
   * `paginate` applies, over the same window it would have produced.
   */
  const { limit, offset } = resolvePageRequest(input, DEFAULT_LIMITS.searchPages);
  const window = ordered.slice(offset, offset + limit);
  const rows: SearchPageHit[] = [];
  const readBodyLines = makeBodyReader(pages);
  for (const acc of window) {
    const row: SearchPageHit = {
      kind: acc.kind,
      rootId: acc.rootId,
      path: acc.path,
      ...(acc.anchor !== undefined ? { anchor: acc.anchor } : {}),
      ...(acc.heading !== undefined ? { heading: acc.heading } : {}),
      ...(acc.headingPath !== undefined ? { headingPath: acc.headingPath } : {}),
      matchCount: acc.matchCount,
    };
    if (mode !== 'hits') {
      rows.push(row);
      continue;
    }
    /*
     * The body is re-read rather than retained.
     *
     * An accumulator holding its page's `lines` would keep the full text of
     * every page that matched alive for the whole scan — a search for a common
     * word across every root would hold the entire corpus in memory at once,
     * where the operation used to hold a couple of hundred characters per hit.
     * Only the window is ever rendered, so only the window's pages are needed,
     * and adjacent sections of one page share the read below.
     */
    const body = await readBodyLines(acc.rootId, acc.path);
    const { hunks, omittedChars } = buildHunks(acc, context, body);
    rows.push({ ...row, hunks, omittedChars });
  }
  const items = fitToBudget(rows);
  const page = {
    items,
    total: ordered.length,
    hasMore: offset + items.length < ordered.length,
    truncated: items.length < rows.length,
  };
  return mode === 'hits' ? { ...page, mode: 'hits' } : { ...page, mode: 'map' };
}

interface HitAccumulator {
  kind: 'section' | 'page';
  rootId: string;
  path: string;
  anchor?: string;
  heading?: string;
  headingPath?: string[];
  sortLine: number;
  matchCount: number;
  /** 1-based line numbers of the matches, ascending. Only filled in `hits` mode. */
  matchLines: number[];
}

/**
 * THE enumeration order, and it is a contract rather than an implementation
 * detail: `(rootId, path, line_start)` ascending, then `anchor`.
 *
 * `offset` is only meaningful over a total order. The previous sort was by a
 * positional `score` that collided for every hit on the same line number of
 * different pages, and the documented tie-break was "deterministic" without
 * saying deterministic BY WHAT — so two calls could legitimately disagree, and a
 * paging caller would skip or repeat rows through no fault of its own.
 */
function compareHits(a: HitAccumulator, b: HitAccumulator): number {
  return (
    a.rootId.localeCompare(b.rootId) ||
    a.path.localeCompare(b.path) ||
    a.sortLine - b.sortLine ||
    (a.anchor ?? '').localeCompare(b.anchor ?? '')
  );
}

/**
 * Context windows around each match, MERGED where they overlap or touch.
 *
 * No line is ever emitted twice: two matches three lines apart with
 * `context: 2` are one block, not two blocks sharing four lines. Emitting them
 * twice would spend the ceiling on a copy and make `omittedChars` a lie about
 * how much of the section the caller has actually seen.
 */
function buildHunks(
  acc: HitAccumulator,
  context: number,
  lines: readonly string[],
): { hunks: string[]; omittedChars: number } {
  const spans: Array<{ start: number; end: number }> = [];
  for (const line of acc.matchLines) {
    const start = Math.max(line - context, 1);
    const end = Math.min(line + context, lines.length);
    const last = spans[spans.length - 1];
    // `<= last.end + 1` merges ADJACENT spans too, not only overlapping ones —
    // a one-line gap between two blocks is noise, not structure.
    if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
    else spans.push({ start, end });
  }

  let omittedChars = 0;
  const hunks = spans.map((span) => {
    const text = lines.slice(span.start - 1, span.end).join('\n');
    if (text.length <= MAX_HUNK_CHARS) return text;
    omittedChars += text.length - MAX_HUNK_CHARS;
    return text.slice(0, MAX_HUNK_CHARS);
  });
  return { hunks, omittedChars };
}

/**
 * One-entry cache, which is all the ordering needs: hits are enumerated by
 * `(rootId, path, …)`, so every section of a page arrives consecutively and a
 * page is read exactly once per window.
 */
function makeBodyReader(pages: PageSource): (rootId: string, path: string) => Promise<string[]> {
  let last: { key: string; lines: string[] } | null = null;
  return async (rootId, path) => {
    const key = `${rootId} ${path}`;
    if (last?.key === key) return last.lines;
    let lines: string[] = [];
    try {
      lines = (await pages.readBody(rootId, path)).split('\n');
    } catch {
      // The page was readable moments ago during the scan; if it is not now,
      // the hit's identity still stands — it just comes back without hunks.
    }
    last = { key, lines };
    return lines;
  };
}

function resolveContext(raw: number | undefined): number {
  if (raw === undefined) return 0;
  if (!Number.isInteger(raw) || raw < 0) {
    throw invalidArgument(
      `context must be a non-negative integer (got ${String(raw)})`,
      'omit context for the matching lines alone, or pass e.g. context: 2',
    );
  }
  return raw;
}

/**
 * Valve 2 — `pathInclude` / `pathExclude`, evaluated against the page path
 * before the page is opened.
 */
function buildPathFilter(input: SearchPagesInput): (rel: string) => boolean {
  const compile = (pattern: string | undefined, name: string): RegExp | null => {
    if (pattern === undefined) return null;
    try {
      return new RegExp(pattern);
    } catch (err) {
      throw invalidArgument(
        `invalid ${name}: ${(err as Error).message}`,
        `${name} is a JavaScript regular expression body without delimiters, e.g. "^modules/"`,
      );
    }
  };
  const include = compile(input.pathInclude, 'pathInclude');
  const exclude = compile(input.pathExclude, 'pathExclude');
  if (!include && !exclude) return () => true;
  return (rel) => (!include || include.test(rel)) && (!exclude || !exclude.test(rel));
}

function buildMatcher(input: SearchPagesInput): (line: string) => boolean {
  if (input.regex && input.query) {
    throw invalidArgument(
      'search_pages takes either query or regex, not both',
      'search_pages({ query: "text" }) for a phrase, search_pages({ regex: "^GET /v1/" }) for a pattern',
    );
  }
  if (input.regex) {
    assertMatchableWithinOneLine(input.regex);
    let re: RegExp;
    try {
      re = new RegExp(input.regex, 'i');
    } catch (err) {
      throw invalidArgument(
        `invalid regex: ${(err as Error).message}`,
        'pass a JavaScript regular expression body without delimiters, e.g. "^## M\\\\d+"',
      );
    }
    return (line) => re.test(line);
  }
  const query = input.query?.trim();
  if (!query) {
    throw invalidArgument(
      'search_pages requires query or regex',
      'search_pages({ query: "checkout" }) or search_pages({ regex: "POST /orders" })',
    );
  }
  const lower = query.toLowerCase();
  return (line) => line.toLowerCase().includes(lower);
}

/** Constructs that can only ever match ACROSS a line boundary — see below. */
const LINE_CROSSING: ReadonlyArray<{ probe: RegExp; what: string }> = [
  { probe: /\\n/, what: 'a newline escape' },
  { probe: /\[\\s\\S\]|\[\\S\\s\]/, what: 'the [\\s\\S] any-character idiom' },
  // Matches `(?i)`, `(?s:...)`, `(?-m:...)`; deliberately NOT `(?:`, `(?=`,
  // `(?!`, `(?<name>`, none of which reach the flag letter before the `)`/`:`.
  { probe: /\(\?[a-zA-Z-]*[imsxu][a-zA-Z-]*[):]/, what: 'an inline flag group' },
];

/**
 * Refuse a pattern that cannot match anything, rather than returning nothing.
 *
 * This operation matches LINE BY LINE, so a pattern spanning a line boundary is
 * not a narrow search — it is a search that cannot succeed. Answering it with
 * zero hits is a false negative dressed as a fact: the caller concludes the term
 * does not appear in the specification, which is the most expensive wrong answer
 * this operation can give, because nothing downstream will contradict it. A
 * silent false negative is worse than an error, so it is made one.
 */
function assertMatchableWithinOneLine(pattern: string): void {
  if (pattern.includes('\n')) {
    throw invalidArgument(
      'regex contains a literal newline, which cannot match: search_pages matches one LINE at a time',
      'search for the first line alone, then follow the anchor with get_sections to read across it',
    );
  }
  const probeSource = neutralise(pattern);
  for (const { probe, what } of LINE_CROSSING) {
    if (!probe.test(probeSource)) continue;
    throw invalidArgument(
      `regex contains ${what}, which cannot match: search_pages matches one LINE at a time, so a pattern spanning a line boundary silently finds nothing`,
      'search for one line alone, then follow the anchor with get_sections to read across the boundary',
    );
  }
}

/**
 * Strip the two constructs that make a `\n` in the source harmless, so the
 * probes above only fire on a pattern that really reaches for a line boundary.
 *
 * A NEGATED class is the reason this exists: `[^\n]` is the standard idiom for
 * "anything WITHIN this line", so refusing `^[^\n]*TODO` rejects the most
 * line-oriented pattern there is — a guard against false negatives producing a
 * false refusal instead. An ESCAPED BACKSLASH is the other: in `\\n` the `n` is
 * a literal letter, and the pattern is searching prose for a backslash-n
 * sequence, which appears on one line like any other text.
 */
function neutralise(pattern: string): string {
  return pattern.replace(/\\\\/g, '').replace(/\[\^(?:\\.|[^\]\\])*\]/g, '');
}

async function safeList(pages: PageSource, rootId: string): Promise<string[]> {
  try {
    return await pages.list(rootId);
  } catch {
    return [];
  }
}

interface AnchorRow {
  path: string;
  anchor: string;
  start: number;
  end: number;
  headingText: string;
  headingPath: string;
}

/**
 * The heading columns come along for the ride: `heading_text` and `heading_path`
 * are already stored on every row (the indexer maintains the breadcrumb as it
 * walks), so a map row can carry them without a second query and without
 * re-parsing any markdown.
 */
function anchorIndex(db: Database, rootId: string): AnchorRow[] {
  return db
    .prepare(
      `SELECT page_path AS path, anchor, line_start AS start, line_end AS end,
              heading_text AS headingText, heading_path AS headingPath
         FROM section_index WHERE rootId = ? ORDER BY page_path, line_start`,
    )
    .all(rootId) as AnchorRow[];
}

/** The innermost section containing `line` — the deepest range wins, so a match
 *  inside a sub-section reports the sub-section rather than its parent. */
function innermost(rows: readonly AnchorRow[], line: number): AnchorRow | undefined {
  let best: AnchorRow | undefined;
  for (const row of rows) {
    if (line < row.start || line > row.end) continue;
    if (!best || row.end - row.start < best.end - best.start) best = row;
  }
  return best;
}
