import { describe, expect, it } from 'vitest';
import {
  __invalidateSurfaceCache,
  composeExternalSurface,
  EXTERNAL_MCP_ERROR_CODES,
  EXTERNAL_MCP_SERVER_NAME,
  RETIRED_EXTERNAL_MCP_ERROR_CODES,
  type ExternalSurfaceDeps,
} from './surface.js';
import { createMcpServer, mcpTool } from '../plugin-runtime/index.js';
import type { McpServerFactory } from '../../shared/plugin-host/mcp.js';
import { z } from 'zod';

/**
 * 0.2.13 §3/§4 — composition of the external surface, isolated from transport.
 *
 * These use a stub plugin host rather than the full harness: the claims under
 * test are about which SERVERS a profile contributes and how their tools merge,
 * and a real host would drown that in the fourteen reads.
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
    // fourteen names are declared, no db is touched.
    reader: { reader: null, discovery: null, db: null, projectDir: null, packageVersion: '0.0.0' },
    pluginHost: host,
    planService: {} as ExternalSurfaceDeps['planService'],
    pageVersions: {} as ExternalSurfaceDeps['pageVersions'],
    briefService: {} as ExternalSurfaceDeps['briefService'],
    listProjects: () => ({ projects: [] }),
    workspaceName: 'default',
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

  it('renders the fourteen M39 reads as the backbone', () => {
    const names = composeExternalSurface(stubDeps()).toolNames;
    for (const op of [
      'overview',
      'describe_types',
      'list_pages',
      'list_sections',
      'get_sections',
      'get_page',
      'search_pages',
      'search_entities',
      'list_entities',
      'get_entities',
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

  it('is dropped by the test seam, so a recomposition can be exercised', () => {
    const host = pluginHostWith([], []);
    const first = composeExternalSurface(stubDeps({ pluginHost: host }));
    __invalidateSurfaceCache(host);
    const second = composeExternalSurface(stubDeps({ pluginHost: host }));
    expect(second).not.toBe(first);
    expect(second.toolNames).toEqual(first.toolNames);
  });
});
