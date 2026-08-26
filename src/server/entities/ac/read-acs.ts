/**
 * Host API 2.0.0 tier K — reading ACs without an `AcService`.
 *
 * `AcService.listRaw({ status: 'active' })` had exactly two callers that were
 * not CRUD: the LLM semantic audit and the deterministic consistency check.
 * Both want the same thing — the active ACs, whole — and both now ask the
 * reader for it.
 *
 * The `status = 'active'` half is NOT re-hardcoded here: it comes from
 * `ac.systemPrompt.defaultPredicate` via `applyDefaultPredicate`, the same
 * declaration the sidebar count and the REST list read. That is the point of
 * having moved it into the manifest — "active is what counts, unless you say
 * otherwise" is now written down once, and this file honours it rather than
 * restating it.
 */

import type { RawEntity, RawEntityReader } from '../../discovery/raw-entity-reader.js';
import type { AcVerifyRef } from '../../../shared/entities.js';

/**
 * What the two non-CRUD readers need off an AC. Deliberately narrower than the
 * old `Ac` domain type: neither caller reads the audit stamps, and asking for
 * less is what lets this be a plain reader query.
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
 * reported a broken verify, and the LLM audit skipped every AC as unresolvable.
 * `ac/views.ts` reads the same field this way; this file was the odd one out.
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
 * `slugsMatching` returns `null` when nothing narrows the set — which for `ac`
 * happens only if the type stops declaring a `defaultPredicate` — and that means
 * "every slug", not "no slugs".
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
