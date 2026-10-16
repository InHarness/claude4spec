import { describe, expect, it } from 'vitest';
import { SkillRegistry, SkillResolver } from '../services/skill-registry.js';
import {
  __invalidateSurfaceCache,
  buildExternalMcpSurface,
  composeExternalSurface,
  EXTERNAL_MCP_ERROR_CODES,
  EXTERNAL_MCP_SERVER_NAME,
  RETIRED_EXTERNAL_MCP_ERROR_CODES,
  type ExternalSurfaceDeps,
} from './surface.js';
import { buildPlanToolsServer } from './plan-tools.js';
import { createMcpServer, mcpTool } from '../plugin-runtime/index.js';
import { toolAdmittedByProfile } from '../operations/profile-gate.js';
import { CATALOG } from '../operations/catalog.js';
import { isMcpChannelProfile, MCP_CHANNEL_PROFILE_NAMES, MCP_CHANNEL_PROFILES } from '../operations/profiles.js';
import { C4S_READER_TOOL_NAMES, createC4sReaderServer } from './c4s-reader.js';
import { createReferenceToolsServer, type ReferenceToolsDeps } from './reference-tools.js';
import { DiscoveryError } from '../discovery/errors.js';
import { READ_TOOL_RECORDS } from '../../../tests/helpers/read-tool-records.js';
import { MCP_CONFIG_SERVER_KEY } from './mcp-config.js';
import { profileFromRequest } from './http-mount.js';
import type { McpServerFactory } from '../../shared/plugin-host/mcp.js';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

/**
 * 0.2.13 §3/§4 — composition of the external surface, isolated from transport.
 *
 * These use a stub plugin host rather than the full harness: the claims under
 * test are about which SERVERS a profile contributes and how their tools merge,
 * and a real host would drown that in the fifteen reads.
 */
function stubDeps(overrides: Partial<ExternalSurfaceDeps> = {}): ExternalSurfaceDeps {
  const servers: Array<{ name: string; server: McpServerFactory }> = [];
  const host = {
    buildMcpServers: () => servers,
    listEntities: () => [{ type: 'spreadsheet' }],
  } as unknown as ExternalSurfaceDeps['pluginHost'];
  return {
    profile: 'chat',
    // `createC4sReaderServer` tolerates a null project — every tool then answers
    // PROJECT_NOT_FOUND — which is exactly the degenerate case wanted here: the
    // fifteen names are declared, no db is touched.
    reader: { reader: null, discovery: null, db: null, projectDir: null, packageVersion: '0.0.0' },
    pluginHost: host,
    planService: {} as ExternalSurfaceDeps['planService'],
    pageVersions: {} as ExternalSurfaceDeps['pageVersions'],
    briefService: {} as ExternalSurfaceDeps['briefService'],
    listProjects: () => ({ projects: [] }),
    workspaceName: 'default',
    skillRegistry: SkillRegistry.load([]),
    skillResolver: new SkillResolver(SkillRegistry.load([]), '/tmp/nonexistent-project'),
    projectId: 'proj-test',
    ...overrides,
  };
}

function pluginHostWith(entries: Array<{ name: string; tools: string[] }>, types: string[]) {
  const servers = entries.map(({ name, tools }) => ({
    name,
    server: createMcpServer({
      name,
      tools: tools.map((t) => mcpTool(t, `${t} description`, { x: z.string().optional() }, async () => ({ content: [] }))),
    }) as unknown as McpServerFactory,
  }));
  return {
    buildMcpServers: () => servers,
    listEntities: () => types.map((type) => ({ type })),
  } as unknown as ExternalSurfaceDeps['pluginHost'];
}

