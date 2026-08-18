import type { RawEntity } from '../../host-kit/host-types.js';
import type { SerializationContribution } from '@c4s/plugin-runtime';
import type { TokenValue } from '../../types.js';
import { designSystemPayloadV1ToV2, designSystemPayloadV2ToV3 } from './upgrades.js';

// ─── snapshot shape (committed file format) ─────────────────────────────────

export interface DesignSystemSnapshotToken {
  name: string;
  type: string;
  value: TokenValue;
  description: string | null;
}

export interface DesignSystemSnapshotGroup {
  name: string;
  tier: 'primitive' | 'semantic';
  tokens: DesignSystemSnapshotToken[];
}

export interface DesignSystemSnapshot {
  slug: string;
  title: string;
  description: string | null;
  groups: DesignSystemSnapshotGroup[];
  modes: Array<{ name: string; overrides: Array<{ token: string; value: TokenValue }> }>;
  tags: string[];
}

/** 0.2.24 — spread onto the type; the `serializer` wrapper is rejected now. */
export const designSystemSerialization = {
  /** v1 files carry a synthesised `description: null` on every token; v2 files spell the label `name`. */
  payloadUpgrades: [designSystemPayloadV1ToV2, designSystemPayloadV2ToV3],
} satisfies Pick<SerializationContribution<RawEntity>, 'payloadUpgrades'>;
