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
export const ANCHOR_PATTERN_SOURCE = '<!--\\s*anchor:\\s*([a-z0-9]{6,12})\\s*-->';