describe('composeExternalSurface', () => {
  it('keeps the misleading name deliberately', () => {
    // Recorded so a future reader does not "fix" it: the surface is no longer
    // read-only, and the name is not a statement about a connection's scope.
    expect(EXTERNAL_MCP_SERVER_NAME).toBe('c4s-reader');
  });

  it('renders the fifteen M39 reads as the backbone', () => {
    const names = composeExternalSurface(stubDeps()).toolNames;
    for (const op of [
      'overview',
      'describe_types',
      'list_pages',
      'get_page_outline',
      'get_sections',
      'get_page',
      'search_pages',
      'search_entities',
      'list_entities',
      'get_entities',
      'get_field_content',
      'list_tags',
      'find_references',
      'check_consistency',
      'resolve_identity',
    ]) {
      expect(names).toContain(op);
    }
  });

  it('collapses a name that two servers render to one row', () => {
    // `find_references` genuinely lives on c4s-reader AND reference-tools. They
    // are two renderings of one catalog operation, so the merge must produce one
    // tool — not two, and not a suffixed pair.
    const surface = composeExternalSurface(
      stubDeps({ pluginHost: pluginHostWith([{ name: 'reference-tools', tools: ['find_references'] }], []) }),
    );
    expect(surface.toolNames.filter((n) => n === 'find_references')).toHaveLength(1);
    expect(new Set(surface.toolNames).size).toBe(surface.toolNames.length);
  });

  it('never contributes transagent-tools, on any profile', () => {
    // Absent by construction, not by policy: its dispatcher needs AgentTurnDeps
    // and a live parent thread, and a connection is not a turn.
    for (const profile of ['chat', 'patch', 'ask', 'brief'] as const) {
      const names = composeExternalSurface(stubDeps({ profile })).toolNames;
      expect(names).not.toContain('spawn_transagent');
      expect(names.some((n) => n.includes('transagent'))).toBe(false);
    }
  });

  it('mounts list_projects for every profile, including the narrow ones', () => {
    // Workspace discovery must not inherit the recursion guard of `ask`, nor the
    // release-only narrowing of `brief`: without it a project-bound external
    // caller cannot learn what to address.
    for (const profile of ['chat', 'patch', 'ask', 'brief'] as const) {
      expect(composeExternalSurface(stubDeps({ profile })).toolNames).toContain('list_projects');
    }
  });

  it('[0.2.99] mounts list_skills and load_skill_file for every profile', () => {
    // Both are read-class, so the default (`chat`) connection AND `brief` — whose
    // methodology lives in a subfile of the writing style — see both.
    for (const profile of ['chat', 'patch', 'ask', 'brief'] as const) {
      const surface = composeExternalSurface(stubDeps({ profile }));
      expect(surface.toolNames).toContain('list_skills');
      expect(surface.toolNames).toContain('load_skill_file');
      expect(surface.byName.get('list_skills')?.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true });
    }
  });

  /**
   * 2.1.17 — the builder's own label (`skill-tools`) is internal; what a caller from
   * outside sees is the composed server, and that one is named `c4s-reader` — the
   * value the `server` field of both external skill entities carries.
   */
  it('[entity:c4s-reader-list-skills] [entity:c4s-reader-load-skill-file] both skill tools are seen on the wire under the server name c4s-reader, not the builder label skill-tools', async () => {
    const server = buildExternalMcpSurface(stubDeps());
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      expect(client.getServerVersion()?.name).toBe('c4s-reader');
      expect(client.getServerVersion()?.name).not.toBe('skill-tools');
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain('list_skills');
      expect(names).toContain('load_skill_file');
    } finally {
      await client.close();
    }
  });

  /**
   * 2.1.20 — the facade `mcpTool` takes optional annotations (fifth argument,
   * C4S-owned shape). A plugin that passes them through `@c4s/plugin-runtime`
   * sees them advertised beside THAT tool in the external `tools/list` — and only
   * beside it: a sibling tool built without annotations carries none.
   */
  it('[ac:ac-adnotacje-podane-przez-plugin-w-fasad] annotations a plugin passes to the mcpTool facade appear beside that tool in the external tools/list', async () => {
    const annotations = {
      title: 'Read the overview',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    };
    const pluginServer = createMcpServer({
      name: 'spreadsheet-tools',
      tools: [
        mcpTool('annotated_op', 'annotated description', { x: z.string().optional() }, async () => ({ content: [] }), annotations),
        mcpTool('plain_op', 'plain description', { x: z.string().optional() }, async () => ({ content: [] })),
      ],
    }) as unknown as McpServerFactory;
    const pluginHost = {
      buildMcpServers: () => [{ name: 'spreadsheet-tools', server: pluginServer }],
      listEntities: () => [{ type: 'spreadsheet' }],
    } as unknown as ExternalSurfaceDeps['pluginHost'];
    const deps = stubDeps({ profile: 'chat', pluginHost });

    // The declaration the HTTP mount registers from carries them…
    expect(composeExternalSurface(deps).byName.get('annotated_op')?.annotations).toEqual(annotations);

    // …and a client reading `tools/list` over the wire sees them on that tool.
    const server = buildExternalMcpSurface(deps);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const { tools } = await client.listTools();
      const annotated = tools.find((t) => t.name === 'annotated_op');
      expect(annotated).toBeDefined();
      expect(annotated!.annotations).toMatchObject(annotations);
      const plain = tools.find((t) => t.name === 'plain_op');
      expect(plain).toBeDefined();
      expect(plain!.annotations?.readOnlyHint).toBeUndefined();
      expect(plain!.annotations?.title).toBeUndefined();
    } finally {
      await client.close();
    }
  });

  it('gives `ask` the peer tool to nobody — a consulted peer cannot consult onward', () => {
    expect(composeExternalSurface(stubDeps({ profile: 'chat' })).toolNames).toContain('ask');
    expect(composeExternalSurface(stubDeps({ profile: 'ask' })).toolNames).not.toContain('ask');
    expect(composeExternalSurface(stubDeps({ profile: 'brief' })).toolNames).not.toContain('ask');
  });

  describe('a plugin server fails CLOSED for a profile that admits no writes', () => {
    const withPlugin = (profile: ExternalSurfaceDeps['profile']) =>
      composeExternalSurface(
        stubDeps({
          profile,
          pluginHost: pluginHostWith(
            // `get_overview`/`set_cell` are catalogued; `undeclared_op` is what a
            // plugin written tomorrow contributes.
            [{ name: 'spreadsheet-tools', tools: ['get_overview', 'set_cell', 'undeclared_op'] }],
            ['spreadsheet'],
          ),
        }),
      ).toolNames;

    it('admits a catalogued plugin READ to `ask`', () => {
      expect(withPlugin('ask')).toContain('get_overview');
    });

    it('withholds a catalogued plugin WRITE from `ask`', () => {
      expect(withPlugin('ask')).not.toContain('set_cell');
    });

    it('withholds an UNDECLARED plugin tool from `ask` rather than guessing it is a read', () => {
      // The whole asymmetry: on a surface this repo owns, an omission is a gap
      // someone can see; on a plugin's, an omission is a hole.
      expect(withPlugin('ask')).not.toContain('undeclared_op');
      // …and `chat`, which admits writes, still sees all three.
      expect(withPlugin('chat')).toContain('undeclared_op');
      expect(withPlugin('chat')).toContain('set_cell');
    });
  });

  it('narrows `brief` to the release-tools whitelist', () => {
    const names = composeExternalSurface(
      stubDeps({
        profile: 'brief',
        pluginHost: pluginHostWith(
          [
            { name: 'release-tools', tools: ['release_diff'] },
            { name: 'spreadsheet-tools', tools: ['get_overview'] },
          ],
          ['spreadsheet'],
        ),
      }),
    ).toolNames;
    expect(names).toContain('release_diff');
    expect(names).not.toContain('get_overview');
  });

  it('states the error codes it produces, and the ones 0.2.13 retired', () => {
    expect(EXTERNAL_MCP_ERROR_CODES).toContain('PROJECT_NOT_IN_WORKSPACE');
    expect(EXTERNAL_MCP_ERROR_CODES).toContain('PROJECT_BUILD_FAILED');
    for (const gone of RETIRED_EXTERNAL_MCP_ERROR_CODES) {
      expect(EXTERNAL_MCP_ERROR_CODES).not.toContain(gone);
    }
    expect(RETIRED_EXTERNAL_MCP_ERROR_CODES).toEqual([
      'AMBIGUOUS_WORKSPACE',
      'INDEX_NOT_MATERIALIZED',
      'SCHEMA_OUT_OF_DATE',
    ]);
  });
});

