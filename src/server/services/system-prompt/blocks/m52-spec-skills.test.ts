import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSystemPrompt, KNOWN_CONTEXT_TYPES, type SystemPromptInput } from '../../chat-context.js';
import { currentSkillOf, registerProjectRootedSkills } from '../../project-rooted-skills.js';
import { SkillRegistry } from '../../skill-registry.js';
import { RootRegistry } from '../../../roots/registry.js';
import type { ProjectPluginHost } from '../../../core/plugin-host/types.js';
import { AVAILABLE_SKILLS_LINES } from './m37-skills.js';
import { M52_AVAILABLE_SKILLS_LINES } from './m52-spec-skills.js';

/**
 * 2.1.9 — M52's prompt contribution (L16): the four conditional lines of the
 * `<available_skills>` body (template `szablon-available-skills-spec-skills`,
 * `6evgp041`), the `<current_skill>` block (template `szablon-current-skill`,
 * `9zio901p`, edge case `rkbsi6ky` 13), and M02's `<current_page>` narrowed to
 * roots of kind `pages` (`cg80qj0e`).
 */

const host = { listEntities: () => [] } as unknown as ProjectPluginHost;

const SKILL_REF_LINE = `A <skill_ref slug="x"/> in the user's message means: call load_skill_file("x") first, before anything else.`;
const EXPOSED_LINE = `An entry with origin="project-exposed" is read-only here: to change it, propose the change to that project with ask, using its project attribute as the address.`;
const WRITE_LINE = `Write the files of this project's own skills with update_skill_file.`;
const HITS_LINE = `A find_references or check_consistency hit in the root "skills" at <slug>/<rest of path> is read with load_skill_file("<slug>", "<rest of path>").`;

const CURRENT_SKILL_PROSE = `The user has this skill file open. Read it with load_skill_file(slug, file) — also when the package is not valid yet and no other source resolves this slug: the response then marks it invalid and says why. Page tools do not reach this root.`;
const shadowedProse = (slug: string, source: string): string =>
  `The user has this skill file open, but it is shadowed: the slug resolves to the skill "${slug}" from source "${source}", and load_skill_file returns that skill, not this file. You have no way to read this file — not with load_skill_file, not with page tools, not with built-in file tools. It becomes readable through load_skill_file once this package wins its slug; renaming the package to a slug no other source resolves always achieves that.`;

const SPEC_SKILL_TOOLS = { name: 'spec-skill-tools', tools: ['update_skill_file'] };

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

function block(prompt: string): string {
  return /<available_skills>[\s\S]*?<\/available_skills>/.exec(prompt)?.[0] ?? '';
}

/** The body lines of `<available_skills>`, de-indented, frame tags excluded. */
function bodyLines(prompt: string): string[] {
  return block(prompt)
    .split('\n')
    .slice(1, -1)
    .map((l) => l.replace(/^ {2}/, ''));
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** A project with its `skills` root (found by kind) and the `project-rooted` source registered over it. */
function project() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-m52-prompt-'));
  tmpDirs.push(cwd);
  const roots = new RootRegistry([{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }]);
  const skillsDir = path.join(cwd, roots.byKind('skills')[0]!.dir);
  const registry = SkillRegistry.load([], { rescanTtlMs: 0 });
  const source = registerProjectRootedSkills(registry, roots, cwd)!;
  return { skillsDir, registry, source };
}

