import path from 'node:path';
import type { Root } from '../../shared/types.js';
import { invalidArgument } from './errors.js';

const BUILTIN_PAGES_ROOT_ID = 'pages';

/**
 * The id an ad-hoc override root is given.
 *
 * NOT the built-in root's id, and that distinction is load-bearing rather than
 * cosmetic — see the note on anchors below.
 */
export const OVERRIDE_ROOT_ID = 'pages-override';

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
 * ## Matching is by RESOLVED path, not by string
 *
 * `--pages ./pages`, `--pages pages/` and `--pages /abs/repo/pages` all name the
 * directory the built-in root already owns. Comparing `Root.dir` by string
 * equality answered "no configured root claims this" for all three and fell to
 * the ad-hoc branch, so the identical query with and without the flag came back
 * with and without anchors. Both sides are resolved against `projectDir` before
 * comparing.
 *
 * ## The override cannot leave the project
 *
 * The parameter reaches this function from an HTTP query string (`?pages=`) and
 * from the MCP-over-HTTP mount, not just from a flag the user typed at their own
 * shell. `PageSource` turns `Root.dir` into `path.join(projectDir, dir)` with no
 * containment check of its own, so `?pages=../../..` would walk and read every
 * markdown file above the project and return its paths and tag text. Config
 * roots go through `validateRootDirs`; this one gets the equivalent here, and
 * refuses rather than silently clamping — a narrowing quietly redirected is the
 * failure this parameter exists to prevent.
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
 * costs nothing: `sectionIndexed: false`, and an id of its own.
 *
 * ## Why the id has to change
 *
 * `sectionIndexed: false` describes the root; it does not travel with a hit.
 * `anchorFor` (`ops/references.ts`) matches `section_index` rows on
 * `(rootId, pagePath, line)` alone — so an ad-hoc root that KEPT the built-in id
 * had its hits decorated with the anchors of identically-named files in the real
 * pages root. `--pages drafts` reporting a hit in `drafts/architecture.md` with
 * the anchor of `pages/architecture.md` sends the caller to `get-sections` for a
 * section of a different file, and nothing in the answer says so. A distinct id
 * matches no row, so the promise this module already made — "hits from an ad-hoc
 * root carry no anchor" — becomes true by construction.
 *
 * A `clarification` patch is filed against the brief; this is the reading under
 * which the flag does anything at all.
 */
export function applyPagesOverride(
  roots: readonly Root[],
  override: string | undefined,
  projectDir: string,
): Root[] {
  if (!override) return [...roots];

  const projectAbs = path.resolve(projectDir);
  const overrideAbs = path.resolve(projectAbs, override);
  const rel = path.relative(projectAbs, overrideAbs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw invalidArgument(
      `pages override '${override}' resolves outside the project`,
      // The project's OWN roots, never a hardcoded default — the core has no
      // privileged root name, and an architecture gate greps for one.
      roots.length > 0
        ? `name a directory inside the project, relative to it — its roots are: ${roots
            .map((r) => r.dir)
            .join(', ')}`
        : 'name a directory inside the project, relative to it',
    );
  }

  const owning = roots.find((r) => path.resolve(projectAbs, r.dir) === overrideAbs);
  if (owning) return [owning];

  const builtin = roots.find((r) => r.id === BUILTIN_PAGES_ROOT_ID) ?? roots[0];
  if (!builtin) return [];
  // `rel` rather than `override`: one normalized spelling reaches `PagesService`,
  // so `./drafts` and `drafts` produce the same `pagePath` on every hit.
  return [
    { ...builtin, id: OVERRIDE_ROOT_ID, dir: rel, referenceValidated: true, sectionIndexed: false },
  ];
}
