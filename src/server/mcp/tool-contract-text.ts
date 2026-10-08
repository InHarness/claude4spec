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

/** `get_page_outline` — the tree, the envelope's `hash`, and what a node does NOT carry. */
export const GET_PAGE_OUTLINE_RETURN =
  'The response is `{ rootId, path, hash, frontmatter?, preamble?, sections[], truncated?, message? }`. ' +
  '`frontmatter` is `{ fields?, size }` — ALL the parsed keys, no projection, with `fields` absent when the ' +
  'YAML does not parse — and `preamble` is `{ size }`, present when the page has text above its first ' +
  'heading. The frontmatter is never cut: over budget it ships whole beside a prefix of the tree, and a ' +
  'frontmatter that alone exceeds the budget comes back with `sections: []` and a `message` pointing at ' +
  'get_page. `sections` is a TREE in ' +
  'DOCUMENT ORDER — the page as it is written — and a node is `{ anchor, heading, level, size }` plus ' +
  '`children` ONLY when it has any: a leaf OMITS the key rather than sending `[]`. `size` is the byte ' +
  "length of that section's OWN body (up to its first child heading), exactly the granularity get_sections " +
  'yields at EITHER setting of `includeSubtree`, so it is the price tag for fetching it. `hash` is on the ENVELOPE, never on a node: it is the sha256 of the ' +
  'WHOLE page file, the same value get_page returns and exactly what update_page / update_sections want as ' +
  '`expectedHash` — so a sectional edit closes with get_page_outline -> get_sections -> update_sections and ' +
  'never fetches the page whole. It is UNCONDITIONAL: this operation either resolves the page (and then the ' +
  'hash is there) or it refuses. A node carries NO `content_hash` (that digest is normalized and would read ' +
  'as something you could write with, which it is not) and NO `heading_path` (the hierarchy IS the position ' +
  'in the tree). The envelope carries no `total`, `hasMore`, `limit` or `offset` — this is not a paginated ' +
  'listing. Over budget, `truncated: true` and the tree comes back as a PREFIX that is complete in itself: ' +
  'every node present has its parent present. There is no smaller retry and `message` does not offer one — ' +
  'go on from the anchors you already have.';

/**
 * `get_sections` — one item PER SECTION, what `includeSubtree` does to the set, and the
 * three valves in the order they bite. Thresholds are interpolated from the core's
 * constants, never restated as literals: a number copied into prose drifts at the
 * first change.
 */
export const GET_SECTIONS_RETURN =
  'The response is `{ results: [...], truncated?, message? }` with ONE ITEM PER SECTION — the requested ' +
  'anchors in the order asked for (duplicates silently collapsed), and with `includeSubtree: true` every ' +
  "section beneath each of them as its OWN item, spliced in directly behind it in document order. An item " +
  'is `{ anchor, rootId, page_path, heading_text, heading_level, body, truncated?, edges? }` or ' +
  '`{ anchor, error, code }` — nothing else, and NO line numbers: the anchor is the full address and the ' +
  'body is in this same response. An expanded item is indistinguishable from a ' +
  'requested one (read its place in the tree from `heading_level` and position), and a parent carries ' +
  'ONLY ITS OWN BODY, ending before its first child heading, at either setting of the flag (update_sections ' +
  '`replace` swaps exactly that own body; `delete` takes the whole subtree). ' +
  'De-duplication ' +
  'is global: an anchor that is both requested and inside another requested anchor\'s subtree appears once, ' +
  'at its own input position — a parent and its child both in `anchors` give exactly one item each, and ' +
  'for `[child, parent]` the parent\'s subtree is not contiguous. Expansion is not a cheap subtree listing ' +
  '(every expanded section is read); for the anchors alone, call get_page_outline. THREE VALVES: ' +
  `\`anchors\` longer than ${MAX_ANCHORS_PER_CALL} (or empty) is INVALID_ARGUMENT stating the limit; after ` +
  `expansion, more than ${MAX_SECTION_ITEMS_PER_RESPONSE} items is CUT to the first ` +
  `${MAX_SECTION_ITEMS_PER_RESPONSE} (every requested anchor keeps its item; the EXPANSION is cut to a ` +
  'prefix in output order; error items count) with `truncated: true` and a ' +
  '`message` naming the ceiling — the rest are ABSENT, so do not retry with fewer anchors (you cannot see ' +
  'what is missing): list the subtree with get_page_outline and read the anchors you need; THEN the ' +
  'response budget degrades what is left: past it, items keep their identity and heading, GAIN `edges` and lose ' +
  '`body`, marked `truncated: true` — never dropped in silence — and `message` says to pick the anchors ' +
  'you need out of those `edges` and retry as a smaller subset. The FIRST item never degrades that way: ' +
  'if its own body alone exceeds the budget it comes back shortened as text with `truncated: true` AND ' +
  '`edges`. `edges` accompanies an item IF AND ONLY IF it carries `truncated: true`, and they are parsed ' +
  "from the section's FULL OWN BODY — no tags from child sections; those come back on the children's " +
  'items — as `edges.sectionRefs: [{ anchor }]`, `edges.entityEmbeds: [{ tagType, type, slug?, slugs?, ' +
  'tags?, filter? }]`, `edges.pageLinks: [{ rootId, path, anchor? }]`, identifiers only, in order of ' +
  'occurrence. There is no `content_hash`.';

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

/** `c4s-reader` → `get_page`, verbatim from the specification (2.1.6). */
export const C4S_READER_GET_PAGE_DESCRIPTION =
  "Get one whole page as a collection of sections. Requires the full page key: both `rootId` and `path`.\n\nA bare path is ambiguous across roots, so a call without `rootId` is refused with the list of roots rather than quietly falling back to a default root. Get the roots from `overview` and the paths from `list_pages`.\n\nThe answer carries the page `hash`, its `frontmatter` and `preamble`, and `results`: a flat list in document order with one item per section — its anchor, heading text, heading level and body. The anchor is a field of the item, so you never parse it out of text, and you can pass it straight to `get_sections`. A body holds neither the anchor line nor the heading line; a parent carries only its own body. An item under a heading that has no anchor yet comes without one.\n\n`frontmatter` gives the literal block (`raw`) and its parsed keys (`fields`); the keys are missing when the YAML does not parse, and `raw` is then the way to repair it.\n\nThe structure is read from the file, not from the index, so this call still answers when `get_page_outline` and `get_sections` refuse because the index is stale. `hash` is the sha256 of the whole file and works as `expectedHash` on a write even when the answer was cut.\n\nThe tool never expands embeds: an embedded entity's data is fetched separately with `get_entities`, using the slug carried in the embed tag. A tag is an edge, and expanding it in place would replace the edge with a copy.\n\nOn a large page, sections that do not fit keep their anchor and heading but come without a body, and the message names them so you can fetch them with `get_sections` — then write with `update_sections`, passing `hash` as `expectedHash`.\n\nThere is no line window: every page root has a section index, so a cut read resumes through `get_page_outline` and `get_sections` alone. The call is refused when `rootId` is missing, when it does not name a page root, or when the page does not exist.";
