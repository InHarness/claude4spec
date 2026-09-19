import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, type SystemPromptInput, type PeerProject } from './chat-context.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import type { Annotation, Brief, Plan } from '../../shared/entities.js';
import type { PatchDetail } from './patch.js';
import { diagramSystemPrompt } from '../entities/diagram/system-prompt.js';
import { INTERACTION_RULES } from './interaction-rules.js';
import { DEFAULT_PAGES_ROOT_PROPS, type Root } from '../../shared/types.js';

/**
 * 0.2.97 — the GOLDEN prompt, byte for byte.
 *
 * Brief 0-2-96-to-0-2-97 moved the specification's description of the prompt
 * into a composer (M48) that assembles blocks declared by the modules owning
 * them, with the composition declared by the context type. The TEXT of the
 * prompt did not change in that release — it was copied from this code into the
 * specification, not the other way round. These snapshots were recorded before
 * the code was reorganised to match, and they are the proof that it was: the
 * reorganisation passes them without `-u`.
 *
 * Every scenario is whole-prompt, not a fragment, so a block that moves, doubles
 * or disappears shows up as a diff even when no targeted test looks at it.
 * Updating a snapshot here is a decision about what the model reads — make it
 * deliberately.
 */

function rootAt(dir: string, id = 'pages', sectionIndexed = true): Root {
  return { id, name: id, dir, builtin: id === 'pages', ...DEFAULT_PAGES_ROOT_PROPS, sectionIndexed, linkTargets: [] };
}

const emptyHost = { listEntities: () => [] } as unknown as ProjectPluginHost;

/** An endpoint-like type with a narrative row, a type that opts out (no roleNoun), and diagram. */
const typedHost = {
  listEntities: () => [
    {
      type: 'endpoint',
      systemPrompt: {
        roleNoun: 'Endpoints',
        narrativeBlock: 'HTTP endpoints; link DTOs with link_dto.',
        mcpToolsLine: 'endpoint-tools: link_dto, unlink_dto',
      },
    },
    { type: 'ui-view', systemPrompt: { roleNoun: '' } },
    { type: 'diagram', systemPrompt: diagramSystemPrompt },
  ],
} as unknown as ProjectPluginHost;

const endpointOnlyHost = {
  listEntities: () => [{ type: 'endpoint', systemPrompt: { roleNoun: 'Endpoints' } }],
} as unknown as ProjectPluginHost;

const FULL_INVENTORY = [
  { name: 'entity-tools', tools: ['create_entities', 'get_entities', 'update_entities', 'delete_entities', 'list_entities'] },
  { name: 'reference-tools', tools: ['create_tag', 'tag_entity', 'find_references', 'check_consistency'] },
  { name: 'page-tools', tools: ['get_page', 'create_page', 'update_page', 'delete_page', 'update_sections'] },
  { name: 'skill-tools', tools: ['load_skill_file'] },
  { name: 'plan-tools', tools: ['get_plan', 'update_plan', 'list_plan_versions', 'get_plan_version', 'mark_plan_applied'] },
  { name: 'c4s-tools', tools: ['ask'] },
  { name: 'endpoint-tools', tools: ['link_dto', 'unlink_dto'], plugin: true },
  { name: 'legacy-tools' },
];

const BRIEF_INVENTORY = [
  { name: 'brief-tools', tools: ['get_brief', 'update_brief'] },
  { name: 'release-tools', tools: ['release_list', 'release_diff'] },
  { name: 'skill-tools', tools: ['load_skill_file'] },
];

const PEERS_UNIQUE: PeerProject[] = [
  { name: 'Billing API', registryName: 'billing', path: '/ws/billing', description: 'Money "in" & out.' },
  { name: 'Auth', registryName: 'auth', path: '/ws/auth' },
];
const PEERS_COLLIDING: PeerProject[] = [
  { name: 'Spec A', registryName: 'spec', path: '/ws/a/spec' },
  { name: 'Spec B', registryName: 'spec', path: '/ws/b/spec' },
  { path: '/ws/broken' },
];

const ANNOTATIONS: Annotation[] = [
  { id: 'a1', page: 'modules/m01.md', text: 'Selected **text**', comment: 'Tighten this' },
  { id: 'a2', page: 'modules/other.md', text: 'Elsewhere', comment: '' },
];

