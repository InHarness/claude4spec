/**
 * `verifies[]` → the subset that does not resolve, and why.
 *
 * 2.0.0 tier K — lifted verbatim out of `AcService`, which is deleted. It was
 * never CRUD: it reads nothing of `ac`'s own table and writes nothing at all,
 * it only asks the host three questions about the entity each ref points AT.
 * Living on the service is what made `ac` look like it still needed one.
 *
 * Its two callers are now the `ac` views (so `brokenVerifies` travels with the
 * entity on every transport instead of being bolted onto three REST handlers)
 * and the consistency check.
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
