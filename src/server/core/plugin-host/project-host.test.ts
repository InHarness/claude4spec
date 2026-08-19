import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../../tests/helpers/fixture-module.js';
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { PluginRegistryImpl } from './registry.js';
import type { BackendModule, MountContext, ProjectPluginOverlay } from './types.js';

/** Minimal BackendModule for pool/activation assertions. */
function mod(type: string, displayOrder = 100): BackendModule {
  return {
    type,
    data: FIXTURE_DATA,
    slugPattern: FIXTURE_SLUG_PATTERN,
    payloadVersion: 1,
    label: type,
    labelPlural: `${type}s`,
    displayOrder,
    pathPrefix: `/${type}s`,
    systemPrompt: {
      roleNoun: type,
      countStat: { placeholder: `${type}Count`, sqlQuery: 'SELECT 0 AS count', label: type },
      mcpToolsLine: `${type}-tools: ...`,
    },
  };
}

function baseRegistry(...types: string[]): PluginRegistryImpl {
  const registry = new PluginRegistryImpl();
  for (const t of types) registry.registerEntityModule(mod(t));
  return registry;
}

function overlayOf(modules: BackendModule[]): ProjectPluginOverlay {
  return {
    listLocal: () => modules,
    origin: (type) => `.claude4spec/plugins/${type}-pkg`,
    listSettings: () => [],
    listCommands: () => [],
  };
}

describe('consolidate — overlay', () => {
  it('overlay undefined ⇒ effective pool = base', () => {
    const host = baseRegistry('endpoint', 'dto').consolidate({});
    expect(host.listAvailable().map((m) => m.type).sort()).toEqual(['dto', 'endpoint']);
    expect(host.shadowReport()).toEqual([]);
  });

  it('merges base ∪ overlay into the effective pool', () => {
    const host = baseRegistry('endpoint').consolidate({}, overlayOf([mod('glossary')]));
    expect(host.listAvailable().map((m) => m.type).sort()).toEqual(['endpoint', 'glossary']);
    expect(host.getAvailable('glossary')).not.toBeNull();
  });

  it('overlay shadows a same-typed base module (cross-layer) and reports it', () => {
    const baseEndpoint = mod('endpoint', 1);
    const overlayEndpoint = mod('endpoint', 2);
    const registry = new PluginRegistryImpl();
    registry.registerEntityModule(baseEndpoint);
    const host = registry.consolidate({}, overlayOf([overlayEndpoint]));

    // The overlay module wins the lookup.
    expect(host.getAvailable('endpoint')).toBe(overlayEndpoint);
    expect(host.listAvailable().filter((m) => m.type === 'endpoint')).toHaveLength(1);
    expect(host.shadowReport()).toEqual([
      { type: 'endpoint', overlayOrigin: '.claude4spec/plugins/endpoint-pkg' },
    ]);
  });

  it('an overlay-only type carries no shadow entry', () => {
    const host = baseRegistry('endpoint').consolidate({}, overlayOf([mod('glossary')]));
    expect(host.shadowReport()).toEqual([]);
  });

  it('applies the entities whitelist to the merged pool (overlay types activatable)', () => {
    const host = baseRegistry('endpoint', 'dto').consolidate(
      { entities: ['glossary'] },
      overlayOf([mod('glossary')]),
    );
    const part = host.partition();
    expect(part.active).toEqual(['glossary']);
    expect(part.inactive.sort()).toEqual(['dto', 'endpoint']);
    expect(part.unknown).toEqual([]);
    expect(host.isActive('glossary')).toBe(true);
  });

  /**
   * The three sets ARE the payload of `GET /api/_meta/entities`, so their
   * properties are an API contract, not an internal detail: the client reapplies
   * activation from this response on project navigation (activation is a lazy
   * resolution, not a process restart), and a set that reordered between two
   * calls would churn the client's module registry for no reason.
   */
  it('partitions into three disjoint, total, deterministically ordered sets', () => {
    const registry = baseRegistry('endpoint', 'dto', 'ac');
    const config = { entities: ['ac', 'endpoint', 'ghost'] };
    const host = registry.consolidate(config, overlayOf([mod('glossary')]));

    const part = host.partition();
    expect(part).toEqual({
      active: ['endpoint', 'ac'],
      inactive: ['dto', 'glossary'],
      unknown: ['ghost'],
    });

    // Disjoint and total over the effective pool.
    const all = [...part.active, ...part.inactive];
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(host.listAvailable().map((m) => m.type).sort());

    // Stable across calls, and PER PROJECT: the same process serving a second
    // config answers with different sets, which is why this cannot be cached
    // process-wide.
    expect(host.partition()).toEqual(part);
    const other = registry.consolidate({ entities: ['dto'] }, overlayOf([mod('glossary')]));
    expect(other.partition().active).toEqual(['dto']);
  });

  it('a whitelist entry in neither layer is unknown', () => {
    const host = baseRegistry('endpoint').consolidate(
      { entities: ['endpoint', 'ghost'] },
      overlayOf([mod('glossary')]),
    );
    expect(host.partition().unknown).toEqual(['ghost']);
  });
});

