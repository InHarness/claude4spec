/**
 * The migration that carries 0.2.51's one real risk.
 *
 * `acPayloadV2ToV3` is the only step in the repo that REFUSES rather than
 * transforms, and the consequence of a refusal is not a visible error: the
 * indexer degrades it to "skip this entity", so the file stays on disk while the
 * entity disappears from every read. These cases pin both halves — that the
 * happy path moves the criterion whole, and that the refusal fires exactly where
 * it should and says enough to act on.
 */
import { describe, expect, it } from 'vitest';
import { acPayloadV1ToV2, acPayloadV2ToV3, acPayloadUpgrades } from './upgrades.js';
import { acBackendModule } from './plugin.js';
import { upgradePayload, PayloadUpgradeError } from '../../serialization/payload-upgrade.js';
import type { SnapshotData } from '../../serialization/types.js';

const v2 = (over: Record<string, unknown> = {}): SnapshotData =>
  ({
    slug: 'ac-the-list-is-ordered',
    title: 'the list is ordered',
    text: 'the list is ordered',
    kind: 'requirement',
    status: 'active',
    verifies: [],
    description: null,
    ...over,
  }) as SnapshotData;

describe('acPayloadV2ToV3 — text and description collapse into title', () => {
  it('moves the criterion into `title` and drops both retired fields', () => {
    const out = acPayloadV2ToV3(v2()) as Record<string, unknown>;
    expect(out.title).toBe('the list is ordered');
    expect(out).not.toHaveProperty('text');
    expect(out).not.toHaveProperty('description');
    // Everything else is carried through untouched — a migration is not an edit.
    expect(out.kind).toBe('requirement');
    expect(out.status).toBe('active');
  });

  /**
   * The overwrite is the point, not a side effect. v1 → v2 wrote a 200-character
   * label; leaving it in place here would make that truncated copy the only
   * surviving text of a criterion that ran longer.
   */
  it('overwrites the truncated label v1 → v2 left behind, rather than keeping it', () => {
    const criterion = `${'a'.repeat(210)} END`;
    const upgraded = acPayloadV1ToV2({ slug: 'ac-x', text: criterion } as SnapshotData);
    expect((upgraded as Record<string, unknown>).title).toHaveLength(200);

    const out = acPayloadV2ToV3(upgraded) as Record<string, unknown>;
    expect(out.title).toBe(criterion);
  });

  it('is idempotent — a payload with no `text` has already been through it', () => {
    const already = { slug: 'ac-x', title: 'still true', kind: 'requirement' } as SnapshotData;
    expect(acPayloadV2ToV3(already)).toBe(already);
  });

  it('drops a description that HAS content, without inspecting it', () => {
    const out = acPayloadV2ToV3(v2({ description: 'why this matters' })) as Record<string, unknown>;
    expect(out).not.toHaveProperty('description');
    expect(out.title).toBe('the list is ordered');
  });

  describe('the refusal', () => {
    it('refuses text past 500 characters instead of truncating it', () => {
      const long = 'x'.repeat(501);
      expect(() => acPayloadV2ToV3(v2({ text: long }))).toThrow(/refuses rather than truncating/);
    });

    it('names the slug and the length, so the fix is a list of criteria to split', () => {
      const long = 'x'.repeat(742);
      expect(() => acPayloadV2ToV3(v2({ slug: 'ac-way-too-long', text: long }))).toThrow(
        /ac-way-too-long: text is 742 characters/,
      );
    });

    it('accepts exactly 500 — the bound is inclusive, as `maxLength` is', () => {
      const exact = 'x'.repeat(500);
      const out = acPayloadV2ToV3(v2({ text: exact })) as Record<string, unknown>;
      expect(out.title).toBe(exact);
    });

    /**
     * What a refusal costs, spelled out at the layer that pays it: the chain
     * turns the throw into a `PayloadUpgradeError`, and `entity-indexer` turns
     * THAT into a skipped entity plus a `warn`. There is no louder failure
     * anywhere downstream, which is why the release is conditional on the data.
     */
    it('surfaces as a PayloadUpgradeError from the chain, which the indexer skips on', () => {
      expect(() =>
        upgradePayload(acBackendModule, v2({ text: 'x'.repeat(600) }), 2),
      ).toThrow(PayloadUpgradeError);
    });
  });
});

describe('the ac chain as registered', () => {
  it('declares one step per version transition, ending at the manifest version', () => {
    expect(acBackendModule.payloadVersion).toBe(3);
    expect(acPayloadUpgrades).toHaveLength(acBackendModule.payloadVersion - 1);
  });

  it('takes a v1 file all the way to v3 in one pass', () => {
    const v1 = { slug: 'ac-old', text: 'the rule holds', kind: 'requirement', status: 'active' };
    const { data, upgraded } = upgradePayload(acBackendModule, v1 as SnapshotData, 1);
    const out = data as Record<string, unknown>;
    expect(upgraded).toBe(true);
    expect(out.title).toBe('the rule holds');
    expect(out).not.toHaveProperty('text');
  });
});