function put(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

describe('<available_skills> — M52 lines (2.1.9)', () => {
  it('[entity:szablon-available-skills-spec-skills] M52 contributes exactly the four template lines to the frame slot, in template order', () => {
    expect(AVAILABLE_SKILLS_LINES).toContain(M52_AVAILABLE_SKILLS_LINES);
    expect(M52_AVAILABLE_SKILLS_LINES.module).toBe('M52');
    const out = build({
      contextType: 'chat',
      availableSkills: [{ slug: 'billing-guide', description: 'from a peer', origin: 'project-exposed', project: 'billing' }],
      mcpInventory: [SPEC_SKILL_TOOLS],
      skillsRootHasFiles: true,
    });
    expect(bodyLines(out)).toEqual([
      '<skill slug="billing-guide" description="from a peer" origin="project-exposed" project="billing"/>',
      SKILL_REF_LINE,
      EXPOSED_LINE,
      WRITE_LINE,
      HITS_LINE,
      'Open a skill with load_skill_file(slug) — it returns the skill body plus a manifest of its package files.',
      'Read a subfile the skill points you to with load_skill_file(slug, file), e.g. load_skill_file("billing-guide", "workflows/brief.md").',
      'Never open a skill with the native Skill() tool and never read one with Read — skills are not files you can reach; load_skill_file is the only channel.',
    ]);
  });

  it('[ac:6evgp041] each M52 line has its own emission condition: skill_ref always, exposed iff a project-exposed entry, update_skill_file iff spec-skill-tools mounted, hits iff the skills root has a file', () => {
    // Nothing of the turn holds: the skill_ref line alone — in every context type, brief frame included.
    for (const contextType of KNOWN_CONTEXT_TYPES) {
      const lean = block(build({ contextType, brief: null, availableSkills: [] }));
      expect(lean, contextType).toContain(SKILL_REF_LINE);
      expect(lean, contextType).not.toContain(EXPOSED_LINE);
      expect(lean, contextType).not.toContain(WRITE_LINE);
      expect(lean, contextType).not.toContain(HITS_LINE);
    }

    // Exposed line: only beside an entry of origin project-exposed.
    const pluginOnly = block(build({ availableSkills: [{ slug: 'm', description: 'd', origin: 'plugin' }] }));
    expect(pluginOnly).not.toContain(EXPOSED_LINE);
    const exposed = block(
      build({ availableSkills: [{ slug: 'p', description: 'd', origin: 'project-exposed', project: 'billing' }] }),
    );
    expect(exposed).toContain(EXPOSED_LINE);
    expect(exposed).not.toContain(WRITE_LINE);
    expect(exposed).not.toContain(HITS_LINE);

    // update_skill_file line: only when spec-skill-tools is mounted in the turn.
    const otherServers = block(build({ mcpInventory: [{ name: 'skill-tools', tools: ['load_skill_file'] }] }));
    expect(otherServers).not.toContain(WRITE_LINE);
    const mounted = block(build({ mcpInventory: [SPEC_SKILL_TOOLS] }));
    expect(mounted).toContain(WRITE_LINE);
    expect(mounted).not.toContain(EXPOSED_LINE);
    expect(mounted).not.toContain(HITS_LINE);

    // Hit translation: only when the skills root has at least one file.
    expect(block(build({ skillsRootHasFiles: false }))).not.toContain(HITS_LINE);
    const hits = block(build({ skillsRootHasFiles: true }));
    expect(hits).toContain(HITS_LINE);
    expect(hits).not.toContain(WRITE_LINE);
  });

  it('[ac:6evgp041] the hit-translation condition reads the skills root: no file → false, any file (package or loose) → true', () => {
    const { skillsDir, source } = project();
    expect(source.hasAnyFile()).toBe(false);
    fs.mkdirSync(path.join(skillsDir, 'empty-dir'), { recursive: true });
    expect(source.hasAnyFile()).toBe(false);
    put(path.join(skillsDir, 'empty-dir', 'notes', 'a.md'), '# a\n');
    expect(source.hasAnyFile()).toBe(true);
  });

  it('[ac:da1d88do#available-skills-pochodzenie-pozycji] every <skill> carries origin; project only beside origin="project-exposed", absent (not empty) elsewhere', () => {
    const out = block(
      build({
        availableSkills: [
          { slug: 'a', description: 'plugin one', origin: 'plugin', project: 'x' },
          { slug: 'b', description: 'rooted one', origin: 'project-rooted', project: '' },
          { slug: 'c', description: 'user one', origin: 'user' },
          { slug: 'd', description: 'peer one', origin: 'project-exposed', project: 'billing' },
        ],
      }),
    );
    const rows = out.split('\n').filter((l) => l.includes('<skill '));
    expect(rows).toEqual([
      '  <skill slug="a" description="plugin one" origin="plugin"/>',
      '  <skill slug="b" description="rooted one" origin="project-rooted"/>',
      '  <skill slug="c" description="user one" origin="user"/>',
      '  <skill slug="d" description="peer one" origin="project-exposed" project="billing"/>',
    ]);
    for (const row of rows) expect(row).toMatch(/ origin="[^"]+"/);
    expect(rows.filter((r) => r.includes('project='))).toEqual([rows[3]]);
    expect(out).not.toContain('project=""');
  });

  it('[ac:da1d88do#available-skills-linie-modulow] module lines stand inside <available_skills>, not as a top-level block; the block without them differs only by those lines', () => {
    const input: Partial<SystemPromptInput> = {
      contextType: 'chat',
      availableSkills: [{ slug: 'p', description: 'd', origin: 'project-exposed', project: 'billing' }],
      mcpInventory: [SPEC_SKILL_TOOLS],
      skillsRootHasFiles: true,
    };
    const out = build(input);
    const inside = block(out);
    for (const line of [SKILL_REF_LINE, EXPOSED_LINE, WRITE_LINE, HITS_LINE]) {
      // Inside the block, indented as its body …
      expect(inside).toContain(`  ${line}`);
      // … and nowhere else in the prompt.
      expect(out.split(line)).toHaveLength(2);
    }
    // No top-level block of M52's own around the lines.
    expect(out).not.toMatch(/^<spec_skills/m);

    // The same block with the module lines removed is exactly the frame M37 renders.
    const moduleLines = new Set([SKILL_REF_LINE, EXPOSED_LINE, WRITE_LINE, HITS_LINE].map((l) => `  ${l}`));
    const withoutModuleLines = inside.split('\n').filter((l) => !moduleLines.has(l));
    expect(withoutModuleLines).toEqual([
      '<available_skills>',
      '  <skill slug="p" description="d" origin="project-exposed" project="billing"/>',
      '  Open a skill with load_skill_file(slug) — it returns the skill body plus a manifest of its package files.',
      '  Read a subfile the skill points you to with load_skill_file(slug, file), e.g. load_skill_file("p", "workflows/brief.md").',
      '  Never open a skill with the native Skill() tool and never read one with Read — skills are not files you can reach; load_skill_file is the only channel.',
      '</available_skills>',
    ]);
    expect(inside.split('\n')).toHaveLength(withoutModuleLines.length + 4);
  });
});

describe('<current_skill> — M52 (2.1.9, 2.1.17)', () => {
  it('[entity:szablon-current-skill] renders both template variants: the self-closing tag with slug and file, then the read line (or the shadowed line)', () => {
    const open = build({ contextType: 'chat', currentSkill: { slug: 'reviewer', file: 'workflows/brief.md' } });
    expect(open).toContain(`<current_skill slug="reviewer" file="workflows/brief.md"/>\n${CURRENT_SKILL_PROSE}`);

    const shadowed = build({
      contextType: 'chat',
      currentSkill: { slug: 'mockups', file: 'SKILL.md', shadowedBy: { slug: 'mockups', source: 'plugin' } },
    });
    expect(shadowed).toContain(`<current_skill slug="mockups" file="SKILL.md"/>\n${shadowedProse('mockups', 'plugin')}`);
    expect(shadowed).not.toContain(CURRENT_SKILL_PROSE);
    // 2.1.17: the shadowed line names the way out as winning the slug, renaming being the sure route.
    expect(shadowed).toContain('It becomes readable through load_skill_file once this package wins its slug;');
    expect(shadowed).toContain('renaming the package to a slug no other source resolves always achieves that.');
    expect(shadowed).not.toContain('only once its package is renamed');
  });

  it('[ac:9zio901p] <current_skill> is present iff the turn has an open file of a skills-kind root; an open page does not stand in for it', () => {
    // No open skill file → no block at all.
    expect(build({ contextType: 'chat' })).not.toContain('<current_skill');
    // An open page (kind `pages`) gives <current_page>, never <current_skill>.
    const page = build({ contextType: 'chat', currentPagePath: 'guide.md', currentPageRootId: 'pages', currentPageRootKind: 'pages', currentPageBody: 'x' });
    expect(page).toContain('<current_page path="guide.md"');
    expect(page).not.toContain('<current_skill');
    // An open skill file → the block, and no <current_page> for it.
    const skill = build({
      contextType: 'chat',
      currentPagePath: 'reviewer/SKILL.md',
      currentPageRootId: 'skills',
      currentPageRootKind: 'skills',
      currentPageBody: null,
      currentSkill: { slug: 'reviewer', file: 'SKILL.md' },
    });
    expect(skill).toContain('<current_skill slug="reviewer" file="SKILL.md"/>');
    expect(skill).not.toContain('<current_page ');

    // The reference is derived from the root-relative path: `<slug>/<file in package>`.
    expect(currentSkillOf('reviewer/workflows/brief.md', () => undefined)).toEqual({
      slug: 'reviewer',
      file: 'workflows/brief.md',
    });
  });

  it('[ac:rkbsi6ky#13] an invalid project-rooted package under a slug another source resolves: <current_skill> says the file is shadowed, by which skill and from which source', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { skillsDir, registry } = project();
    // Invalid: no description in the header.
    put(path.join(skillsDir, 'mockups', 'SKILL.md'), '---\ntitle: Broken\nversion: 1\nlanguage: en\n---\n# broken\n');
    // Without a rival the open file is what load_skill_file serves (invalid, marked).
    expect(currentSkillOf('mockups/SKILL.md', (s) => registry.winnerOf(s))).toEqual({ slug: 'mockups', file: 'SKILL.md' });

    registry.addPluginSkill({
      slug: 'mockups',
      title: 'Mockups',
      description: 'Plugin mockups.',
      version: 1,
      language: 'en',
      scope: 'contextual',
      content: '# plugin body\n',
    });
    const ref = currentSkillOf('mockups/SKILL.md', (s) => registry.winnerOf(s));
    expect(ref).toEqual({ slug: 'mockups', file: 'SKILL.md', shadowedBy: { slug: 'mockups', source: 'plugin' } });

    const out = build({ contextType: 'chat', currentSkill: ref });
    expect(out).toContain('<current_skill slug="mockups" file="SKILL.md"/>');
    expect(out).toContain(shadowedProse('mockups', 'plugin'));
    // The agent is told it has no route to the file, and never told to read it.
    expect(out).toContain('You have no way to read this file');
    expect(out).not.toContain(CURRENT_SKILL_PROSE);
    // No content of the open file reaches the prompt.
    expect(out).not.toContain('# broken');
  });
});

