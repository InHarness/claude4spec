/**
 * Sentences that MUST read identically across the MCP servers exposing the same
 * core operation.
 *
 * `reference-tools` and `c4s-reader` are two adapters over one `DiscoveryCore`, so
 * they cannot disagree about what an operation RETURNS — but their descriptions are
 * hand-written per server, and hand-written prose about a shared contract drifts the
 * moment one copy is edited and the other is not. The parity is structural here
 * rather than asserted somewhere downstream: the return-shape claim exists once and
 * both servers paste the same string.
 *
 * The surrounding prose stays per-server on purpose — each audience gets its own
 * framing. Only the CONTRACT is shared.
 */

import { MAX_ANCHORS_PER_CALL, MAX_SECTION_ITEMS_PER_RESPONSE } from '../discovery/budget.js';

/**
 * `get_page_outline` — the tree, the envelope's `hash`, and what a node does NOT carry.
 *
 * 2.1.26 — re-rendered from the two `mcp-tool` records (`reference-tools-get-page-outline`,
 * `c4s-reader-get-page-outline`): both end in this same contract, verbatim.
 */
export const GET_PAGE_OUTLINE_RETURN =
  'The response is `{ rootId, path, hash, frontmatter?, preamble?, sections[], truncated?, message? }`. `frontmatter` is `{ fields?, size }` — ALL the parsed keys, with `fields` absent when the YAML does not parse — and `preamble` is `{ size }`, present when the page has text above its first heading. The frontmatter is never cut: over budget it ships whole beside a prefix of the tree, and a frontmatter that alone exceeds the budget comes back with `sections: []` and a `message` pointing at get_page. A node is `{ anchor, heading, level, size }` plus `children` ONLY when it has any. `size` is the byte length of that section\'s OWN body, exactly what get_sections yields at EITHER setting of `includeSubtree`. `hash` is on the ENVELOPE: the sha256 of the WHOLE page file, exactly what update_page / update_sections want as `expectedHash` — so a sectional edit closes with get_page_outline -> get_sections -> update_sections. A node carries NO `content_hash` and NO `heading_path`; the envelope carries no `total`, `hasMore`, `limit` or `offset`. Over budget, `truncated: true` and the tree comes back as a PREFIX in which every node has its parent. There is no smaller retry — go on from the anchors you already have.';

/** `reference-tools` → `get_page_outline`, the part before the shared contract (2.1.26). */
export const REFERENCE_TOOLS_GET_PAGE_OUTLINE_LEAD =
  'One page\'s headings as a TREE in document order — the cheap step between locating a page and paying for any of its text. Takes the page key and NOTHING else: no anchor variant, no fuzzy heading search, no limit/offset, no depth cap. Every node carries the section\'s anchor, so you can pick exactly the anchors worth fetching with get_sections. It emits no content — bodies come from get_sections. It refuses as a WHOLE: an unknown path on a known page root is PAGE_NOT_FOUND, and an unknown root — or one that is not a page root — is INVALID_ARGUMENT listing the page roots. ';

/** `c4s-reader` → `get_page_outline`, the part before the shared contract (2.1.26). */
export const C4S_READER_GET_PAGE_OUTLINE_LEAD =
  'One page\'s headings as a TREE in document order — the cheap step between locating a page and paying for any of its text. Takes the page key and NOTHING else: no anchor variant, no fuzzy heading search (to find a section by text, call search_pages, whose hit ALREADY carries the anchor), no limit/offset, no depth cap. It emits no content. It refuses as a WHOLE: an unknown path on a known page root is PAGE_NOT_FOUND, and an unknown root — or one that is not a page root — is INVALID_ARGUMENT listing the page roots. ';

/**
 * `get_sections` — 2.1.26: the WHOLE description is shared. Both `mcp-tool` records
 * (`reference-tools-get-sections`, `c4s-reader-get-sections`) carry the same text, so it
 * exists once and both servers paste it. Thresholds are interpolated from the core's
 * constants, never restated as literals: a number copied into prose drifts at the first
 * change.
 */
