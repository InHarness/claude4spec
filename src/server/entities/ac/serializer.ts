import type { RawEntity } from '../../discovery/raw-entity-reader.js';
import { acPayloadUpgrades } from './upgrades.js';
import type { SerializationContribution } from '../../serialization/types.js';
import type { AcKind, AcStatus, AcVerifyRef } from '../../../shared/entities.js';

// ─── M17 Snapshot shape ─────────────────────────────────────────────────────

export interface AcSnapshot {
  slug: string;
  title: string;
  text: string;
  kind: AcKind;
  status: AcStatus;
  verifies: AcVerifyRef[];
  description: string | null;
  tags: string[];
}

/**
 * 0.2.24 — the surviving slot, declared on the type rather than wrapped.
 *
 * `payloadVersion` is not repeated here: it lives on the manifest, which was
 * always the authority. The optional echo this object used to carry is gone
 * with the container — a number written twice is a number that eventually
 * disagrees with itself. 0.2.31 took `diff` too: the delta is generated from
 * `data.schema` and the `identity` declared on `verifies`.
 */
export const acSerialization = {
  payloadUpgrades: acPayloadUpgrades,
} satisfies Pick<SerializationContribution<RawEntity>, 'payloadUpgrades'>;
