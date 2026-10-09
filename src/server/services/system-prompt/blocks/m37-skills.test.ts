import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSystemPrompt, KNOWN_CONTEXT_TYPES, type SystemPromptInput } from '../../chat-context.js';
import { SkillRegistry, SkillResolver } from '../../skill-registry.js';
import type { ProjectPluginHost } from '../../../core/plugin-host/types.js';
import { AVAILABLE_SKILLS_LINES } from './m37-skills.js';

/**
 * 2.1.9 — `<available_skills>` (template `szablon-available-skills`): the frame
 * M37 contributes, its rows carrying `origin` (and `project` beside a
 * `project-exposed` origin only), and the slot for lines other modules add.
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

function block(prompt: string): string {
  return /<available_skills>[\s\S]*?<\/available_skills>/.exec(prompt)?.[0] ?? '';
}

describe('<available_skills> — M37 frame (2.1.9)', () => {
  it('[entity:szablon-available-skills] renders the frame: one <skill slug description origin [project]/> per row, the contributed-lines slot, then the channel rule', () => {
    const out = block(
      build({
        contextType: 'chat',
        availableSkills: [
          { slug: 'mockups', description: 'author mockups', origin: 'plugin' },
          { slug: 'peer-skill', description: 'from a peer', origin: 'project-exposed', project: 'billing' },
          // `project` is never rendered beside any other origin.
          { slug: 'local-skill', description: 'from this project', origin: 'project-rooted', project: 'ignored' },
        ],
      }),
    );
    // 2.1.9: M52 contributes to the slot; with no spec-skill-tools and no files in
    // the skills root, its unconditional `skill_ref` line and the exposed-project line
    // (a `project-exposed` row is listed) stand between the rows and the channel rule.
    expect(AVAILABLE_SKILLS_LINES.map((c) => c.module)).toEqual(['M52']);
    expect(out.split('\n')).toEqual([
      '<available_skills>',
      '  <skill slug="mockups" description="author mockups" origin="plugin"/>',
      '  <skill slug="peer-skill" description="from a peer" origin="project-exposed" project="billing"/>',
      '  <skill slug="local-skill" description="from this project" origin="project-rooted"/>',
      '  A <skill_ref slug="x"/> in the user\'s message means: call load_skill_file("x") first, before anything else.',
      '  An entry with origin="project-exposed" is read-only here: to change it, propose the change to that project with ask, using its project attribute as the address.',
      '  Open a skill with load_skill_file(slug) — it returns the skill body plus a manifest of its package files.',
      '  Read a subfile the skill points you to with load_skill_file(slug, file), e.g. load_skill_file("mockups", "workflows/brief.md").',
      '  Never open a skill with the native Skill() tool and never read one with Read — skills are not files you can reach; load_skill_file is the only channel.',
      '</available_skills>',
    ]);

    // Empty listing: the frame stands, with the literal example slug.
    const empty = block(build({ contextType: 'brief', brief: null, availableSkills: [] }));
    expect(empty).not.toContain('<skill ');
    expect(empty).toContain('load_skill_file("some-skill", "workflows/brief.md")');
  });

  describe('fed by the real resolver', () => {
    let tmp: string;
    let projectRoot: string;
    let globalRoot: string;

    function writeSkill(root: string, slug: string, scope: 'writing-style' | 'contextual'): void {
      const dir = path.join(root, slug);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'SKILL.md'),
        `---\ntitle: ${slug}\ndescription: about ${slug}\nversion: 1\nlanguage: en\nscope: ${scope}\n---\n# ${slug}\n${slug} body\n`,
      );
    }

    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-m37-block-'));
      projectRoot = path.join(tmp, 'project', '.claude', 'skills');
      globalRoot = path.join(tmp, 'home', '.claude', 'skills');
      fs.mkdirSync(projectRoot, { recursive: true });
      fs.mkdirSync(globalRoot, { recursive: true });
    });
    afterEach(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('[ac:ac-skill-pluginowy-trafia-wylacznie-na-i] a plugin skill is only a { slug, description, origin } row of <available_skills>', () => {
      const registry = SkillRegistry.load([], { rescanTtlMs: 0 });
      registry.addPluginSkill({
        slug: 'mockups',
        title: 'Mockups',
        description: 'author mockups',
        version: 1,
        language: 'en',
        scope: 'contextual',
        content: 'MOCKUP-BODY-MARKER',
        files: { 'templates/x.md': 'TEMPLATE-MARKER' },
      });
      const resolver = new SkillResolver(registry, tmp);

      for (const contextType of KNOWN_CONTEXT_TYPES) {
        const { listing, writingStyle } = resolver.resolveForContext(contextType);
        expect(listing).toEqual([{ slug: 'mockups', description: 'author mockups', origin: 'plugin' }]);
        const out = build({
          contextType,
          brief: null,
          availableSkills: listing,
          writingStyleSkill: writingStyle,
        });
        // One row, and it is exactly three attributes — nothing else of the skill.
        expect(block(out).match(/<skill /g)).toHaveLength(1);
        expect(block(out)).toContain('<skill slug="mockups" description="author mockups" origin="plugin"/>');
        expect(out).not.toContain('<project_writing_skill slug="mockups"');
        expect(out).not.toContain('MOCKUP-BODY-MARKER');
        expect(out).not.toContain('TEMPLATE-MARKER');
      }
    });

    it('[ac:ac-skill-w-claude-skills-ze-scope-contex] a scope: contextual skill in ~/.claude/skills is no <available_skills> row in any context type', () => {
      writeSkill(globalRoot, 'dropped-global', 'contextual');
      const registry = SkillRegistry.load(
        [
          { dir: projectRoot, source: 'user', registration: 'user-project' },
          { dir: globalRoot, source: 'user', registration: 'user-global' },
        ],
        { rescanTtlMs: 0 },
      );
      // A plugin row beside it, so the listing is not trivially empty.
      registry.addPluginSkill({
        slug: 'mockups',
        title: 'Mockups',
        description: 'author mockups',
        version: 1,
        language: 'en',
        scope: 'contextual',
        content: 'body',
      });
      const resolver = new SkillResolver(registry, tmp);

      for (const contextType of KNOWN_CONTEXT_TYPES) {
        const { listing } = resolver.resolveForContext(contextType);
        const out = block(build({ contextType, brief: null, availableSkills: listing }));
        expect(out).toContain('<skill slug="mockups"');
        expect(out).not.toContain('dropped-global');
      }
      expect(resolver.resolveAll().listing.map((s) => s.slug)).toEqual(['mockups']);
    });
  });
});
