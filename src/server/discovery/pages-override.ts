import path from 'node:path';
import type { Root } from '../../shared/types.js';
import { invalidArgument } from './errors.js';


/**
 * `--pages <dir>` / `?pages=<dir>` — re-point the BASE root of a sweep
 * (`find_references`, `check_consistency`).
 *
 * ## Why this lives on the server
 *
 * Root iteration is server-side (0.2.13), so the override is applied where the
 * root list is assembled rather than re-implemented as a filter over results.
 *
 * ## What it does (2.1.8, M11 L13 / M19 L14)
 *
 * It overrides ONLY the `dir` of the root carrying `builtin: true` — found by
 * the flag, never by an id or a directory. Its `id` stays, and every other page
 * root is still swept: the full set is what keeps the answer identical across
 * channels. `--pages .` is a valid spelling; the walk skips dot-segment subtrees
 * and reads markdown entries only, so it never reaches `.claude4spec/`.
 *
 * A kept root whose directory lies inside the re-pointed one is NOT
 * deduplicated: a hit is keyed `(rootId, pagePath)`, so the same file under two
 * roots is two distinguishable addresses (a `clarification` patch is filed).
 *
 * ## Anchors
 *
 * `anchorFor` (`ops/references.ts`) matches `section_index` rows on
 * `(rootId, pagePath, line)` alone, and the index was built over the CONFIGURED
 * dir. A re-pointed builtin root keeps its id, so its hits would borrow the
 * anchors of identically-named files in the real directory — `--pages drafts`
 * reporting `drafts/notes.md` with the anchor of `pages/notes.md`. The root is
 * therefore reported in `unindexedRootIds` and its hits carry no anchor. An
 * override that resolves to the configured dir changes nothing.
 *
 * ## Matching is by RESOLVED path
 *
 * `./pages`, `pages/` and `/abs/repo/pages` all name the dir the builtin root
 * already owns; both sides are resolved against `projectDir` before comparing.
 *
 * ## The override cannot leave the project
 *
 * The parameter arrives from an HTTP query string and the MCP-over-HTTP mount,
 * and `PageSource` joins `Root.dir` onto the project dir with no containment
 * check of its own — `?pages=../../..` would read every markdown file above the
 * project. Refused rather than clamped.
 */
export interface PagesOverride {
  roots: Root[];
  /** Roots whose `dir` is not the one `section_index` was built over — their hits carry no anchor. */
  unindexedRootIds: ReadonlySet<string>;
}

const NONE: ReadonlySet<string> = new Set();

export function applyPagesOverride(
  roots: readonly Root[],
  override: string | undefined,
  projectDir: string,
): PagesOverride {
  if (!override) return { roots: [...roots], unindexedRootIds: NONE };

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

  // 2.1.4: no positional fallback — `roots[]` validation guarantees exactly one.
  const builtin = roots.find((r) => r.builtin);
  if (!builtin || path.resolve(projectAbs, builtin.dir) === overrideAbs) {
    return { roots: [...roots], unindexedRootIds: NONE };
  }
  // `rel` rather than `override`: one normalized spelling reaches `PagesService`,
  // so `./drafts` and `drafts` produce the same `pagePath` on every hit.
  const dir = rel === '' ? '.' : rel;
  return {
    roots: roots.map((r) => (r === builtin ? { ...r, dir } : r)),
    unindexedRootIds: new Set([builtin.id]),
  };
}
