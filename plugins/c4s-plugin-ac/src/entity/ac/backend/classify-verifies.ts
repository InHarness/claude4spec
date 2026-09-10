/**
 * `verifies[]` → the subset that does not resolve, and why.
 *
 * 0.2.80 — the envelope's copy. The core keeps its own for `check_consistency`
 * rules 9-11 (`server/discovery/ops/ac-rules.ts`), which are AC rules by
 * definition and belong to M19, and M19 may not import from `plugins/`.
 *
 * Both go through `ctx.host`, not through the read core. That is not a shortcut
 * around the five operations — it is the right channel for the question. The
 * read core answers about entity SHAPES and RECORDS; `describeTypes` throws
 * `INVALID_TYPE` for an unregistered type AND for a deactivated one, so asking
 * it here would collapse `unknown` and `inactive` into one verdict and lose the
 * distinction the UI shows. The registry knows which is which.
 */

import type { AcBrokenVerify, AcVerifyRef } from '../../../types.js';
import type { HostRegistryView } from '../../../host-kit/host-types.js';

export function classifyVerifies(
  host: HostRegistryView | undefined,
  verifies: readonly AcVerifyRef[],
): AcBrokenVerify[] {
  /**
   * No host → NO verdict, rather than "everything is broken".
   *
   * Without the registry there is nothing to resolve a ref against, and an
   * empty list reads as "nothing is broken" — which is the honest answer to a
   * question that was never asked, where a full list would paint every AC in
   * the UI red the first time a caller happened to be built without a host.
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