/**
 * Host API 2.0.0 — `mountBackend` runs NO migrations, so the two suites that
 * used to live here are gone rather than rewritten.
 *
 * They pinned real properties of a mechanism that no longer exists: that a
 * module's table was created BEFORE its `mount()` first queried it, that a
 * re-mount after ProjectContext dispose was idempotent, and that a broken
 * migration in a DEACTIVATED type did not fail the whole project build while the
 * same failure in an ACTIVE one did.
 *
 * Where each property went, so none of them is merely dropped:
 *   - "table exists before mount" is now structural. `applyProjection` runs at
 *     ProjectContext construction, before `mountBackend` and before
 *     `indexAll()`, over every AVAILABLE module. Covered by
 *     `upgrade-adoption.test.ts` ("a deactivated type keeps its (empty) table").
 *   - "idempotent across a re-mount" is now a property of the generator itself,
 *     which asks the database what it already has instead of consulting a
 *     ledger. Covered by `projection.golden.test.ts` and by
 *     `upgrade-adoption.test.ts` ("a second boot changes nothing further").
 *   - "a broken migration must not fail the build" has no analogue, because a
 *     schema that will not apply is no longer expressible. The generator only
 *     CREATEs and ADDs COLUMNs; a schema the host cannot project is rejected at
 *     REGISTRATION by `data-schema-validation.ts`, where the consequence is that
 *     one plugin does not load rather than that one project never builds.
 */

describe('buildMcpServers — one malformed plugin must not kill the turn', () => {
  /** A valid handle is the `{server, config}` shape `createMcpServer(...)` returns. */
  const validInstance = (name: string) => ({ server: { __name: name }, config: { type: 'sdk' } });

  function hostWith(factories: Record<string, () => unknown>) {
    const host = baseRegistry('endpoint').consolidate({});
    for (const [name, factory] of Object.entries(factories)) {
      host.registerMcpServer(name, factory as () => never);
    }
    return host;
  }

  function silenceWarn() {
    return vi.spyOn(console, 'warn').mockImplementation(() => {});
  }

  /**
   * Brief `0-2-35-to-next` item 3b. This is the ONE failure here that is fatal
   * rather than skipped, and the asymmetry is the point: a plugin that returns a
   * repeat instance does not merely lose its own tools — an McpServer binds to
   * exactly one transport, so the shared map goes dark for everyone, brief-tools
   * included, and the symptom is tool calls with no result at all.
   */
  it('throws, naming the plugin, when a factory returns an instance already returned', () => {
    const memoized = validInstance('memoizing-tools');
    const host = hostWith({
      'endpoint-tools': () => validInstance('endpoint-tools'),
      'memoizing-tools': () => memoized,
      'other-tools': () => memoized,
    });

    expect(() => host.buildMcpServers()).toThrow(/other-tools/);
    expect(() => host.buildMcpServers()).toThrow(/fresh/i);
  });

  it('lets two structurally identical handles through — identity is what matters', () => {
    // Two separate `createMcpServer` calls can look alike; only the same object
    // twice is the transport-binding hazard.
    const host = hostWith({
      'a-tools': () => ({ server: {}, config: { type: 'sdk' } }),
      'b-tools': () => ({ server: {}, config: { type: 'sdk' } }),
    });
    expect(host.buildMcpServers()).toHaveLength(2);
  });

  it('passes a well-formed McpServerInstance through untouched', () => {
    const instance = validInstance('ok-tools');
    const host = hostWith({ 'ok-tools': () => instance });
    expect(host.buildMcpServers()).toEqual([{ name: 'ok-tools', server: instance }]);
  });

  it('skips a hand-rolled `{name, version, tools}` descriptor and keeps the healthy servers', () => {
    // The exact shape `c4s-plugin-database-tables` returned: no `config`, so
    // `agent-turn` would have put `undefined` into the adapter's mcpServers map
    // and every turn in every project of the workspace died on `serverConfig.type`.
    const healthy = validInstance('endpoint-tools');
    const warn = silenceWarn();
    const host = hostWith({
      'database-table-tools': () => ({ name: 'database-table-tools', version: '1.0.0', tools: [] }),
      'endpoint-tools': () => healthy,
    });

    const built = host.buildMcpServers();

    // The invariant whose absence broke the whole workspace: a bad plugin
    // costs only its own tools.
    expect(built).toEqual([{ name: 'endpoint-tools', server: healthy }]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('database-table-tools'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('createMcpServer'));
    warn.mockRestore();
  });

  it('skips a factory returning undefined', () => {
    const warn = silenceWarn();
    const host = hostWith({ 'bad-tools': () => undefined });
    expect(host.buildMcpServers()).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('skips a throwing factory instead of failing the turn', () => {
    const healthy = validInstance('endpoint-tools');
    const warn = silenceWarn();
    const host = hostWith({
      'bad-tools': () => {
        throw new Error('boom');
      },
      'endpoint-tools': () => healthy,
    });

    let built: ReturnType<typeof host.buildMcpServers> = [];
    expect(() => {
      built = host.buildMcpServers();
    }).not.toThrow();
    expect(built).toEqual([{ name: 'endpoint-tools', server: healthy }]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
    warn.mockRestore();
  });

  it('auto-unwraps a pre-0.1.133 thunk (compat shim moved here from manifest-adapter)', () => {
    const instance = validInstance('legacy-tools');
    const warn = silenceWarn();
    const host = hostWith({ 'legacy-tools': () => () => instance });

    expect(host.buildMcpServers()).toEqual([{ name: 'legacy-tools', server: instance }]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('pre-0.1.133'));
    warn.mockRestore();
  });

  it('skips a thunk that unwraps to a malformed value', () => {
    const warn = silenceWarn();
    const host = hostWith({ 'legacy-bad-tools': () => () => ({ tools: [] }) });
    expect(host.buildMcpServers()).toEqual([]);
    warn.mockRestore();
  });
});