export const GET_SECTIONS_DESCRIPTION =
  `Read sections BY ANCHOR — pass every anchor you need in ONE call. Each section comes back as its own item: identity, heading and body as authored — XML tags left untouched (to follow an embed, call get_entities with the slug it carries). An unknown anchor comes back as \`{ anchor, error, code: "SECTION_NOT_FOUND" }\` in its own slot rather than failing the batch. The response is \`{ results: [...], truncated?, message? }\` with ONE ITEM PER SECTION — the requested anchors in input order (duplicates silently collapsed), and with \`includeSubtree: true\` every section beneath each as its OWN item, directly behind it in document order. An item is \`{ anchor, rootId, page_path, heading_text, heading_level, body, truncated?, edges? }\` or \`{ anchor, error, code }\` — NO line numbers and no \`content_hash\`. A parent carries ONLY ITS OWN BODY, ending before its first child heading, at either setting of the flag. De-duplication is global: an anchor also inside another's subtree appears once, at its own input position. THREE VALVES: \`anchors\` longer than ${MAX_ANCHORS_PER_CALL} (or empty) is INVALID_ARGUMENT; after expansion, more than ${MAX_SECTION_ITEMS_PER_RESPONSE} items is CUT to the first ${MAX_SECTION_ITEMS_PER_RESPONSE} (requested anchors keep their items; error items count) with \`truncated: true\` and a \`message\` — the rest are ABSENT: do not retry with fewer anchors, list the subtree with get_page_outline; THEN past the response budget items keep identity and heading, GAIN \`edges\` and lose \`body\`, marked \`truncated: true\` — retry as a smaller subset. The FIRST item never degrades that way: an over-budget body comes back shortened as text with \`truncated: true\` AND \`edges\`. \`edges\` accompanies an item IF AND ONLY IF it carries \`truncated: true\`, parsed from its FULL OWN BODY: \`sectionRefs: [{ anchor }]\`, \`entityEmbeds: [{ tagType, type, slug?, slugs?, tags?, filter? }]\`, \`pageLinks: [{ rootId, path, anchor? }]\`. A duplicate anchor resolves to the lowest (rootId, page_path), then the first occurrence; \`check_consistency\` rule 13 reports it.`;

/**
 * `get_page` — 2.1.6: the WHOLE description is the contract, so it lives here once
 * per server rather than as a shared tail. The envelope sentence is shared by
 * construction: `reference-tools` states it in full and `c4s-reader` appends
 * `GET_PAGE_RETURN`.
 */
export const GET_PAGE_RETURN =
  'The response is `{ rootId, path, hash, frontmatter?, preamble?, results[], truncated?, message? }`; an item of ' +
  '`results` is `{ anchor?, heading_text, heading_level, body, truncated? }`.';

/** `reference-tools` → `get_page`, verbatim from the specification (2.1.6). */
export const REFERENCE_TOOLS_GET_PAGE_DESCRIPTION =
  "Read one WHOLE page as a collection of sections, addressed by the FULL key of `rootId` plus `path`. A bare path is ambiguous across roots, so a call without `rootId` is refused with the list of page roots rather than guessing the built-in one.\n\nThe answer is an envelope `{ rootId, path, hash, frontmatter?, preamble?, results[], truncated?, message? }`. `results` is a FLAT list in document order, one item per section: `anchor`, `heading_text`, `heading_level`, `body`. The anchor is a field of the item, never a comment to parse out of text. `body` excludes the anchor line and the heading line and is otherwise a literal slice of the file, so `textEdits` match it as written; a parent carries only its own body, up to its first child heading. Under a heading the indexer has not tagged yet the item has no `anchor` — readable, not addressable by `get_sections`.\n\n`frontmatter` is `{ raw, fields? }`: `raw` is the literal block, `fields` the parsed keys, absent when the YAML does not parse. `preamble` is the text before the first heading. Embeds are never expanded — a tag is an edge; fetch the entity by its slug.\n\nThe structure is computed from the file, not from the index, so this call answers even while `get_page_outline` and `get_sections` refuse with `INDEX_STALE`. `hash` is the sha256 of the WHOLE file and arms `expectedHash` on a write even when the answer was cut.\n\nOver the budget, an item that does not fit keeps its anchor and heading, loses `body` and carries `truncated: true`; the first item is never dropped — its body is cut as text. `message` names the cut anchors: fetch them with `get_sections`, and write with `update_sections` using `hash` as `expectedHash`. There is no line window: a cut read resumes only through `get_page_outline` and `get_sections`. The call is refused when `rootId` is missing, when it does not name a page root (a system root such as `plans` is refused like an unknown one), or when the page does not exist.";

