import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, subagentsFor, type SystemPromptInput, type PeerProject } from './chat-context.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import { DEFAULT_PAGES_ROOT_PROPS, type Root } from '../../shared/types.js';

/** Minimal Root at `dir` for prompt tests. */
function rootAt(dir: string, id = 'pages'): Root {
  return { id, name: id, dir, builtin: id === 'pages', ...DEFAULT_PAGES_ROOT_PROPS, linkTargets: [] };
}

// buildSystemPrompt only calls host.listEntities() (no active plugins needed for
// these gating assertions); entityCounts is supplied directly by the caller.
const host = { listEntities: () => [] } as unknown as ProjectPluginHost;

function build(overrides: Partial<SystemPromptInput>): string {
  return buildSystemPrompt({
    host,
    projectName: 'My Spec',
    cwd: '/tmp/my-spec',
    roots: [rootAt('pages')],
    briefsDir: '.claude4spec/briefs',
    patchesDir: '.claude4spec/patches',
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
      forcedSkills: [{ slug: 'house-style', title: 'House Style' }],
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

describe('buildSystemPrompt — M37 forcedSkills (multi-skill <project_skill>)', () => {
  it('brief frame: emits one <project_skill> block per forced skill, and derives the writing-style workflow addendum from the non-brief-author entry', () => {
    const out = build({
      contextType: 'brief',
      brief: null,
      forcedSkills: [
        { slug: 'brief-author', title: 'Brief Author' },
        { slug: 'house-style', title: 'House Style' },
      ],
    });
    expect(out.match(/<project_skill /g)?.length).toBe(2);
    expect(out).toContain('<project_skill slug="brief-author" title="Brief Author">');
    expect(out).toContain('<project_skill slug="house-style" title="House Style">');
    expect(out).toContain('<writing_style_brief_workflow slug="house-style">');
  });

  it('brief frame: omits the writing-style workflow addendum when only brief-author is forced (no active style)', () => {
    const out = build({
      contextType: 'brief',
      brief: null,
      forcedSkills: [{ slug: 'brief-author', title: 'Brief Author' }],
    });
    expect(out.match(/<project_skill /g)?.length).toBe(1);
    expect(out).not.toContain('<writing_style_brief_workflow');
  });

  it('non-brief frame (chat/patch/ask): emits one <project_skill> block per forced skill', () => {
    const out = build({
      contextType: 'patch',
      forcedSkills: [
        { slug: 'patch-implementer', title: 'Patch Implementer' },
        { slug: 'house-style', title: 'House Style' },
      ],
    });
    expect(out.match(/<project_skill /g)?.length).toBe(2);
    expect(out).toContain('<project_skill slug="patch-implementer" title="Patch Implementer">');
    expect(out).toContain('<project_skill slug="house-style" title="House Style">');
  });

  it('non-brief frame: renders nothing when forcedSkills is empty', () => {
    const out = build({ contextType: 'ask' });
    expect(out).not.toContain('<project_skill');
  });
});

// M13 (0.1.113): CRUD lives on the generic entity-tools server, composed by
// the host — per-type mcpToolsLine now covers ONLY a custom server, and is
// absent entirely for a type with no non-CRUD tools (e.g. dto).
describe('buildSystemPrompt — <tooling> entity-tools (M13)', () => {
  it('always includes the host-level entity-tools line', () => {
    const out = build({});
    expect(out).toContain(
      '<mcp name="entity-tools">create_entities, get_entities, update_entities, delete_entities, list_entities, search_entities, describe_entity_type</mcp>',
    );
  });

  it('plug-and-play: config.entities = ["endpoint"] → entity-tools line + endpoint-tools custom line, no dto line', () => {
    const singleEntityHost = {
      listEntities: () => [
        { systemPrompt: { mcpToolsLine: 'endpoint-tools: link_dto, unlink_dto' } },
      ],
    } as unknown as ProjectPluginHost;
    const out = buildSystemPrompt({
      host: singleEntityHost,
      projectName: 'My Spec',
      cwd: '/tmp/my-spec',
      roots: [rootAt('pages')],
      briefsDir: '.claude4spec/briefs',
      patchesDir: '.claude4spec/patches',
      currentPagePath: null,
      currentPageBody: null,
      pageCount: 0,
      entityCounts: {},
      tagCount: 0,
      sectionCount: 0,
    });
    expect(out).toContain('<mcp name="entity-tools">');
    expect(out).toContain('<mcp name="endpoint-tools">link_dto, unlink_dto</mcp>');
    expect(out).not.toContain('dto-tools');
  });

  it('a type with no mcpToolsLine (e.g. dto — no custom tools) contributes no per-type <mcp> line', () => {
    const dtoOnlyHost = {
      listEntities: () => [{ systemPrompt: {} }],
    } as unknown as ProjectPluginHost;
    const out = buildSystemPrompt({
      host: dtoOnlyHost,
      projectName: 'My Spec',
      cwd: '/tmp/my-spec',
      roots: [rootAt('pages')],
      briefsDir: '.claude4spec/briefs',
      patchesDir: '.claude4spec/patches',
      currentPagePath: null,
      currentPageBody: null,
      pageCount: 0,
      entityCounts: {},
      tagCount: 0,
      sectionCount: 0,
    });
    // Only the always-present entity-tools + reference-tools lines — no extra <mcp> from the dto type.
    const mcpLines = (out.match(/<mcp name="[^"]+">/g) ?? []).map((m) => m);
    expect(mcpLines).toEqual(['<mcp name="entity-tools">', '<mcp name="reference-tools">']);
  });
});

// 0.1.67 m05ctxreg: czwarty wymiar rejestru context_type — wbudowany subagent.
// M13: post-migration mcpToolsLine values — endpoint keeps only its custom
// relation tools; dto has no custom server left at all (no mcpToolsLine).
const entityHost = {
  listEntities: () => [
    {
      systemPrompt: {
        mcpToolsLine: 'endpoint-tools: link_dto, unlink_dto',
      },
    },
    { systemPrompt: {} },
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
      // M13: CRUD (incl. reads) lives on the generic entity-tools server —
      // hardcoded here since per-type mcpToolsLine no longer carries get_/list_.
      expect(tools).toContain('mcp__entity-tools__get_entities');
      expect(tools).toContain('mcp__entity-tools__list_entities');
      expect(tools).toContain('mcp__entity-tools__search_entities');
      expect(tools).toContain('mcp__entity-tools__describe_entity_type');
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

  it('ask → spec-explore (reuses the read-only current-spec explorer)', () => {
    const subs = subagentsFor('ask', entityHost);
    expect(subs.map((s) => s.name)).toEqual(['spec-explore']);
  });
});

// 0.1.79: ask peer-consult prompt frame.
describe('buildSystemPrompt — ask context (0.1.79)', () => {
  it('emits the chat-frame with <spec_language> + PLAN MODE and NO <current_*> block', () => {
    const out = build({
      contextType: 'ask',
      planMode: true,
      specLanguage: 'English',
      // Even if a page is somehow supplied, the ask frame must not render it.
      currentPagePath: 'pages/intro.md',
      currentPageBody: 'body',
    });
    expect(out).toContain('<spec_language>');
    expect(out).toContain('<claude4spec_plan_mode>');
    // The current-page DATA block (which would inline the supplied path) is absent.
    // (The static <current_page_handling> instruction block is part of the frame.)
    expect(out).not.toContain('pages/intro.md');
    expect(out).not.toContain('<current_page path=');
    // Standard chat-frame identity (not the brief frame).
    expect(out).not.toContain('<claude4spec_brief_identity>');
  });
});

describe('buildSystemPrompt — <agent_path_scope> (0.1.90 / 0.1.130)', () => {
  // 0.1.130: artifactDenyDirs is always present (the implicit deny-set) → block always emitted.
  const ARTIFACT = [
    '/tmp/my-spec/.claude4spec/plans',
    '/tmp/my-spec/.claude4spec/briefs',
    '/tmp/my-spec/.claude4spec/patches',
    '/tmp/my-spec/.claude4spec/entities',
    '/tmp/my-spec/.claude4spec/releases',
  ];
  const scope = { allowedPaths: ['/extra/lib'], disallowedPaths: ['/tmp/my-spec/src'], artifactDenyDirs: ARTIFACT };
  const emptyUserScope = { allowedPaths: [], disallowedPaths: [], artifactDenyDirs: ARTIFACT };

  it('emits the block even when the user lists are empty (artifact deny-set is unconditional)', () => {
    const out = build({ contextType: 'chat', agentPathScope: emptyUserScope });
    expect(out).toContain('<agent_path_scope>');
    expect(out).toContain('ALWAYS DISALLOWED — C4S artifact dirs');
    for (const d of ARTIFACT) expect(out).toContain(d);
  });

  it('omits the block when agentPathScope is absent', () => {
    expect(build({})).not.toContain('<agent_path_scope>');
  });

  it('emits the block in the chat frame with cwd, allowed, disallowed and ALWAYS-DISALLOWED lines', () => {
    const out = build({ contextType: 'chat', agentPathScope: scope });
    expect(out).toContain('<agent_path_scope>');
    // cwd is always listed; configured allow/deny entries appear verbatim.
    expect(out).toContain('ALLOWED (you may read/write here): /tmp/my-spec, /extra/lib');
    expect(out).toContain('DISALLOWED (never read/write here, takes precedence): /tmp/my-spec/src');
    // 0.1.130: unconditional artifact deny line + MCP-only guidance.
    expect(out).toContain(`ALWAYS DISALLOWED — C4S artifact dirs (edit ONLY via MCP tools, never with built-in Read/Write/Edit/Bash): ${ARTIFACT.join(', ')}`);
    expect(out).toContain('use plan-tools / brief-tools / entity-tools / release-tools instead');
  });

  it('emits the block in the patch and ask frames', () => {
    expect(build({ contextType: 'patch', agentPathScope: scope })).toContain('<agent_path_scope>');
    expect(build({ contextType: 'ask', agentPathScope: scope })).toContain('<agent_path_scope>');
  });

  it('NEVER emits the block in the brief frame, even with a configured scope', () => {
    const out = build({ contextType: 'brief', agentPathScope: scope });
    expect(out).not.toContain('<agent_path_scope>');
    expect(out).not.toContain('ALWAYS DISALLOWED — C4S artifact dirs');
  });

  it('drops the DISALLOWED line when only allowedPaths is set (artifact line still present)', () => {
    const out = build({
      contextType: 'chat',
      agentPathScope: { allowedPaths: ['/extra/lib'], disallowedPaths: [], artifactDenyDirs: ARTIFACT },
    });
    expect(out).toContain('<agent_path_scope>');
    // The user DISALLOWED *list* line is dropped; the ALWAYS DISALLOWED line is unconditional.
    expect(out).not.toContain('DISALLOWED (never read/write here');
    expect(out).toContain('ALWAYS DISALLOWED — C4S artifact dirs');
  });

  it('includes a root dir on the ALLOWED line only when it sits outside cwd', () => {
    const inside = build({ contextType: 'chat', roots: [rootAt('pages')], agentPathScope: scope });
    expect(inside).toContain('ALLOWED (you may read/write here): /tmp/my-spec, /extra/lib');
    const outside = build({ contextType: 'chat', roots: [rootAt('/var/spec-pages')], agentPathScope: scope });
    expect(outside).toContain('ALLOWED (you may read/write here): /tmp/my-spec, /var/spec-pages, /extra/lib');
  });
});

// 0.1.110: <delegation_policy> advertises the spec-explore subagent inside <claude4spec_identity>.
describe('buildSystemPrompt — <delegation_policy> (0.1.110)', () => {
  it('renders between </entity_change_protocol> and <tags> in the chat frame, mentioning spec-explore', () => {
    const out = build({ contextType: 'chat' });
    const protocolEndIdx = out.indexOf('</entity_change_protocol>');
    // Match the block's opening tag, not the `<delegation_policy/>` self-reference inside
    // <entity_discovery>'s channels intro (which appears earlier in the identity block).
    const delegationIdx = out.indexOf('<delegation_policy severity=');
    const tagsIdx = out.indexOf('<tags>');
    expect(protocolEndIdx).toBeGreaterThanOrEqual(0);
    expect(delegationIdx).toBeGreaterThan(protocolEndIdx);
    expect(tagsIdx).toBeGreaterThan(delegationIdx);
    expect(out).toContain('spec-explore');
  });

  it('never renders in the brief frame', () => {
    const out = build({ contextType: 'brief', brief: null });
    expect(out).not.toContain('<delegation_policy');
  });
});

// 0.1.110: each of the 5 entity-embed forms is fully described exactly once, inside <entity_embeds>.
describe('buildSystemPrompt — <entity_embeds> single-source regression (0.1.110)', () => {
  it('describes each embed form exactly once', () => {
    const out = build({ contextType: 'chat' });
    const start = out.indexOf('<entity_embeds>');
    const end = out.indexOf('</entity_embeds>');
    expect(start).toBeGreaterThanOrEqual(0);
    const embedsBlock = out.slice(start, end);
    const restOfPrompt = out.slice(0, start) + out.slice(end);

    const formSignatures = [
      'Inline chip inside a sentence',
      'Block card with the entity',
      'Static block list of hand-picked',
      'Dynamic block list filtered by tag',
      'spans all entity types',
    ];
    for (const signature of formSignatures) {
      expect(embedsBlock.split(signature).length - 1).toBe(1);
      // The full description must not be duplicated elsewhere (e.g. <entity_linking_rule>, <tags>).
      expect(restOfPrompt).not.toContain(signature);
    }
  });
});

// 0.1.110: the plan-tools read-only exemption sentence has exactly one source (<claude4spec_plan_mode>).
describe('buildSystemPrompt — plan-tools exemption single-source regression (0.1.110)', () => {
  it('appears exactly once when both plan_tools_usage and plan_mode are mounted', () => {
    const out = build({ contextType: 'chat', planToolsAvailable: true, planMode: true });
    expect(out.split('EXEMPT').length - 1).toBe(1);
  });

  it('is absent from <plan_tools_usage> on its own (plan_mode not active)', () => {
    const out = build({ contextType: 'chat', planToolsAvailable: true, planMode: false });
    expect(out).toContain('<plan_tools_usage>');
    expect(out).not.toContain('EXEMPT');
    expect(out).not.toContain('NOT subject to plan_mode');
  });
});
