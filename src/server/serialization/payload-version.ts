/**
 * Reading `entity_version.serializer_version` across the 0.2.9 boundary.
 *
 * The column holds two vocabularies and always will: rows captured before 0.2.9
 * carry the serializer's advisory semver (`'1.0.0'`, `'1.1.0'`), rows captured
 * after carry the type's integer `payloadVersion` (`'1'`). Nothing migrates the
 * old rows — a semver cannot be mapped onto a payload version by inspection, and
 * rewriting history to guess one would be worse than reading it honestly.
 *
 * Reading it honestly is what this module is for. The column is not decoration:
 * `entities-router` and `ReleaseService` both compare two captures' values and
 * raise `_serializerVersionMismatch` when they differ, which the client renders
 * as a "schema bump" badge. A raw string comparison across the boundary sees
 * `'1.1.0' !== '1'` and reports a serializer migration on EVERY entity in EVERY
 * diff that spans the upgrade — a badge on everything, meaning nothing.
 *
 * So {@link samePayloadVersion} compares by VOCABULARY, and only collapses the
 * two where collapsing is the honest answer:
 *
 *   - both integers → the post-0.2.9 comparison, numerically;
 *   - both semvers → the pre-0.2.9 comparison, verbatim, so a genuine historical
 *     bump (ui-view `1.0.0` → `1.1.0`) is still reported on old rows;
 *   - one of each → the pair spans the upgrade itself. The column changed
 *     spelling; the payload shape did not. Reporting a bump here would flag every
 *     entity in every diff crossing the boundary, so it reports none.
 */

/** `'1.1.0'` → 1, `'2'` → 2, null → 1. Any non-integer spelling is a pre-0.2.9 capture. */
export function payloadVersionOfCapture(raw: string | null | undefined): number {
  if (raw == null) return 1;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return 1;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

const isLegacy = (raw: string | null | undefined): boolean => raw != null && !/^\d+$/.test(raw.trim());

/** Whether two captures describe the same payload shape. See the module docstring. */
export function samePayloadVersion(a: string | null | undefined, b: string | null | undefined): boolean {
  if (isLegacy(a) !== isLegacy(b)) return true; // the pair spans the vocabulary change
  if (isLegacy(a)) return a === b; // two pre-0.2.9 captures: the old comparison, verbatim
  return payloadVersionOfCapture(a) === payloadVersionOfCapture(b);
}
