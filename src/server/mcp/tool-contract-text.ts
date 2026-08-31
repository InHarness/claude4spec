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

/** `list_sections` — the envelope's `hash`, and the absence of any per-section one. */
export const LIST_SECTIONS_RETURN =
  'The envelope carries `hash`: the sha256 of the WHOLE page file, the same value `get_page` returns and exactly ' +
  'what `update_page` / `update_sections` want as `expectedHash` — so a sectional edit closes with list_sections ' +
  '-> get_sections -> update_sections and never needs to fetch the page whole. It is present for { by: "page" } ' +
  'and for a KNOWN anchor, whenever that page can be read. It is ABSENT when no page is named (`is_known: false`) ' +
  'and when the named page does not exist or cannot be read — an empty listing may therefore carry no hash, so ' +
  'check the field before passing it as `expectedHash`. Rows carry no ' +
  'per-section hash: `content_hash` is normalized and would read as something you could write with, which it is not.';

/** `get_page` — the full response shape, and WHEN the hash is taken. */
export const GET_PAGE_RETURN =
  'The response is `{ rootId, path, content, hash, truncated?, truncationHint? }`, where `hash` is the sha256 of ' +
  'the whole file (frontmatter included) computed BEFORE any `range` narrowing or budget truncation — so a ' +
  'truncated response still carries a valid `expectedHash` for update_page / update_sections.';
