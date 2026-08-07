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
 * ## The ad-hoc root keeps `referenceValidated`, and that is not optional
 *
 * 0.2.13 §2 says ad-hoc roots "come back with `referenceValidated=false`", and a
 * first pass at this implemented that literally. It cannot be implemented
 * literally: `referenceValidated` is the property `findReferences` FILTERS ON
 * (`ops/references.ts` → `roots.referenceValidated()`), so a root carrying
 * `false` is not swept at all. With the override replacing the root list, the
 * only root was unswept and `--pages <dir>` answered `{ references: [], total: 0 }`
 * for every directory the project had not already declared — which is the whole
 * set of directories the flag exists to point at. A confidently empty answer to
 * "is anything still pointing at this before I rename it" is the worst possible
 * output of this command, and it is what the literal reading produces.
 *
 * So the sweep runs. What the project does not vouch for is expressed where it
 * costs nothing: `sectionIndexed: false`, which is simply true — there is no
 * section index for a directory nobody declared — and means hits from an ad-hoc
 * root carry no `anchor`, so they cannot be mistaken for indexed ones.
 *
 * A `clarification` patch is filed against the brief; this is the reading under
 * which the flag does anything at all.
 */
export function applyPagesOverride(roots: readonly Root[], override: string | undefined): Root[] {
  if (!override) return [...roots];
  const owning = roots.find((r) => r.dir === override);
  if (owning) return [owning];
  const builtin = roots.find((r) => r.id === BUILTIN_PAGES_ROOT_ID) ?? roots[0];
  if (!builtin) return [];
  return [{ ...builtin, dir: override, referenceValidated: true, sectionIndexed: false }];
}
