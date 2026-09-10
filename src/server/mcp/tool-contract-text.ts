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
  'The response is `{ rootId, path, hash, sections[], truncated?, message? }`. `sections` is a TREE in ' +
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
  'is `{ anchor, rootId, page_path, heading_text, heading_level, line_start, line_end, body, truncated?, ' +
  'edges? }` or `{ anchor, error, code }` — nothing else; an expanded item is indistinguishable from a ' +
  'requested one (read its place in the tree from `heading_level` and position), and a parent carries ' +
  'ONLY ITS OWN BODY, ending before its first child heading, at either setting of the flag. De-duplication ' +
  'is global: an anchor that is both requested and inside another requested anchor\'s subtree appears once, ' +
  'at its own input position — a parent and its child both in `anchors` give exactly one item each, and ' +
  'for `[child, parent]` the parent\'s subtree is not contiguous. Expansion is not a cheap subtree listing ' +
  '(every expanded section is read); for the anchors alone, call get_page_outline. THREE VALVES: ' +
  `\`anchors\` longer than ${MAX_ANCHORS_PER_CALL} (or empty) is INVALID_ARGUMENT stating the limit; after ` +
  `expansion, more than ${MAX_SECTION_ITEMS_PER_RESPONSE} items is CUT to the first ` +
  `${MAX_SECTION_ITEMS_PER_RESPONSE} in output order (error items count) with \`truncated: true\` and a ` +
  '`message` naming the ceiling — the rest are ABSENT, so do not retry with fewer anchors (you cannot see ' +
  'what is missing): list the subtree with get_page_outline and read the anchors you need; THEN the ' +
  'response budget degrades what is left: past it, items keep their coordinates, GAIN `edges` and lose ' +
  '`body`, marked `truncated: true` — never dropped in silence — and `message` says to pick the anchors ' +
  'you need out of those `edges` and retry as a smaller subset. The FIRST item never degrades that way: ' +
  'if its own body alone exceeds the budget it comes back shortened as text with `truncated: true` AND ' +
  '`edges`. `edges` accompanies an item IF AND ONLY IF it carries `truncated: true`, and they are parsed ' +
  "from the section's FULL OWN BODY — no tags from child sections; those come back on the children's " +
  'items — as `edges.sectionRefs: [{ anchor }]`, `edges.entityEmbeds: [{ tagType, type, slug?, slugs?, ' +
  'tags?, filter? }]`, `edges.pageLinks: [{ rootId, path, anchor? }]`, identifiers only, in order of ' +
  'occurrence. There is no `content_hash`.';

/** `get_page` — the full response shape, and WHEN the hash is taken. */
export const GET_PAGE_RETURN =
  'The response is `{ rootId, path, content, hash, truncated?, truncationHint? }`, where `hash` is the sha256 of ' +
  'the whole file (frontmatter included) computed BEFORE any `range` narrowing or budget truncation — so a ' +
  'truncated response still carries a valid `expectedHash` for update_page / update_sections.';
