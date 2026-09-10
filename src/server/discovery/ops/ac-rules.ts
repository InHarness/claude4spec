/**
 * The AC-shaped reads that stay in the CORE, for M19's consistency rules 9-11.
 *
 * 0.2.80 — `ac` moved into the `c4s-plugin-ac` envelope, and these two functions
 * did not go with it. Rules 9 (`broken-ac-verify`), 10
 * (`entity-without-ac-coverage`) and 11 (`module-without-ac`) are AC rules by
 * definition, they belong to M19, and M19 may not import from `plugins/`. So the
 * bodies were relocated here, verbatim, rather than moved: both were already
 * generic over `RawEntityReader` and a three-method host shape, which is why
 * this is a change of address and not a rewrite.
 *
 * The envelope has its OWN pair, over `MountContext`'s bound read operations
 * and `ctx.host`. Two call sites, deliberately — that duplication IS the
 * versioned boundary, and it is thinner than it looks: both end in the same
 * `RawEntityReader` + L9 `serialize` underneath, so there is one reading
 * mechanism, reached through two doors that are allowed to diverge.
 *
 * ── `verifies[]` → the subset that does not resolve, and why ──
 *
 * 2.0.0 tier K — lifted verbatim out of `AcService`, which is deleted. It was
 * never CRUD: it reads nothing of `ac`'s own table and writes nothing at all,
 * it only asks the host three questions about the entity each ref points AT.
 * Living on the service is what made `ac` look like it still needed one.
 *
 * 0.2.23 leaves it ONE caller: the consistency check. The other was the `ac`
 * detail view, and a type contributes no read code any more — so `brokenVerifies`
 * stops riding along on the record. That is not a capability lost, it is the
 * answer moving to the two places that can give it honestly: `check_consistency`
 * for the project-wide report, and the AC panel for one AC's own chips, derived
 * from the candidate lists it already has.
 *
 * 2.0.0 (brief item 25): `host.entityExists` used to resolve the type's
 * registered service and call `getBySlug`, so a type with rows in its table but
 * no `backend.service` answered `false` and every AC verifying one was reported
 * broken — precisely the state the declarative contract moves types into. The
 * fix lives in `entityExists` itself (it now falls back to the projection row),
 * NOT here: every other consumer of that check — the section indexer's
 * `<inline_mention/>` linking, the entity router, the reference tools — was
 * wrong in the same way for the same types, and repairing one call site would
 * have left the rest silently disagreeing about which entities exist.
 */

import type { AcBrokenVerify, AcVerifyRef } from '../../../shared/entities.js';
import type { RawEntity, RawEntityReader } from '../raw-entity-reader.js';

/**
 * The three host questions this needs, structurally — not `ProjectPluginHost`.
 *
 * The reader carries an OPTIONAL host (it is constructed without one by the CLI
 * tools and by ac-analysis), so a view reaching through it gets `undefined` some
 * of the time and the narrow shape makes that explicit at the call site.
 */
export interface VerifyResolver {
  getAvailable(type: string): unknown;
  isActive(type: string): boolean;
  entityExists(type: string, slug: string): boolean;
}

export function classifyVerifies(
  host: VerifyResolver | undefined,
  verifies: readonly AcVerifyRef[],
): AcBrokenVerify[] {
  /**
   * No host → NO verdict, rather than "everything is broken".
   *
   * Without the registry there is nothing to resolve a ref against, and an
   * empty list reads as "nothing is broken" — which is the honest answer to a
   * question that was never asked, where a full list would paint every AC in
   * the UI red the first time a reader happened to be built without a host.
   */
  if (!host) return [];

  const broken: AcBrokenVerify[] = [];
  for (const ref of verifies) {
    if (!host.getAvailable(ref.type)) {
      broken.push({ ...ref, reason: 'unknown' });
      continue;
    }
    if (!host.isActive(ref.type)) {
      broken.push({ ...ref, reason: 'inactive' });
      continue;
    }
    if (!host.entityExists(ref.type, ref.slug)) {
      broken.push({ ...ref, reason: 'missing' });
    }
  }
  return broken;
}

/**
 * What rule 9 needs off an AC. Deliberately narrower than a domain type: the
 * rule reads no audit stamps, and asking for less is what lets this be a plain
 * reader query.
 *
 * 0.2.51 — `text` became `title`. Not a rename at this layer so much as a
 * collapse one layer down: the type has a single authored prose field now, and
 * it is the reserved one, so the criterion arrives under the name every generic
 * reader already uses for an entity's name.
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
 * Off `entity.data`, NOT through `readCollection`.
 *
 * `verifies` is a value collection with no `keyFields`, so `hasProjectionTable`
 * is false and it stays EMBEDDED JSON on the `ac.verifies` column — the
 * declaration's own comment says so. `readCollection` is for the projected kind:
 * it queries `ac_verifies`, that table does not exist, and the reader swallows
 * the error and answers `[]`.
 *
 * Silently. Which is the whole problem — every AC came back with no verifies, so
 * `check_consistency` reported every entity as lacking AC coverage and never
 * reported a broken verify.
 */
function verifiesOf(entity: RawEntity): AcVerifyRef[] {
  const raw = entity.data.verifies;
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

/**
 * The active ACs, in the reader's slug order.
 *
 * The `status = 'active'` half is NOT hardcoded here: it comes from the type's
 * `systemPrompt.defaultPredicate` via `applyDefaultPredicate`, the same
 * declaration the sidebar count and the REST list read — and since 0.2.80 that
 * declaration is the envelope's, which is exactly why this file asks for the
 * predicate instead of restating it. A core rule that hardcoded `status` would
 * be the one reader that stopped agreeing the day the envelope changed its mind.
 *
 * `slugsMatching` returns `null` when nothing narrows the set — which happens
 * only if the type stops declaring a `defaultPredicate` — and that means "every
 * slug", not "no slugs".
 */
export function readActiveAcs(reader: RawEntityReader): ActiveAc[] {
  const matching = reader.slugsMatching('ac', {}, { applyDefaultPredicate: true });
  const slugs = reader.listSlugs('ac').filter((s) => matching === null || matching.has(s));

  const acs: ActiveAc[] = [];
  for (const slug of slugs) {
    const entity = reader.getEntity('ac', slug);
    if (!entity) continue;
    acs.push({
      slug,
      title: typeof entity.data.title === 'string' ? entity.data.title : '',
      kind: typeof entity.data.kind === 'string' ? entity.data.kind : 'requirement',
      tags: entity.tags,
      verifies: verifiesOf(entity),
    });
  }
  return acs;
}
