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

  it('reads a payload from the FUTURE without rewriting its file', () => {
    /**
     * This used to throw, and the throw was the bug. `indexEntity` degrades an
     * upgrade failure to "skip this entity", so one file written by a newer build
     * made every entity of that type vanish — from the list, from search, from
     * every page that mentions one — behind a console warning. Two teammates on
     * different builds sharing a git spec repo is a normal Tuesday.
     *
     * `upgraded: false` is the load-bearing half: it is what stops the indexer
     * rewriting (and thereby downgrading) a file whose newer content this build
     * cannot represent.
     */
    const result = upgradePayload(moduleAt(1), { name: 'x' }, 2);
    expect(result.upgraded).toBe(false);
    expect(result.data).toEqual({ name: 'x' });
    expect(result.warnings.join()).toMatch(/NEWER version/);
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

/**
 * Registration must refuse a bump with no migration.
 *
 * The check lived in `manifest-adapter` gated on `upgrades != null`, so the
 * ABSENT chain was the one shape that slipped through — and it is the shape an
 * author actually produces, because forgetting a slot is easier than writing a
 * wrong one. What followed was silent and unrecoverable: `upgradePayload` warns,
 * `continue`s, and still reports `upgraded: true`, so every file of that type is
 * rewritten STAMPED at the new version with its old content. Ship the real
 * migration later and the marker says the work is done.
 */
describe('a payloadVersion bump with no chain', () => {
  it('is rejected at registration, not discovered one entity at a time', async () => {
    const { assertSerializationContribution } = await import(
      '../core/plugin-host/manifest-adapter.js'
    );
    expect(() => assertSerializationContribution('widget', {}, 2)).toThrow(
      /must have exactly 1 step\(s\)/,
    );
    expect(() => assertSerializationContribution('widget', {}, 2)).toThrow(
      /the slot is absent — a bump needs a migration/,
    );
    // Version 1 is a chain of length zero, which is what "no migrations yet" is.
    expect(() => assertSerializationContribution('widget', {}, 1)).not.toThrow();
  });

  it('still rejects a chain of the WRONG length', () => {
    // The half that already worked, kept so widening the check did not lose it.
    return import('../core/plugin-host/manifest-adapter.js').then(({ assertSerializationContribution }) => {
      expect(() =>
        assertSerializationContribution('widget', { payloadUpgrades: [(p: unknown) => p] }, 3),
      ).toThrow(/exactly 2 step\(s\)/);
    });
  });
});

/**
 * `upgradeCapture` — the shared reader for `entity_version.data`.
 *
 * One implementation because there are four consumers and a review found the
 * fourth had been missed. `ok: false` is the part that matters: it is REPORTED,
 * so a read-side caller can degrade to the raw payload while a write-side caller
 * refuses. Collapsing that into a silent degrade is what made a failed release
 * restore report success while restoring nothing.
 */
describe('upgradeCapture', () => {
  it('reports failure instead of silently handing back the un-upgraded payload', async () => {
    const { upgradeCapture } = await import('./payload-upgrade.js');
    const module = moduleAt(2, [
      () => {
        throw new Error('nope');
      },
    ]);
    const result = upgradeCapture(module, { name: 'x' }, 1);
    expect(result.ok).toBe(false);
    // The data still comes back, so a DIFF can use it and stay useful. The flag
    // is what stops a RESTORE from writing it.
    expect(result.data).toEqual({ name: 'x' });
    expect(result.warnings.join()).toMatch(/cannot be upgraded/);
  });

  it('passes a payload through untouched when the type is unknown', () => {
    return import('./payload-upgrade.js').then(({ upgradeCapture }) => {
      const payload = { name: 'x' };
      const result = upgradeCapture(null, payload, 1);
      expect(result.ok).toBe(true);
      expect(result.data).toBe(payload);
    });
  });

  it('reports success and the migrated payload on a clean upgrade', () => {
    return import('./payload-upgrade.js').then(({ upgradeCapture }) => {
      const module = moduleAt(2, [(p) => ({ ...(p as object), migrated: true })]);
      const result = upgradeCapture(module, { name: 'x' }, 1);
      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({ name: 'x', migrated: true });
    });
  });
});

/**
 * The envelope definition the two diff paths have to share.
 *
 * `ReleaseService.dropStampOnlyEntityChanges` stripped only the timestamps, so
 * once `persist` started writing `payloadVersion` the marker read as content:
 * the git-anchored diff reported an entity `modified` while the SQL path called
 * the same entity `noop`. Two diff paths for one release, disagreeing, which is
 * precisely the regression that filter was written to close.
 */
describe('stripFileEnvelope', () => {
  it('removes the timestamps AND the payload marker, leaving content alone', async () => {
    const { stripFileEnvelope } = await import('./payload-upgrade.js');
    expect(
      stripFileEnvelope({
        slug: 'a',
        name: 'X',
        createdAt: '2020-01-01T00:00:00.000Z',
        updatedAt: '2021-01-01T00:00:00.000Z',
        [PAYLOAD_VERSION_KEY]: 2,
      }),
    ).toEqual({ slug: 'a', name: 'X' });
  });

  it('makes a file that gained only a marker compare equal to one without', () => {
    return import('./payload-upgrade.js').then(({ stripFileEnvelope }) => {
      const before = { slug: 'a', name: 'X', createdAt: 'c', updatedAt: 'u' };
      const after = { ...before, [PAYLOAD_VERSION_KEY]: 1 };
      expect(JSON.stringify(stripFileEnvelope(before))).toBe(JSON.stringify(stripFileEnvelope(after)));
    });
  });

  it('still reports a real content change', () => {
    return import('./payload-upgrade.js').then(({ stripFileEnvelope }) => {
      const a = { slug: 'a', name: 'X', [PAYLOAD_VERSION_KEY]: 2 };
      const b = { slug: 'a', name: 'Y', [PAYLOAD_VERSION_KEY]: 2 };
      expect(JSON.stringify(stripFileEnvelope(a))).not.toBe(JSON.stringify(stripFileEnvelope(b)));
    });
  });
});
