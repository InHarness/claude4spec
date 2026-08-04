import { describe, expect, it, vi } from 'vitest';
import {
  PAYLOAD_VERSION_KEY,
  PayloadUpgradeError,
  attachPayloadVersion,
  classifyGap,
  readPayloadVersion,
  stripPayloadVersion,
  upgradePayload,
  type UpgradableModule,
} from './payload-upgrade.js';
import type { FieldNode } from '../../shared/plugin-host/data-schema.js';

const SCHEMA: Record<string, FieldNode> = {
  name: { kind: 'string', required: true },
  status: { kind: 'enum', values: ['active', 'archived'], required: true, default: 'active' },
  createdAt: { kind: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
  note: { kind: 'string' },
};

function moduleAt(version: number, steps: Array<(p: unknown) => unknown> = []): UpgradableModule {
  return {
    type: 'widget',
    payloadVersion: version,
    data: { schema: SCHEMA },
    serializer: { payloadUpgrades: steps as UpgradableModule['serializer'] extends undefined ? never : never },
  } as unknown as UpgradableModule;
}

describe('the payload version marker', () => {
  it('reads an absent marker as version 1', () => {
    // Exactly true rather than a convention: the marker ships in this release
    // and every type was at 1 before it, so "no marker" and "written at 1" name
    // the same corpus.
    expect(readPayloadVersion({ name: 'x' })).toBe(1);
    expect(readPayloadVersion(null)).toBe(1);
  });

  it('treats a corrupt marker as absent rather than trusting it', () => {
    // Degrading to "run the whole chain" either succeeds or fails loudly;
    // trusting a bad number silently skips migrations.
    expect(readPayloadVersion({ [PAYLOAD_VERSION_KEY]: '3' })).toBe(1);
    expect(readPayloadVersion({ [PAYLOAD_VERSION_KEY]: 0 })).toBe(1);
    expect(readPayloadVersion({ [PAYLOAD_VERSION_KEY]: 2.5 })).toBe(1);
    expect(readPayloadVersion({ [PAYLOAD_VERSION_KEY]: 2 })).toBe(2);
  });

  it('round-trips attach and strip without disturbing the payload', () => {
    const payload = { name: 'x', note: null };
    const stamped = attachPayloadVersion(payload, 3) as Record<string, unknown>;
    expect(stamped[PAYLOAD_VERSION_KEY]).toBe(3);
    expect(stripPayloadVersion(stamped)).toEqual(payload);
    // Stripping something never stamped is a no-op, not a rebuild of the object.
    expect(stripPayloadVersion(payload)).toBe(payload);
  });

  it('leaves a payload alone when the type declares no version', () => {
    const payload = { name: 'x' };
    expect(attachPayloadVersion(payload, undefined)).toBe(payload);
  });
});

describe('upgradePayload', () => {
  it('is a no-op at the current version, and says so', () => {
    // `upgraded: false` is what makes the file rewrite one-time — the second
    // boot reads a current marker and never reaches the rewrite branch.
    const result = upgradePayload(moduleAt(1), { name: 'x' }, 1);
    expect(result.upgraded).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it('composes the chain in order, one step per version', () => {
    const module = moduleAt(3, [
      (p) => ({ ...(p as object), steps: ['a'] }),
      (p) => ({ ...(p as object), steps: [...(p as { steps: string[] }).steps, 'b'] }),
    ]);
    const result = upgradePayload(module, { name: 'x' }, 1);
    expect(result.upgraded).toBe(true);
    expect((result.data as { steps: string[] }).steps).toEqual(['a', 'b']);
  });

  it('starts mid-chain when the file is only one version behind', () => {
    // `payloadUpgrades[i]` takes i+1 to i+2, so the step out of v2 is index 1.
    // Off-by-one here would re-run a migration that has already been applied.
    const module = moduleAt(3, [
      () => ({ name: 'first-step-ran' }),
      (p) => ({ ...(p as object), second: true }),
    ]);
    const result = upgradePayload(module, { name: 'x' }, 2);
    // `name` untouched proves the v1 step did not run; `second` proves the v2
    // one did. (`status` is filled by the gap classifier from its default.)
    expect(result.data).toMatchObject({ name: 'x', second: true });
  });

  it('refuses a payload from the future', () => {
    // There is no way to express a downgrade, and running a newer file through
    // an older write path silently drops whatever the newer shape added.
    expect(() => upgradePayload(moduleAt(1), { name: 'x' }, 2)).toThrow(PayloadUpgradeError);
    expect(() => upgradePayload(moduleAt(1), { name: 'x' }, 2)).toThrow(/downgrade is not expressible/);
  });

  it('reports a step that throws as an upgrade failure naming the version pair', () => {
    const module = moduleAt(2, [
      () => {
        throw new Error('bad input');
      },
    ]);
    expect(() => upgradePayload(module, { name: 'x' }, 1)).toThrow(/v1 → v2 cannot be upgraded/);
  });
});

describe('classifyGap — the unambiguous / contradictory line', () => {
  it('fills a required field from its declared default and warns', () => {
    const { filled, warnings, contradiction } = classifyGap(SCHEMA, { name: 'x' });
    expect(contradiction).toBeNull();
    expect(filled.status).toBe('active');
    expect(warnings.join()).toMatch(/status/);
  });

  it('refuses when a required field has nothing to derive it from', () => {
    // Any value we chose would be invented, and an invented value written back
    // to the entity FILE is indistinguishable from something the user wrote.
    const { contradiction } = classifyGap(SCHEMA, { status: 'active' });
    expect(contradiction).toMatch(/required field 'name'/);
  });

  it('refuses a value outside a declared enum', () => {
    const { contradiction } = classifyGap(SCHEMA, { name: 'x', status: 'zombie' });
    expect(contradiction).toMatch(/not one of active, archived/);
  });

  it('leaves an optional field absent rather than filling it', () => {
    const { filled, warnings } = classifyGap(SCHEMA, { name: 'x', status: 'active' });
    expect(filled.note).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it('ignores systemManaged fields — the envelope owns those', () => {
    // `createdAt` is required-ish and always absent from the payload, because it
    // travels in the envelope. Classifying it would make every upgrade warn.
    const { warnings, contradiction } = classifyGap(SCHEMA, { name: 'x', status: 'active' });
    expect(contradiction).toBeNull();
    expect(warnings.join()).not.toMatch(/createdAt/);
  });

  it('surfaces a contradiction through upgradePayload as a hard error', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const module = moduleAt(2, [() => ({ status: 'active' })]); // drops `name`
    expect(() => upgradePayload(module, { name: 'x' }, 1)).toThrow(/required field 'name'/);
    warn.mockRestore();
  });
});
