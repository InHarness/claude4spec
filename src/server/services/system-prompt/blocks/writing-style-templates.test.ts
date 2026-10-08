import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, type SystemPromptInput } from '../../chat-context.js';
import { INTERACTION_RULES } from '../../interaction-rules.js';
import type { ProjectPluginHost } from '../../../core/plugin-host/types.js';

/**
 * 2.1.9 — the two prompt-block templates this window changed, asserted VERBATIM
 * against their code-snippet entities, plus the M15 criteria that read them:
 *
 *  - `szablon-project-writing-skill` (M15 L16 `fviol01i`) — the block now carries
 *    the sentence excluding skill packages from the binding style;
 *  - `szablon-agent-filesystem-access` (M05 L16 `0ffkwcew`) — scaffolding a
 *    writing style is gone from both variants (it writes through
 *    `update_skill_file`, which the flag does not touch).
 */

const host = { listEntities: () => [] } as unknown as ProjectPluginHost;

function build(overrides: Partial<SystemPromptInput>): string {
  return buildSystemPrompt({
    host,
    projectName: 'My Spec',
    cwd: '/tmp/my-spec',
    roots: [{ id: 'pages', name: 'pages', dir: 'pages', builtin: true }],
    currentPagePath: null,
    currentPageBody: null,
    ...overrides,
  });
}

const block = (out: string, tag: string): string =>
  new RegExp(`<${tag}[ >][\\s\\S]*?</${tag}>`).exec(out)?.[0] ?? '';

/** The entity's `code`, placeholders `{slug stylu}` / `{tytuł stylu}` filled. */
const PROJECT_WRITING_SKILL_TEMPLATE = (slug: string, title: string): string =>
  [
    `<project_writing_skill slug="${slug}" title="${title}">`,
    'This project has an active writing style, and it is BINDING on everything you produce: pages, plans, entity content, and the structure of your answers all follow it.',
    'Skill packages are outside this binding: when you write or edit one, follow the skill-author skill instead.',
    '',
    'You do not know its conventions yet, and this block does not summarise them.',
    `  1. Before your first tool call in this thread, call load_skill_file("${slug}") and read it.`,
    '  2. Treat its content as authoritative. If a request seems to contradict it, surface the conflict rather than quietly overriding the convention.',
    '</project_writing_skill>',
  ].join('\n');

/** The entity's `code`, the two variants (comments dropped). */
const FS_ACCESS_DISABLED = [
  '<agent_filesystem_access enabled="false">',
  'This project runs you WITHOUT built-in filesystem or shell tools. Read, Grep, Glob, Edit, Write, NotebookEdit, Bash and Skill are not in your catalog — they are absent, not merely discouraged, so there is nothing to fall back to and no point proposing one.',
  'The specification is fully reachable anyway, through the MCP servers listed in <tooling>: read with get_page / get_sections / list_pages / search_pages, write with update_sections / update_page. That is the point of the posture, not a workaround for it — a core write carries expectedHash, captures a version and injects anchors, and a built-in write skipped all three.',
  'Two things genuinely do not work while this is on. If you are asked for one, say which setting is in the way rather than attempting it:',
  '  - git recovery ("Fix it with Agent") — it drives git through Bash, and no MCP operation replaces it;',
  '  - the c4s CLI — it is a shell program; only its `ask` survives, and only where this turn mounted the server that exposes it — check <tooling>.',
  'The user can turn both back on by unchecking "Block direct file access" in Settings → Agent. Say that plainly; do not try to work around it.',
  'One thing that DOES still work, and it is about you rather than the user: the read-only explorer subagents are mounted here as usual. They never held the file built-ins to begin with — they read the specification through the same MCP operations you do — so this posture takes nothing away from them, and delegating a wide sweep is still the way to keep the bulk of what you read out of your own context.',
  '</agent_filesystem_access>',
].join('\n');

const FS_ACCESS_ENABLED = [
  '<agent_filesystem_access enabled="true">',
  'This project leaves the built-in filesystem and shell tools available to you, so work outside the specification (implementation code, git, the c4s CLI) is possible here.',
  'That does NOT make them an alternative route into the specification. Pages, entities, plans and briefs are still read and written ONLY through the MCP servers in <tooling>: a built-in write bypasses expectedHash, version capture and anchor injection, so it corrupts the consistency contract while reporting success. Reach for Read/Edit/Write only for files that are not C4S artifacts.',
  '</agent_filesystem_access>',
].join('\n');

describe('<project_writing_skill> — template (M15 L16, 2.1.9)', () => {
  it('[entity:szablon-project-writing-skill] the block renders the template verbatim, slug and title filled in', () => {
    const out = build({ contextType: 'chat', writingStyleSkill: { slug: 'house-style', title: 'House Style' } });
    expect(block(out, 'project_writing_skill')).toBe(PROJECT_WRITING_SKILL_TEMPLATE('house-style', 'House Style'));
  });

  it('[ac:ac-blok-project-writing-skill-zawiera-zd] the block carries the sentence excluding skill packages from the binding convention and pointing at skill-author — in every context type', () => {
    for (const contextType of ['chat', 'brief', 'patch', 'ask'] as const) {
      const out = build({ contextType, brief: null, writingStyleSkill: { slug: 'house-style', title: 'House Style' } });
      const b = block(out, 'project_writing_skill');
      expect(b, contextType).toContain('Skill packages are outside this binding');
      expect(b, contextType).toContain('follow the skill-author skill instead');
    }
  });
});

describe('<agent_filesystem_access> — template (M05 L16, 2.1.9)', () => {
  it('[entity:szablon-agent-filesystem-access] both variants render the template verbatim — no writing-style scaffold among what the block costs', () => {
    const off = build({ contextType: 'chat', agentFilesystemAccess: { enabled: false } });
    const on = build({ contextType: 'chat', agentFilesystemAccess: { enabled: true } });
    expect(block(off, 'agent_filesystem_access')).toBe(FS_ACCESS_DISABLED);
    expect(block(on, 'agent_filesystem_access')).toBe(FS_ACCESS_ENABLED);
    for (const out of [off, on]) expect(block(out, 'agent_filesystem_access')).not.toMatch(/writing style|scaffold/i);
  });
});

describe('config.writingStyle === null in a brief thread (M15 edge cases)', () => {
  it('[ac:ac-przy-config-writingstyle-null-watek-b] the brief thread keeps the full domain rules of its type (identity, tool whitelist, self-containment invariant) but gets no genre methodology — no <project_writing_skill> block', () => {
    const out = build({ contextType: 'brief', brief: null, writingStyleSkill: null, interactionRules: INTERACTION_RULES.brief });
    const rules = block(out, 'interaction_context');
    expect(rules).toContain('<interaction_context type="brief">');
    expect(rules).toContain(INTERACTION_RULES.brief);
    // Identity, whitelist, self-containment.
    expect(rules).toContain('You are operating in BRIEF mode');
    expect(rules).toContain('only `release-tools` is mounted');
    expect(rules).toContain('THE SELF-CONTAINMENT INVARIANT');
    // No methodology: no style to open, so no order to read one.
    expect(out).not.toContain('<project_writing_skill');
    expect(out).not.toContain('call load_skill_file(');
  });
});
