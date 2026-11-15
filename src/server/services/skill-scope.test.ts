import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import { loadBuiltinEnvelopes } from '../core/plugin-host/loader.js';
import { PluginRegistryImpl } from '../core/plugin-host/registry.js';
import type { ScopedPluginSkill } from '../core/plugin-host/contribution-scope.js';
import { fanPluginSkills } from '../workspace/project-skills.js';
import { buildSystemPrompt, contextTypesFor, type SystemPromptInput } from './chat-context.js';
import { resolvePluginSubagents } from './plugin-subagents.js';
import { ProjectRootedSkillSource } from './project-rooted-skills.js';
import { SkillRegistry, SkillResolver, type SkillRoot } from './skill-registry.js';
import type { ChatContextType } from '../../shared/entities.js';
import type { PluginSkillContribution } from '../../shared/plugin-host/manifest.js';

/**
 * 2.1.88 — unit `skill-scope`: the skill listing and the forced writing-style
 * slot in EVERY value of the project's context-type registry (M37 `fs6xai8n`,
 * `49xdwa2z`, `d015saim`; M52 `xrpcvap9`; M15 `ui3mv2t0`). "Every value" is
 * always the rows of the project registry (`contextTypesFor(capabilities)`),
 * never a written-out list: each assertion below walks two registries — a
 * project with every capability (chat, brief, patch, ask) and one without
 * `briefs` (chat, ask).
 */

const host = { listEntities: () => [] } as unknown as ProjectPluginHost;

/** The two project registries every criterion is checked in. */
const REGISTRIES: Array<{ name: string; values: ChatContextType[] }> = [
  { name: 'spec project (every capability)', values: contextTypesFor({ has: () => true }) },
  { name: 'project without briefs', values: contextTypesFor({ has: (c) => c !== 'briefs' }) },
];

function build(cwd: string, overrides: Partial<SystemPromptInput>): string {
  return buildSystemPrompt({
    host,
    projectName: 'My Spec',
    cwd,
    roots: [{ id: 'pages', name: 'pages', dir: 'pages', builtin: true }],
    currentPagePath: null,
    currentPageBody: null,
    brief: null,
    ...overrides,
  });
}

function availableSkills(prompt: string): string {
  return /<available_skills>[\s\S]*?<\/available_skills>/.exec(prompt)?.[0] ?? '';
}

/** The rendered `<project_writing_skill …>` blocks (opening tags with attributes). */
function writingSkillBlocks(prompt: string): string[] {
  return prompt.match(/<project_writing_skill slug="[^"]*"/g) ?? [];
}

/** A turn's prompt in `contextType`, fed by the resolver the way the turn feeds it. */
function turnPrompt(resolver: SkillResolver, cwd: string, contextType: ChatContextType): string {
  const { listing, writingStyle } = resolver.resolveForContext(contextType);
  return build(cwd, { contextType, availableSkills: listing, writingStyleSkill: writingStyle });
}

function contextual(slug: string, over: Partial<PluginSkillContribution> = {}): PluginSkillContribution {
  return {
    slug,
    title: slug,
    description: `about ${slug}`,
    version: 1,
    language: 'en',
    scope: 'contextual',
    content: `# ${slug}`,
    ...over,
  };
}

/** Plugin skills as the loader hands them over: each WITH its declared Host API version's set. */
function fanned(registry: SkillRegistry, scoped: ScopedPluginSkill[]): void {
  fanPluginSkills(registry, { listScopedSkills: () => scoped, listUnloadedSkills: () => [] });
}

