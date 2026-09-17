import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../../tests/helpers/fixture-module.js';
import { describe, expect, it } from 'vitest';
import { PluginRegistryImpl } from './registry.js';
import { SerializationEngine } from './serialization-engine.js';
import { buildSystemPrompt } from '../../services/chat-context.js';
import { upgradeCapture } from '../../serialization/payload-upgrade.js';
import type { BackendModule } from './types.js';
import type { RawEntityReader } from '../../discovery/raw-entity-reader.js';

/**
 * 0.2.90 — deactivating a type takes its renderer AND its payload timeline off
 * every consumer in one move, because both are slots of one manifest and every
 * consumer resolves the type through `host.getEntity(type)`.
 */
function mod(type: string, over: Partial<BackendModule> = {}): BackendModule {
  return {
    type,
    data: FIXTURE_DATA,
    slugPattern: FIXTURE_SLUG_PATTERN,
    payloadVersion: 2,
    payloadUpgrades: [() => ({ upgraded: true })],
    label: type,
    labelPlural: `${type}s`,
    displayOrder: 100,
    pathPrefix: `/${type}s`,
    systemPrompt: { roleNoun: type, narrativeBlock: `NARRATIVE-OF-${type}` },
    ...over,
  } as BackendModule;
}

function hostWith(active: string[]) {
  const registry = new PluginRegistryImpl();
  registry.registerEntityModule(mod('keeper'));
  registry.registerEntityModule(mod('widget'));
  return registry.consolidate({ entities: active });
}

describe('type deactivation — one point of truth (0.2.90)', () => {
  it('getEntity returns null for the inactive type while it stays available in the pool', () => {
    const host = hostWith(['keeper']);
    expect(host.getEntity('widget')).toBeNull();
    expect(host.getAvailable('widget')).not.toBeNull();
    expect(host.listEntities().map((m) => m.type)).toEqual(['keeper']);
  });

  it('buildSystemPrompt skips the inactive type', () => {
    const host = hostWith(['keeper']);
    const prompt = buildSystemPrompt({
      host,
      projectName: 'P',
      cwd: '/tmp/p',
      roots: [],
      currentPagePath: null,
      currentPageBody: null,
      entityCounts: {},
      tagCount: 0,
    } as never);
    expect(prompt).toContain('NARRATIVE-OF-keeper');
    expect(prompt).not.toContain('NARRATIVE-OF-widget');
  });

  it('the payload timeline goes with it — no upgrade chain runs for the inactive type', () => {
    const host = hostWith(['keeper']);
    const payload = { old: true };
    expect(upgradeCapture(host.getEntity('widget'), payload, 1)).toEqual({ data: payload, ok: true, warnings: [] });
    expect(upgradeCapture(host.getEntity('keeper'), payload, 1).data).toMatchObject({ upgraded: true });
  });

  it('the read-record backstop refuses the inactive type instead of serializing it', () => {
    const host = hostWith(['keeper']);
    const engine = new SerializationEngine(host);
    const entity = { type: 'widget', slug: 'w', data: {}, tags: [] };
    expect(() => engine.serializeEntity('widget', entity as never, {} as RawEntityReader)).toThrow();
  });
});
