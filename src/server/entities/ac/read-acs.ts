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

import type { RawEntityReader } from '../../discovery/raw-entity-reader.js';
import type { AcVerifyRef } from '../../../shared/entities.js';

/**
 * What the two non-CRUD readers need off an AC. Deliberately narrower than the
 * old `Ac` domain type: neither caller reads `description` or the audit stamps,
 * and asking for less is what lets this be a plain reader query.
 */
export interface ActiveAc {
  slug: string;
  text: string;
  kind: string;
  tags: string[];
  verifies: AcVerifyRef[];
}

function verifiesOf(reader: RawEntityReader, slug: string): AcVerifyRef[] {
  const rows = reader.readCollection('ac', slug, 'verifies');
  const refs: AcVerifyRef[] = [];
  for (const row of rows) {
    const r = row as { type?: unknown; slug?: unknown };
    // Both fields are `required` in the declaration, so a row missing either is
    // a corrupt projection rather than a legal state — skip it rather than
    // surface `undefined` as a reference the caller then reports as broken.
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
      text: typeof entity.data.text === 'string' ? entity.data.text : '',
      kind: typeof entity.data.kind === 'string' ? entity.data.kind : 'requirement',
      tags: entity.tags,
      verifies: verifiesOf(reader, slug),
    });
  }
  return acs;
}
