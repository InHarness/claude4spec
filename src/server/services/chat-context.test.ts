import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, mainPromptBlockNames, subagentsFor, type SystemPromptInput, type PeerProject } from './chat-context.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import { validateSubagents } from '@inharness-ai/agent-adapters';
import type { PluginSubagentContribution } from '../../shared/plugin-host/manifest.js';
import { acSystemPrompt } from '../entities/ac/system-prompt.js';
import { diagramSystemPrompt } from '../entities/diagram/system-prompt.js';
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
    currentPagePath: null,
    currentPageBody: null,
    entityCounts: {},
    tagCount: 0,
    ...overrides,
  });
}

const PEERS: PeerProject[] = [
  { name: 'Billing API', registryName: 'billing', path: '/ws/billing', description: 'Money in, money out.' },
  { name: 'Auth', registryName: 'auth', path: '/ws/auth' },
];

/** The mounted-server inventory the turn hands the prompt. `<tooling>` is derived
 *  from this alone since 0.2.50, so a test that wants a server named must say so. */
function inv(...servers: Array<[string, string[]?]>) {
  return servers.map(([name, tools]) => ({ name, tools }));
}

/** The inventory a plain chat turn mounts, trimmed to what these tests assert on. */
const CHAT_INVENTORY = inv(
  ['entity-tools', ['create_entities', 'get_entities', 'update_entities', 'delete_entities', 'list_entities', 'search_entities', 'describe_entity_type']],
  ['reference-tools', ['create_tag', 'tag_entity', 'find_references', 'check_consistency', 'list_pages', 'get_page']],
  ['page-tools', ['create_page', 'update_page', 'delete_page', 'update_sections']],
  ['skill-tools', ['load_skill_file']],
  ['plan-tools', ['get_plan', 'update_plan', 'list_plan_versions', 'get_plan_version']],
  ['c4s-tools', ['ask']],
);

/**
 * 0.2.50 — the per-type COUNT attributes are gone, so the well-formedness rule
 * they needed is gone with them; what replaces it is the assertion that they do
 * not come back.
 *
 * They were frozen at turn 1 (the system prompt is written once per thread), and
 * `ac` was silently a filtered subset on top of that. No block in the prompt
 * ever branched on one, and an agent that needs a count has
 * `list_entities({ mode: 'count' })`, which is current. What remains on
 * `<project>` is scale — pages and sections — stamped with when it was true.
 */
