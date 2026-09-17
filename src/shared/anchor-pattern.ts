/**
 * Canonical anchor comment pattern per M06 spec (anchors `kkz1e7d6`, `15u7sazr`).
 *
 * Length contract: parsing/validation uses {6,12} — covers:
 *  - auto-generated 8-char nanoids (section indexer + plan generator)
 *  - manual semantic anchors (e.g. `m21chatcols`, `anchorscr`, `hdgcopy01`)
 *
 * Generation contract is separate: `customAlphabet(...).8` in
 * `section-indexer.ts` and `plan.ts` stays strict 8 — only parsing/validation
 * uses {6,12}.
 *
 * Single source of truth — re-used by all section-aware consumers per spec
 * `kkz1e7d6` ("pojedynczy regex per kodbase").
 */
export const ANCHOR_ID_SOURCE = '[a-z0-9]{6,12}';

export const ANCHOR_PATTERN_SOURCE = `<!--\\s*anchor:\\s*(${ANCHOR_ID_SOURCE})\\s*-->`;

/**
 * 0.2.89 — the canonical anchor LINE, character for character the spec's
 * `/^\s*<!--\s*anchor:\s*[a-z0-9]{6,12}\s*-->\s*$/`, plus a capture group on the
 * id (a group changes what is captured, never what matches). A line that carries
 * anything besides the comment is prose quoting the syntax, not an anchor.
 */
export const ANCHOR_LINE_RE = new RegExp(`^\\s*${ANCHOR_PATTERN_SOURCE}\\s*$`);