/**
 * Composition is memoized on the plugin host's identity.
 *
 * The mount recomposes before every request — that is what makes lazy rebuild
 * work — and composing costs ~5.7 ms, which on every `tools/call` is waste when
 * nothing changed. These pin that the cache does not buy speed by giving up the
 * rebuild it exists alongside.
 */
describe('surface memoization', () => {
  it('returns the same surface for the same host and profile', () => {
    const deps = stubDeps();
    // Fresh deps objects, same host — a caller builds a new deps record per
    // request, so identity of THAT object must not be what the cache keys on.
    expect(composeExternalSurface(deps)).toBe(composeExternalSurface({ ...deps }));
  });

  it('keeps profiles apart — the cache must not leak a wider surface into a narrower one', () => {
    const host = pluginHostWith([{ name: 'spreadsheet-tools', tools: ['set_cell'] }], ['spreadsheet']);
    const chat = composeExternalSurface(stubDeps({ profile: 'chat', pluginHost: host }));
    const ask = composeExternalSurface(stubDeps({ profile: 'ask', pluginHost: host }));
    expect(chat.toolNames).toContain('set_cell');
    expect(ask.toolNames).not.toContain('set_cell');
  });

  it('recomposes for a NEW host — a rebuilt context is a changed pool', () => {
    // A plugin activated or deactivated invalidates the ProjectContext, which
    // builds a new host. That is the whole reason the host is the key.
    const before = composeExternalSurface(
      stubDeps({ pluginHost: pluginHostWith([{ name: 'a-tools', tools: ['get_overview'] }], ['a']) }),
    );
    const after = composeExternalSurface(
      stubDeps({ pluginHost: pluginHostWith([], []) }),
    );
    expect(before.toolNames).toContain('get_overview');
    expect(after.toolNames).not.toContain('get_overview');
  });

  /**
   * Brief `0-2-35-to-next` item 3c. The memoized declarations carry HANDLERS,
   * and those close over the services captured on the FIRST compose. "A config
   * change builds a new host" describes one way the context is rebuilt, not all
   * of them — rebuild it without a config change and the host key survives while
   * `briefService` is replaced, leaving cached handlers writing through a
   * service that belongs to a disposed context.
   */
  it('recomposes when briefService is replaced under the SAME host', async () => {
    const host = pluginHostWith([], []);
    const dead = {
      getBrief: async () => ({ path: 'b.md', body: 'dead', hash: 'h', frontmatter: {} }),
    } as unknown as ExternalSurfaceDeps['briefService'];
    const live = {
      getBrief: async () => ({ path: 'b.md', body: 'live', hash: 'h', frontmatter: {} }),
    } as unknown as ExternalSurfaceDeps['briefService'];

    // `brief` is the profile that mounts brief-tools at all.
    const first = composeExternalSurface(
      stubDeps({ profile: 'brief', pluginHost: host, briefService: dead }),
    );
    const second = composeExternalSurface(
      stubDeps({ profile: 'brief', pluginHost: host, briefService: live }),
    );

    expect(second).not.toBe(first);

    // Identity of the surface is the cheap half; what matters is that the
    // handler reaches the CURRENT service, not the first composition's.
    const getBrief = second.byName.get('get_brief');
    expect(getBrief).toBeDefined();
    const out = JSON.stringify(await getBrief!.handler({ path: 'b.md' }, {}));
    expect(out).toContain('live');
    expect(out).not.toContain('dead');
  });

  it('still hits the cache when the same briefService comes back', () => {
    const host = pluginHostWith([], []);
    const briefService = {} as ExternalSurfaceDeps['briefService'];
    const first = composeExternalSurface(stubDeps({ pluginHost: host, briefService }));
    const second = composeExternalSurface(stubDeps({ pluginHost: host, briefService }));
    expect(second).toBe(first);
  });

  it('is dropped by the test seam, so a recomposition can be exercised', () => {
    const host = pluginHostWith([], []);
    const first = composeExternalSurface(stubDeps({ pluginHost: host }));
    __invalidateSurfaceCache(host);
    const second = composeExternalSurface(stubDeps({ pluginHost: host }));
    expect(second).not.toBe(first);
    expect(second.toolNames).toEqual(first.toolNames);
  });
});

/**
 * A plugin must not be able to take a host operation's NAME.
 *
 * The merge is first-wins over one flat namespace, and the gate classifies by
 * name. Together those made a plugin tool called `update_plan` both shadow the
 * host operation AND inherit its catalog class — so its own mutating handler was
 * admitted to the read-only `ask` profile.
 */
/**
 * 2.1.27 (M13 `v0v4ku5d`) — every rendering reads one registry. The host builds
 * the `{type}-tools` server from the type's registry; the `internal` channel
 * mounts it in the turn and the `mcp` channel merges it straight into the
 * external surface beside the other source servers — the same tool schema in
 * both, and no generic proxy tool on the `mcp` channel in any posture.
 */
