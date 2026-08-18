import type { RawEntity } from '../../discovery/raw-entity-reader.js';
import { diagramPayloadUpgrades } from './upgrades.js';
import type { SerializationContribution } from '../../serialization/types.js';
import type { DiagramFormat } from '../../../shared/entities.js';

// ─── snapshot shape (committed file format) ─────────────────────────────────

export interface DiagramSnapshot {
  slug: string;
  title: string;
  format: DiagramFormat;
  /**
   * Literal DSL body, kept verbatim (no trim). May be empty.
   *
   * `contentBearing` since 0.2.22, and it STILL BELONGS HERE. The flag governs
   * reads, not writes: the snapshot is what the entity file contains and what a
   * release package carries, so excluding the body would make the file
   * unable to reproduce the entity — the one invariant the projection rests on.
   */
  source: string;
  tags: string[];
}

/** 0.2.24 — declared on the type; see `ac/serializer.ts` for why the wrapper went. */
export const diagramSerialization = {
  payloadUpgrades: diagramPayloadUpgrades,
} satisfies Pick<SerializationContribution<RawEntity>, 'payloadUpgrades'>;
