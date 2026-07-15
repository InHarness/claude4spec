/**
 * M36 — shared content-normalization helpers for the markdown-with-frontmatter
 * artifacts (brief/patch/plan). Factored out of brief.ts/patch.ts/plan.ts,
 * which had each copy-pasted an identical `hashContent`, and (brief/plan) a
 * missing/inconsistent `toIso` — see `artifact-registry.ts` for the sibling
 * declarative registry these three services also share.
 */

import crypto from 'node:crypto';

/** sha256 of full file content (frontmatter + body) — optimistic-concurrency hash. */
export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * YAML auto-parses unquoted ISO-8601 scalars into JS `Date` objects (gray-matter
 * / js-yaml) — normalize back to an ISO 8601 string for DTO fields. `String(date)`
 * would silently produce `Date.prototype.toString()`'s verbose, non-ISO,
 * non-lexicographically-sortable form instead.
 */
export function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return v == null ? '' : String(v);
}