describe('[section:v0v4ku5d] mcp channel: {type}-tools merged directly, no generic proxy', () => {
  const PROXY_TOOL_NAMES = ['list_plugin_tools', 'call_plugin_tool', 'list_type_tools', 'call_type_tool'];

  it('[section:v0v4ku5d] the {type}-tools server the host builds is merged into the external surface with the very declaration (same input schema) the internal mount gets, and no generic proxy tool exists in any profile', () => {
    const linkShape = {
      endpointSlug: z.string(),
      dtoSlug: z.string(),
      relation: z.enum(['request', 'response', 'error']),
      statusCode: z.number().optional(),
    };
    const endpointTools = createMcpServer({
      name: 'endpoint-tools',
      tools: [
        mcpTool('link_dto', 'link', linkShape, async () => ({ content: [] })),
        mcpTool('unlink_dto', 'unlink', linkShape, async () => ({ content: [] })),
      ],
    });
    const entry = { name: 'endpoint-tools', server: endpointTools as unknown as McpServerFactory };
    const host = {
      buildMcpServers: () => [entry],
      listEntities: () => [{ type: 'endpoint' }],
    } as unknown as ExternalSurfaceDeps['pluginHost'];

    // The internal channel mounts what `buildMcpServers()` returns; the mcp
    // channel composes from the same call — one registry, one declaration.
    const internalDecl = endpointTools.tools!.find((t) => t.name === 'link_dto')!;
    const surface = composeExternalSurface(stubDeps({ profile: 'chat', pluginHost: host }));
    const external = surface.byName.get('link_dto');
    expect(external).toBe(internalDecl);
    expect(Object.keys(external!.inputSchema).sort()).toEqual(['dtoSlug', 'endpointSlug', 'relation', 'statusCode']);
    expect(surface.toolNames).toContain('unlink_dto');

    // Without a generic proxy: every profile of the closed table, every posture
    // (project-bound and workspace-bound mounts compose through this same call).
    for (const profile of MCP_CHANNEL_PROFILE_NAMES) {
      __invalidateSurfaceCache(host);
      const names = composeExternalSurface(stubDeps({ profile, pluginHost: host })).toolNames;
      for (const proxy of PROXY_TOOL_NAMES) expect(names, `${profile}: ${proxy}`).not.toContain(proxy);
    }
  });
});

describe('plugin tools cannot shadow host operations', () => {
  const hostileHost = () =>
    pluginHostWith(
      [{ name: 'spreadsheet-tools', tools: ['list_projects', 'update_plan', 'update_brief', 'get_overview'] }],
      ['spreadsheet'],
    );

  it('the host owns the name on the merged surface', () => {
    const surface = composeExternalSurface(stubDeps({ profile: 'chat', pluginHost: hostileHost() }));
    // Only one row per name, and it must be the host's — a caller asking for
    // `list_projects` to discover a project must not get plugin data.
    expect(surface.toolNames.filter((n) => n === 'list_projects')).toHaveLength(1);
    expect(surface.byName.get('list_projects')!.description).toContain('workspace');
  });

  it('the surviving `update_plan` under `ask` is the host tool, not the plugin one', () => {
    // `ask` admits the `plan` class and mounts plan-tools, so the NAME is present
    // either way — only provenance distinguishes the fix. The stub plugin's
    // descriptions are generated as `<name> description`; the host's are prose.
    const surface = composeExternalSurface(stubDeps({ profile: 'ask', pluginHost: hostileHost() }));
    const decl = surface.byName.get('update_plan');
    expect(decl).toBeDefined();
    expect(decl!.description).not.toBe('update_plan description');
    expect(surface.toolNames.filter((n) => n === 'update_plan')).toHaveLength(1);
  });

  it('a catalogued PLUGIN read still reaches `ask`', () => {
    // The narrowing must not cost the type-specific reads their reachability —
    // that is what `contributedBy: 'plugin'` on those declarations is for.
    const names = composeExternalSurface(stubDeps({ profile: 'ask', pluginHost: hostileHost() })).toolNames;
    expect(names).toContain('get_overview');
  });

  it('a host declaration does not vouch for a plugin tool of the same name', () => {
    /**
     * The decisive assertion for `contributedBy`, at the gate rather than the
     * surface — because with host-first ordering the two defences overlap and
     * the merged NAME looks identical either way.
     *
     * `ask` admits the `plan` class, so a plugin tool called `update_plan` was
     * looked up, found as class `plan`, and admitted — its own mutating handler
     * on a connection built to be unable to mutate. Same name, two provenances,
     * two answers.
     */
    expect(toolAdmittedByProfile('ask', 'update_plan', { plugin: false })).toBe(true);
    expect(toolAdmittedByProfile('ask', 'update_plan', { plugin: true })).toBe(false);
    // Symmetrically, a plugin-contributed declaration is honoured for a plugin
    // server — the narrowing must not cost the type-specific reads their reach.
    expect(toolAdmittedByProfile('ask', 'get_overview', { plugin: true })).toBe(true);
    // …and does not vouch for a HOST server's tool of that name either.
    expect(toolAdmittedByProfile('ask', 'get_overview', { plugin: false })).toBe(true);
  });
});

/**
 * 0.2.13 review fix — the external mount addresses a plan by PATH.
 *
 * `plan-tools` was mounted with `threadId: 'mcp-external'`, a value the comment
 * beside it called a provenance stamp. `PlanService.update` used it to ADDRESS
 * the plan, so it resolved to nothing, took the create branch, wrote a plan file
 * and a version row, and then threw NOT_FOUND attaching it to a thread that does
 * not exist. Reachable from the MCP config entry claude4spec generates, i.e. from
 * every editor an upgrading user opens — and each retry left another orphan.
 */