/** `c4s-reader` → `get_page`, verbatim from the record `c4s-reader-get-page` (2.1.26) — `GET_PAGE_RETURN` follows it. */
export const C4S_READER_GET_PAGE_DESCRIPTION =
  "Get one whole page as a collection of sections. Requires the full page key: both `rootId` and `path`.\n\nA call without `rootId` is refused with the list of roots rather than quietly falling back to a default root. Get the roots from `overview` and the paths from `list_pages`.\n\nThe answer carries the page `hash`, its `frontmatter` and `preamble`, and `results`: a flat list in document order with one item per section — its anchor, heading text, heading level and body. The anchor is a field of the item, so you can pass it straight to `get_sections`. A body holds neither the anchor line nor the heading line; a parent carries only its own body. An item under a heading that has no anchor yet comes without one.\n\n`frontmatter` gives the literal block (`raw`) and its parsed keys (`fields`); the keys are missing when the YAML does not parse, and `raw` is then the way to repair it.\n\nThe structure is read from the file, not from the index, so this call still answers when `get_page_outline` and `get_sections` refuse because the index is stale. `hash` is the sha256 of the whole file and works as `expectedHash` on a write even when the answer was cut.\n\nThe tool never expands embeds: an embedded entity's data is fetched separately with `get_entities`, using the slug carried in the embed tag.\n\nOn a large page, sections that do not fit keep their anchor and heading but come without a body, and the message names them so you can fetch them with `get_sections` — then write with `update_sections`, passing `hash` as `expectedHash`.\n\nThere is no line window: a cut read resumes through `get_page_outline` and `get_sections` alone. The call is refused when `rootId` is missing, when it does not name a page root, or when the page does not exist.";

/**
 * `search_pages` — the whole description, verbatim on both servers.
 *
 * 2.1.26 — re-rendered from the two `mcp-tool` records (`reference-tools-search-pages`,
 * `c4s-reader-search-pages`), which carry one identical text.
 */
export const SEARCH_PAGES_DESCRIPTION =
  'Search the prose of the pages, by phrase (`query`) or by regex (`regex`) — the replacement for grepping the specification, and the one search the entity graph cannot stand in for (a bare HTTP path, a DTO name mentioned in running text). THREE MODES, a ladder of cost: "count" returns only the totals; "map" (DEFAULT) returns identity rows `{ rootId, path, anchor, heading, headingPath, matchCount }` with no prose; "hits" adds `hunks[]` + `omittedChars`. There is no "pages" mode — to read a section, take the `anchor` from a map row and call get_sections. A HIT IS A SECTION, a MATCH is a line: several matches in one section collapse into ONE hit carrying `matchCount`. A hit carries an `anchor` IF AND ONLY IF `kind` is "section"; a `kind: "page"` hit falls outside every section (the frontmatter, text above the first heading, or under a heading without an anchor yet), has no anchor and no line number, and is read with get_page. Branch on `kind`. Results enumerate in `(rootId, path, line_start)` order with a declared tie-break, so paging with `limit`/`offset` returns every hit exactly once. There is no `score` and no line number. THREE COST VALVES, coarse to sharp: `rootId`, then `pathInclude`/`pathExclude` (regexes over the page path, applied BEFORE the file is opened), then `anchors` (scan only these sections). A `regex` that could only match across a line boundary (`\\n`, `[\\s\\S]`, an inline flag group) is refused with INVALID_ARGUMENT rather than answered with zero hits; within-line idioms are fine, `[^\\n]` included. An over-long `regex` is refused with INVALID_ARGUMENT naming the ceiling, and a run that exhausts the core time budget answers SEARCH_BUDGET_EXCEEDED, whose message names the valves (`rootId`, `pathInclude`).';