const LONG_BODY = Array.from({ length: 45 }, (_, i) => `line ${i + 1}`).join('\n');
const SHORT_BODY = '# Title\n\nShort page.';

function plan(over: Partial<Plan> = {}): Plan {
  return {
    path: 'add-dark-mode.md',
    frontmatter: {} as Plan['frontmatter'],
    body: '1. Do the thing\n2. Then the other',
    content: '---\n---\n1. Do the thing',
    hash: 'planhash',
    currentVersion: 3,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-02',
    ...over,
  };
}

function brief(roots?: string[]): Brief {
  return {
    path: '0-1-0-to-0-2-0.md',
    frontmatter: {
      type: 'brief',
      from_release: '0.1.0',
      to_release: null,
      generated_at: '2026-01-01',
      implemented: false,
      ...(roots ? { roots } : {}),
    },
    body: '# Brief body',
    content: '---\ntype: brief\n---\n# Brief body',
    hash: 'briefhash',
  } as Brief;
}

function patch(kind?: string): PatchDetail {
  return {
    path: 'p-1.md',
    title: 'P1',
    frontmatter: {
      type: 'patch',
      ...(kind ? { patch_kind: kind } : {}),
      created_at: '2026-01-01',
      created_by: 'agent',
      brief: '0-1-0-to-0-2-0.md',
    },
    body: 'Patch body',
    content: '---\ntype: patch\n---\nPatch body',
    hash: 'patchhash',
  } as unknown as PatchDetail;
}

const PATH_SCOPE = {
  allowedPaths: ['/extra/allowed'],
  disallowedPaths: ['/tmp/my-spec/secret'],
  artifactDenyDirs: ['/tmp/my-spec/.claude4spec/plans', '/tmp/my-spec/.claude4spec/briefs'],
  pageRootDirs: ['/tmp/my-spec/pages', '/outside/adr'],
};

function base(over: Partial<SystemPromptInput> = {}): SystemPromptInput {
  return {
    host: emptyHost,
    projectName: 'My Spec',
    cwd: '/tmp/my-spec',
    roots: [rootAt('pages'), rootAt('/outside/adr', 'adr', false)],
    currentPagePath: null,
    currentPageBody: null,
    ...over,
  };
}

/** Everything switched on — the fullest prompt each frame can produce. */
function full(contextType: SystemPromptInput['contextType'], over: Partial<SystemPromptInput> = {}): SystemPromptInput {
  return base({
    contextType,
    host: typedHost,
    interactionRules: INTERACTION_RULES[contextType ?? 'chat'],
    currentPagePath: 'modules/m01.md',
    currentPageRootId: 'pages',
    currentPageBody: LONG_BODY,
    annotations: ANNOTATIONS,
    planMode: true,
    currentPlan: plan(),
    mcpInventory: contextType === 'brief' ? BRIEF_INVENTORY : FULL_INVENTORY,
    workspaceProjects: PEERS_UNIQUE,
    workspaceName: 'default',
    writingStyleSkill: { slug: 'layered-vertical-slices', title: 'Layered "vertical" slices' },
    availableSkills: [
      { slug: 'layered-vertical-slices', description: 'The style.' },
      { slug: 'mockup-generator', description: 'Makes <mockups> & more.' },
    ],
    specLanguage: 'Polski',
    conversationalLanguage: 'Deutsch',
    agentPathScope: PATH_SCOPE,
    agentFilesystemAccess: { enabled: false },
    brief: contextType === 'brief' ? brief(['pages', 'adr']) : null,
    patch: contextType === 'patch' ? patch('drift') : null,
    ...over,
  });
}

/** Everything off — the leanest prompt each frame can produce. */
function lean(contextType: SystemPromptInput['contextType']): SystemPromptInput {
  return base({ contextType });
}

