import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../../tests/helpers/fixture-module.js';
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { PluginRegistryImpl } from './registry.js';
import { pluginHostRouter } from './cross-cutting.js';
import type { BackendModule, MountContext, ProjectPluginOverlay } from './types.js';
import { createMcpServer, mcpTool, z } from '../../plugin-runtime/index.js';

/** Minimal BackendModule for pool/activation assertions. */
function mod(type: string): BackendModule {
  return {
    type,
    data: FIXTURE_DATA,
    slugPattern: FIXTURE_SLUG_PATTERN,
    payloadVersion: 1,
    label: type,
    labelPlural: `${type}s`,
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
    listCommands: () => [],
    listSubagents: () => [],
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
    const baseEndpoint = mod('endpoint');
    const overlayEndpoint = mod('endpoint');
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
    // 2.1.26 — the identity carries no ordering field (the sidebar's default
    // order is the frontend's `sidebarTab.order`), so every set is listed by `type`:
    // registration order (endpoint, dto, ac) does not leak into the payload.
    expect(part).toEqual({
      active: ['ac', 'endpoint'],
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

  it('[ac:ac-config-entities-aktywuje-typ-ktorego] a whitelist entry no package loaded is unknown at activation — not a load error', () => {
    const registry = baseRegistry('endpoint');
    let host!: ReturnType<PluginRegistryImpl['consolidate']>;
    // Activation never throws over a type nobody contributed.
    expect(() => {
      host = registry.consolidate({ entities: ['endpoint', 'ghost'] }, overlayOf([mod('glossary')]));
    }).not.toThrow();
    expect(host.partition().unknown).toEqual(['ghost']);
    expect(host.partition().active).toEqual(['endpoint']);
    expect(host.isActive('ghost')).toBe(false);
    expect(host.getAvailable('ghost')).toBeNull();
    // Load and activate are disjoint axes: the loaded pool is untouched by the
    // whitelist, and the ghost leaves no trace in it.
    expect(registry.listAvailable().map((m) => m.type)).toEqual(['endpoint']);
  });

  it('[ac:ac-plugin-project-local-wnoszacy-type-obe] a project-local type present in the base shadows it — reported by the per-project /_meta/plugins with both origins, not an error', async () => {
    const baseEndpoint = mod('endpoint');
    const overlayEndpoint = mod('endpoint');
    const registry = new PluginRegistryImpl();
    registry.registerEntityModule(baseEndpoint);
    let host!: ReturnType<PluginRegistryImpl['consolidate']>;
    expect(() => {
      host = registry.consolidate({}, overlayOf([overlayEndpoint]));
    }).not.toThrow();
    // Project-local wins the effective pool.
    expect(host.getAvailable('endpoint')).toBe(overlayEndpoint);
    expect(host.partition().active).toEqual(['endpoint']);

    const app = express().use(
      pluginHostRouter({
        host,
        registry: {} as never,
        workspace: {} as never,
        projectId: 'p1',
        basePackages: [
          { package: '@acme/c4s-plugin-api', status: 'loaded', layer: 'base', contributedTypes: ['endpoint'] },
        ],
        overlayRecords: [
          {
            package: 'endpoint-pkg',
            status: 'loaded',
            layer: 'overlay',
            trust: 'trusted',
            contributedTypes: ['endpoint'],
            origin: '.claude4spec/plugins/endpoint-pkg',
          },
        ],
        localPluginsPresent: true,
        trust: true,
      }),
    );
    const res = await request(app).get('/_meta/plugins');
    expect(res.status).toBe(200);
    expect(res.body.types).toEqual([
      {
        type: 'endpoint',
        state: 'shadowed',
        origin: { base: '@acme/c4s-plugin-api', overlay: '.claude4spec/plugins/endpoint-pkg' },
      },
    ]);
    // Both packages stay loaded — shadowing is a report, not a rejection.
    expect((res.body.packages as Array<{ status: string }>).map((p) => p.status)).toEqual(['loaded', 'loaded']);
  });

  it('[section:z7l89jhf] the host exposes no plugin settings list — no listSettings() and no /_meta/plugin-settings route', async () => {
    const registry = new PluginRegistryImpl();
    registry.registerPlugin({
      name: '@acme/c4s-plugin-cmds',
      version: '1.0.0',
      hostApiVersion: '^2.0.0',
      contributes: { commands: [{ name: 'x-insert', trigger: 'x', label: 'Insert X', popoverKind: 'x' }] },
    });
    const host = registry.consolidate({});
    expect('listSettings' in host).toBe(false);

    const app = express().use(
      pluginHostRouter({
        host,
        registry: {} as never,
        workspace: {} as never,
        projectId: 'p1',
        basePackages: [],
        overlayRecords: [],
        localPluginsPresent: false,
        trust: undefined,
      }),
    );
    expect((await request(app).get('/_meta/plugin-settings')).status).toBe(404);
    // The sibling channel that stays is still served.
    const commands = await request(app).get('/_meta/plugin-commands');
    expect(commands.status).toBe(200);
    expect((commands.body.commands as Array<{ trigger: string }>).map((c) => c.trigger)).toEqual(['x']);
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

    // Fatal only on the MOUNT path. The external read surface composes from the
    // same method, never connects the handles, and runs where a throw would take
    // the process down — so there it degrades to a warning, as everything else
    // in this method does.
    expect(() => host.buildMcpServers({ strict: true })).toThrow(/other-tools/);
    expect(() => host.buildMcpServers({ strict: true })).toThrow(/fresh/i);

    const warn = silenceWarn();
    expect(host.buildMcpServers().map((e) => e.name)).toEqual(['endpoint-tools', 'memoizing-tools']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('other-tools'));
    warn.mockRestore();
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

  it('refuses a server registered under a key the Claude Code CLI reserves', () => {
    const host = baseRegistry('endpoint').consolidate({});
    expect(() => host.registerMcpServer('workspace', () => validInstance('workspace') as never)).toThrow(
      /"workspace" is reserved/,
    );
    expect(host.buildMcpServers()).toEqual([]);
  });

  it('[section:3f5ej79s] `include` selects by name BEFORE a factory runs — a rejected server is never built', () => {
    const calls: string[] = [];
    const host = hostWith({
      'entity-tools': () => (calls.push('entity-tools'), validInstance('entity-tools')),
      'release-tools': () => (calls.push('release-tools'), validInstance('release-tools')),
    });
    const built = host.buildMcpServers({ include: (name) => name === 'release-tools' });
    expect(built.map((e) => e.name)).toEqual(['release-tools']);
    expect(calls).toEqual(['release-tools']);
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

/**
 * 2.1.57 (M13 `z7l89jhf` `mcpServer?`, M33 `m33load01` (d)) — the pool refuses,
 * at plugin load, a tool name declared twice in one `${type}-tools` server and a
 * server name already registered, with `PLUGIN_TOOL_CONFLICT` on the model of
 * `PLUGIN_TYPE_CONFLICT`. Neither the silent factory overwrite nor the silent
 * per-turn drop of the whole server survives.
 */
describe('[section:m33load01] PLUGIN_TOOL_CONFLICT — tool server refusals at plugin load', () => {
  const tool = (name: string) => mcpTool(name, `${name} tool`, { q: z.string() }, async () => ({ content: [] }));

  /** A module carrying the declarative `backend.mcpServer` slot (lowered by `registerEntityModule`). */
  function modWithServer(type: string, toolNames: string[]): BackendModule {
    return {
      ...mod(type),
      backend: {
        mcpServer: () => createMcpServer({ name: `${type}-tools`, tools: toolNames.map(tool) }),
      },
    };
  }

  /** A module writing `mount` by hand and registering a server under a name of its choosing. */
  function modMounting(type: string, serverName: string): BackendModule {
    return {
      ...mod(type),
      backend: {
        mount: (ctx: MountContext) =>
          ctx.registerMcpServer(serverName, () => createMcpServer({ name: serverName, tools: [tool(`${type}_op`)] })),
      },
    };
  }

  function mountCtx(host: { registerMcpServer: MountContext['registerMcpServer'] }): MountContext {
    return { registerMcpServer: (name, factory) => host.registerMcpServer(name, factory) } as MountContext;
  }

  it('[section:m33load01] the facade refuses a tool name declared twice in one server with PLUGIN_TOOL_CONFLICT', () => {
    expect(() => createMcpServer({ name: 'glossary-tools', tools: [tool('lookup'), tool('lookup')] })).toThrow(
      /PLUGIN_TOOL_CONFLICT.*"lookup".*twice/,
    );
    try {
      createMcpServer({ name: 'glossary-tools', tools: [tool('lookup'), tool('lookup')] });
    } catch (err) {
      expect((err as { code?: string }).code).toBe('PLUGIN_TOOL_CONFLICT');
    }
  });

  it('[section:m33load01] mounting a plugin whose tool server declares a tool twice is refused at load, naming the server', () => {
    const registry = new PluginRegistryImpl();
    registry.registerEntityModule(modWithServer('glossary', ['lookup', 'lookup']));
    const host = registry.consolidate({});
    let caught: unknown;
    try {
      host.mountBackend(mountCtx(host));
    } catch (err) {
      caught = err;
    }
    expect((caught as { code?: string }).code).toBe('PLUGIN_TOOL_CONFLICT');
    expect((caught as Error).message).toMatch(/MCP server "glossary-tools"/);
    expect((caught as Error).message).toMatch(/"lookup" is declared twice/);
  });

  it('[section:m33load01] a second server under a name already in the pool is refused, and the first factory is kept', () => {
    const host = baseRegistry('endpoint').consolidate({});
    const first = () => createMcpServer({ name: 'shared-tools', tools: [tool('a')] });
    host.registerMcpServer('shared-tools', first);
    let caught: unknown;
    try {
      host.registerMcpServer('shared-tools', () => createMcpServer({ name: 'shared-tools', tools: [tool('b')] }));
    } catch (err) {
      caught = err;
    }
    expect((caught as { code?: string }).code).toBe('PLUGIN_TOOL_CONFLICT');
    expect((caught as Error).message).toMatch(/"shared-tools" is already registered/);
    // No silent overwrite: the pool still builds the FIRST server.
    const built = host.buildMcpServers();
    expect(built.map((e) => e.name)).toEqual(['shared-tools']);
    expect((built[0]!.server as { tools?: Array<{ name: string }> }).tools?.map((t) => t.name)).toEqual(['a']);
  });

  it('[section:m33load01] two plugins mounting a server under the same name — the second is refused at load', () => {
    const registry = new PluginRegistryImpl();
    registry.registerEntityModule(modMounting('alpha', 'shared-tools'));
    registry.registerEntityModule(modMounting('beta', 'shared-tools'));
    const host = registry.consolidate({});
    expect(() => host.mountBackend(mountCtx(host))).toThrow(/PLUGIN_TOOL_CONFLICT.*"shared-tools"/);
  });

  it('[section:m33load01] distinct tool and server names load, and every other factory failure keeps its per-turn posture', () => {
    const registry = new PluginRegistryImpl();
    registry.registerEntityModule(modWithServer('glossary', ['lookup', 'define']));
    registry.registerEntityModule({
      ...mod('broken'),
      backend: {
        mcpServer: () => {
          throw new Error('boom');
        },
      },
    });
    const host = registry.consolidate({});
    expect(() => host.mountBackend(mountCtx(host))).not.toThrow();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const built = host.buildMcpServers();
    expect(built.map((e) => e.name)).toEqual(['glossary-tools']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
    warn.mockRestore();
  });
});