describe('skill scope in every value of the project registry (2.1.88)', () => {
  let tmp: string;
  let userRoot: SkillRoot;

  function writeConfig(writingStyle: string | null): void {
    fs.mkdirSync(path.join(tmp, '.claude4spec'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude4spec', 'config.json'), JSON.stringify({ writingStyle }));
  }

  function writePackage(dir: string, slug: string, header: string): void {
    fs.mkdirSync(path.join(dir, slug), { recursive: true });
    fs.writeFileSync(
      path.join(dir, slug, 'SKILL.md'),
      `---\ntitle: ${slug}\ndescription: about ${slug}\nversion: 1\nlanguage: en\n${header}---\n# ${slug}\n`,
    );
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-skill-scope-'));
    userRoot = { dir: path.join(tmp, '.claude', 'skills'), source: 'user', registration: 'user-project' };
    writePackage(userRoot.dir, 'house-style', 'scope: writing-style\n');
    writeConfig(null);
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('<available_skills>', () => {
    it('[ac:ac-blok-available-skills-jest-emitowany-2] <available_skills> is emitted in every value of the registry, also with an empty listing', () => {
      const registry = SkillRegistry.load([], { rescanTtlMs: 0 });
      for (const { name, values } of REGISTRIES) {
        const resolver = new SkillResolver(registry, tmp, values);
        for (const contextType of resolver.contextTypes) {
          expect(resolver.resolveForContext(contextType).listing, `${name}/${contextType}`).toEqual([]);
          const block = availableSkills(turnPrompt(resolver, tmp, contextType));
          expect(block, `${name}/${contextType}`).not.toBe('');
          expect(block, `${name}/${contextType}`).not.toContain('<skill ');
        }
      }
    });

    it('[ac:ac-blok-available-skills-jest-emitowany] in every value of the registry <available_skills> carries the description of each skill attached to that value', () => {
      const registry = SkillRegistry.load([], { rescanTtlMs: 0 });
      fanned(registry, [
        { skill: contextual('everywhere', { description: 'attached to every value' }), declaredContextTypes: ['chat', 'brief', 'patch', 'ask'] },
        { skill: contextual('ask-only', { description: 'attached to ask', contextTypes: ['ask'] }), declaredContextTypes: ['chat', 'brief', 'patch', 'ask'] },
      ]);
      for (const { name, values } of REGISTRIES) {
        const resolver = new SkillResolver(registry, tmp, values);
        for (const contextType of resolver.contextTypes) {
          const { listing } = resolver.resolveForContext(contextType);
          const block = availableSkills(turnPrompt(resolver, tmp, contextType));
          expect(listing.length, `${name}/${contextType}`).toBeGreaterThan(0);
          for (const entry of listing) {
            expect(block, `${name}/${contextType}`).toContain(`<skill slug="${entry.slug}" description="${entry.description}"`);
          }
          expect(block).toContain('description="attached to every value"');
          if (contextType === 'ask') expect(block).toContain('description="attached to ask"');
          else expect(block, `${name}/${contextType}`).not.toContain('ask-only');
        }
      }
    });

    it('[ac:ac-blok-available-skills-niesie-instrukc] <available_skills> carries the channel rule forbidding opening a skill with the native Skill() and reading it with Read', () => {
      const registry = SkillRegistry.load([], { rescanTtlMs: 0 });
      fanned(registry, [{ skill: contextual('mockups'), declaredContextTypes: ['chat', 'brief', 'patch', 'ask'] }]);
      const empty = SkillRegistry.load([], { rescanTtlMs: 0 });
      for (const { values } of REGISTRIES) {
        for (const reg of [registry, empty]) {
          const resolver = new SkillResolver(reg, tmp, values);
          for (const contextType of resolver.contextTypes) {
            expect(availableSkills(turnPrompt(resolver, tmp, contextType))).toContain(
              'Never open a skill with the native Skill() tool and never read one with Read — skills are not files you can reach; load_skill_file is the only channel.',
            );
          }
        }
      }
    });

    it('[ac:ac-projekt-bez-pluginow-listing-availabl] in a project without plugins <available_skills> has an empty listing in every value of the registry', () => {
      // No plugin push, no `contextual` in a skills root, no attachments — only a writing style.
      writeConfig('house-style');
      const registry = SkillRegistry.load([userRoot], { rescanTtlMs: 0 });
      for (const { name, values } of REGISTRIES) {
        const resolver = new SkillResolver(registry, tmp, values);
        for (const contextType of resolver.contextTypes) {
          expect(resolver.resolveForContext(contextType).listing, `${name}/${contextType}`).toEqual([]);
          const block = availableSkills(turnPrompt(resolver, tmp, contextType));
          expect(block, `${name}/${contextType}`).toContain('<available_skills>');
          expect(block, `${name}/${contextType}`).not.toContain('<skill ');
        }
      }
    });
  });

  describe('reach of a contribution', () => {
    it('[ac:ac-plugin-wnoszacy-contributes-skills-ze] a plugin skill with scope contextual and no contextTypes is an <available_skills> row in every value of the project registry that belongs to the ContextType set of the plugin\'s declared Host API version', () => {
      const registry = SkillRegistry.load([], { rescanTtlMs: 0 });
      // Declared set narrower than the full registry: chat + brief.
      fanned(registry, [{ skill: contextual('scoped-by-version'), declaredContextTypes: ['chat', 'brief'] }]);
      const expected: Record<string, ChatContextType[]> = {
        'spec project (every capability)': ['chat', 'brief'],
        'project without briefs': ['chat'],
      };
      for (const { name, values } of REGISTRIES) {
        const resolver = new SkillResolver(registry, tmp, values);
        const listedIn = resolver.contextTypes.filter((ct) =>
          availableSkills(turnPrompt(resolver, tmp, ct)).includes('<skill slug="scoped-by-version"'),
        );
        // The intersection of the declared set and the registry — never "none".
        expect(listedIn, name).toEqual(expected[name]);
      }
    });

    it('[ac:ac-plugin-wnoszacy-trzy-pozycje-ze-scope-2] a plugin without contextTypes adds all three rows in every value of the project registry that belongs to its declared Host API set', () => {
      const registry = SkillRegistry.load([userRoot], { rescanTtlMs: 0 });
      const declared: ChatContextType[] = ['chat', 'brief', 'ask'];
      fanned(
        registry,
        ['one', 'two', 'three'].map((slug) => ({ skill: contextual(slug), declaredContextTypes: declared })),
      );
      for (const style of [null, 'house-style']) {
        writeConfig(style);
        for (const { name, values } of REGISTRIES) {
          const resolver = new SkillResolver(registry, tmp, values);
          for (const contextType of resolver.contextTypes) {
            const rows = resolver.resolveForContext(contextType).listing.map((r) => r.slug);
            if (declared.includes(contextType)) expect(rows, `${name}/${contextType}/${style}`).toEqual(['one', 'two', 'three']);
            else expect(rows, `${name}/${contextType}/${style}`).toEqual([]);
          }
        }
      }
    });

    it('[ac:ac-wklad-contributes-skills-z-contexttyp] a contributes.skills[] entry with a non-empty contextTypes is an <available_skills> row only in threads of the values it names', () => {
      const registry = SkillRegistry.load([], { rescanTtlMs: 0 });
      fanned(registry, [
        { skill: contextual('named', { contextTypes: ['brief', 'ask'] }), declaredContextTypes: ['chat', 'brief', 'patch', 'ask'] },
      ]);
      for (const { name, values } of REGISTRIES) {
        const resolver = new SkillResolver(registry, tmp, values);
        for (const contextType of resolver.contextTypes) {
          const listed = availableSkills(turnPrompt(resolver, tmp, contextType)).includes('<skill slug="named"');
          expect(listed, `${name}/${contextType}`).toBe(contextType === 'brief' || contextType === 'ask');
        }
        // A named value the project registry lacks (`brief` without `briefs`) gives no row and no error.
        expect(() => resolver.resolveForContext('chat')).not.toThrow();
      }
    });

    it('[ac:ac-skill-projektu-bez-contexttypes-jest] a project skill without contextTypes is an <available_skills> row in every value of the project registry', () => {
      const skillsRoot = path.join(tmp, '.claude4spec', 'skills');
      writePackage(skillsRoot, 'local-procedure', 'scope: contextual\n');
      writePackage(skillsRoot, 'local-chat-only', 'scope: contextual\ncontextTypes: [chat]\n');
      const registry = SkillRegistry.load([], { rescanTtlMs: 0 });
      registry.registerSource(new ProjectRootedSkillSource(skillsRoot));
      for (const { name, values } of REGISTRIES) {
        const resolver = new SkillResolver(registry, tmp, values);
        for (const contextType of resolver.contextTypes) {
          const block = availableSkills(turnPrompt(resolver, tmp, contextType));
          expect(block, `${name}/${contextType}`).toContain('<skill slug="local-procedure" description="about local-procedure" origin="project-rooted"/>');
          // The contrast: a declared scope narrows.
          expect(block.includes('local-chat-only'), `${name}/${contextType}`).toBe(contextType === 'chat');
        }
      }
    });
  });

  describe('the forced writing-style slot', () => {
    it('[ac:ac-aktywny-writing-style-config-writingsty] the active writing style is attached as a <project_writing_skill/> block in every value of the registry', () => {
      writeConfig('house-style');
      const registry = SkillRegistry.load([userRoot], { rescanTtlMs: 0 });
      for (const { name, values } of REGISTRIES) {
        const resolver = new SkillResolver(registry, tmp, values);
        for (const contextType of resolver.contextTypes) {
          const prompt = turnPrompt(resolver, tmp, contextType);
          expect(writingSkillBlocks(prompt), `${name}/${contextType}`).toEqual(['<project_writing_skill slug="house-style"']);
          // Outside the listing.
          expect(availableSkills(prompt), `${name}/${contextType}`).not.toContain('house-style');
        }
      }
    });

    it('[ac:ac-przy-config-writingstyle-null-blok-pr] with config.writingStyle === null no <project_writing_skill/> block is attached in any value of the registry', () => {
      writeConfig(null);
      const registry = SkillRegistry.load([userRoot], { rescanTtlMs: 0 });
      fanned(registry, [{ skill: contextual('mockups'), declaredContextTypes: ['chat', 'brief', 'patch', 'ask'] }]);
      for (const { name, values } of REGISTRIES) {
        const resolver = new SkillResolver(registry, tmp, values);
        for (const contextType of resolver.contextTypes) {
          expect(resolver.resolveForContext(contextType).writingStyle).toBeNull();
          expect(writingSkillBlocks(turnPrompt(resolver, tmp, contextType)), `${name}/${contextType}`).toEqual([]);
        }
      }
    });

    it('[ac:ac-system-prompt-zawiera-co-najwyzej-jed] the system prompt carries at most one <project_writing_skill> block in every value of the registry', () => {
      // Two selectable styles in the registry (a user root one and a plugin one); one is active.
      writeConfig('house-style');
      const registry = SkillRegistry.load([userRoot], { rescanTtlMs: 0 });
      registry.addPluginStyle({
        slug: 'other-style',
        title: 'Other style',
        description: 'another style',
        version: 1,
        language: 'en',
        content: 'other',
      } as never);
      for (const style of ['house-style', null]) {
        writeConfig(style);
        for (const { name, values } of REGISTRIES) {
          const resolver = new SkillResolver(registry, tmp, values);
          for (const contextType of resolver.contextTypes) {
            const blocks = writingSkillBlocks(turnPrompt(resolver, tmp, contextType));
            expect(blocks.length, `${name}/${contextType}/${style}`).toBeLessThanOrEqual(1);
            expect(blocks.length).toBe(style === null ? 0 : 1);
          }
        }
      }
    });
  });

  describe('the built-in envelopes', () => {
    let plugins: PluginRegistryImpl;
    beforeAll(async () => {
      plugins = new PluginRegistryImpl();
      await loadBuiltinEnvelopes(plugins);
    });
    afterAll(() => {
      plugins = undefined as never;
    });

    /** A skill registry with the envelopes' skills fanned in the way the project context fans them. */
    function withEnvelopes(): SkillRegistry {
      const registry = SkillRegistry.load([userRoot], { rescanTtlMs: 0 });
      fanPluginSkills(registry, plugins);
      return registry;
    }

    it('[ac:ac-skill-ui-view-mockup-generator-trafia] the ui-view-mockup-generator skill is an <available_skills> row in every value of the registry', () => {
      const registry = withEnvelopes();
      for (const { name, values } of REGISTRIES) {
        const resolver = new SkillResolver(registry, tmp, values);
        for (const contextType of resolver.contextTypes) {
          expect(availableSkills(turnPrompt(resolver, tmp, contextType)), `${name}/${contextType}`).toContain(
            '<skill slug="ui-view-mockup-generator"',
          );
        }
      }
    });

    it('[ac:ac-skill-ui-view-mockup-generator-nigdy] the ui-view-mockup-generator skill never gets a <project_writing_skill/> block', () => {
      const registry = withEnvelopes();
      for (const style of [null, 'house-style', 'ui-view-mockup-generator']) {
        writeConfig(style);
        for (const { name, values } of REGISTRIES) {
          const resolver = new SkillResolver(registry, tmp, values);
          for (const contextType of resolver.contextTypes) {
            expect(resolver.resolveForContext(contextType).writingStyle?.slug).not.toBe('ui-view-mockup-generator');
            expect(turnPrompt(resolver, tmp, contextType), `${name}/${contextType}/${style}`).not.toContain(
              '<project_writing_skill slug="ui-view-mockup-generator"',
            );
          }
        }
      }
    });

    it('[ac:ac-skill-writing-style-author-jest-wlasnosc] the writing-style-author skill is an <available_skills> row in a chat thread', () => {
      const registry = withEnvelopes();
      for (const { name, values } of REGISTRIES) {
        const resolver = new SkillResolver(registry, tmp, values);
        expect(resolver.contextTypes).toContain('chat');
        expect(availableSkills(turnPrompt(resolver, tmp, 'chat')), name).toContain('<skill slug="writing-style-author"');
      }
    });

    it('[ac:ac-skill-writing-style-author-nie-jest-p] the writing-style-author skill is no <available_skills> row in a thread of any value other than chat', () => {
      const registry = withEnvelopes();
      for (const { name, values } of REGISTRIES) {
        const resolver = new SkillResolver(registry, tmp, values);
        const others = resolver.contextTypes.filter((ct) => ct !== 'chat');
        expect(others.length, name).toBeGreaterThan(0);
        for (const contextType of others) {
          expect(availableSkills(turnPrompt(resolver, tmp, contextType)), `${name}/${contextType}`).not.toContain('writing-style-author');
        }
      }
    });

    function specReviewIn(contextType: ChatContextType): boolean {
      const contributions = plugins.listPluginRecords().flatMap((r) => r.subagents);
      return resolvePluginSubagents({
        contextType,
        contributions,
        hasSkillSlug: () => true,
        taken: new Set(),
        warn: () => {},
      }).some((s) => s.name === 'spec-review');
    }

    it('[ac:ac-spec-review-jest-rozwiazywany-w-turze] spec-review is resolved in a chat turn', () => {
      for (const { values } of REGISTRIES) expect(values).toContain('chat');
      expect(specReviewIn('chat')).toBe(true);
    });

    it('[ac:ac-spec-review-nie-jest-rozwiazywany-w-t] spec-review is not resolved in a turn of any value other than chat', () => {
      for (const { name, values } of REGISTRIES) {
        for (const contextType of values.filter((ct) => ct !== 'chat')) {
          expect(specReviewIn(contextType), `${name}/${contextType}`).toBe(false);
        }
      }
    });
  });
});