describe('plan addressing on the threadless channel', () => {
  it('takes an explicit `path`, and offers a way to discover one', () => {
    const surface = composeExternalSurface(stubDeps({ profile: 'ask' }));

    /**
     * EVERY plan tool on this mount, enumerated from the server rather than
     * listed by hand.
     *
     * The first version of this test named `get_plan` and `update_plan` — the two
     * the fix had touched — so it could only ever confirm the fix, never find
     * what the fix missed. It missed `list_plan_versions` and `get_plan_version`,
     * which kept resolving through `getByThread('mcp-external')`: no such thread
     * row, so history came back as `{ versions: [], total: 0 }` for a plan with a
     * hundred versions, and neither tool exposed a `path` that could have made it
     * work. A test written from the diff sees what the diff did.
     */
    const planTools = buildPlanToolsServer({
      threadId: 'mcp-external',
      target: 'explicit',
      planService: {} as never,
      pageVersions: {} as never,
    }).tools!.map((t) => t.name);
    // 0.2.98 — `create_plan` is excluded for the opposite reason to `list_plans`:
    // it addresses no EXISTING plan, so it has no `path` to take (it returns one).
    const addressAPlan = planTools.filter((n) => n !== 'list_plans' && n !== 'create_plan');
    expect(planTools).toContain('create_plan');
    expect(Object.keys(surface.byName.get('create_plan')!.inputSchema as Record<string, unknown>)).not.toContain('path');
    expect(addressAPlan.length).toBeGreaterThan(2);

    for (const name of addressAPlan) {
      const decl = surface.byName.get(name);
      expect(decl, name).toBeDefined();
      // The parameter has to be in the SCHEMA — a handler-side check would leave
      // the model unaware it must supply one.
      expect(Object.keys(decl!.inputSchema as Record<string, unknown>), name).toContain('path');
    }

    /**
     * And `path` must be obtainable. A required parameter no operation can
     * produce a value for is the same unreachable-contract shape as an
     * `expectedHash` that no read returns — which is the other finding from this
     * same review.
     */
    expect(surface.toolNames).toContain('list_plans');
  });

  it('the INTERNAL channel keeps its implicit, thread-bound plan', () => {
    // 2.1.13 — M10 declares thread isolation, so the internal `path` is absent
    // (not optional): an agent reaches only the plan pinned to its thread.
    const internal = buildPlanToolsServer({
      threadId: 't-1',
      planService: {} as never,
      pageVersions: {} as never,
    });
    const names = internal.tools!.map((t) => t.name);
    expect(names).not.toContain('list_plans');
    for (const t of internal.tools!) {
      expect(Object.keys(t.inputSchema as Record<string, unknown>), t.name).not.toContain('path');
    }
  });

  it('the version tools READ the plan the path names, not the one a thread would', async () => {
    /**
     * The schema check above proves `path` is asked for; this proves it is used.
     * Both halves are needed — the defect was a tool that took no `path` AND
     * resolved through a thread, and either half alone leaves the other possible.
     */
    const calls: string[] = [];
    const planService = {
      getByAddress: async (p: string) => {
        calls.push(p);
        return { path: p, currentVersion: 2 };
      },
      getByThread: async () => {
        throw new Error('getByThread must not be reached on the threadless mount');
      },
    };
    const pageVersions = {
      listVersions: () => [{ version: 1 }, { version: 2 }],
      getVersion: (_p: string, v: number) => ({ version: v, content: 'x' }),
    };
    const server = buildPlanToolsServer({
      threadId: 'mcp-external',
      target: 'explicit',
      planService: planService as never,
      pageVersions: pageVersions as never,
    });

    const call = async (name: string, args: Record<string, unknown>) => {
      const tool = server.tools!.find((t) => t.name === name)!;
      const res = (await tool.handler(args, {} as never)) as {
        isError?: boolean;
        content: Array<{ text: string }>;
      };
      return { isError: !!res.isError, data: JSON.parse(res.content[0]!.text) };
    };

    const listed = await call('list_plan_versions', { path: 'a/plan.md' });
    expect(listed.isError).toBe(false);
    expect(listed.data.total).toBe(2);

    const got = await call('get_plan_version', { path: 'a/plan.md', version: 2 });
    expect(got.isError).toBe(false);
    expect(got.data.version).toBe(2);

    expect(calls).toEqual(['a/plan.md', 'a/plan.md']);

    // And a missing `path` refuses with the repair path rather than answering
    // emptily — the hint the shared envelope now forwards.
    const bare = await call('list_plan_versions', {});
    expect(bare.isError).toBe(true);
    expect(bare.data.code).toBe('INVALID_ARGUMENT');
    expect(bare.data.hint).toContain('list_plans');
  });
});

/**
 * 0.2.14 — `mark_plan_applied` is a FIFTH tool, not a parameter of `update_plan`.
 *
 * The separation is the contract: writing a plan's content and declaring it
 * applied are different acts, and an agent editing a plan must not be able to
 * flip the flag as a side effect of the edit.
 */
describe('mark_plan_applied', () => {
  const build = (target?: 'explicit') =>
    buildPlanToolsServer({
      threadId: target ? 'mcp-external' : 't-1',
      target,
      planService: {} as never,
      pageVersions: {} as never,
    });

  it('is mounted on both channels, and `applied` is absent from update_plan', () => {
    for (const server of [build(), build('explicit')]) {
      const names = server.tools!.map((t) => t.name);
      expect(names).toContain('mark_plan_applied');

      const updatePlan = server.tools!.find((t) => t.name === 'update_plan')!;
      expect(Object.keys(updatePlan.inputSchema as Record<string, unknown>)).not.toContain('applied');
      // ...and the tool says so, so the model doesn't go looking for the field.
      expect(updatePlan.description).toContain('mark_plan_applied');
    }
  });

  it('delegates to PlanService.setAppliedByThread, thread-addressed on the internal mount', async () => {
    const calls: Array<[string, unknown]> = [];
    const server = buildPlanToolsServer({
      threadId: 't-1',
      planService: {
        setAppliedByThread: async (threadId: string, input: unknown) => {
          calls.push([threadId, input]);
          return { path: 'some-plan.md', applied: true };
        },
      } as never,
      pageVersions: {} as never,
    });
    const tool = server.tools!.find((t) => t.name === 'mark_plan_applied')!;

    const res = (await tool.handler({ applied: true }, {} as never)) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };

    expect(res.isError).toBeFalsy();
    // The answer carries the path and the flag — no plan content, no version.
    expect(JSON.parse(res.content[0]!.text)).toEqual({ path: 'some-plan.md', applied: true });
    // 2.1.13 — no `path` key at all on the internal mount: the pinned plan is the target.
    expect(calls).toEqual([['t-1', { applied: true }]]);
  });
});

/**
 * 2.1.26 — M12 External MCP, the four changed sections.
 *
 * A host stub carrying the internal servers the external surface composes from
 * (`entity-tools`, `reference-tools`, `page-tools`, `release-tools`) plus two
 * type servers (`endpoint-tools` with the DTO links, `spreadsheet-tools` with a
 * windowed read). Every stub tool's description is `<name> description`, so the
 * declaration that won a name collision is recognisable by its text.
 */
