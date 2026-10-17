/**
 * Reading every `ui-kit-component` record over the M39 plugin surface — the
 * same two-call shape `c4s-plugin-ac` uses: `listEntities` gives the SET of
 * slugs, `getEntities` with `select` gives the fields the audit needs.
 * `anatomy` is content-bearing and never selected.
 */

import type { ReadOps } from '../../../host-kit/host-types.js';
import { UI_KIT_COMPONENT_TYPE } from '../../../identity.js';
import type { AuditRecord } from './audit.js';

/** The host's hard cap on slugs per `getEntities` call; it throws past it. */
export const SLUGS_PER_CALL = 50;
const LIST_PAGE = 200;

function allSlugs(ops: ReadOps): string[] {
  const slugs: string[] = [];
  let offset = 0;
  for (;;) {
    const page = ops.listEntities({
      type: UI_KIT_COMPONENT_TYPE,
      mode: 'items',
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

/** One `getEntities` call; a truncated answer is re-asked as halves rather than read as a delete. */
function fetchBatch(ops: ReadOps, batch: string[]): AuditRecord[] {
  if (batch.length === 0) return [];
  const got = ops.getEntities({
    type: UI_KIT_COMPONENT_TYPE,
    slugs: batch,
    select: ['slug', 'binding', 'dataSources', 'soleAnatomyOf', 'types'],
  });
  const out: AuditRecord[] = [];
  const deferred: string[] = [];
  for (const result of got.results) {
    if (result.entity) out.push({ ...(result.entity as Record<string, unknown>), slug: result.slug });
    else if (got.truncated) deferred.push(result.slug);
  }
  if (deferred.length > 0 && batch.length > 1) {
    const half = Math.ceil(deferred.length / 2);
    out.push(...fetchBatch(ops, deferred.slice(0, half)), ...fetchBatch(ops, deferred.slice(half)));
  }
  return out;
}

export function readAllRecords(ops: ReadOps): AuditRecord[] {
  const slugs = allSlugs(ops);
  const records: AuditRecord[] = [];
  for (let i = 0; i < slugs.length; i += SLUGS_PER_CALL) {
    records.push(...fetchBatch(ops, slugs.slice(i, i + SLUGS_PER_CALL)));
  }
  return records;
}