describe('buildSystemPrompt — <project> carries no per-type counters (0.2.50)', () => {
  const typed = (types: Array<{ type: string; labelPlural: string }>) =>
    ({
      listEntities: () =>
        types.map((t) => ({ ...t, label: t.labelPlural, systemPrompt: { roleNoun: t.type } })),
    }) as unknown as ProjectPluginHost;

  it('emits no count attribute for any entity type', () => {
    const out = build({
      host: typed([
        { type: 'ac', labelPlural: 'Acceptance Criteria' },
        { type: 'ui-view', labelPlural: 'UI Views' },
      ]),
      entityCounts: { ac: 12, 'ui-view': 3 },
      tagCount: 7,
    });
    expect(out).not.toContain('ac="12"');
    expect(out).not.toContain('ui-view="3"');
    expect(out).not.toContain('tags="7"');
    expect(out).not.toContain('Acceptance Criteria=');
  });

  /**
   * `pages`/`sections` fell to the same test that took the per-type counters:
   * nothing in the prompt branches on them, and after #171 rewrote
   * `<sections_and_anchors>` no block cites one at all. `counted=` went with
   * them — it was honest about two attributes and misleading about the prompt
   * around them.
   */
  it('carries identity only — name, cwd, roots, and no scale counters', () => {
    const out = build({});
    const projectTag = /<project\s([^>]*)\/>/.exec(out)?.[1] ?? '';
    const keys = [...projectTag.matchAll(/([^\s=]+)="/g)].map(([, k]) => k);
    expect(keys).toEqual(['name', 'cwd', 'roots']);
    expect(projectTag).toContain('name="My Spec"');
    expect(projectTag).toContain('cwd="/tmp/my-spec"');
    expect(projectTag).toContain('roots="pages=pages"');
  });

  /**
   * The general form of the rule, kept so a future attribute source is held to
   * it: an XML Name may not contain a space, a quote or a parenthesis, and
   * `attrs()` escapes VALUES while interpolating KEYS verbatim.
   */
  it('emits only valid XML Names as attribute keys', () => {
    const out = build({
      host: typed([
        { type: 'ac', labelPlural: 'Acceptance Criteria' },
        { type: 'design-system', labelPlural: 'Design Systems' },
      ]),
      entityCounts: { ac: 1, 'design-system': 1 },
    });
    const projectTag = /<project\s([^>]*)\/>/.exec(out)?.[1] ?? '';
    expect(projectTag).not.toBe('');
    for (const [, key] of projectTag.matchAll(/([^\s=]+)="/g)) {
      expect({ key, valid: /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key!) }).toEqual({ key, valid: true });
    }
  });

  /**
   * 0.2.50 — `roots=` lists ROOTS. It used to prepend `briefs=` and `patches=`,
   * which are not roots: passing either as a `rootId` answers ROOT_NOT_FOUND,
   * and `<agent_path_scope>` names both directories as ALWAYS DISALLOWED. The
   * `id=dir` shape stays, because it is the only place in the prompt binding a
   * root identifier to a directory.
   */
  it('roots= lists only real roots, as id=dir', () => {
    const out = build({ roots: [rootAt('pages'), rootAt('docs/adr', 'adr')] });
    expect(out).toContain('roots="pages=pages;adr=docs/adr"');
    expect(out).not.toContain('briefs=');
    expect(out).not.toContain('patches=');
  });
});

/**
 * 0.2.50 — `<entities>` rows carry RULES; shapes come from the tool.
 *
 * The rows are the real plugin contributions here, not fixtures, because the
 * thing under test is a discipline about their CONTENT: a row must not preview
 * what `describe_entity_type` returns derived from the schema. A fixture would
 * only prove the assertion runs.
 */
describe('buildSystemPrompt — <entities> states rules, not shapes (0.2.50)', () => {
  const realHost = {
    listEntities: () => [
      { type: 'ac', systemPrompt: acSystemPrompt },
      { type: 'diagram', systemPrompt: diagramSystemPrompt },
    ],
  } as unknown as ProjectPluginHost;

  const entitiesBlock = (out: string) => /<entities>[\s\S]*?<\/entities>/.exec(out)?.[0] ?? '';

  it('names describe_entity_type as the address for fields and enums', () => {
    const block = entitiesBlock(build({ host: realHost, mcpInventory: CHAT_INVENTORY }));
    expect(block).toContain('describe_entity_type(type)');
    expect(block).toMatch(/RULES, not shapes/);
  });

  it('previews no field name or enum value that describe_entity_type returns', () => {
    const block = entitiesBlock(build({ host: realHost, mcpInventory: CHAT_INVENTORY }));
    for (const shape of ['verifies[]', 'requirement/edge-case', 'active/deprecated']) {
      expect({ shape, present: block.includes(shape) }).toEqual({ shape, present: false });
    }
  });

  it('does not restate a convention block emitted beside it', () => {
    // diagram's own <diagram_references> carries the reference grammar; the row
    // must point at it rather than spell the two tags out a second time.
    const out = build({ host: realHost, mcpInventory: CHAT_INVENTORY });
    expect(out).toContain('<diagram_references>');
    expect(entitiesBlock(out)).not.toContain('<single_element type="diagram"');
  });
});

describe('buildSystemPrompt — <workspace_projects> (0.1.58)', () => {
  const withC4s = (o: Record<string, unknown>) =>
    build({ mcpInventory: CHAT_INVENTORY, workspaceName: 'acme', ...o });

  it('omits the block when c4s-tools is not mounted, regardless of peers', () => {
    // 0.2.50: the gate is the SERVER's presence, not a flag beside it. The block
    // exists to make `ask`'s `project` argument constructible, so it is wanted
    // exactly when `ask` is reachable.
    const out = build({
      mcpInventory: inv(['entity-tools', ['get_entities']]),
      workspaceProjects: PEERS,
      workspaceName: 'acme',
    });
    expect(out).not.toContain('<workspace_projects workspace=');
  });

  it('omits the block when the peer list is empty', () => {
    expect(withC4s({ workspaceProjects: [] })).not.toContain('<workspace_projects workspace=');
  });

  it('renders in layer C, after <tooling> and before the writing conventions', () => {
    const out = withC4s({
      workspaceProjects: PEERS,
      writingStyleSkill: { slug: 'house-style', title: 'House Style' },
    });
    const toolingIdx = out.indexOf('<tooling>');
    const wsIdx = out.indexOf('<workspace_projects');
    const conventionsIdx = out.indexOf('<entity_embeds');
    expect(toolingIdx).toBeGreaterThanOrEqual(0);
    expect(wsIdx).toBeGreaterThan(toolingIdx);
    expect(conventionsIdx).toBeGreaterThan(wsIdx);
    expect(out).toContain('<workspace_projects workspace="acme">');
  });

  /**
   * 0.2.50 — the peer's ADDRESS is `id`, the registry name, and this is the
   * assertion that keeps it from being "simplified" back to the display name.
   *
   * `ask({ project })` resolves a non-path value through `findProjectByName`,
   * which compares against `ProjectRecord.name` from the workspace registry —
   * not the `name` the peer gives itself in its own config.json. A peer that
   * shows as "Billing API" is registered as `billing`, and passing the former
   * answers PROJECT_SLUG_NOT_FOUND. This was found by making the call; the
   * change it refutes had survived three readings of the code.
   */
  it('renders the REGISTRY name as `id` — the address — with `name` as a label only', () => {
    const out = withC4s({ workspaceProjects: PEERS });
    expect(out).toContain(
      '<peer id="billing" name="Billing API" description="Money in, money out."/>',
    );
    // The display name must never be the only identifier offered.
    expect(out).not.toContain('<peer name="Billing API" path=');
    expect(out).toContain('Pass a peer\'s `id` as the `project` argument');
  });

  it('drops an empty description, keeping the addressable id', () => {
    expect(withC4s({ workspaceProjects: PEERS })).toContain('<peer id="auth" name="Auth"/>');
  });

  /** A peer with no registry name keeps `path`, which the resolver tries first —
   *  better a longer address than a decorative one. */
  it('falls back to path when a peer has no registry name', () => {
    const out = withC4s({ workspaceProjects: [{ name: 'Legacy', path: '/ws/legacy' }] });
    expect(out).toContain('<peer name="Legacy" path="/ws/legacy"/>');
  });

  it('never renders the block in a brief frame', () => {
    const out = withC4s({ contextType: 'brief', workspaceProjects: PEERS, brief: null });
    expect(out).not.toContain('<workspace_projects workspace=');
  });
});

describe('buildSystemPrompt — M37 <project_writing_skill> is the writing-style slot (0.2.19)', () => {
  it('brief frame: emits exactly one block, for the active writing style', () => {
    const out = build({
      contextType: 'brief',
      brief: null,
      writingStyleSkill: { slug: 'house-style', title: 'House Style' },
    });
    expect(out.match(/<project_writing_skill /g)?.length).toBe(1);
    expect(out).toContain('<project_writing_skill slug="house-style" title="House Style">');
  });

  /**
   * 0.2.50 — the block says a style EXISTS and orders it read; it does not
   * characterise it. It briefly rendered the style's own `description`, which
   * is a blurb written to help a model decide whether to open a skill — a
   * decision this block has already made for it.
   */
  it('renders no description of the style, only its address and the order to read it', () => {
    const out = build({
      mcpInventory: CHAT_INVENTORY,
      // The extra `description` is a probe: the type no longer carries one, so
      // this also fails at compile time if the field comes back — but the cast
      // keeps the runtime guarantee that nothing renders it.
      writingStyleSkill: { slug: 'house-style', title: 'House Style', description: 'PROBE_DESCRIPTION_TEXT' } as unknown as {
        slug: string;
        title: string;
      },
    });
    const block = /<project_writing_skill [\s\S]*?<\/project_writing_skill>/.exec(out)?.[0] ?? '';
    expect(block).not.toBe('');
    expect(block).toContain('slug="house-style"');
    expect(block).toContain('title="House Style"');
    expect(block).toContain('call load_skill_file("house-style")');
    expect(block).toContain('BINDING');
    expect(block).not.toContain('PROBE_DESCRIPTION_TEXT');
    expect(block).not.toContain('describes itself as');
  });

  it('brief frame: emits no block at all when no writing style is active', () => {
    // Pre-0.2.19 this frame always carried `brief-author`, so the block count
    // never reached zero here. The genre rules that skill used to carry now
    // arrive in <interaction_context>, which is what makes an empty slot safe.
    const out = build({ contextType: 'brief', brief: null, writingStyleSkill: null });
    expect(out).not.toContain('<project_writing_skill');
  });

  it('brief frame: no longer points at the style\'s internal file layout', () => {
    // The host does not know a style's directory structure; every package file
    // rides InlineSkill.files and the agent navigates its own style.
    const out = build({
      contextType: 'brief',
      brief: null,
      writingStyleSkill: { slug: 'house-style', title: 'House Style' },
    });
    expect(out).not.toContain('<writing_style_brief_workflow');
  });

  it('non-brief frame: at most one block, whatever the context type', () => {
    for (const contextType of ['chat', 'patch', 'ask'] as const) {
      const out = build({
        contextType,
        writingStyleSkill: { slug: 'house-style', title: 'House Style' },
      });
      expect(out.match(/<project_writing_skill /g)?.length).toBe(1);
      expect(out).toContain('<project_writing_skill slug="house-style" title="House Style">');
    }
  });

  it('non-brief frame: renders nothing when no writing style is active', () => {
    const out = build({ contextType: 'ask' });
    expect(out).not.toContain('<project_writing_skill');
  });
});

describe('buildSystemPrompt — <available_skills> (0.2.36)', () => {
  const LISTING = [
    { slug: 'house-rules', description: 'always on' },
    { slug: 'writing-style-author', description: 'authors styles' },
  ];

  it.each(['chat', 'patch', 'ask', 'brief'] as const)(
    'is emitted in the %s context, carrying every listed skill\'s description',
    (contextType) => {
      const out = build({ contextType, brief: null, availableSkills: LISTING });
      expect(out).toContain('<skill slug="house-rules" description="always on"/>');
      expect(out).toContain('<skill slug="writing-style-author" description="authors styles"/>');
    },
  );

  it.each(['chat', 'patch', 'ask', 'brief'] as const)(
    'renders in the %s context even with an EMPTY listing — the concept is not conditional',
    (contextType) => {
      // An absent block is indistinguishable from a host that has no notion of
      // skills, which is a different and wronger thing to say than "none here".
      const out = build({ contextType, brief: null, availableSkills: [] });
      expect(out).toContain('<available_skills>');
      expect(out).not.toContain('<skill slug=');
    },
  );

  it.each(['chat', 'patch', 'ask', 'brief'] as const)(
    'forbids the native Skill() tool and Read in the %s context',
    (contextType) => {
      const out = build({ contextType, brief: null, availableSkills: LISTING });
      const block = /<available_skills>([\s\S]*?)<\/available_skills>/.exec(out)?.[1] ?? '';
      expect(block).toContain('load_skill_file(slug)');
      expect(block).toContain('Never open a skill with the native Skill() tool and never read one with Read');
    },
  );

  it.each(['chat', 'patch', 'ask', 'brief'] as const)(
    'lands immediately BEFORE <project_writing_skill> in the %s context',
    (contextType) => {
      // The order is load-bearing: <available_skills> carries the convention for
      // opening a skill, <project_writing_skill> issues an instruction to open one. Reversed,
      // the model is told to make a call before anything says what that call is.
      const out = build({
        contextType,
        brief: null,
        availableSkills: LISTING,
        writingStyleSkill: { slug: 'house-style', title: 'House Style' },
      });
      const listingIdx = out.indexOf('<available_skills>');
      const closeIdx = out.indexOf('</available_skills>');
      const skillIdx = out.indexOf('<project_writing_skill');
      expect(listingIdx).toBeGreaterThanOrEqual(0);
      expect(skillIdx).toBeGreaterThan(listingIdx);
      // IMMEDIATELY before: the two blocks are adjacent parts, nothing in between.
      expect(out.slice(closeIdx + '</available_skills>'.length, skillIdx).trim()).toBe('');
    },
  );

  it.each(['chat', 'patch', 'ask', 'brief'] as const)(
    'advertises the skill-tools mount in the %s context\'s <tooling>',
    (contextType) => {
      // 0.2.50: `<tooling>` is derived from the mounted set, so the fixture has
      // to say the server is mounted — which is the point. The line can no
      // longer appear for a server that is not there, nor go missing for one
      // that is.
      const out = build({
        contextType,
        brief: null,
        mcpInventory: inv(['skill-tools', ['load_skill_file']]),
      });
      expect(out).toContain('<mcp name="skill-tools">load_skill_file</mcp>');
    },
  );

  it('leaks no skill CONTENT into the prompt — only slugs, titles and descriptions', () => {
    // The grep-check the release rests its budget claim on. A description is the
    // whole cost of a skill now; a body reaching this string would be the old
    // delivery channel back by another route.
    const out = build({
      contextType: 'chat',
      availableSkills: [{ slug: 'house-rules', description: 'always on' }],
      writingStyleSkill: { slug: 'house-style', title: 'House Style' },
    });
    expect(out).not.toContain('# How to write specifications');
    expect(out).not.toContain('workflows/brief.md contents');
    expect(out).toContain('slug="house-rules"');
    expect(out).toContain('slug="house-style"');
  });
});

describe('buildSystemPrompt — <project_writing_skill> points at load_skill_file (0.2.36)', () => {
  it('never instructs the model to call the native Skill() tool', () => {
    for (const contextType of ['chat', 'patch', 'ask', 'brief'] as const) {
      const out = build({
        contextType,
        brief: null,
        writingStyleSkill: { slug: 'house-style', title: 'House Style' },
      });
      expect(out).toContain('call load_skill_file("house-style")');
      expect(out).not.toMatch(/call Skill\("house-style"\)/);
    }
  });

  it('does not tell plan mode to call Skill(slug) either', () => {
    // <claude4spec_plan_mode> reaches every `ask` turn (force-plan) and every
    // plan-mode chat/patch turn, so a leftover Skill(slug) there contradicts the
    // <available_skills> rule inside the very same prompt.
    for (const contextType of ['chat', 'patch', 'ask'] as const) {
      const out = build({
        contextType,
        brief: null,
        planMode: true,
        writingStyleSkill: { slug: 'house-style', title: 'House Style' },
      });
      expect(out).toContain('ensure load_skill_file(slug) has been called this turn');
      // Every remaining `Skill(` is the empty-argument prohibition itself.
      expect(out).not.toMatch(/Skill\((?!\))/);
    }
  });
});

describe('buildSystemPrompt — <interaction_context> (0.2.19)', () => {
  it('is emitted in every context type, carrying the type as an attribute', () => {
    for (const contextType of ['chat', 'brief', 'patch', 'ask'] as const) {
      const out = build({ contextType, brief: null, interactionRules: 'RULES FOR ' + contextType });
      expect(out).toContain(`<interaction_context type="${contextType}">`);
      expect(out).toContain('RULES FOR ' + contextType);
    }
  });

  it('self-closes rather than disappearing when there are no rules', () => {
    // An absent block would be indistinguishable from "this host has no such
    // concept"; the `type` attribute alone still tells the agent which mode it is in.
    const out = build({ contextType: 'chat', interactionRules: '' });
    expect(out).toContain('<interaction_context type="chat"/>');
    expect(out).not.toContain('<interaction_context type="chat">');
  });

  it('is emitted even when the caller passes no rules at all', () => {
    const out = build({ contextType: 'patch' });
    expect(out).toContain('<interaction_context type="patch"/>');
  });

  /**
   * 0.2.50 — it OPENS every frame, identity included, where it used to come
   * second in the chat frame and first in the brief frame. One rule for four
   * modes rather than two rules for two groups: in all of them, which of the
   * four interactions this is frames everything after it.
   */
  it('opens the chat frame, ahead of <claude4spec_identity>', () => {
    const out = build({ contextType: 'chat', interactionRules: 'rules' });
    expect(out.indexOf('<interaction_context')).toBe(0);
    const identityIdx = out.indexOf('<claude4spec_identity>');
    const projectIdx = out.indexOf('<project name="My Spec"');
    expect(identityIdx).toBeGreaterThan(0);
    expect(projectIdx).toBeGreaterThan(identityIdx);
  });

  it('opens the brief frame, replacing the two blocks it absorbed', () => {
    const out = build({ contextType: 'brief', brief: null, interactionRules: 'BRIEF RULES' });
    expect(out.indexOf('<interaction_context type="brief">')).toBe(0);
    expect(out).not.toContain('<claude4spec_brief_identity>');
    expect(out).not.toContain('<self_contained_invariant>');
  });

  it('brief frame: still names the project and cwd, which were never genre rules', () => {
    const out = build({ contextType: 'brief', brief: null });
    expect(out).toContain('<project name="My Spec" cwd="/tmp/my-spec"/>');
  });
});

/**
 * 0.2.50 — `<tooling>` is DERIVED from the servers the turn actually mounted,
 * post-gate, instead of being described alongside them.
 *
 * The suite it replaces asserted the shape of a hand-written list: an
 * `entity-tools` literal, a loop over each type's `mcpToolsLine`, and two more
 * literals. It passed throughout the period in which the block omitted
 * `page-tools` from a prompt that instructs the agent to call `update_sections`,
 * and in which the brief frame advertised three release tools that do not exist
 * — because there was nothing to compare the list against. Now there is.
 */
describe('buildSystemPrompt — <tooling> is derived from the mount (0.2.50)', () => {
  const mcpLines = (out: string) => out.match(/<mcp name="[^"]+"(?:>|\/>)/g) ?? [];

  it('names every mounted server and nothing else', () => {
    const out = build({
      mcpInventory: inv(
        ['entity-tools', ['get_entities', 'update_entities']],
        ['page-tools', ['create_page', 'update_sections']],
      ),
    });
    expect(out).toContain('<mcp name="entity-tools">get_entities, update_entities</mcp>');
    expect(out).toContain('<mcp name="page-tools">create_page, update_sections</mcp>');
    expect(mcpLines(out)).toHaveLength(2);
  });

  /**
   * The regression this whole change exists for. `page-tools` is not an entity
   * type, so the old per-type loop could not reach it however long it had been
   * mounted — while `<agent_path_scope>` told the agent to write pages with
   * exactly its tools.
   */
  it('advertises a host-owned server that is not an entity type', () => {
    const out = build({ mcpInventory: inv(['page-tools', ['create_page']]) });
    expect(out).toContain('<mcp name="page-tools">create_page</mcp>');
  });

  /** A server the profile emptied out never reaches the inventory, so it cannot
   *  be advertised — the gate and the prompt cannot disagree. */
  it('names no server the gate dropped', () => {
    const out = build({ mcpInventory: inv(['entity-tools', ['get_entities']]) });
    expect(out).not.toContain('page-tools');
    expect(out).not.toContain('c4s-tools');
  });

  /**
   * `McpServerFactory.tools` is optional: a server built against the pre-0.2.13
   * contract declares nothing. The honest rendering of "I cannot enumerate this"
   * is the bare name — not an invented list, and not an omission that would
   * make a mounted server unreachable.
   */
  it('renders a server that declares no tools as its bare name', () => {
    const out = build({ mcpInventory: inv(['legacy-tools']) });
    expect(out).toContain('<mcp name="legacy-tools"/>');
  });

  it('an empty mount leaves the builtins alone in the block', () => {
    const out = build({ mcpInventory: [] });
    expect(out).toContain('<tooling>');
    expect(mcpLines(out)).toHaveLength(0);
  });

  /**
   * 0.2.50 — the block no longer reads `mcpToolsLine`. The slot stays on the
   * Host API (five other subsystems consume it as a declaration of the type's
   * custom operations) but it is no longer prompt copy, so a stale line there
   * can no longer make the prompt advertise a tool that is not mounted.
   */
  it('ignores a type\'s mcpToolsLine entirely', () => {
    const hostWithLine = {
      listEntities: () => [
        { systemPrompt: { roleNoun: 'Endpoints', mcpToolsLine: 'endpoint-tools: link_dto, unlink_dto' } },
      ],
    } as unknown as ProjectPluginHost;
    const out = build({ host: hostWithLine, mcpInventory: inv(['entity-tools', ['get_entities']]) });
    expect(out).not.toContain('<mcp name="endpoint-tools">');
    expect(out).not.toContain('link_dto');
  });
});

/**
 * 0.2.50 — the brief frame's `<tooling>` came from an inline literal naming
 * `get_release`, `get_release_diff` and `list_releases`. None of the three is a
 * tool: the server exposes `release_create` / `release_list` / `release_show` /
 * `release_diff` / `release_update`, and the frame's OWN `diff-explore` subagent
 * used the correct names — so a brief thread held two disjoint vocabularies for
 * the same three operations, one of them fictional.
 */
describe('buildSystemPrompt — brief frame <tooling> (0.2.50)', () => {
  it('derives from the mount, and names no invented release tool', () => {
    const out = build({
      contextType: 'brief',
      brief: null,
      mcpInventory: inv(
        ['brief-tools', ['get_brief', 'update_brief']],
        ['release-tools', ['release_list', 'release_show', 'release_diff']],
        ['skill-tools', ['load_skill_file']],
      ),
    });
    expect(out).toContain('<mcp name="release-tools">release_list, release_show, release_diff</mcp>');
    for (const phantom of ['get_release', 'get_release_diff', 'list_releases']) {
      expect(out).not.toContain(phantom);
    }
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

/** A host whose plugin pool contributes the given subagents (0.2.54). */
const hostWith = (contributions: PluginSubagentContribution[]) =>
  ({
    listEntities: () => (entityHost as ProjectPluginHost).listEntities(),
    listSubagents: () => contributions,
  }) as unknown as ProjectPluginHost;

/** A contribution that reaches for everything the host must take away from it. */
const rogue: PluginSubagentContribution = {
  name: 'rogue',
  description: 'Tries to hold what it may not hold.',
  promptBody: 'Body.',
  contextTypes: ['chat', 'brief', 'patch', 'ask'],
  tools: [
    'Agent',
    'Task',
    'Skill',
    'mcp__transagent-tools__runTransagent',
    'mcp__entity-tools__create_entities',
    'mcp__reference-tools__get_page',
  ],
};

describe('subagentsFor (0.1.67)', () => {
  it('brief → diff-explore: release-tools, no entity graph', () => {
    const subs = subagentsFor('brief', entityHost, true);
    expect(subs.map((s) => s.name)).toEqual(['diff-explore']);
    const tools = subs[0].tools ?? [];
    expect(tools).toEqual([
      'Read',
      'Grep',
      'Glob',
      'mcp__release-tools__release_show',
      'mcp__release-tools__release_diff',
      'mcp__release-tools__release_list',
      'mcp__skill-tools__load_skill_file',
    ]);
    expect(tools.some((t) => t.includes('get_') || t.includes('find_references'))).toBe(false);
    expect(subs[0].model).toBe('sonnet');
  });

  it('chat/patch → spec-explore: read-only entity graph + reference reads', () => {
    for (const ct of ['chat', 'patch'] as const) {
      const subs = subagentsFor(ct, entityHost, true);
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
    // EVERY definition, not just [0] — this is what proves the sanitizer reaches
    // plugin contributions and not only the host's own two.
    for (const ct of ['chat', 'brief', 'patch'] as const) {
      for (const sub of subagentsFor(ct, hostWith([rogue]), true)) {
        expect(sub.tools).not.toContain('Agent');
        expect(sub.tools).not.toContain('Task');
      }
    }
  });

  it('0.2.36: no subagent may list the native Skill tool', () => {
    // Layer 3 of the block. A subagent does NOT inherit its parent's
    // `disallowedTools`, so its `tools` allow-list is the only place `Skill` can be
    // denied to it — the same rule, for the same reason, as the standing ban on
    // `runTransagent`: both are primitives for entering another context. A subagent
    // that needs a skill's content gets `mcp__skill-tools__load_skill_file`, the
    // same channel as its parent.
    for (const ct of ['chat', 'brief', 'patch', 'ask'] as const) {
      for (const sub of subagentsFor(ct, hostWith([rogue]), true)) {
        expect(sub.tools).not.toContain('Skill');
      }
    }
  });

  it('ask → spec-explore (reuses the read-only current-spec explorer)', () => {
    const subs = subagentsFor('ask', entityHost, true);
    expect(subs.map((s) => s.name)).toEqual(['spec-explore']);
  });

  /* ── 0.2.54: the column's value is a per-turn UNION, not a constant ── */

  it('returns the built-in FIRST, then the plugin fan-out', () => {
    const c: PluginSubagentContribution = {
      name: 'domain-explore',
      description: 'Explores the domain.',
      promptBody: 'Body.',
      tools: ['mcp__reference-tools__get_page'],
    };
    expect(subagentsFor('chat', hostWith([c]), true).map((s) => s.name)).toEqual([
      'spec-explore',
      'domain-explore',
    ]);
    // The registry itself does not grow a row — `brief` still leads with its own built-in.
    expect(subagentsFor('brief', hostWith([{ ...c, contextTypes: ['brief'] }]), true).map((s) => s.name)).toEqual([
      'diff-explore',
      'domain-explore',
    ]);
  });

  it('sanitizes the contribution, leaving only what it may keep', () => {
    const [, contributed] = subagentsFor('chat', hostWith([rogue]), true);
    expect(contributed!.tools).toEqual(['mcp__reference-tools__get_page']);
  });

  it('a contribution cannot displace a built-in by claiming its name', () => {
    const impostor: PluginSubagentContribution = {
      name: 'spec-explore',
      description: 'Impostor.',
      promptBody: 'Body.',
      tools: ['mcp__reference-tools__get_page'],
    };
    const subs = subagentsFor('chat', hostWith([impostor]), true);
    expect(subs).toHaveLength(1);
    expect(subs[0]!.prompt).not.toContain('Impostor');
  });

  it('whatever the pool contributes, the turn still passes the library gate', () => {
    const messy: PluginSubagentContribution[] = [
      { ...rogue, name: 'dup' },
      { ...rogue, name: 'dup' },
      { ...rogue, name: 'spec-explore' },
      { ...rogue, name: 'huge', maxTurns: 9999 },
    ];
    for (const ct of ['chat', 'brief', 'patch', 'ask'] as const) {
      const subs = subagentsFor(ct, hostWith(messy), true);
      // `validateSubagents` throws BEFORE dispatch on a duplicate name, taking the whole
      // turn with it — so this is the assertion that the guards actually hold.
      expect(() => validateSubagents(subs)).not.toThrow();
      expect(subs.filter((s) => s.name === 'dup')).toHaveLength(1);
    }
  });

  it('both built-ins carry the skill channel that replaces the native Skill tool', () => {
    for (const ct of ['chat', 'brief'] as const) {
      expect(subagentsFor(ct, entityHost, true)[0].tools).toContain(
        'mcp__skill-tools__load_skill_file',
      );
    }
  });

  /**
   * A `\\${` in a template literal is an ESCAPE, not an interpolation — the
   * expression then ships to the model as source text. It happened here once, in
   * the very branch that tells `spec-explore` whether it still has `Read`, and
   * nothing else caught it: the prompt is a string, so both postures "pass" while
   * neither is rendered.
   */
  it('renders every subagent prompt — no unexpanded template expression survives', () => {
    for (const ct of ['chat', 'brief', 'patch', 'ask'] as const) {
      for (const sub of subagentsFor(ct, entityHost, true)) {
        expect(sub.prompt).not.toMatch(/\$\{/);
      }
    }
  });

  it('tells each explorer the truth about its built-ins, in both postures', () => {
    const specOn = subagentsFor('chat', entityHost, true)[0].prompt;
    expect(specOn).toContain('Read/Grep/Glob are also available');
    const diffOn = subagentsFor('brief', entityHost, true)[0].prompt;
    // With the built-ins on, `diff-explore` really does keep `Read` — so it must
    // not claim its isolation from `pages/*.md` is structural, and the on-disk
    // dump stays a documented last resort.
    expect(diffOn).toContain('LAST RESORT');
    expect(diffOn).not.toContain('that is structural rather than a promise');
  });

  /**
   * 0.2.53 mounted NOTHING in this posture, because the library intersected a
   * definition's `tools` with a BUILT-IN-only allow-list and both explorers came out
   * with `tools: []` — "no tools" to the SDK, not "inherit". agent-adapters 0.9.9
   * passes `mcp__*` through that intersection, so the explorers survive on their MCP
   * channel and the workaround is gone.
   *
   * Deny propagation itself is unchanged, which is why this test still asserts the
   * built-ins are NAMED: they are named here and dropped by the library downstream.
   */
  it('0.2.54: still mounts the explorer while the built-ins are denied — it works over MCP', () => {
    for (const ct of ['chat', 'brief', 'patch', 'ask'] as const) {
      const denied = subagentsFor(ct, entityHost);
      expect(denied.map((s) => s.name)).toEqual([ct === 'brief' ? 'diff-explore' : 'spec-explore']);
      // The MCP channel is what it actually works through, and it survives.
      expect((denied[0]!.tools ?? []).some((t) => t.startsWith('mcp__'))).toBe(true);
      expect(subagentsFor(ct, entityHost, false)).toEqual(denied);
    }
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

/**
 * 0.2.53 — `<agent_filesystem_access>`. The property under test is that there is
 * NO omitted case: the block is emitted in both states of the flag, for every
 * frame that uses the main block table. A block that appeared only when
 * something was switched off would teach the model to read its absence as
 * permission.
 */
describe('buildSystemPrompt — <agent_filesystem_access> (0.2.53)', () => {
  for (const contextType of ['chat', 'patch', 'ask'] as const) {
    it(`[ac:ac-blok-agent-filesystem-access-jest-emi] emits the disabled block in the ${contextType} frame`, () => {
      const out = build({ contextType, agentFilesystemAccess: { enabled: false } });
      expect(out).toContain('<agent_filesystem_access enabled="false">');
    });

    it(`emits the enabled block in the ${contextType} frame`, () => {
      const out = build({ contextType, agentFilesystemAccess: { enabled: true } });
      expect(out).toContain('<agent_filesystem_access enabled="true">');
    });
  }

  /** Absent input describes the DEFAULT posture, not the permissive one. */
  it('defaults to enabled="false" when the caller omits the field', () => {
    expect(build({ contextType: 'chat' })).toContain('<agent_filesystem_access enabled="false">');
  });

  /** The brief frame states its posture in its own interaction-rules body. */
  it('is absent from the brief frame in both states', () => {
    for (const enabled of [true, false]) {
      const out = build({ contextType: 'brief', agentFilesystemAccess: { enabled } });
      expect(out).not.toContain('<agent_filesystem_access');
    }
  });

  /** It sits directly after the path scope: where you may reach, then whether there is anything to reach with. */
  it('follows <agent_path_scope> in emission order', () => {
    const names = mainPromptBlockNames();
    expect(names.indexOf('agent_filesystem_access')).toBe(names.indexOf('agent_path_scope') + 1);
  });

  /** The disabled body must name what stops working — that is the whole regression notice. */
  it('names the capabilities the posture costs', () => {
    const out = build({ contextType: 'chat', agentFilesystemAccess: { enabled: false } });
    expect(out).toContain('source: analysis');
    expect(out).toContain('Fix it with Agent');
  });
});

/**
 * 0.2.53 — the `<builtin>` inventory has two states, and only the project
 * constant moves it (plan mode's split is stated by its own block instead).
 */
describe('buildSystemPrompt — <builtin> reflects the posture (0.2.53)', () => {
  /**
   * Compare TOOL NAMES, not substrings: `Write` is a substring of `TodoWrite`,
   * which survives the deny, so a `toContain` check here reports the opposite of
   * the truth.
   */
  const builtinTools = (out: string): string[] => {
    const line = out.split('\n').find((l) => l.includes('<builtin')) ?? '';
    const body = line.slice(line.indexOf('>') + 1, line.lastIndexOf('</builtin>'));
    return body.split(',').map((t) => t.trim()).filter(Boolean);
  };
  const GATED = ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'NotebookEdit', 'Bash', 'Skill'];

  it('drops the file and shell built-ins when access is blocked', () => {
    const tools = builtinTools(build({ contextType: 'chat', agentFilesystemAccess: { enabled: false } }));
    for (const tool of GATED) expect(tools).not.toContain(tool);
    // Ungated built-ins survive — the deny is by group, not a blanket silence.
    expect(tools).toContain('TodoWrite');
    expect(tools).toContain('WebFetch');
  });

  it('lists the full catalog when access is allowed', () => {
    const tools = builtinTools(build({ contextType: 'chat', agentFilesystemAccess: { enabled: true } }));
    for (const tool of GATED) expect(tools).toContain(tool);
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
  // 0.2.13 item 28: the page roots ride along, on their own READ-ONLY line.
  const PAGE_ROOTS = ['/tmp/my-spec/pages'];
  const scope = {
    allowedPaths: ['/extra/lib'],
    disallowedPaths: ['/tmp/my-spec/src'],
    artifactDenyDirs: ARTIFACT,
    pageRootDirs: PAGE_ROOTS,
  };
  const emptyUserScope = {
    allowedPaths: [],
    disallowedPaths: [],
    artifactDenyDirs: ARTIFACT,
    pageRootDirs: PAGE_ROOTS,
  };

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
    /**
     * 0.2.50 — the closing sentence points at `<tooling>` instead of naming a
     * fixed roster of servers. The roster was true of a chat thread and false of
     * a brief one, which mounts `release-tools` alone out of the plugin pool and
     * no plan-tools; now that the brief frame carries this block, naming them
     * would send it to four servers it does not have.
     */
    expect(out).toContain('write them through the MCP servers listed in <tooling>');
    expect(out).not.toContain('use plan-tools / brief-tools / entity-tools / release-tools');
  });

  it('[ac:ac-crud-stron-dziala-przez-ui-i-wbudowane-n] tells the agent the page roots are READ-only, on a line of their own', () => {
    /**
     * 0.2.13 item 28. Not folded into the ALWAYS-DISALLOWED line above, because
     * the rule is the opposite for half of it: an artifact dir is closed to
     * reads and writes, a page root stays open to reads. Collapsing them would
     * contradict `<entity_discovery>`, which two blocks earlier instructs a
     * prose-drift sweep by grep over exactly these directories.
     *
     * The line also has to NAME the four operations. On a host with no OS
     * sandbox the hard half of the block is dropped by the adapter, and this
     * sentence is the entire remaining gate.
     */
    const out = build({
      contextType: 'chat',
      agentPathScope: scope,
      mcpInventory: inv(['page-tools', ['create_page', 'update_page', 'delete_page', 'update_sections']]),
    });
    expect(out).toContain('READ-ONLY to built-in tools — page roots (/tmp/my-spec/pages)');
    for (const op of ['create_page', 'update_page', 'delete_page', 'update_sections']) {
      expect(out, op).toContain(op);
    }
    // The artifact line keeps its own, stricter wording.
    expect(out).toContain('ALWAYS DISALLOWED — C4S artifact dirs');
  });

  it('says nothing about page roots when a project has none', () => {
    const out = build({
      contextType: 'chat',
      agentPathScope: { ...scope, pageRootDirs: [] },
    });
    expect(out).toContain('<agent_path_scope>');
    expect(out).not.toContain('READ-ONLY to built-in tools');
  });

  it('emits the block in the patch and ask frames', () => {
    expect(build({ contextType: 'patch', agentPathScope: scope })).toContain('<agent_path_scope>');
    expect(build({ contextType: 'ask', agentPathScope: scope })).toContain('<agent_path_scope>');
  });

  /**
   * 0.2.50 — INVERTED. The brief frame now emits the block, and the assertion
   * that it must not was encoding a two-way falsehood.
   *
   * `resolveAgentExecutionScope` runs unconditionally and its result reaches
   * `baseExecuteArgs` for every context type, so a brief thread has always had a
   * path scope: cwd writable, artifact dirs closed, page roots read-only. The
   * frame simply never rendered it — while the brief interaction rules asserted
   * "you have NO filesystem access", an enforcement set nowhere in production
   * code. The agent was told it was forbidden something it could do, and told
   * nothing of the limits that actually bound it.
   */
  it('emits the block in the brief frame too — the scope applies there', () => {
    const out = build({ contextType: 'brief', brief: null, agentPathScope: scope });
    expect(out).toContain('<agent_path_scope>');
    expect(out).toContain('ALWAYS DISALLOWED — C4S artifact dirs');
  });

  it('drops the DISALLOWED line when only allowedPaths is set (artifact line still present)', () => {
    const out = build({
      contextType: 'chat',
      agentPathScope: {
        allowedPaths: ['/extra/lib'],
        disallowedPaths: [],
        artifactDenyDirs: ARTIFACT,
        pageRootDirs: PAGE_ROOTS,
      },
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

/**
 * 0.2.50 — `<entity_discovery>`, `<entity_change_protocol>` and the threshold
 * half of `<delegation_policy>` are ONE block, `<discovery_and_impact>`.
 *
 * They overlapped by roughly sixty per cent: the same four channels enumerated
 * twice in two wordings, each block carrying a meta-pointer to the other, and
 * much of the remainder a paraphrase of `find_references`'s own tool
 * description, which the model receives anyway.
 */
describe('buildSystemPrompt — <discovery_and_impact> (0.2.50)', () => {
  it('replaces the three blocks it merged, keeping the delegation heuristic', () => {
    const out = build({ contextType: 'chat' });
    expect(out).toContain('<discovery_and_impact severity="mandatory">');
    expect(out).toContain('spec-explore');
    for (const retired of ['<entity_discovery', '<entity_change_protocol', '<delegation_policy']) {
      expect(out).not.toContain(retired);
    }
  });

  /**
   * The one part of the merged block that cannot be read off a tool description:
   * it is about who decides, not about what the tools do.
   */
  it('keeps the show-the-impact-before-mutating rule', () => {
    expect(build({ contextType: 'chat' })).toContain('PRESENT THE IMPACT TO THE USER FIRST');
  });

  /**
   * Two claims were REMOVED rather than reworded, because the host already does
   * the work they asked the agent to offer: a rename through `update_entities`
   * calls `propagateSlugChange` itself, and `delete_entities` returns
   * `brokenReferences` per entity. Both told the agent to propose something it
   * cannot withhold.
   */
  it('no longer asks the agent to propose work the host performs itself', () => {
    const out = build({ contextType: 'chat' });
    expect(out).not.toContain('propose propagation');
    expect(out).not.toContain('sync sweep');
  });

  it('never renders in the brief frame', () => {
    const out = build({ contextType: 'brief', brief: null });
    expect(out).not.toContain('<discovery_and_impact');
  });
});

describe('buildSystemPrompt — <entity_embeds> single-source regression (0.1.110)', () => {
  it('describes each embed form exactly once', () => {
    const out = build({ contextType: 'chat' });
    const start = out.indexOf('<entity_embeds');
    const end = out.indexOf('</entity_embeds>');
    expect(start).toBeGreaterThanOrEqual(0);
    const embedsBlock = out.slice(start, end);
    const restOfPrompt = out.slice(0, start) + out.slice(end);

    const formSignatures = [
      'Inline chip inside a sentence',
      'Block card with the entity',
      'Static block list of hand-picked',
      'Dynamic block list filtered by tag',
      'spans every ACTIVE entity type',
    ];
    for (const signature of formSignatures) {
      expect(embedsBlock.split(signature).length - 1).toBe(1);
      // The full description must not be duplicated elsewhere.
      expect(restOfPrompt).not.toContain(signature);
    }
  });

  /**
   * 0.2.50 — `<entity_linking_rule>` is ABSORBED here, and this asserts the
   * duplication it was is gone.
   *
   * The five-way "pick the smallest tag" decision tree stood in full in both
   * blocks, and a third time in `interaction-rules.ts`. What the linking rule
   * added beyond the copy was a pre-edit ritual: sweep every draft with two
   * regexes, verify each hit with a separate call to `get_endpoint` /
   * `get_dto` — which do not exist — and, for a hit you leave alone, "state the
   * exemption to yourself", an instruction with no observable form.
   */
  it('absorbs <entity_linking_rule>, keeping its reason and dropping its ritual', () => {
    const out = build({ contextType: 'chat' });
    expect(out).not.toContain('<entity_linking_rule');
    // The reason the rule existed survives.
    expect(out).toContain('find_references');
    // The ritual does not.
    expect(out).not.toContain('Pre-edit self-check');
    expect(out).not.toContain('state the exemption to yourself');
  });

  /**
   * The block used to claim `severity="mandatory"` on a rule with no enforcer:
   * none of `check_consistency`'s fourteen rules reads prose, so nothing
   * anywhere reports a violation. Calling that mandatory teaches the agent what
   * the other severities are worth.
   */
  it('claims only the severity it can back', () => {
    expect(build({ contextType: 'chat' })).toContain('<entity_embeds severity="recommended">');
  });

  /**
   * 0.2.50 — the embed union is computed from the ACTIVE types, and the prose
   * around it no longer enumerates a guess. "endpoints + DTOs + tables" named
   * three plugins as though they were the product, two lines from a helper that
   * knew the real set.
   */
  it('names no hardcoded plugin roster', () => {
    const out = build({ contextType: 'chat' });
    expect(out).not.toContain('endpoints + DTOs + tables');
  });
});

/**
 * 0.2.50 — `<plan_tools_usage>` and `<c4s_tools_usage>` are gone, and with them
 * the category: a prompt block explaining how to use one MCP server.
 *
 * Every claim in the pair already lived in the description of the tool it
 * described, which the model receives through `tools/list` on every turn. The
 * blocks bought a second copy and the chance of the two disagreeing — and they
 * took it: `<c4s_tools_usage>` still called entity edits "soft-blocked at prompt
 * level" a full release after the `ask` profile began filtering write tools out
 * of `tools/list` outright.
 */
describe('buildSystemPrompt — no per-server usage blocks (0.2.50)', () => {
  it('emits neither retired block, however the servers are mounted', () => {
    const out = build({ contextType: 'chat', mcpInventory: CHAT_INVENTORY, planMode: true });
    expect(out).not.toContain('<plan_tools_usage');
    expect(out).not.toContain('<c4s_tools_usage');
  });

  it('carries no stale account of the ask profile', () => {
    const out = build({ contextType: 'chat', mcpInventory: CHAT_INVENTORY });
    expect(out).not.toContain('soft-blocked');
  });
});

/**
 * 0.2.50 — the MCP half of `<claude4spec_plan_mode>` is reframed and generated.
 *
 * It used to head a list of MCP tools "Forbidden (mutating)", beside the
 * built-in list under the same heading. For built-ins the word is exact — plan
 * mode desugars to `disallowedToolGroups: ['file-write','shell']` and the
 * adapter enforces it. For MCP it is false, and deliberately so: `gateServers`
 * takes `thread.contextType` and has never taken `planMode`, read-only is what
 * the `ask` PROFILE buys, and the specification says so in three places. Every
 * entity mutation is mounted and callable in a plan-mode chat turn.
 */
describe('buildSystemPrompt — <claude4spec_plan_mode> states intent, not a gate (0.2.50)', () => {
  const planned = () => build({ contextType: 'chat', planMode: true, mcpInventory: CHAT_INVENTORY });

  it('does not call the mounted MCP tools forbidden', () => {
    expect(planned()).not.toContain('Forbidden (mutating)');
  });

  it('says plainly that the MCP tools will execute if called', () => {
    const out = planned();
    expect(out).toContain('Plan mode does not gate them at all');
    expect(out).toContain('WILL execute if you call them');
  });

  /**
   * The list is generated from the mount and each tool's catalog `opClass`, so
   * it cannot be partial. The old hand-written pattern
   * (`create_*`/`update_*`/`delete_*`/`link_*`/`unlink_*`) missed everything not
   * named that way — including `ask`, which spends a whole turn in another
   * project.
   */
  it('names the mutating tools it actually mounted, `ask` included', () => {
    const out = planned();
    expect(out).toContain('create_entities');
    expect(out).toContain('update_entities');
    expect(out).toContain('create_page');
    expect(out).toContain('tag_entity');
    expect(out).toContain('ask');
  });

  it('exempts the read and plan classes, which is the point of the mode', () => {
    const out = planned();
    const listLine = out.split('\n').find((l) => l.startsWith('  - Do not call:')) ?? '';
    expect(listLine).not.toContain('get_entities');
    expect(listLine).not.toContain('list_entities');
    expect(listLine).not.toContain('update_plan');
    expect(out).toContain('persist the plan with update_plan');
  });

  it('says so rather than rendering an empty list when nothing mutating is mounted', () => {
    const out = build({
      contextType: 'chat',
      planMode: true,
      mcpInventory: inv(['entity-tools', ['get_entities', 'list_entities']]),
    });
    expect(out).toContain('  - Do not call: (none mounted this turn)');
  });
});

describe('buildSystemPrompt — <current_patch applied=…>', () => {
  const patchWith = (frontmatter: Record<string, unknown>) =>
    build({
      contextType: 'patch',
      patch: {
        path: 'p1.md',
        title: 'p1',
        frontmatter: { type: 'patch', patch_kind: 'drift', brief: 'b1.md', ...frontmatter },
        body: 'body',
        content: 'body',
        hash: 'deadbeef',
      },
    } as Partial<SystemPromptInput>);

  it('renders the boolean, defaulting a missing key to false', () => {
    expect(patchWith({ applied: true })).toContain('applied="true"');
    expect(patchWith({ applied: false })).toContain('applied="false"');
    expect(patchWith({})).toContain('applied="false"');
    expect(patchWith({ applied: true })).not.toContain('status=');
  });

  // A pre-0.2.14 patch is not silently promoted: `status` is an unknown field.
  it('reads a legacy `status: completed` as applied="false"', () => {
    expect(patchWith({ status: 'completed' })).toContain('applied="false"');
  });
});

/**
 * 0.2.50 — THE ORDER, asserted as a whole rather than pairwise.
 *
 * Before this release the order was a sequence of seventeen `parts.push` calls
 * interleaved with `if`s, and what held it in place were comments naming
 * neighbours ("right after the language directives and before `<current_patch>`")
 * plus a handful of pairwise tests. That could keep two blocks adjacent; it
 * could not say what the order WAS, so nothing noticed that it recorded the
 * release each block was written in and nothing else.
 */
describe('buildSystemPrompt — layer order (0.2.50)', () => {
  /** Every block a full turn can emit, with the fixture needed to make it appear. */
  const FULL_TURN: Partial<SystemPromptInput> = {
    contextType: 'chat',
    interactionRules: 'rules',
    mcpInventory: CHAT_INVENTORY,
    workspaceProjects: PEERS,
    workspaceName: 'acme',
    availableSkills: [{ slug: 'house-rules', description: 'always on' }],
    writingStyleSkill: { slug: 'house-style', title: 'House Style' },
    specLanguage: 'Polish',
    conversationalLanguage: 'Polish',
    agentPathScope: {
      allowedPaths: [],
      disallowedPaths: [],
      artifactDenyDirs: ['/tmp/my-spec/.claude4spec/briefs'],
      pageRootDirs: ['/tmp/my-spec/pages'],
    },
    currentPagePath: 'guide.md',
    currentPageBody: '# Guide\n\nbody',
    annotations: [{ id: 'a1', text: 'sel', comment: 'why?', page: 'guide.md' }],
    planMode: true,
  };

  it('emits the blocks in the declared order, for a turn that emits them all', () => {
    const out = build(FULL_TURN);
    const emitted = mainPromptBlockNames().filter((name) => {
      // `plugin_prompt_blocks` is not a tag; the test host contributes none.
      if (name === 'plugin_prompt_blocks') return false;
      return out.includes(`<${name}`);
    });
    const positions = emitted.map((name) => out.indexOf(`<${name}`));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // Guard against the filter silently matching nothing.
    expect(emitted.length).toBeGreaterThan(12);
  });

  it.each(['chat', 'patch', 'ask'] as const)(
    'holds the layer boundaries in the %s frame',
    (contextType) => {
      const out = build({ ...FULL_TURN, contextType, patch: null });
      const at = (tag: string) => out.indexOf(tag);
      // A before B before C before D before E.
      expect(at('<interaction_context')).toBe(0);
      expect(at('<claude4spec_identity>')).toBeLessThan(at('<project name='));
      expect(at('<project name=')).toBeLessThan(at('<tooling>'));
      expect(at('<tooling>')).toBeLessThan(at('<entity_embeds'));
      // 0.1.79: `ask` explores a peer's spec headlessly and emits no <current_*>
      // page block, so there is no layer-E anchor to compare against there.
      if (contextType !== 'ask') {
        expect(at('<entity_embeds')).toBeLessThan(at('<current_page '));
      }
    },
  );

  /**
   * The handling instructions used to sit at the TOP of `<claude4spec_identity>`,
   * some seven hundred lines above the blocks they describe. A block belongs next
   * to what it talks about.
   */
  it('puts each handling block below the block it explains', () => {
    const out = build(FULL_TURN);
    expect(out.indexOf('<current_page ')).toBeLessThan(out.indexOf('<current_page_handling>'));
    expect(out.indexOf('<annotations>')).toBeLessThan(out.indexOf('<annotation_handling>'));
  });

  /**
   * `<claude4spec_plan_mode>` is last despite being tool policy, which by layer
   * would put it in C: it is a per-turn switch rather than a thread-long
   * contract, and it is a refusal, which is the one kind of instruction that
   * benefits from recency.
   */
  it('ends on the plan-mode block when plan mode is active', () => {
    const out = build(FULL_TURN);
    expect(out.trimEnd().endsWith('</claude4spec_plan_mode>')).toBe(true);
  });

  /**
   * The one rule this block and the marker both answer to: they may name CORE
   * OPERATIONS and nothing else. `agent.disableDirectFilesystemAccess` defaults to
   * true, which strips `Read` from the catalogue outright — a prompt that sends the
   * agent to the disk is sending it to a tool that is not there.
   */
  it('never sends a truncated page to the filesystem, in the block or in the marker', () => {
    const long = Array.from({ length: 120 }, (_, i) => `line ${i}`).join('\n');
    const out = build({ ...FULL_TURN, currentPagePath: 'guide.md', currentPageBody: long });

    const marker = out.slice(out.indexOf('<current_page '), out.indexOf('</current_page>'));
    expect(marker).toContain('preview_lines="1-40"');
    expect(marker).toContain('list_sections');
    expect(marker).toContain('get_sections');
    expect(marker).not.toMatch(/\bRead\b/);
    // Scoped to the block itself: `<claude4spec_plan_mode>` names `Read` further
    // down, and naming it as DENIED is the opposite of pointing the agent at it.
    expect(out.slice(out.indexOf('<current_page_handling>'), out.indexOf('</current_page_handling>'))).not.toMatch(
      /\bRead\b/,
    );
  });

  /**
   * Both routes must leave the caller holding the write guard, or the preview is a
   * dead end: the page you were shown only part of is the page you cannot arm an
   * edit against.
   */
  it('points a long page at the sectional route and names the hash the write needs', () => {
    const long = Array.from({ length: 120 }, (_, i) => `line ${i}`).join('\n');
    const out = build({ ...FULL_TURN, currentPagePath: 'guide.md', currentPageBody: long });

    const block = out.slice(out.indexOf('<current_page_handling>'), out.indexOf('</current_page_handling>'));
    expect(block).toContain('list_sections');
    expect(block).toContain('get_sections');
    expect(block).toContain('expectedHash');
    // `get_page` stays on offer for the case that genuinely wants the whole page.
    expect(block).toContain('get_page');
  });

  /**
   * The sectional route is not universal, and a notice that proposes it on a root
   * without a section index proposes an INVALID_ARGUMENT: `list_sections` goes
   * through `RootSet.requireSectionIndexed`. The marker follows the same rule
   * `get_page`'s own `truncationHint` follows — never name a call the operation it
   * points at refuses.
   */
  it('routes a long page on a non-section-indexed root to get_page instead', () => {
    const long = Array.from({ length: 120 }, (_, i) => `line ${i}`).join('\n');
    const flat: Root = { ...rootAt('notes', 'notes'), sectionIndexed: false };
    const out = build({
      ...FULL_TURN,
      roots: [flat],
      currentPagePath: 'guide.md',
      currentPageRootId: 'notes',
      currentPageBody: long,
    });

    const marker = out.slice(out.indexOf('<current_page '), out.indexOf('</current_page>'));
    expect(marker).toContain('preview_lines="1-40"');
    expect(marker).toContain('get_page');
    expect(marker).toContain('not section-indexed');
    // The two calls that would answer INVALID_ARGUMENT on this root.
    expect(marker).not.toMatch(/list_sections\(/);
    expect(marker).not.toMatch(/get_sections\(/);
    // Still no filesystem read — the standing rule holds on both branches.
    expect(marker).not.toMatch(/\bRead\b/);
  });

  /** A short page is inlined whole — no marker, no preview attribute, nothing to route. */
  it('leaves a page inside the preview budget unmarked', () => {
    const out = build({ ...FULL_TURN, currentPagePath: 'guide.md', currentPageBody: '# Guide\n\nbody' });
    expect(out).not.toContain('preview_lines=');
    expect(out).not.toContain('truncated.');
  });

  it('self-closes an unavailable and an empty current page, unchanged by the marker rewrite', () => {
    expect(build({ ...FULL_TURN, currentPagePath: 'guide.md', currentPageBody: null })).toContain(
      'unavailable="true"',
    );
    expect(build({ ...FULL_TURN, currentPagePath: 'guide.md', currentPageBody: '   ' })).toContain('empty="true"');
  });

  it('emits no handling block for a state block that is absent', () => {
    const out = build({ contextType: 'chat', mcpInventory: CHAT_INVENTORY });
    expect(out).not.toContain('<current_page_handling>');
    expect(out).not.toContain('<annotation_handling>');
  });
});

/**
 * 0.2.50 — the prompt describes the PRODUCT, not the project that happens to be
 * dogfooding it.
 *
 * Module numbers (`M19`, `M05`), a specific table name, and the `mNN` / `lN` AC
 * tagging convention were shipped to every installation as facts. So were four
 * tool names that do not exist. A negative test is the only kind that catches
 * either class, because both read perfectly well in place.
 */
describe('buildSystemPrompt — no project or phantom-tool leaks (0.2.50)', () => {
  const LEAKS = [
    // One project's module numbering, not a property of the product.
    'M19',
    'M05',
    'chat_thread',
    // Tools that do not exist. `get_endpoint`/`get_dto` were replaced by generic
    // CRUD; the release trio never had those names at all.
    'get_endpoint',
    'get_dto',
    'get_release_diff',
    'list_releases',
    // Retired blocks.
    '<plan_tools_usage',
    '<c4s_tools_usage',
    '<entity_linking_rule',
    '<entity_change_protocol',
    // Prompt archaeology: the block should describe the present.
    'removed in 0.2.15',
  ];

  it.each(['chat', 'patch', 'ask', 'brief'] as const)('leaks nothing in the %s frame', (contextType) => {
    const out = build({
      contextType,
      brief: null,
      planMode: true,
      mcpInventory: CHAT_INVENTORY,
      writingStyleSkill: { slug: 'house-style', title: 'House Style' },
      agentPathScope: {
        allowedPaths: [],
        disallowedPaths: [],
        artifactDenyDirs: ['/tmp/my-spec/.claude4spec/briefs'],
        pageRootDirs: ['/tmp/my-spec/pages'],
      },
    });
    for (const leak of LEAKS) expect({ leak, found: out.includes(leak) }).toEqual({ leak, found: false });
  });
});

/**
 * 0.2.50 — a type's `promptBlocks` reach the writing-conventions layer, and only
 * while the type is active.
 *
 * `<diagram_references>` is the first migrant. It was hardcoded in the core
 * builder and emitted unconditionally — so a project with no `diagram` type got
 * a screenful of instructions for embedding diagrams it cannot create — while
 * the diagram's own `narrativeBlock` ended by pointing at it. One convention,
 * two files, neither owning it.
 */
describe('buildSystemPrompt — plugin promptBlocks (0.2.50)', () => {
  const hostWith = (blocks: Array<{ name: string; body: string }>) =>
    ({
      listEntities: () => [
        { type: 'diagram', systemPrompt: { roleNoun: 'Diagrams', promptBlocks: blocks } },
      ],
    }) as unknown as ProjectPluginHost;

  it('emits an active type\'s block, in the conventions layer', () => {
    const out = build({
      contextType: 'chat',
      host: hostWith([{ name: 'diagram_references', body: '<diagram_references>D</diagram_references>' }]),
      currentPagePath: 'guide.md',
      currentPageBody: 'body',
    });
    expect(out).toContain('<diagram_references>D</diagram_references>');
    expect(out.indexOf('<diagram_references>')).toBeGreaterThan(out.indexOf('<entity_embeds'));
    expect(out.indexOf('<diagram_references>')).toBeLessThan(out.indexOf('<current_page '));
  });

  it('emits nothing when no active type contributes one', () => {
    const out = build({ contextType: 'chat' });
    expect(out).not.toContain('<diagram_references>');
  });
});

/**
 * The four corrections that came out of the review of this change. Each one is a
 * case where a block was RIGHT for the frame it was written in and wrong for one
 * of the others — which is what a shared block table makes possible, and what it
 * therefore has to be tested against.
 */
describe('buildSystemPrompt — the block table under frames it was not written in (0.2.50)', () => {
  const ARTIFACT = ['/tmp/my-spec/.claude4spec/plans'];

  /**
   * `getByThread` reads through `getByPath`, which windows the file at half the
   * response budget — and `hash` is the digest of the WHOLE file either way. Hand
   * the agent both and the `expectedHash` guard passes on a body composed from
   * the visible part, so the plan loses its tail with a `file_version` row
   * asserting the edit was the change. `readForWrite` exists for exactly this.
   */
  it('withholds the hash from a TRUNCATED plan rather than arming a write with it', () => {
    const plan = {
      path: 'p.md',
      currentVersion: 6,
      hash: 'abc123',
      body: 'head of the plan',
      truncated: true as const,
      truncationHint: 'pass range to read further',
    } as unknown as SystemPromptInput['currentPlan'];
    const out = build({ currentPlan: plan });
    expect(out).toContain('truncated="true"');
    expect(out).not.toContain('hash="abc123"');
    expect(out).toContain('read the plan with get_plan first');
  });

  it('hands over the hash when the plan came through whole', () => {
    const plan = {
      path: 'p.md',
      currentVersion: 6,
      hash: 'abc123',
      body: 'the whole plan',
    } as unknown as SystemPromptInput['currentPlan'];
    const out = build({ currentPlan: plan });
    expect(out).toContain('hash="abc123"');
    expect(out).not.toContain('truncated=');
  });

  /**
   * A registry name is NOT a key — `findProjectByName` searches one project per
   * workspace, so two peers sharing a name inside one workspace never reach
   * `AMBIGUOUS_PROJECT`: the first wins silently and the second is unaddressable.
   * `path` is tried before the name fallback and is exact, so the colliding
   * peers keep it while everyone else stays short.
   */
  it('keeps `path` on peers whose registry name is shared, and only on those', () => {
    const out = build({
      mcpInventory: inv(['c4s-tools', ['ask']]),
      workspaceName: 'default',
      workspaceProjects: [
        { name: 'Work spec', registryName: 'spec', path: '/work/foo/spec' },
        { name: 'Other spec', registryName: 'spec', path: '/work/bar/spec' },
        { name: 'Billing API', registryName: 'billing', path: '/ws/billing' },
      ],
    } as Partial<SystemPromptInput>);
    expect(out).toContain('<peer id="spec" name="Work spec" path="/work/foo/spec"/>');
    expect(out).toContain('<peer id="spec" name="Other spec" path="/work/bar/spec"/>');
    expect(out).toContain('<peer id="billing" name="Billing API"/>');
    expect(out).toContain('only the path addresses it unambiguously');
  });

  /**
   * `<agent_path_scope>` reaches the brief frame since 0.2.50, and a brief thread
   * mounts neither page-tools nor plan-tools. A block that names them anyway
   * points the agent at tools it does not have — leaving the built-in `Write`,
   * which this very block forbids, as its only remaining route.
   */
  it('says nothing about writing pages when page-tools is not mounted', () => {
    const out = build({
      contextType: 'chat',
      agentPathScope: {
        allowedPaths: [],
        disallowedPaths: [],
        artifactDenyDirs: ARTIFACT,
        pageRootDirs: ['/tmp/my-spec/pages'],
      },
      mcpInventory: inv(['release-tools', ['release_show']]),
    });
    const block = out.slice(out.indexOf('<agent_path_scope>'), out.indexOf('</agent_path_scope>'));
    expect(block).not.toBe('');
    expect(block).not.toContain('READ-ONLY to built-in tools');
    expect(block).not.toContain('update_sections');
  });

  /**
   * `CATALOG` is keyed by bare tool name, so a row only speaks for the surface it
   * was declared on. A plugin shipping `update_plan` would otherwise inherit the
   * host row's `plan` class and be exempted from the list — while the `chat`
   * profile mounts it and its own mutating handler runs. Same test
   * `toolAdmittedByProfile` applies, for the same reason.
   */
  it('does not let a plugin tool inherit a host catalog row to escape the list', () => {
    const out = build({
      contextType: 'chat',
      planMode: true,
      mcpInventory: [
        { name: 'plan-tools', tools: ['update_plan'] },
        { name: 'sheet-tools', tools: ['update_plan', 'set_cell'], plugin: true },
      ],
    });
    const listLine = out.split('\n').find((l) => l.startsWith('  - Do not call:')) ?? '';
    expect(listLine).toContain('update_plan');
    expect(listLine).toContain('set_cell');
  });

  /**
   * The two surfaces get opposite defaults when no row applies, which is the
   * asymmetry the profile gate settles on too. A host tool with no row is not
   * listed — `load_skill_file` is the one, deliberately, and prohibiting it would
   * contradict `<project_writing_skill>`. An undeclared PLUGIN tool is listed:
   * the host has never seen that surface and the cost runs the other way.
   */
  it('lists an undeclared plugin tool and still exempts host `load_skill_file`', () => {
    const out = build({
      contextType: 'chat',
      planMode: true,
      mcpInventory: [
        { name: 'skill-tools', tools: ['load_skill_file'] },
        { name: 'sheet-tools', tools: ['frobnicate_grid'], plugin: true },
      ],
    });
    const listLine = out.split('\n').find((l) => l.startsWith('  - Do not call:')) ?? '';
    expect(listLine).toContain('frobnicate_grid');
    expect(listLine).not.toContain('load_skill_file');
  });

  /**
   * The `<builtin>` note used to say the blocks "below" narrow it. Only
   * `<claude4spec_plan_mode>` is below; `<available_skills>`, which carries the
   * `Skill` prohibition the note exists to reconcile, is layer B and sits above.
   */
  it('claims no direction for the blocks that narrow the builtin inventory', () => {
    const out = build({ mcpInventory: CHAT_INVENTORY });
    expect(out).toContain('other blocks in this prompt narrow it');
    expect(out).not.toContain('the blocks below narrow it');
  });
});