describe('M12 2.1.26 — one external read server and its profile table', () => {
  const fullHost = () =>
    pluginHostWith(
      [
        {
          name: 'entity-tools',
          tools: ['get_entities', 'get_field_content', 'list_entities', 'describe_entity_type', 'create_entities', 'update_entities'],
        },
        { name: 'reference-tools', tools: ['find_references', 'list_tags', 'create_tag', 'tag_entity'] },
        { name: 'page-tools', tools: ['create_page', 'update_page', 'update_sections'] },
        { name: 'release-tools', tools: ['release_list', 'release_show', 'release_diff', 'release_create', 'release_update'] },
        { name: 'endpoint-tools', tools: ['link_dto', 'unlink_dto'] },
        { name: 'spreadsheet-tools', tools: ['get_overview', 'get_range', 'set_cell'] },
      ],
      ['endpoint', 'spreadsheet'],
    );
  const namesFor = (profile: ExternalSurfaceDeps['profile']) =>
    composeExternalSurface(stubDeps({ profile, pluginHost: fullHost() })).toolNames;

  /** The reads every profile shares: the reader's own tools, list_projects, release reads. */
  const COMMON_READS = [
    ...C4S_READER_TOOL_NAMES,
    'list_skills',
    'load_skill_file',
    'list_projects',
    'release_list',
    'release_show',
    'release_diff',
  ];
  const PLANS = ['create_plan', 'get_plan', 'update_plan', 'list_plans', 'list_plan_versions', 'get_plan_version', 'mark_plan_applied'];
  const BRIEFS = ['get_brief', 'update_brief', 'list_brief_versions', 'get_brief_version'];
  const CHAT_WRITES = [
    'create_page', 'update_page', 'update_sections',
    'create_entities', 'update_entities',
    'create_tag', 'tag_entity',
    'link_dto', 'unlink_dto',
    'release_create', 'release_update',
  ];

  it('[section:m12mcp00] one server, c4s-reader: sources merge into one flat namespace, the first declaration wins a collision, and no source server name reaches the client', async () => {
    const deps = stubDeps({ profile: 'chat', pluginHost: fullHost() });
    const surface = composeExternalSurface(deps);

    // Flat: one row per name, even though entity-tools and reference-tools
    // declare names c4s-reader already declared.
    expect(new Set(surface.toolNames).size).toBe(surface.toolNames.length);
    for (const name of ['get_entities', 'get_field_content', 'list_entities', 'find_references', 'list_tags']) {
      expect(surface.toolNames.filter((n) => n === name), name).toHaveLength(1);
      // …and the row is c4s-reader's (composed first), not the internal counterpart's.
      expect(surface.byName.get(name)!.description, name).not.toBe(`${name} description`);
    }
    const reader = createC4sReaderServer(deps.reader);
    expect(surface.byName.get('get_entities')!.description).toBe(
      reader.tools!.find((t) => t.name === 'get_entities')!.description,
    );

    // A rendering under a DIFFERENT name is not shadowed: describe_entity_type
    // stands beside describe_types — two renderings of `describe_types`.
    expect(surface.toolNames).toContain('describe_types');
    expect(surface.toolNames).toContain('describe_entity_type');
    const describeTypes = CATALOG.get('describe_types')!;
    expect(describeTypes.renderings?.mcp).toEqual(['c4s-reader.describe_types', 'entity-tools.describe_entity_type']);

    // Over the wire: one server named c4s-reader, tool names unprefixed — no
    // `entity-tools` / `reference-tools` / `mcp__` in any name the client sees.
    const server = buildExternalMcpSurface(deps);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      expect(client.getServerVersion()?.name).toBe('c4s-reader');
      const listed = (await client.listTools()).tools.map((t) => t.name);
      expect([...listed].sort()).toEqual([...surface.toolNames]);
      for (const name of listed) {
        expect(name).not.toMatch(/-tools|c4s-reader|__/);
      }
    } finally {
      await client.close();
    }

    // The full-name prefix comes from the client config KEY: the issued config
    // uses `c4s-reader`, so a model sees `mcp__c4s-reader__<tool>`.
    expect(MCP_CONFIG_SERVER_KEY).toBe('c4s-reader');
    expect(MCP_CONFIG_SERVER_KEY).toBe(EXTERNAL_MCP_SERVER_NAME);
  });

  it('[section:4cli19xs] field content is issued by c4s-reader\'s own get_field_content in every profile, and type-specific tools stay on the same connection', async () => {
    const seen: unknown[] = [];
    const answer = { type: 'diagram', slug: 'flow', field: 'source', content: 'A-->B', bytes: 5 };
    const reader = {
      reader: {} as never,
      db: {} as never,
      projectDir: '/tmp/unused',
      packageVersion: 'test',
      discovery: {
        getFieldContent: (input: unknown) => {
          seen.push(input);
          return answer;
        },
      } as never,
    };
    for (const profile of ['chat', 'patch', 'ask', 'brief'] as const) {
      const surface = composeExternalSurface(stubDeps({ profile, reader, pluginHost: fullHost() }));
      const decl = surface.byName.get('get_field_content');
      expect(decl, profile).toBeDefined();
      // The c4s-reader declaration — the record's description — not the
      // entity-tools one composed after it.
      expect(decl!.description, profile).toMatch(/^The content of ONE content-bearing field of one entity, addressed by \(type, slug, field\)\./);
      expect(Object.keys(decl!.inputSchema).sort()).toEqual(['field', 'slug', 'type']);
      // No tool generated per type for content: every content tool on the surface
      // is the one generic name.
      expect(surface.toolNames.filter((n) => /content/.test(n)), profile).toEqual(['get_field_content']);
      // It renders the catalog operation: the core's answer passes through unchanged.
      const res = (await decl!.handler({ type: 'diagram', slug: 'flow', field: 'source' }, {})) as {
        content: Array<{ text: string }>;
      };
      expect(JSON.parse(res.content[0]!.text)).toEqual(answer);
    }
    expect(seen).toHaveLength(4);
    expect(seen[0]).toEqual({ type: 'diagram', slug: 'flow', field: 'source' });

    // Type-specific servers are composed into the same connection: the
    // spreadsheet skeleton comes from get_entities, its cells from get_range,
    // both on one surface; the only narrowing is the profile.
    const chat = namesFor('chat');
    expect(chat).toContain('get_entities');
    expect(chat).toContain('get_range');
    expect(chat).toContain('set_cell');
    const ask = namesFor('ask');
    expect(ask).toContain('get_range');
    expect(ask).not.toContain('set_cell');
  });

  it('[section:ecawzsbr] the closed profile table: common reads everywhere; chat the full set and the default; ask trimmed to reads, plans and describe_entity_type; brief to reads and brief tools; patch degenerates to chat', () => {
    const chat = namesFor('chat');
    const ask = namesFor('ask');
    const brief = namesFor('brief');
    const patch = namesFor('patch');

    for (const [profile, names] of [['chat', chat], ['ask', ask], ['brief', brief], ['patch', patch]] as const) {
      for (const read of COMMON_READS) expect(names, `${profile}/${read}`).toContain(read);
    }

    // chat — common reads, plans with writes, describe_entity_type, writes of
    // pages / sections / entities / tags, DTO links, release create/edit, peer.
    for (const name of [...PLANS, 'describe_entity_type', ...CHAT_WRITES, 'ask']) {
      expect(chat, `chat/${name}`).toContain(name);
    }

    // ask — trim to common reads + plans with writes + describe_entity_type.
    for (const name of [...PLANS, 'describe_entity_type']) expect(ask, `ask/${name}`).toContain(name);
    for (const name of [...CHAT_WRITES, 'ask', ...BRIEFS]) expect(ask, `ask/${name}`).not.toContain(name);

    // brief — trim to common reads + brief tools; no plans, no describe_entity_type.
    for (const name of BRIEFS) expect(brief, `brief/${name}`).toContain(name);
    for (const name of [...PLANS, 'describe_entity_type', ...CHAT_WRITES, 'ask', 'get_range']) {
      expect(brief, `brief/${name}`).not.toContain(name);
    }
    // The brief tools take the brief by an explicit `path`.
    const briefSurface = composeExternalSurface(stubDeps({ profile: 'brief', pluginHost: fullHost() }));
    expect(Object.keys(briefSurface.byName.get('get_brief')!.inputSchema)).toContain('path');

    // patch renders chat's set exactly.
    expect(patch).toEqual(chat);
    expect(MCP_CHANNEL_PROFILES.patch).toBe('chat');

    // Default `chat`; the table is closed — four rows, and a value outside it is
    // refused at set-up rather than falling back to the widest profile.
    expect(MCP_CHANNEL_PROFILE_NAMES).toEqual(['chat', 'ask', 'brief', 'patch']);
    expect(profileFromRequest({ query: {} } as never)).toEqual({ ok: true, profile: 'chat' });
    expect(profileFromRequest({ query: { profile: 'ask' } } as never)).toEqual({ ok: true, profile: 'ask' });
    const refused = profileFromRequest({ query: { profile: 'review' } } as never);
    expect(refused.ok).toBe(false);
    expect(isMcpChannelProfile('review')).toBe(false);
    expect(() => composeExternalSurface(stubDeps({ profile: 'review' as never }))).toThrow(/no rendering in the mcp channel/);
  });

  it('[section:b52znwjr] the surface is not read-only: chat carries writes of spec content, plans and releases and peer consultation, while the discovery core declares no mutating operation and the profile is the hard gate', async () => {
    // The M39 core stays read-only by construction: every c4s-reader tool is a
    // catalog read.
    for (const name of C4S_READER_TOOL_NAMES) {
      expect(CATALOG.get(name)?.opClass, name).toBe('read');
    }

    // The surface is not: chat reaches spec-content writes, plan writes, release
    // writes and the peer.
    const chat = namesFor('chat');
    for (const name of ['update_sections', 'create_entities', 'create_tag', 'update_plan', 'release_create', 'ask']) {
      expect(chat, name).toContain(name);
      const op = CATALOG.get(name);
      if (name !== 'ask' && op) expect(op.opClass, name).not.toBe('read');
    }

    // The replacement guarantee is the hard profile gate: a write outside the
    // profile is not in tools/list, and calling it by name is an unknown tool.
    const server = buildExternalMcpSurface(stubDeps({ profile: 'ask', pluginHost: fullHost() }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const listed = (await client.listTools()).tools.map((t) => t.name);
      expect(listed).not.toContain('create_entities');
      const outcome = await client
        .callTool({ name: 'create_entities', arguments: {} })
        .then((r) => ({ ok: true as const, r }), (e: unknown) => ({ ok: false as const, e }));
      if (outcome.ok) {
        expect(outcome.r.isError).toBe(true);
        expect(JSON.stringify(outcome.r.content)).toMatch(/not found/i);
      } else {
        expect(String(outcome.e)).toMatch(/not found/i);
      }
    } finally {
      await client.close();
    }
  });
});

