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

/** `get_page_outline` — the tree, the envelope's `hash`, and what a node does NOT carry. */
export const GET_PAGE_OUTLINE_RETURN =
  'The response is `{ rootId, path, hash, sections[], truncated?, message? }`. `sections` is a TREE in ' +
  'DOCUMENT ORDER — the page as it is written — and a node is `{ anchor, heading, level, size }` plus ' +
  '`children` ONLY when it has any: a leaf OMITS the key rather than sending `[]`. `size` is the byte ' +
  "length of that section's body, the same granularity get_sections yields without `includeSubtree`, so it " +
  'is the price tag for fetching it. `hash` is on the ENVELOPE, never on a node: it is the sha256 of the ' +
  'WHOLE page file, the same value get_page returns and exactly what update_page / update_sections want as ' +
  '`expectedHash` — so a sectional edit closes with get_page_outline -> get_sections -> update_sections and ' +
  'never fetches the page whole. It is UNCONDITIONAL: this operation either resolves the page (and then the ' +
  'hash is there) or it refuses. A node carries NO `content_hash` (that digest is normalized and would read ' +
  'as something you could write with, which it is not) and NO `heading_path` (the hierarchy IS the position ' +
  'in the tree). The envelope carries no `total`, `hasMore`, `limit` or `offset` — this is not a paginated ' +
  'listing. Over budget, `truncated: true` and the tree comes back as a PREFIX that is complete in itself: ' +
  'every node present has its parent present. There is no smaller retry and `message` does not offer one — ' +
  'go on from the anchors you already have.';

/** `get_page` — the full response shape, and WHEN the hash is taken. */
export const GET_PAGE_RETURN =
  'The response is `{ rootId, path, content, hash, truncated?, truncationHint? }`, where `hash` is the sha256 of ' +
  'the whole file (frontmatter included) computed BEFORE any `range` narrowing or budget truncation — so a ' +
  'truncated response still carries a valid `expectedHash` for update_page / update_sections.';