describe('<current_skill> — M52 edge cases (2.1.17)', () => {
  it('[ac:m52-edge-loose-file-no-current-skill] an open loose file at the top level of the skills root, outside every package, gives no <current_skill> block (and no <current_page> either)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { skillsDir, registry } = project();
    put(path.join(skillsDir, 'notes.md'), '# Loose notes\n');
    put(path.join(skillsDir, 'reviewer', 'SKILL.md'), '---\ntitle: Reviewer\ndescription: Reviews.\nversion: 1\nlanguage: en\nscope: contextual\n---\n# Reviewer\n');

    // The loose file belongs to no package: no reference, so nothing for the block to render.
    const loose = currentSkillOf('notes.md', (s) => registry.winnerOf(s));
    expect(loose).toBeNull();
    // A leading slash or a trailing-slash-only path is not a package file either.
    expect(currentSkillOf('/notes.md', (s) => registry.winnerOf(s))).toBeNull();
    expect(currentSkillOf('reviewer/', (s) => registry.winnerOf(s))).toBeNull();
    // A file of a package next to it does get one.
    expect(currentSkillOf('reviewer/SKILL.md', (s) => registry.winnerOf(s))).toEqual({ slug: 'reviewer', file: 'SKILL.md' });

    // The turn as agent-turn builds it for that open file: root of kind skills, currentSkill = null.
    const out = build({
      contextType: 'chat',
      currentPagePath: 'notes.md',
      currentPageRootId: 'skills',
      currentPageRootKind: 'skills',
      currentPageBody: '# Loose notes\n',
      currentSkill: loose,
    });
    expect(out).not.toContain('<current_skill');
    expect(out).not.toContain('<current_page ');
    expect(out).not.toContain('notes.md');
  });

  it('[ac:m52-edge-valid-outranked-package-shadowed] a file open from a VALID project-rooted package whose slug a plugin contextual skill wins gets the shadowed variant of <current_skill>', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { skillsDir, registry } = project();
    // Valid: title, description, version, language, contextual scope.
    put(
      path.join(skillsDir, 'mockups', 'SKILL.md'),
      '---\ntitle: Mockups\ndescription: Our own mockups guide.\nversion: 1\nlanguage: en\nscope: contextual\n---\n# own body\n',
    );
    // Alone, the valid package wins its slug: the read variant.
    expect(registry.winnerOf('mockups')?.source).toBe('project-rooted');
    const own = currentSkillOf('mockups/SKILL.md', (s) => registry.winnerOf(s));
    expect(own).toEqual({ slug: 'mockups', file: 'SKILL.md' });
    expect(build({ contextType: 'chat', currentSkill: own })).toContain(CURRENT_SKILL_PROSE);

    // A plugin's contextual skill under the same slug outranks it in the contextual chain.
    registry.addPluginSkill({
      slug: 'mockups',
      title: 'Mockups',
      description: 'Plugin mockups.',
      version: 1,
      language: 'en',
      scope: 'contextual',
      content: '# plugin body\n',
    });
    expect(registry.winnerOf('mockups')?.source).toBe('plugin');
    const ref = currentSkillOf('mockups/workflows/brief.md', (s) => registry.winnerOf(s));
    expect(ref).toEqual({ slug: 'mockups', file: 'workflows/brief.md', shadowedBy: { slug: 'mockups', source: 'plugin' } });

    const out = build({ contextType: 'chat', currentSkill: ref });
    expect(out).toContain(`<current_skill slug="mockups" file="workflows/brief.md"/>\n${shadowedProse('mockups', 'plugin')}`);
    expect(out).not.toContain(CURRENT_SKILL_PROSE);
    expect(out).not.toContain('# own body');

    // Across scopes too: a valid writing-style package loses its slug to another source's contextual entry.
    put(
      path.join(skillsDir, 'house-style', 'SKILL.md'),
      '---\ntitle: House\ndescription: Our style.\nversion: 1\nlanguage: en\nscope: writing-style\n---\n# style\n',
    );
    expect(currentSkillOf('house-style/SKILL.md', (s) => registry.winnerOf(s))).toEqual({ slug: 'house-style', file: 'SKILL.md' });
    registry.addPluginSkill({
      slug: 'house-style',
      title: 'House',
      description: 'Plugin house rules.',
      version: 1,
      language: 'en',
      scope: 'contextual',
      content: '# plugin house\n',
    });
    expect(currentSkillOf('house-style/SKILL.md', (s) => registry.winnerOf(s))).toEqual({
      slug: 'house-style',
      file: 'SKILL.md',
      shadowedBy: { slug: 'house-style', source: 'plugin' },
    });
  });
});

describe('<current_page> — only for roots of kind pages (M02, 2.1.9)', () => {
  it('[ac:cg80qj0e] <current_page> (and its handling) is emitted for an open page of a pages-kind root only; an open file of another root kind gives none', () => {
    const page = build({
      contextType: 'chat',
      currentPagePath: 'guide.md',
      currentPageRootId: 'adr',
      currentPageRootKind: 'pages',
      currentPageBody: 'a\nb',
    });
    expect(page).toContain('<current_page path="guide.md" root="adr" total_lines="2"/>');
    expect(page).toContain('<current_page_handling>');

    const skillFile = build({
      contextType: 'chat',
      currentPagePath: 'reviewer/SKILL.md',
      currentPageRootId: 'skills',
      currentPageRootKind: 'skills',
      currentPageBody: 'x',
    });
    expect(skillFile).not.toContain('<current_page ');
    expect(skillFile).not.toContain('<current_page_handling>');
  });
});
