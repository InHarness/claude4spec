/**
 * 0.2.18 — the two axes an envelope moves on, asserted separately because the
 * whole risk of the migration is confusing them.
 *
 * **Axis A, registration — per ENVELOPE, globally.** `ui-view` and
 * `design-system` reach the registry only through `registerPlugin` → fan-out to
 * `registerEntityModule`, never from the core bootstrap. They travel in one
 * envelope because `ui-view.designSystemSlug` declares `ref: 'design-system'` —
 * a fixed, single-target ref — so the target must exist from the first
 * registration, and unregistering the envelope takes both types down at once.
 *
 * **Axis B, activation — per PROJECT, per TYPE.** The `config.entities`
 * whitelist still operates on a single type. Deactivating `ui-view` must NOT
 * deactivate `design-system`, and vice versa, despite the shared envelope. This
 * is the assertion that would catch someone "simplifying" activation to work on
 * the envelope, which is the natural mistake once the two ship together.
 *
 * Driven through the real loader against the real `plugins/` tree — a fixture
 * envelope would prove the machinery and not the wiring, and the wiring is what
 * changed.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { loadBuiltinEnvelopes } from '../../../src/server/core/plugin-host/loader.js';
import { PluginRegistryImpl } from '../../../src/server/core/plugin-host/registry.js';
import { registerAllPlugins } from '../../../src/server/serialization/registerAll.js';

const ENVELOPE = 'c4s-plugin-frontend-mockups';
const PAIR = ['design-system', 'ui-view'];

async function loadedRegistry(): Promise<PluginRegistryImpl> {
  const registry = new PluginRegistryImpl();
  registerAllPlugins(registry);
  await loadBuiltinEnvelopes(registry);
  return registry;
}

describe('axis A — registration is per envelope', () => {
  let registry: PluginRegistryImpl;
  beforeAll(async () => {
    registry = await loadedRegistry();
  });

  it('the core bootstrap alone contributes neither type', () => {
    // `registerAllPlugins` is the whole of tier (a). If either type came back
    // into it, this is where a "convenient" import would show up.
    const coreOnly = new PluginRegistryImpl();
    registerAllPlugins(coreOnly);
    const types = coreOnly.listAvailable().map((m) => m.type).sort();
    expect(types).toEqual(['ac', 'diagram']);
  });

  it('both types arrive through the envelope loader', () => {
    const types = registry.listAvailable().map((m) => m.type);
    for (const type of PAIR) expect(types).toContain(type);
  });

  it('both are contributed by the SAME envelope — the ref pair is not split', () => {
    const record = registry.listPluginRecords().find((p) => p.name === ENVELOPE);
    expect(record, `${ENVELOPE} is not registered`).toBeDefined();
    expect([...record!.contributedTypes].sort()).toEqual(PAIR);

    // And no OTHER envelope claims either of them — a split across two records
    // is exactly what the ref pairing rule forbids.
    for (const other of registry.listPluginRecords().filter((p) => p.name !== ENVELOPE)) {
      for (const type of PAIR) expect(other.contributedTypes).not.toContain(type);
    }
  });

  it('unregistering the envelope drops BOTH types, idempotently and without throwing', () => {
    const types = () => registry.listAvailable().map((m) => m.type);
    for (const type of PAIR) expect(types()).toContain(type);

    registry.unregisterPlugin(ENVELOPE);
    for (const type of PAIR) expect(types()).not.toContain(type);
    // The other envelopes are untouched — teardown is per envelope, not global.
    expect(types()).toContain('endpoint');

    // Second call is a no-op. Since 0.2.29 no envelope declares `onUnregister`
    // at all — the slot is optional and only for resources the host cannot see,
    // and these packages hold none — so both the teardown AND its idempotency
    // are entirely the registry's: `if (!record) return`, which this pins.
    expect(() => registry.unregisterPlugin(ENVELOPE)).not.toThrow();
    for (const type of PAIR) expect(types()).not.toContain(type);
  });
});

describe('axis B — activation is per project, per type', () => {
  let registry: PluginRegistryImpl;
  beforeAll(async () => {
    registry = await loadedRegistry();
  });

  it.each([
    ['design-system', 'ui-view'],
    ['ui-view', 'design-system'],
  ])('whitelisting %s leaves %s available but inactive', (kept, dropped) => {
    const host = registry.consolidate({ entities: [kept] });

    // Both are in the POOL — the envelope contributed them regardless.
    const available = host.listAvailable().map((m) => m.type);
    expect(available).toContain(kept);
    expect(available).toContain(dropped);

    // Only one is ACTIVE. This is the assertion the brief asks for by name.
    const active = host.listEntities().map((m) => m.type);
    expect(active).toEqual([kept]);
    expect(host.isActive(kept)).toBe(true);
    expect(host.isActive(dropped)).toBe(false);
  });

  it('an undefined whitelist activates both, as it does every other type', () => {
    const active = registry.consolidate(null).listEntities().map((m) => m.type);
    for (const type of PAIR) expect(active).toContain(type);
  });
});
