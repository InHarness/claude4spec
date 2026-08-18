import type { RawEntity } from '../../host-kit/host-types.js';
import type { SerializationContribution } from '@c4s/plugin-runtime';
import type { UiViewParam } from '../../types.js';
import { uiViewPayloadUpgrades } from './upgrades.js';

// ─── M17 Snapshot shape (entities/ui-view.md `uvsn0sho`) ────────────────────

export interface UiViewSnapshot {
  slug: string;
  title: string;
  url: string | null;
  description: string | null;
  params: UiViewParam[];
  /** v0.1.59 (serializer 1.1.0, additive): referenced design-system slug, or null. */
  designSystemSlug: string | null;
  /**
   * The mockup — FULL CONTENT, `contentBearing` notwithstanding.
   *
   * The flag governs READS, not serialisation. Dropping the blob here would stop
   * the entity file being the source of truth and would make
   * `snapshot → restore → snapshot` lose the mockup, so it stays, literally and
   * without trim. The snapshot and the full read record are the same shape apart
   * from exactly this field: the record carries descriptors, the snapshot carries
   * the content. In a DELTA it is neither — `field_changed_opaque` reports its
   * two sizes, which is what the flag means everywhere else too.
   */
  mockupHtml: string | null;
  tags: string[];
}

/** 0.2.24 — spread onto the type; the `serializer` wrapper is rejected now. */
export const uiViewSerialization = {
  /** v1 files spell the label `name`. */
  payloadUpgrades: uiViewPayloadUpgrades,
} satisfies Pick<SerializationContribution<RawEntity>, 'payloadUpgrades'>;