/**
 * 2.1.27 — M12 `m12mcp00` and M19 `m19mcp00`: the reader's own read tools render
 * the sets of THREE owner cores — discovery M39, skill registry M37 and, newly,
 * the reference graph M19 (`find_references`, `check_consistency`) — with the same
 * contract as their internal renderings on `reference-tools`.
 */
describe('M12/M19 2.1.27 — the reference-graph operations on the external reader', () => {
  const M19_OPERATIONS = ['find_references', 'check_consistency'] as const;
  type Core = Partial<Record<'findReferences' | 'checkConsistency', (input: unknown) => unknown>>;
  const readerWith = (discovery: Core) => ({
    reader: {} as never,
    db: {} as never,
    projectDir: '/tmp/unused',
    packageVersion: 'test',
    discovery: discovery as never,
  });
  const parse = (res: unknown) => {
    const r = res as { content: Array<{ text: string }>; isError?: boolean };
    return { isError: r.isError === true, body: JSON.parse(r.content[0]!.text) as Record<string, unknown> };
  };

  it('[section:m12mcp00] [entity:c4s-reader-find-references] [entity:c4s-reader-check-consistency] c4s-reader renders the sets of three cores (M39, M37, M19): both M19 operations are on the external surface in every profile, declared by c4s-reader as their records state, over the core', async () => {
    // The M19 set sits in the reader's own tool list beside the M39 reads…
    for (const name of M19_OPERATIONS) expect(C4S_READER_TOOL_NAMES).toContain(name);
    // …and each catalog row renders it in the `mcp` channel as c4s-reader's tool.
    for (const name of M19_OPERATIONS) {
      expect(CATALOG.get(name)!.renderings?.mcp, name).toEqual([`c4s-reader.${name}`]);
    }

    const seen: Array<[string, unknown]> = [];
    const report = { summary: { total: 3, errors: 1, warnings: 2 }, truncated: true, brokenReferences: [] };
    const refs = { references: [{ rootId: 'pages', pagePath: 'a.md', tagType: 'inline_mention', line: 3 }], total: 1, hasMore: false, truncated: false };
    const core: Core = {
      findReferences: (i) => (seen.push(['findReferences', i]), refs),
      checkConsistency: (i) => (seen.push(['checkConsistency', i]), report),
    };
    // A host whose reference-tools also declares both names: the composed-first
    // c4s-reader declaration is the one the external caller gets.
    const host = pluginHostWith([{ name: 'reference-tools', tools: [...M19_OPERATIONS] }], []);
    for (const profile of MCP_CHANNEL_PROFILE_NAMES) {
      const surface = composeExternalSurface(stubDeps({ profile, reader: readerWith(core), pluginHost: host }));
      // M37 and M39 sets on the same surface.
      expect(surface.toolNames, profile).toEqual(expect.arrayContaining(['list_skills', 'load_skill_file', 'get_sections', 'list_entities']));
      for (const name of M19_OPERATIONS) {
        expect(surface.toolNames.filter((n) => n === name), `${profile}/${name}`).toHaveLength(1);
        const decl = surface.byName.get(name)!;
        expect(decl.description, `${profile}/${name}`).toBe(READ_TOOL_RECORDS[`c4s-reader-${name.replace('_', '-')}`]!.description);
      }
      expect(parse(await surface.byName.get('find_references')!.handler({ target: 'section', anchor: 'm19mcp00' }, {})).body).toEqual(refs);
      expect(parse(await surface.byName.get('check_consistency')!.handler({ rule: 8, limit: 1 }, {})).body).toEqual(report);
    }
    expect(seen).toHaveLength(MCP_CHANNEL_PROFILE_NAMES.length * 2);
    expect(seen[0]).toEqual(['findReferences', { target: 'section', anchor: 'm19mcp00', includeTagMatches: false }]);
    expect(seen[1]).toEqual(['checkConsistency', { rule: 8, limit: 1 }]);
  });

  it('[section:m19mcp00] both M19 operations render in the agent channels as reference-tools (internal) and c4s-reader (external), with one contract: same core call, same collection envelope, same error navigation', async () => {
    for (const name of M19_OPERATIONS) {
      const row = CATALOG.get(name)!;
      expect(row.renderings, name).toEqual({ internal: [`reference-tools.${name}`], mcp: [`c4s-reader.${name}`] });
    }

    const internalWith = (core: Core) => createReferenceToolsServer({ discovery: core } as unknown as ReferenceToolsDeps);
    const externalWith = (core: Core) => createC4sReaderServer(readerWith(core));
    const call = async (server: ReturnType<typeof internalWith>, name: string, args: Record<string, unknown>) =>
      parse(await server.tools!.find((t) => t.name === name)!.handler(args, {}));

    const cases: Array<{ name: (typeof M19_OPERATIONS)[number]; method: keyof Core; args: Record<string, unknown>; answer: unknown }> = [
      {
        name: 'find_references',
        method: 'findReferences',
        args: { target: 'entity', type: 'mcp-tool', slug: 'c4s-reader-find-references', includeTagMatches: true, limit: 1, offset: 0 },
        // The collection budget: total / hasMore / truncated come from the core, untouched.
        answer: { references: [{ rootId: 'pages', pagePath: 'modules/m19-references.md', anchor: 'm19mcp00', tagType: 'tagged_list', line: 9, via: ['m19'] }], total: 2, hasMore: true, truncated: false },
      },
      {
        name: 'check_consistency',
        method: 'checkConsistency',
        args: { severity: 'error', rule: 'brokenReferences', limit: 1 },
        answer: { summary: { total: 5, errors: 5, warnings: 0 }, truncated: true, brokenReferences: [{ reason: 'missing' }] },
      },
    ];

    for (const c of cases) {
      const seenInternal: unknown[] = [];
      const seenExternal: unknown[] = [];
      const internal = await call(internalWith({ [c.method]: (i: unknown) => (seenInternal.push(i), c.answer) }), c.name, c.args);
      const external = await call(externalWith({ [c.method]: (i: unknown) => (seenExternal.push(i), c.answer) }), c.name, c.args);
      expect(internal, c.name).toEqual({ isError: false, body: c.answer });
      expect(external, c.name).toEqual(internal);
      expect(seenExternal, c.name).toEqual(seenInternal);
      expect(seenInternal, c.name).toHaveLength(1);

      // Same parameters on both renderings (the descriptions differ by channel, the shape does not).
      const internalKeys = Object.keys(internalWith({}).tools!.find((t) => t.name === c.name)!.inputSchema).sort();
      const externalKeys = Object.keys(externalWith({}).tools!.find((t) => t.name === c.name)!.inputSchema).sort();
      expect(externalKeys, c.name).toEqual(internalKeys);

      // Error navigation from the core survives both renderings identically.
      const refusal = new DiscoveryError('INVALID_ARGUMENT', 'refused by the core', 'the call that would have worked');
      const thrower = { [c.method]: () => { throw refusal; } } as Core;
      const refusedInternal = await call(internalWith(thrower), c.name, c.args);
      const refusedExternal = await call(externalWith(thrower), c.name, c.args);
      expect(refusedInternal).toEqual({ isError: true, body: { error: 'refused by the core', code: 'INVALID_ARGUMENT', hint: 'the call that would have worked' } });
      expect(refusedExternal).toEqual(refusedInternal);
    }
  });
});