const SCENARIOS: Record<string, SystemPromptInput> = {
  // ── the four frames, full and lean ───────────────────────────────────────
  'chat full': full('chat'),
  'chat lean': lean('chat'),
  'patch full': full('patch'),
  'patch lean': lean('patch'),
  'ask full': full('ask'),
  'ask lean': lean('ask'),
  'brief full': full('brief'),
  'brief lean': lean('brief'),

  // ── plan mode / plan ─────────────────────────────────────────────────────
  'chat plan mode off, plan pinned': full('chat', { planMode: false }),
  'chat plan truncated': full('chat', {
    currentPlan: plan({ truncated: true, truncationHint: 'read with range 1:200' }),
  }),
  'chat plan truncated no hint': full('chat', { currentPlan: plan({ truncated: true }) }),
  'chat plan empty body': full('chat', { currentPlan: plan({ body: '   ' }) }),

  // ── current page variants ────────────────────────────────────────────────
  'chat page unavailable': full('chat', { currentPageBody: null }),
  'chat page empty': full('chat', { currentPageBody: '  \n ' }),
  'chat page short': full('chat', { currentPageBody: SHORT_BODY }),
  'chat page long unindexed root': full('chat', {
    currentPagePath: 'decisions/0001.md',
    currentPageRootId: 'adr',
  }),
  'chat page long unknown root': full('chat', {
    currentPagePath: 'x.md',
    currentPageRootId: 'nowhere',
  }),
  'chat page 41 lines': full('chat', {
    currentPageBody: Array.from({ length: 41 }, (_, i) => `l${i}`).join('\n'),
  }),
  'chat page, no root id given': full('chat', { currentPageRootId: undefined }),

  // ── languages ────────────────────────────────────────────────────────────
  'chat spec language only': full('chat', { conversationalLanguage: undefined }),
  'chat conversational language only': full('chat', { specLanguage: undefined }),
  'brief both languages': full('brief'),
  'brief no languages': full('brief', { specLanguage: undefined, conversationalLanguage: undefined }),

  // ── access ───────────────────────────────────────────────────────────────
  'chat builtins enabled': full('chat', { agentFilesystemAccess: { enabled: true } }),
  'chat no fs access given': full('chat', { agentFilesystemAccess: undefined }),
  'brief builtins enabled': full('brief', { agentFilesystemAccess: { enabled: true } }),
  'chat no page-tools': full('chat', {
    mcpInventory: FULL_INVENTORY.filter((s) => s.name !== 'page-tools'),
  }),
  'chat empty path lists': full('chat', {
    agentPathScope: { ...PATH_SCOPE, allowedPaths: [], disallowedPaths: [], pageRootDirs: [] },
  }),
  'chat no path scope given': full('chat', { agentPathScope: undefined }),

  // ── workspace peers ──────────────────────────────────────────────────────
  'chat colliding peers': full('chat', { workspaceProjects: PEERS_COLLIDING }),
  'chat peers but no c4s-tools': full('chat', {
    mcpInventory: FULL_INVENTORY.filter((s) => s.name !== 'c4s-tools'),
  }),
  'chat no peers': full('chat', { workspaceProjects: [] }),
  'chat peers, no workspace name': full('chat', { workspaceName: undefined }),

  // ── skills ───────────────────────────────────────────────────────────────
  'chat no writing style, no skills': full('chat', { writingStyleSkill: null, availableSkills: [] }),
  'brief no writing style, no skills': full('brief', { writingStyleSkill: null, availableSkills: [] }),

  // ── entity types ─────────────────────────────────────────────────────────
  'chat endpoint-only': full('chat', { host: endpointOnlyHost }),
  'chat no entity types': full('chat', { host: emptyHost }),

  // ── annotations ──────────────────────────────────────────────────────────
  'chat no annotations': full('chat', { annotations: [] }),
  'chat annotations, no current page': full('chat', { currentPagePath: null }),
  'brief no annotations': full('brief', { annotations: [] }),

  // ── artifacts ────────────────────────────────────────────────────────────
  'patch without kind': full('patch', { patch: patch() }),
  'patch without artifact': full('patch', { patch: null }),
  'chat with a patch in input': full('chat', { patch: patch('drift') }),
  'brief roots without pages': full('brief', { brief: brief(['adr']) }),
  'brief whole release': full('brief', { brief: brief() }),
  'brief no artifact': full('brief', { brief: null }),
  'brief released window': full('brief', {
    brief: { ...brief(), frontmatter: { ...brief().frontmatter, from_release: null, to_release: '0.2.0', implemented: true } },
  }),

  // ── no rules passed ──────────────────────────────────────────────────────
  'patch without rules': full('patch', { interactionRules: undefined }),
  'no context type at all': base({ host: typedHost, mcpInventory: FULL_INVENTORY }),
};

describe('system prompt — golden (0.2.97)', () => {
  for (const [name, input] of Object.entries(SCENARIOS)) {
    it(name, () => {
      expect(buildSystemPrompt(input)).toMatchSnapshot();
    });
  }
});
