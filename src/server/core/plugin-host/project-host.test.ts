import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
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

/**
 * Deactivating a type must remain the way out of a plugin that cannot migrate.
 *
 * 0.2.2 migrates every AVAILABLE module, not just the active ones, so a
 * deactivated type keeps its (empty) table — see `upgrade-adoption.test.ts`.
 * That change also removed an operator's only recovery: before it, dropping a
 * type from `config.entities` meant its migrations were never consulted. After
 * it, a third-party plugin whose SQL will not apply against THIS project's data
 * threw out of `mountBackend` regardless, and M31 turned that into a permanent
 * `PROJECT_BUILD_FAILED` — every request 500, no configuration able to clear it
 * short of uninstalling the package.
 *
 * So the isolation is asymmetric on purpose, and both halves are pinned here.
 */
describe('mountBackend — a broken migration in a DEACTIVATED type', () => {
  const broken: SqlMigration[] = [
    { version: 1, name: 'not_sql', up: 'CREATE TABLE ( this is not valid sql' },
  ];
  const fine: SqlMigration[] = [
    { version: 1, name: 'create_good', up: 'CREATE TABLE IF NOT EXISTS good (slug TEXT PRIMARY KEY);' },
  ];

  function hostWith(config: { entities?: string[] } | null) {
    const registry = new PluginRegistryImpl();
    registry.registerEntityModule({ ...mod('good'), backend: { migrations: fine } });
    registry.registerEntityModule({ ...mod('rotten'), backend: { migrations: broken } });
    return registry.consolidate(config);
  }

  it('does not fail the project build, and the rest of the schema still applies', () => {
    const db = new Database(':memory:');
    const host = hostWith({ entities: ['good'] });

    expect(() => host.mountBackend({ db } as unknown as MountContext)).not.toThrow();

    // The healthy type is unaffected — isolation, not a blanket try/catch
    // around the whole pass.
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(tables).toContain('good');
    db.close();
  });

  it('still fails the build when the SAME type is ACTIVE', () => {
    // An active type's schema is load-bearing: serving it with no table fails
    // later and more confusingly than failing here.
    const db = new Database(':memory:');
    const host = hostWith({ entities: ['good', 'rotten'] });

    expect(() => host.mountBackend({ db } as unknown as MountContext)).toThrow();
    db.close();
  });
});

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
