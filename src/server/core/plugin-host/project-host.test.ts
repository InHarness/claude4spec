import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { PluginRegistryImpl } from './registry.js';
import type { BackendModule, MountContext, ProjectPluginOverlay, SqlMigration } from './types.js';

/** Minimal BackendModule for pool/activation assertions. */
function mod(type: string, displayOrder = 100): BackendModule {
  return {
    type,
    table: type,
    label: type,
    labelPlural: `${type}s`,
    displayOrder,
    slugFrom: (d: unknown) => String((d as { slug?: string }).slug ?? type),
    pathPrefix: `/${type}s`,
    serializer: {} as BackendModule['serializer'],
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

  it('a whitelist entry in neither layer is unknown', () => {
    const host = baseRegistry('endpoint').consolidate(
      { entities: ['endpoint', 'ghost'] },
      overlayOf([mod('glossary')]),
    );
    expect(host.partition().unknown).toEqual(['ghost']);
  });
});

describe('buildMcpServers — validates factory output (0.1.133 skew guard)', () => {
  it('returns the server when the factory yields a valid instance (has .config)', () => {
    const host = baseRegistry('endpoint').consolidate({});
    const instance = { config: { type: 'sdk' } } as never;
    host.registerMcpServer('endpoint-tools', () => instance);
    expect(host.buildMcpServers()).toEqual([{ name: 'endpoint-tools', server: instance }]);
  });

  it('throws an actionable error when a factory returns a bare thunk (stale/partial build skew)', () => {
    const host = baseRegistry('endpoint').consolidate({});
    // Pre-0.1.133 slot shape leaking through a mixed build: the factory yields
    // `() => instance` (a function) instead of the createMcpServer(...) handle.
    host.registerMcpServer('endpoint-tools', (() => () => ({ config: {} })) as never);
    expect(() => host.buildMcpServers()).toThrow(/invalid MCP server \(no \.config\)/);
    expect(() => host.buildMcpServers()).toThrow(/endpoint-tools/);
  });
});

describe('mountBackend — runs declared plugin migrations (L1/M13)', () => {
  const exampleMigrations: SqlMigration[] = [
    {
      version: 1,
      name: 'create_example_entity',
      up: 'CREATE TABLE IF NOT EXISTS example_entity (slug TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);',
    },
  ];

  /** A module whose mount() queries its own table — fails with "no such table" unless migrations ran first. */
  function modWithBackend(type: string, migrations: SqlMigration[]): BackendModule {
    return {
      ...mod(type),
      backend: {
        migrations,
        mount(ctx: MountContext) {
          // The original repro: the service queries the table at mount time.
          ctx.db.prepare(`SELECT slug, name FROM ${type}`).all();
        },
      },
    };
  }

  function activeHost(module: BackendModule) {
    const registry = new PluginRegistryImpl();
    registry.registerEntityModule(module);
    return registry.consolidate({ entities: [module.type] });
  }

  it('creates the plugin table before mount(), so the first query succeeds', () => {
    const db = new Database(':memory:');
    const host = activeHost(modWithBackend('example_entity', exampleMigrations));

    // Without the fix this throws SqliteError: no such table: example_entity.
    expect(() => host.mountBackend({ db } as unknown as MountContext)).not.toThrow();

    const ledger = db
      .prepare("SELECT plugin, version FROM plugin_schema_migrations WHERE plugin = 'example_entity'")
      .all();
    expect(ledger).toEqual([{ plugin: 'example_entity', version: 1 }]);
    db.close();
  });

  it('is idempotent across a re-mount (ProjectContext dispose + rebuild)', () => {
    const db = new Database(':memory:');
    const host = activeHost(modWithBackend('example_entity', exampleMigrations));

    host.mountBackend({ db } as unknown as MountContext);
    expect(() => host.mountBackend({ db } as unknown as MountContext)).not.toThrow();

    const count = db
      .prepare("SELECT COUNT(*) AS n FROM plugin_schema_migrations WHERE plugin = 'example_entity'")
      .get() as { n: number };
    expect(count.n).toBe(1);
    db.close();
  });
});
