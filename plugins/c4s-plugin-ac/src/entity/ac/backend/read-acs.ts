/**
 * Reading ACs from inside the envelope, over the M39 plugin surface.
 *
 * 0.2.80 — the in-core version of this read went over `RawEntityReader`
 * (`slugsMatching` + `listSlugs` + `getEntity`). An envelope has no reader and
 * should not: the projection's shape is a host detail, and the `contentBearing`
 * field filter lives in serialization, so a raw read would bypass it. What it
 * has is the bound read operations, and this is the same query expressed in
 * them.
 *
 * It takes TWO calls, not one, and the reason is a deliberate narrowness in the
 * surface. `listEntities` answers with `EntityRow`, which is frozen at
 * `{slug, title}` and takes no `select` — it is the SET, and only the set. The
 * width comes from `getEntities`, which does take `select`. Wanting both is not
 * a gap; it is the shape of a catalogue read that also needs a field.
 *
 * The `status = 'active'` half is not re-hardcoded here either: it comes from
 * this type's own `systemPrompt.defaultPredicate`, asked for by
 * `applyDefaultPredicate`, the same declaration the sidebar count and the REST
 * list read. The flag is opt-in, and a transport read of "the active ACs" is
 * exactly the caller that opts in.
 *
 * The core keeps its own copy of this query for `check_consistency` rules 9-11
 * (`server/discovery/ops/ac-rules.ts`), which may not import from `plugins/`.
 * Two doors, one mechanism underneath.
 */

import type { AcVerifyRef } from '../../../types.js';
import type { ReadOps } from '../../../host-kit/host-types.js';
import { AC_TYPE } from '../../../identity.js';

/**
 * What the audit needs off an AC. Deliberately narrower than the `Ac` record:
 * it reads no audit stamps, and asking for less keeps the projection small.
 */
export interface ActiveAc {
  slug: string;
  /** The criterion, whole. */
  title: string;
  kind: string;
  tags: string[];
  verifies: AcVerifyRef[];
}

/**
 * How many slugs to ask for in one `getEntities`.
 *
 * The host caps a single call and reports the overflow rather than throwing, so
 * the honest way to read a whole type is to page deliberately instead of asking
 * for everything and reading `truncated` afterwards. 100 is comfortably under
 * the host's own budget and keeps the number of round trips sane on a corpus of
 * a few hundred criteria.
 */
const SLUGS_PER_CALL = 100;

/** One page of the active set. Sized to match the batch above. */
const LIST_PAGE = 200;

function verifiesOf(record: Record<string, unknown>): AcVerifyRef[] {
  const raw = record.verifies;
  if (!Array.isArray(raw)) return [];
  const refs: AcVerifyRef[] = [];
  for (const row of raw) {
    const r = row as { type?: unknown; slug?: unknown };
    // Both fields are `required` in the declaration, so an entry missing either
    // is corrupt rather than a legal state — skip it rather than surface
    // `undefined` as a reference the caller then reports as broken.
    if (typeof r.type === 'string' && typeof r.slug === 'string') {
      refs.push({ type: r.type, slug: r.slug });
    }
  }
  return refs;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

/** Every active AC slug, paged until the host says there is no more. */
function activeSlugs(ops: ReadOps): string[] {
  const slugs: string[] = [];
  let offset = 0;
  for (;;) {
    const page = ops.listEntities({
      type: AC_TYPE,
      mode: 'items',
      applyDefaultPredicate: true,
      // The only offset-stable order the surface offers. Paging on a sort the
      // host may compute per call would drop or repeat rows between pages.
      sort: 'createdAt',
      limit: LIST_PAGE,
      offset,
    });
    if (page.mode !== 'items') break;
    for (const row of page.items) slugs.push(row.slug);
    if (!page.hasMore || page.items.length === 0) break;
    offset += page.items.length;
  }
  return slugs;
}

/**
 * The active ACs, whole.
 *
 * `verifies` is read as a WHOLE field. It is a top-level value collection, so it
 * is selectable — `select: ['verifies.slug']` would be rejected, and there is no
 * reason to want it: the pair is the unit.
 */
export function readActiveAcs(ops: ReadOps): ActiveAc[] {
  const slugs = activeSlugs(ops);
  const acs: ActiveAc[] = [];

  for (let i = 0; i < slugs.length; i += SLUGS_PER_CALL) {
    const batch = slugs.slice(i, i + SLUGS_PER_CALL);
    const got = ops.getEntities({
      type: AC_TYPE,
      slugs: batch,
      // `slug` and `tags` survive every projection as identity fields; naming
      // them anyway is what makes this call say what it reads.
      select: ['slug', 'title', 'kind', 'tags', 'verifies'],
    });
    for (const result of got.results) {
      // `entity: null` is a slug that vanished between the two calls — a delete
      // racing the audit. Skipping it is the same answer the reader gave.
      if (!result.entity) continue;
      const record = result.entity as Record<string, unknown>;
      acs.push({
        slug: result.slug,
        title: str(record.title),
        kind: str(record.kind, 'requirement'),
        tags: Array.isArray(record.tags) ? record.tags.filter((t): t is string => typeof t === 'string') : [],
        verifies: verifiesOf(record),
      });
    }
  }
  return acs;
}
