import type { Root } from '../../shared/types.js';

const BUILTIN_PAGES_ROOT_ID = 'pages';

/**
 * `--pages <dir>` / `?pages=<dir>` — NARROW a sweep to one directory.
 *
 * ## Why this lives on the server now
 *
 * It used to live in `src/bin/c4s/context.ts`, applied while the CLI built a
 * discovery core of its own. 0.2.13 took that core away: root iteration is
 * server-side, so the override has to be too, or the flag would have to be
 * re-implemented as a filter over results — which is not the same thing, because
 * a root is also what a hit's `rootId` and relative path are reported against.
 *
 * ## What it does, and the two mistakes it avoids
 *
 * It REPLACES the root list rather than rewriting one entry. Rewriting the
 * built-in root's `dir` and leaving the others in place looks equivalent and is
 * not: a caller that explicitly narrowed the scan would still get hits from every
 * other reference-validated root, with paths relative to a root it never named —
 * and pointing a second root id at a directory another root already covers slips
 * past the overlap validation in `validateRootsConfig`, so every hit there is
 * reported twice under two ids.
 *
 * When a CONFIGURED root already claims that directory, that root is used
 * verbatim — id and properties intact. The override names a DIRECTORY, not a
 * root, so hits stay attributable to whoever owns it.
 *
 * ## The ad-hoc root is not reference-validated
 *
 * When no configured root claims the directory, the result is an AD-HOC root,
 * and 0.2.13 states what that costs: `referenceValidated: false`. The CLI's old
 * version inherited the built-in root's properties instead, which quietly
 * claimed validation for a directory nobody had declared — a sweep over an
 * arbitrary folder would report its hits as if the project vouched for them.
 * Section indexing goes the same way, and for the same reason: there is no index
 * for a directory the project never declared.
 */
export function applyPagesOverride(roots: readonly Root[], override: string | undefined): Root[] {
  if (!override) return [...roots];
  const owning = roots.find((r) => r.dir === override);
  if (owning) return [owning];
  const builtin = roots.find((r) => r.id === BUILTIN_PAGES_ROOT_ID) ?? roots[0];
  if (!builtin) return [];
  return [{ ...builtin, dir: override, referenceValidated: false, sectionIndexed: false }];
}
