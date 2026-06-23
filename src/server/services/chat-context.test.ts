import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, subagentsFor, type SystemPromptInput, type PeerProject } from './chat-context.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';

// buildSystemPrompt only calls host.listEntities() (no active plugins needed for
// these gating assertions); entityCounts is supplied directly by the caller.
const host = { listEntities: () => [] } as unknown as ProjectPluginHost;

function build(overrides: Partial<SystemPromptInput>): string {
  return buildSystemPrompt({
    host,
    projectName: 'My Spec',
    cwd: '/tmp/my-spec',
    pagesDir: 'pages',
    currentPagePath: null,
    currentPageBody: null,
    pageCount: 0,
    entityCounts: {},
    tagCount: 0,
    sectionCount: 0,
    ...overrides,
  });
}

const PEERS: PeerProject[] = [
  { name: 'Billing API', path: '/ws/billing', description: 'Money in, money out.' },
  { name: 'Auth', path: '/ws/auth' },
];

describe('buildSystemPrompt — <workspace_projects> (0.1.58)', () => {
  it('omits the block when c4sToolsAvailable is false, regardless of peers', () => {
    const out = build({ c4sToolsAvailable: false, workspaceProjects: PEERS, workspaceName: 'acme' });
    expect(out).not.toContain('<workspace_projects workspace=');
  });

  it('omits the block when the peer list is empty', () => {
    const out = build({ c4sToolsAvailable: true, workspaceProjects: [], workspaceName: 'acme' });
    expect(out).not.toContain('<workspace_projects workspace=');
  });

  it('renders the block right after <c4s_tools_usage> and before <project_skill>', () => {
    const out = build({
      c4sToolsAvailable: true,
      workspaceProjects: PEERS,
      workspaceName: 'acme',
      writingStyle: { slug: 'house-style', title: 'House Style' },
    });
    const c4sIdx = out.indexOf('<c4s_tools_usage>');
    const wsIdx = out.indexOf('<workspace_projects');
    const skillIdx = out.indexOf('<project_skill');
    expect(c4sIdx).toBeGreaterThanOrEqual(0);
    expect(wsIdx).toBeGreaterThan(c4sIdx);
    expect(skillIdx).toBeGreaterThan(wsIdx);
    expect(out).toContain('<workspace_projects workspace="acme">');
  });

  it('renders one <peer> per project with the workspace cwd as path', () => {
    const out = build({ c4sToolsAvailable: true, workspaceProjects: PEERS, workspaceName: 'acme' });
    expect(out).toContain('<peer name="Billing API" path="/ws/billing" description="Money in, money out."/>');
  });

  it('drops empty name/description attributes (unreadable peer config → path only)', () => {
    const out = build({ c4sToolsAvailable: true, workspaceProjects: PEERS, workspaceName: 'acme' });
    expect(out).toContain('<peer name="Auth" path="/ws/auth"/>');
  });

  it('never renders the block in a brief frame', () => {
    const out = build({
      contextType: 'brief',
      c4sToolsAvailable: true,
      workspaceProjects: PEERS,
      workspaceName: 'acme',
      brief: null,
    });
    expect(out).not.toContain('<workspace_projects workspace=');
  });
});

// 0.1.67 m05ctxreg: czwarty wymiar rejestru context_type — wbudowany subagent.
const entityHost = {
  listEntities: () => [
    {
      systemPrompt: {
        mcpToolsLine:
          'endpoint-tools: create_endpoint, get_endpoint, update_endpoint, delete_endpoint, list_endpoints, link_dto, unlink_dto',
      },
    },
    { systemPrompt: { mcpToolsLine: 'dto-tools: create_dto, get_dto, update_dto, delete_dto, list_dtos' } },
  ],
} as unknown as ProjectPluginHost;

describe('subagentsFor (0.1.67)', () => {
  it('brief → diff-explore: release-tools, no entity graph', () => {
    const subs = subagentsFor('brief', entityHost);
    expect(subs.map((s) => s.name)).toEqual(['diff-explore']);
    const tools = subs[0].tools ?? [];
    expect(tools).toEqual([
      'Read',
      'Grep',
      'Glob',
      'mcp__release-tools__release_show',
      'mcp__release-tools__release_diff',
      'mcp__release-tools__release_list',
    ]);
    expect(tools.some((t) => t.includes('get_') || t.includes('find_references'))).toBe(false);
    expect(subs[0].model).toBe('sonnet');
  });

  it('chat/patch → spec-explore: read-only entity graph + reference reads', () => {
    for (const ct of ['chat', 'patch'] as const) {
      const subs = subagentsFor(ct, entityHost);
      expect(subs.map((s) => s.name)).toEqual(['spec-explore']);
      const tools = subs[0].tools ?? [];
      // get_/list_ tools are enumerated; mutating tools are dropped.
      expect(tools).toContain('mcp__endpoint-tools__get_endpoint');
      expect(tools).toContain('mcp__endpoint-tools__list_endpoints');
      expect(tools).toContain('mcp__dto-tools__get_dto');
      expect(tools).toContain('mcp__reference-tools__find_references');
      expect(tools).toContain('mcp__reference-tools__check_consistency');
      expect(tools).toContain('mcp__reference-tools__list_sections');
      expect(tools.some((t) => /create_|update_|delete_|link_/.test(t))).toBe(false);
      expect(subs[0].model).toBe('sonnet');
    }
  });

  it('no subagent can nest (no Agent/Task in tools)', () => {
    for (const ct of ['chat', 'brief', 'patch'] as const) {
      const tools = subagentsFor(ct, entityHost)[0].tools ?? [];
      expect(tools).not.toContain('Agent');
      expect(tools).not.toContain('Task');
    }
  });
});
