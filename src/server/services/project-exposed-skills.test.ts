import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildSkillToolsServer } from '../mcp/skill-tools.js';
import type { WsEvent } from '../../shared/types.js';
import type { ExpansionContext } from '../../core/references/types.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import { normalizeSkillConfig, readConfig, writeConfig } from '../config.js';
import { RootRegistry } from '../roots/registry.js';
import { sidebarAccordionsRouter } from '../routes/sidebar-accordions.js';
import { buildSystemPrompt, type SystemPromptInput } from './chat-context.js';
import { listExposedProjectRows, listExposedProjects, type ExposedProject } from './exposed-projects.js';
import { PagesService } from './pages.js';
import {
  EXPOSED_SKILL_MANIFEST_LIMIT,
  ProjectExposedSkillSource,
  UNCONFIRMED_DETAIL,
  exposedReadOnlyReason,
  readExposedPackage,
  stripForSkill,
  workspaceExposedSkillAccess,
  type ExposedSkillAccess,
  type ExposedSkillPackage,
} from './project-exposed-skills.js';
import { registerProjectRootedSkills } from './project-rooted-skills.js';
import { SidebarAccordionsService } from './sidebar-accordions.js';
import { SkillRegistry, SkillResolver, toPackageFiles } from './skill-registry.js';
import { loadSkillFileLive } from './skill-operations.js';
import { DomainError } from './tags.js';
import { ProjectContextCache } from '../workspace/context-cache.js';
import type { ProjectContext } from '../workspace/project-context.js';
import type { ProjectRecord } from '../workspace/types.js';
import { WorkspaceRegistry } from '../workspace/registry.js';
import { parseArgs } from '../../bin/c4s/args.js';
import { runConfirmSkillUses } from '../../bin/c4s/commands/confirm-skill-uses.js';
import { runRegisterHome } from '../../bin/c4s/commands/register-home.js';
import { checkWritingStyleAtStart } from './writing-style-start.js';

/**
 * 2.1.9 — M52's `project-exposed` skill source (`ybbal0vf`, `9j9cxrsr`,
 * `gx7f584v`, `rkbsi6ky`) under the M37 source contract (`zscui1qz`,
 * `aw9kcadc`, `vsa4f54s`, `ixkjxpua`, `7pj9yx9k`), and the M01 start rule for a
 * style whose provider is unreachable (`7yzu5k8u`).
 *
 * Most cases drive the source through a hand-made {@link ExposedSkillAccess}
 * (attachments, the workspace's exposed projects, the provider read); the
 * live-read and no-materialisation cases read a real provider base root through
 * a `PagesService`, and the rename case reads real `config.json` files.
 */

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-project-exposed-'));
  tmpDirs.push(d);
  return d;
}

function put(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const host = { listEntities: () => [] } as unknown as ProjectPluginHost;

function prompt(overrides: Partial<SystemPromptInput>): string {
  return buildSystemPrompt({
    host,
    projectName: 'Consumer',
    cwd: '/tmp/consumer',
    roots: [{ id: 'pages', name: 'pages', dir: 'pages', builtin: true }],
    currentPagePath: null,
    currentPageBody: null,
    contextType: 'chat',
    ...overrides,
  });
}

function availableSkillsBlock(text: string): string {
  return /<available_skills>[\s\S]*?<\/available_skills>/.exec(text)?.[0] ?? '';
}

const BILLING: ExposedProject = {
  projectId: 'billing',
  name: 'billing-rules',
  description: 'How billing works.',
  entry: 'index.md',
  scope: 'contextual',
  contextTypes: undefined,
};

function pkg(content: string, files: Record<string, string> = {}): ExposedSkillPackage {
  return { entry: 'index.md', content, files: toPackageFiles(files) };
}

/** A consumer registry with only the `project-exposed` source over a mutable state. */
function consumer(initial: {
  uses?: string[];
  exposed?: ExposedProject[];
  packages?: Record<string, () => ExposedSkillPackage | Promise<ExposedSkillPackage>>;
  /**
   * 2.1.67: the attachment names confirmed on this machine (`confirmedSkillUses`);
   * absent = every name of `uses` confirmed, unless a case says otherwise.
   */
  confirmed?: string[];
}) {
  const state: {
    uses: string[];
    exposed: ExposedProject[];
    packages: Record<string, () => ExposedSkillPackage | Promise<ExposedSkillPackage>>;
    confirmed: string[] | undefined;
  } = {
    uses: initial.uses ?? [],
    exposed: initial.exposed ?? [],
    packages: initial.packages ?? {},
    confirmed: initial.confirmed,
  };
  const reads: string[] = [];
  const access: ExposedSkillAccess = {
    // The consumer's own exposed name, as its own config would give it.
    own: () => ({ uses: state.uses, name: state.exposed.find((p) => p.projectId === 'consumer')?.name ?? null }),
    workspace: () => ({ confirmed: state.confirmed ?? state.uses, listExposed: () => state.exposed }),
    readProvider: async (id) => {
      reads.push(id);
      const read = state.packages[id];
      if (!read) throw new Error(`provider "${id}" is gone`);
      return read();
    },
  };
  const registry = SkillRegistry.load([], { rescanTtlMs: 0 });
  registry.registerSource(new ProjectExposedSkillSource('consumer', access));
  const cwd = tmp();
  const resolver = new SkillResolver(registry, cwd);
  return { state, reads, registry, resolver, cwd };
}

async function refusal(p: Promise<unknown>): Promise<DomainError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    return err as DomainError;
  }
  throw new Error('expected a refusal');
}

/** Every file under `dir`, relative, sorted — to prove nothing was written. */
function tree(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(abs, e.name), r);
      else out.push(r);
    }
  };
  walk(dir, '');
  return out.sort();
}

/** An M19 expansion context of the PROVIDER: one endpoint and one section it knows. */
const PROVIDER_EXPANSION: ExpansionContext = {
  readEntities: (_type, slugs) =>
    slugs.map((slug) => ({ slug, entity: slug === 'get-invoice' ? { slug, title: 'GET /invoices/:id' } : null })),
  listByTags: () => [],
  sectionHeading: (anchor) => (anchor === 'inv00001' ? 'Invoice lifecycle' : null),
  findPageLinks: () => [],
  pageTitle: () => null,
};

/** A provider project on disk: its base root `pages/` read through a real `PagesService`. */
function providerOnDisk() {
  const cwd = tmp();
  const pagesDir = path.join(cwd, 'pages');
  put(
    path.join(pagesDir, 'index.md'),
    [
      '---',
      'title: Billing',
      '---',
      '<!-- anchor: idx00001 -->',
      '# Billing rules v1',
      '',
      'Read <inline_mention type="endpoint" slug="get-invoice"/> and <section_ref anchor="inv00001"/>.',
      '',
    ].join('\n'),
  );
  put(path.join(pagesDir, 'modules/invoices.md'), '<!-- anchor: inv00001 -->\n# Invoice lifecycle\n\nDraft, issued, paid.\n');
  const pages = new PagesService(cwd, 'pages', 'pages');
  const read = () =>
    readExposedPackage(
      {
        listPages: () => pages.listMarkdownFilesReadonly(),
        readRaw: (rel) => pages.readRaw(rel),
        rootId: 'pages',
        expansion: PROVIDER_EXPANSION,
      },
      'index.md',
    );
  return { cwd, pagesDir, read };
}

describe('project-exposed source — listing and precedence (M52 + M37, 2.1.9)', () => {
  it('[ac:ac-pozycja-available-skills-projektu-wys] the <available_skills> row of an exposed project carries `project` with the provider id', () => {
    const { resolver } = consumer({ uses: ['billing-rules'], exposed: [BILLING] });
    const { listing } = resolver.resolveForContext('chat', { writingStyle: null });
    expect(listing).toEqual([
      { slug: 'billing-rules', description: 'How billing works.', origin: 'project-exposed', project: 'billing' },
    ]);
    expect(availableSkillsBlock(prompt({ availableSkills: listing }))).toContain(
      '<skill slug="billing-rules" description="How billing works." origin="project-exposed" project="billing"/>',
    );
  });

  it('[ac:ac-skill-contextual-projektu-wystawioneg] a `contextual` skill of an exposed project under the slug of a plugin `contextual` skill does not shadow the plugin entry', async () => {
    const c = consumer({ uses: ['billing-rules'], exposed: [BILLING], packages: { billing: () => pkg('EXPOSED BODY') } });
    c.registry.addPluginSkill({
      slug: 'billing-rules',
      title: 'Billing (plugin)',
      description: 'The plugin one.',
      version: 1,
      language: 'en',
      scope: 'contextual',
      content: 'PLUGIN BODY',
    });
    expect(c.registry.winnerOf('billing-rules')?.source).toBe('plugin');
    expect(c.resolver.resolveForContext('chat', { writingStyle: null }).listing).toEqual([
      { slug: 'billing-rules', description: 'The plugin one.', origin: 'plugin' },
    ]);
    const open = await loadSkillFileLive(c.registry, 'billing-rules');
    expect(open.source).toBe('plugin');
    expect(open.content).toBe('PLUGIN BODY');
    // The provider was never read: the exposed entry lost the chain.
    expect(c.reads).toEqual([]);
  });

  it('[ac:ac-styl-source-plugin-przeslania-bundl] listSelectable() settles a slug collision by the chain project-rooted > <cwd>/.claude/skills > project-exposed > ~/.claude/skills > plugin', () => {
    const cwd = tmp();
    const home = tmp();
    const roots = new RootRegistry([{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }]);
    const skillsDir = path.join(cwd, roots.byKind('skills')[0]!.dir);
    const userProject = path.join(cwd, '.claude', 'skills');
    const userGlobal = path.join(home, '.claude', 'skills');
    const style = (title: string) => `---\ntitle: ${title}\ndescription: House style (${title}).\nversion: 1\nlanguage: en\n---\n# ${title}\n`;
    put(path.join(skillsDir, 'house-style', 'SKILL.md'), style('rooted'));
    put(path.join(userProject, 'house-style', 'SKILL.md'), style('user-project'));
    put(path.join(userGlobal, 'house-style', 'SKILL.md'), style('user-global'));

    const registry = SkillRegistry.load(
      [
        { dir: userProject, source: 'user', registration: 'user-project' },
        { dir: userGlobal, source: 'user', registration: 'user-global' },
      ],
      { rescanTtlMs: 0 },
    );
    registerProjectRootedSkills(registry, roots, cwd);
    const exposure = { uses: ['house-style'] };
    registry.registerSource(
      new ProjectExposedSkillSource('consumer', {
        own: () => ({ uses: exposure.uses, name: null }),
        workspace: () => ({ confirmed: ['house-style'], listExposed: () => [{ ...BILLING, name: 'house-style', scope: 'writing-style' }] }),
        readProvider: async () => pkg('exposed'),
      }),
    );
    registry.addPluginStyle({ slug: 'house-style', title: 'plugin', description: 'House style (plugin).', version: 1, language: 'en', content: 'plugin' });

    const winner = () => {
      const m = registry.listSelectable().find((s) => s.slug === 'house-style')!;
      return m.source === 'user' ? (m.path.startsWith(userProject) ? 'user-project' : 'user-global') : m.source;
    };
    expect(winner()).toBe('project-rooted');
    fs.rmSync(path.join(skillsDir, 'house-style'), { recursive: true });
    expect(winner()).toBe('user-project');
    fs.rmSync(path.join(userProject, 'house-style'), { recursive: true });
    expect(winner()).toBe('project-exposed');
    exposure.uses = [];
    expect(winner()).toBe('user-global');
    fs.rmSync(path.join(userGlobal, 'house-style'), { recursive: true });
    expect(winner()).toBe('plugin');
    // One row per slug at every step.
    expect(registry.listSelectable().filter((s) => s.slug === 'house-style')).toHaveLength(1);
  });

  it('[ac:ac-w-projekcie-bez-zaladowanych-pluginow] with no plugins, no `contextual` package in the `skills` root and no attachments, the chat turn\'s <available_skills> has zero rows', () => {
    const cwd = tmp();
    const roots = new RootRegistry([{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }]);
    const registry = SkillRegistry.load([], { rescanTtlMs: 0 });
    registerProjectRootedSkills(registry, roots, cwd);
    registry.registerSource(
      new ProjectExposedSkillSource('consumer', {
        own: () => ({ uses: [], name: null }),
        workspace: () => ({ confirmed: [], listExposed: () => [BILLING] }),
        readProvider: async () => pkg('never read'),
      }),
    );
    const { listing } = new SkillResolver(registry, cwd).resolveForContext('chat', { writingStyle: null });
    expect(listing).toEqual([]);
    const block = availableSkillsBlock(prompt({ availableSkills: listing }));
    expect(block.startsWith('<available_skills>')).toBe(true);
    expect(block).not.toContain('<skill ');
  });

  it('[ac:m52-edge-self-attachment-not-listed] attaching the project\'s own `skill.name` puts nothing on the listing (ignored with a warning) and offers no row', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const own: ExposedProject = { ...BILLING, projectId: 'consumer', name: 'my-skill' };
    const { registry, resolver } = consumer({ uses: ['my-skill'], exposed: [own, BILLING] });
    expect(registry.has('my-skill')).toBe(false);
    expect(resolver.resolveForContext('chat', { writingStyle: null }).listing).toEqual([]);
    // Ignored, not dangling: no source reports the slug as unresolved.
    expect(registry.unresolvedReason('my-skill')?.reason).toBe('outside-registry');
    expect(warn.mock.calls.some(([m]) => String(m).includes('attaching oneself is ignored'))).toBe(true);
    expect(listExposedProjectRows('consumer', ['my-skill'], [own, BILLING], ['my-skill']).map((r) => r.name)).toEqual(['billing-rules']);
  });
});

describe('project-exposed source — reading (M52 + M37, 2.1.9)', () => {
  it('[ac:ac-otwarcie-projektu-wystawionego-o-mani] opening an exposed project whose manifest is over the limit answers `truncated: true`; a left-out page stays addressable', async () => {
    const files: Record<string, string> = {};
    const total = EXPOSED_SKILL_MANIFEST_LIMIT + 5;
    for (let i = 0; i < total; i++) files[`p-${String(i).padStart(3, '0')}.md`] = `page ${i}\n`;
    const { registry } = consumer({ uses: ['billing-rules'], exposed: [BILLING], packages: { billing: () => pkg('# Entry\n', files) } });

    const open = await loadSkillFileLive(registry, 'billing-rules');
    expect(open.truncated).toBe(true);
    expect(open.files).toHaveLength(EXPOSED_SKILL_MANIFEST_LIMIT);
    expect(open.truncationHint).toContain(`${EXPOSED_SKILL_MANIFEST_LIMIT} of its ${total}`);
    expect(open.source).toBe('project-exposed');
    expect(open).not.toHaveProperty('hash');
    const last = `p-${String(total - 1).padStart(3, '0')}.md`;
    expect(open.files!.some((f) => f.path === last)).toBe(false);
    expect((await loadSkillFileLive(registry, 'billing-rules', last)).content).toBe(`page ${total - 1}\n`);
  });

  it('[ac:ac-slug-z-nieosiagalnego-dostawcy-podpie] a slug of an unreachable attachment provider is known-unresolved in the registry with the reason "provider unreachable"', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const twin: ExposedProject = { ...BILLING, projectId: 'billing-2' };
    const { registry, resolver } = consumer({ uses: ['ghost', 'billing-rules'], exposed: [BILLING, twin] });
    // Dangling: no project exposes `ghost`. Ambiguous: two expose `billing-rules` — it resolves to none.
    for (const slug of ['ghost', 'billing-rules']) {
      expect(registry.has(slug)).toBe(false);
      expect(registry.unresolvedReason(slug)?.reason).toBe('provider-unreachable');
    }
    expect(resolver.resolveForContext('chat', { writingStyle: null }).listing).toEqual([]);
    const err = await refusal(loadSkillFileLive(registry, 'ghost'));
    expect(err.code).toBe('SKILL_NOT_FOUND');
    expect(err.message).toContain('the provider of this skill attachment is unreachable');
    expect(warn).toHaveBeenCalled();
  });

  it('[ac:m52-provider-change-visible-next-load] a change of a page at the provider is visible in the consumer\'s next load_skill_file', async () => {
    const provider = providerOnDisk();
    const { registry } = consumer({ uses: ['billing-rules'], exposed: [BILLING], packages: { billing: provider.read } });
    const first = await loadSkillFileLive(registry, 'billing-rules');
    expect(first.content).toContain('# Billing rules v1');
    expect((await loadSkillFileLive(registry, 'billing-rules', 'modules/invoices.md')).content).toContain('Draft, issued, paid.');

    put(path.join(provider.pagesDir, 'index.md'), '# Billing rules v2\n');
    put(path.join(provider.pagesDir, 'modules/invoices.md'), '# Invoice lifecycle\n\nDraft, issued, paid, refunded.\n');
    expect((await loadSkillFileLive(registry, 'billing-rules')).content).toContain('# Billing rules v2');
    expect((await loadSkillFileLive(registry, 'billing-rules', 'modules/invoices.md')).content).toContain('refunded');
  });

  it('[section:1v62dbhb] the source holds no handle of the provider\'s context: after the implementor releases and rebuilds it, the next read reaches the new context', async () => {
    // The layer's implementor — the M31 cache — hands out the provider's context on request.
    let version = 0;
    const cache = new ProjectContextCache(async (p) => {
      const v = ++version;
      return {
        projectId: p.id,
        hasInFlightTurn: () => false,
        dispose: vi.fn(async () => {}),
        readExposedSkill: async () => pkg(`# Billing rules v${v}\n`),
      } as unknown as ProjectContext;
    });
    const provider: ProjectRecord = { id: 'billing', cwd: '/projects/billing', addedAt: '2026-10-28T00:00:00.000Z' };
    try {
      const { registry } = consumer({
        uses: ['billing-rules'],
        exposed: [BILLING],
        packages: { billing: async () => (await cache.get(provider)).readExposedSkill() },
      });
      expect((await loadSkillFileLive(registry, 'billing-rules')).content).toContain('# Billing rules v1');
      const first = cache.getLive('billing')!;

      // The implementor releases the provider's context (an invalidation) and builds its successor.
      cache.invalidate('billing');
      expect(first.dispose).toHaveBeenCalledTimes(1);
      expect((await loadSkillFileLive(registry, 'billing-rules')).content).toContain('# Billing rules v2');
      expect(cache.getLive('billing')).not.toBe(first);
    } finally {
      await cache.disposeAll();
    }
  });

  it('the content arrives expanded in the provider\'s context, without frontmatter and anchor lines; subfiles are the base-root pages by path', async () => {
    const provider = providerOnDisk();
    const read = await provider.read();
    expect(read.content).not.toContain('title: Billing');
    expect(read.content).not.toContain('<!-- anchor:');
    expect(read.content).not.toContain('<inline_mention');
    expect(read.content).not.toContain('<section_ref');
    expect(read.content).toContain('GET /invoices/:id');
    expect(read.content).toContain('Invoice lifecycle');
    expect(Object.keys(read.files)).toEqual(['modules/invoices.md']);
    expect(stripForSkill('---\na: 1\n---\n<!-- anchor: abcdef12 -->\n# H\n')).toBe('# H\n');
  });

  it('[ac:ac-zadna-tura-agenta-nie-przekazuje-pola] no skill package — the content of an exposed project included — is materialised on disk for the agent', async () => {
    const provider = providerOnDisk();
    const c = consumer({ uses: ['billing-rules'], exposed: [BILLING], packages: { billing: provider.read } });
    const before = { provider: tree(provider.cwd), consumer: tree(c.cwd), tmp: fs.readdirSync(os.tmpdir()).length };

    const open = await loadSkillFileLive(c.registry, 'billing-rules');
    const sub = await loadSkillFileLive(c.registry, 'billing-rules', 'modules/invoices.md');

    // Nothing written or copied: the provider's tree and the consumer's are byte-for-byte the same set of files.
    expect(tree(provider.cwd)).toEqual(before.provider);
    expect(tree(c.cwd)).toEqual(before.consumer);
    // Served as payload only — no disk path in either answer.
    expect(JSON.stringify([open, sub])).not.toContain(provider.cwd);
    expect(open).not.toHaveProperty('path');
    expect(sub.path).toBe('modules/invoices.md');
  });
});

describe('a writing style of an attachment whose provider is unreachable (M01 7yzu5k8u, 2.1.9)', () => {
  const dangling = () => consumer({ uses: ['house-style'], exposed: [] });
  const reachable = () =>
    consumer({
      uses: ['house-style'],
      exposed: [{ ...BILLING, name: 'house-style', scope: 'writing-style' }],
      packages: { billing: () => pkg('# House style\n') },
    });

  it('[ac:ac-config-writingstyle-na-styl-podpieteg] `config.writingStyle` on the style of an attached exposed project with an unreachable provider → the server start does not hard-fail', () => {
    const verdict = checkWritingStyleAtStart(dangling().registry, 'house-style');
    expect(verdict.ok).toBe(true);
    expect(verdict.ok && verdict.warning).toMatch(/provider is unreachable/);
  });

  it('[ac:ac-config-writingstyle-wskazujacy-styl-p] `config.writingStyle` pointing at a style of an exposed project whose provider is unreachable does not stop the start — the other unresolved causes still do', () => {
    expect(checkWritingStyleAtStart(dangling().registry, 'house-style')).toMatchObject({ ok: true });
    // Contrast: a slug nobody knows still stops it.
    expect(checkWritingStyleAtStart(dangling().registry, 'no-such-style')).toMatchObject({ ok: false, reason: 'outside-registry' });
    // And a reachable provider's style is selectable — no warning at all.
    expect(checkWritingStyleAtStart(reachable().registry, 'house-style')).toEqual({ ok: true });
  });

  it('[ac:ac-config-writingstyle-na-styl-podpieteg-2] `config.writingStyle` on the style of an attached exposed project with an unreachable provider → the prompt of a new thread has no <project_writing_skill> block', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { writingStyle } = dangling().resolver.resolveForContext('chat', { writingStyle: 'house-style' });
    expect(writingStyle).toBeNull();
    expect(prompt({ writingStyleSkill: writingStyle })).not.toContain('<project_writing_skill');
  });

  it('[ac:ac-gdy-config-writingstyle-wskazuje-styl-2] when `config.writingStyle` points at a style of an exposed project whose provider is unreachable, the first turn of a new thread carries no <project_writing_skill/> block; once the provider resolves it does', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const down = dangling().resolver.resolveForContext('chat', { writingStyle: 'house-style' });
    expect(prompt({ writingStyleSkill: down.writingStyle, availableSkills: down.listing })).not.toContain('<project_writing_skill');
    const up = reachable().resolver.resolveForContext('chat', { writingStyle: 'house-style' });
    expect(up.writingStyle).toEqual({ slug: 'house-style', title: 'house-style' });
    expect(prompt({ writingStyleSkill: up.writingStyle })).toContain('<project_writing_skill');
  });
});

describe('attachments against real project configs (M52, 2.1.9)', () => {
  /** A workspace of two projects on disk: provider `billing` and consumer `shop`. */
  function workspace() {
    const providerCwd = tmp();
    const consumerCwd = tmp();
    writeConfig(providerCwd, { name: 'Billing', projectType: 'skill', skill: { name: 'billing-rules', description: 'How billing works.' } });
    writeConfig(consumerCwd, { name: 'Shop', skill: { uses: ['billing-rules'] } });
    const projects = [
      { id: 'billing', cwd: providerCwd, projectType: 'skill' },
      { id: 'shop', cwd: consumerCwd, confirmedSkillUses: ['billing-rules'] },
    ];
    const registry = SkillRegistry.load([], { rescanTtlMs: 0 });
    registry.registerSource(
      new ProjectExposedSkillSource(
        'shop',
        workspaceExposedSkillAccess({
          consumerId: 'shop',
          readOwnSkill: () => normalizeSkillConfig(readConfig(consumerCwd)),
          readWorkspaceProjects: () => projects,
          readProvider: async () => pkg('# Billing\n'),
        }),
      ),
    );
    const rows = () =>
      listExposedProjectRows('shop', readConfig(consumerCwd).skill?.uses ?? [], listExposedProjects(projects), projects[1]!.confirmedSkillUses!);
    return { providerCwd, consumerCwd, registry, rows };
  }

  it('[ac:m52-edge-renamed-provider-unavailable] after the provider changes its `skill.name`, the attachment by the old name is marked Unavailable', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ws = workspace();
    expect(ws.rows()).toEqual([
      { name: 'billing-rules', description: 'How billing works.', projectId: 'billing', projectType: 'skill', uses: true, status: 'ok', confirmed: true },
    ]);
    expect(ws.registry.has('billing-rules')).toBe(true);

    writeConfig(ws.providerCwd, { skill: { name: 'billing-v2' } });
    expect(ws.rows()).toEqual([
      { name: 'billing-rules', uses: true, status: 'unavailable', confirmed: true },
      { name: 'billing-v2', description: 'How billing works.', projectId: 'billing', projectType: 'skill', uses: false, status: 'ok', confirmed: false },
    ]);
    // No redirect: the old name is dangling for the registry too.
    expect(ws.registry.has('billing-rules')).toBe(false);
    expect(ws.registry.unresolvedReason('billing-rules')?.reason).toBe('provider-unreachable');
  });

  it('[ac:m52-exposed-project-not-in-consumer-sidebar] an attached exposed project has no place in the consumer\'s sidebar: its accordions are the consumer\'s own roots, attached or not', async () => {
    const ws = workspace();
    const accordions = async () => {
      const svc = new SidebarAccordionsService({
        cwd: ws.consumerCwd,
        registry: new RootRegistry(readConfig(ws.consumerCwd).roots),
        ws: { broadcast: (_e: WsEvent) => {} },
        projectKey: ws.consumerCwd,
        warn: () => {},
      });
      const res = await request(express().use('/api/sidebar-accordions', sidebarAccordionsRouter(svc))).get('/api/sidebar-accordions');
      expect(res.status).toBe(200);
      return res.body.data as Array<{ rootId: string; key: string; label: string; path: string }>;
    };
    // The attachment is live in the consumer's registry…
    expect(ws.registry.has('billing-rules')).toBe(true);
    const attached = await accordions();
    const ownRoots = new Set(new RootRegistry(readConfig(ws.consumerCwd).roots).list().map((r) => r.id));
    expect(attached.every((a) => ownRoots.has(a.rootId))).toBe(true);
    expect(JSON.stringify(attached)).not.toMatch(/billing/i);
    // …and the sidebar is exactly what it is without it.
    writeConfig(ws.consumerCwd, { skill: { uses: [] } });
    expect(await accordions()).toEqual(attached);
  });
});

describe('the `mcp` channel (M12 ecawzsbr, 2.1.9)', () => {
  it('an attached exposed project is a row of THIS project\'s registry on the external surface: list_skills shows it with origin + project, load_skill_file reads it live — no other project addressed', async () => {
    const c = consumer({ uses: ['billing-rules'], exposed: [BILLING], packages: { billing: () => pkg('# Billing rules\n') } });
    const server = buildSkillToolsServer(c.registry, 'consumer', { resolver: c.resolver });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const call = async (name: string, args: Record<string, unknown>) => {
        const res = await client.callTool({ name, arguments: args });
        expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
        return JSON.parse((res.content as Array<{ text: string }>)[0]!.text) as Record<string, any>;
      };
      const listing = await call('list_skills', { contextType: 'chat' });
      expect(listing.listing).toEqual([
        { slug: 'billing-rules', description: 'How billing works.', origin: 'project-exposed', project: 'billing' },
      ]);
      const open = await call('load_skill_file', { slug: 'billing-rules' });
      expect(open).toMatchObject({ slug: 'billing-rules', source: 'project-exposed', content: '# Billing rules\n' });
      expect(c.reads).toEqual(['billing']);
    } finally {
      await client.close();
    }
  });
});

describe('update_skill_file read-only rule (M52, 2.1.9)', () => {
  it('a slug won by an exposed project and absent from the own `skills` root is read-only (pointing at ask on the provider); any other slug is not', () => {
    expect(exposedReadOnlyReason({ slug: 'billing-rules', source: 'project-exposed', project: 'billing' })).toBe(
      'skill "billing-rules" comes from an exposed project and is read-only here — propose the change to its owner with ask({ project: "billing" })',
    );
    expect(exposedReadOnlyReason({ slug: 'billing-rules', source: 'project-exposed', project: 'billing' }, true)).toBeNull();
    expect(exposedReadOnlyReason({ slug: 'own', source: 'project-rooted' })).toBeNull();
    expect(exposedReadOnlyReason(undefined)).toBeNull();
  });
});

/**
 * 2.1.67 — M52 `uluzymnm` / `ybbal0vf` / `rkbsi6ky` 15: the trust gate of
 * attachments from the repository. The attachment list rides in the committed
 * `config.json`, so an attachment works only once this machine confirmed its NAME
 * (`confirmedSkillUses` in the M31 registry record). A name is confirmed, not the
 * list: a name a commit adds stays unconfirmed. An unconfirmed attachment resolves
 * to no provider and warns like a dangling one; the start never fails on it.
 */
describe('attachments from the repository need their name confirmed on this machine (M52 uluzymnm, 2.1.67)', () => {
  it('[ac:ac-podpiecie-z-skill-uses-ktorego-nazwa] an attachment of `skill.uses` whose name is not confirmed on this machine does not resolve to its provider; confirmed, it does — read live without a rebuild', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = consumer({
      uses: ['billing-rules'],
      exposed: [BILLING],
      packages: { billing: () => pkg('# Billing rules\n') },
      confirmed: [],
    });

    // Not confirmed: the provider exists and is unique, yet the attachment resolves to none.
    expect(c.registry.has('billing-rules')).toBe(false);
    expect(c.resolver.resolveForContext('chat', { writingStyle: null }).listing).toEqual([]);
    // Like a dangling attachment: known, unresolved, `provider-unreachable` — a warning, not an error.
    const unresolved = c.registry.unresolvedReason('billing-rules');
    expect(unresolved?.reason).toBe('provider-unreachable');
    expect(unresolved?.detail).toBe(UNCONFIRMED_DETAIL);
    const err = await refusal(loadSkillFileLive(c.registry, 'billing-rules'));
    expect(err.code).toBe('SKILL_NOT_FOUND');
    // The provider's content never reaches the consumer.
    expect(c.reads).toEqual([]);
    const messages = warn.mock.calls.map((args) => String(args[0]));
    expect(messages.some((m) => m.includes('skill.uses "billing-rules"') && m.includes('not confirmed on this machine'))).toBe(true);

    // The name confirmed on this machine: the same attachment resolves to its provider.
    c.state.confirmed = ['billing-rules'];
    expect(c.registry.has('billing-rules')).toBe(true);
    expect(c.registry.unresolvedReason('billing-rules')).toBeNull();
    expect((await loadSkillFileLive(c.registry, 'billing-rules')).content).toContain('# Billing rules');
    expect(c.reads).toEqual(['billing']);

    // Withdrawn: back to unresolved.
    c.state.confirmed = [];
    expect(c.registry.has('billing-rules')).toBe(false);
    expect(c.registry.unresolvedReason('billing-rules')?.reason).toBe('provider-unreachable');
  });

  it('[ac:ac-nazwa-dopisana-commitem-do-skill-uses] a name a commit adds to the `skill.uses` of a project with other attachments confirmed is unconfirmed: it resolves to none and its row reads `confirmed: false`, while the confirmed one keeps working', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const billingCwd = tmp();
    const legalCwd = tmp();
    const shopCwd = tmp();
    writeConfig(billingCwd, { name: 'Billing', projectType: 'skill', skill: { name: 'billing-rules', description: 'How billing works.' } });
    writeConfig(legalCwd, { name: 'Legal', projectType: 'skill', skill: { name: 'legal-terms', description: 'Terms.' } });
    writeConfig(shopCwd, { name: 'Shop', skill: { uses: ['billing-rules'] } });
    // The registry record of this machine: `billing-rules` confirmed.
    const projects: ProjectRecord[] = [
      { id: 'billing', cwd: billingCwd, projectType: 'skill' },
      { id: 'legal', cwd: legalCwd, projectType: 'skill' },
      { id: 'shop', cwd: shopCwd, confirmedSkillUses: ['billing-rules'] },
    ];
    const registry = SkillRegistry.load([], { rescanTtlMs: 0 });
    const source = new ProjectExposedSkillSource(
      'shop',
      workspaceExposedSkillAccess({
        consumerId: 'shop',
        readOwnSkill: () => normalizeSkillConfig(readConfig(shopCwd)),
        readWorkspaceProjects: () => projects,
        readProvider: async (id) => pkg(`# ${id}\n`),
      }),
    );
    registry.registerSource(source);
    const rows = () =>
      listExposedProjectRows(
        'shop',
        readConfig(shopCwd).skill?.uses ?? [],
        listExposedProjects(projects),
        projects[2]!.confirmedSkillUses ?? [],
      );
    expect(registry.has('billing-rules')).toBe(true);

    // A commit (pulled into the working tree) appends `legal-terms` to `skill.uses`.
    writeConfig(shopCwd, { skill: { uses: ['billing-rules', 'legal-terms'] } });
    expect(readConfig(shopCwd).skill?.uses).toEqual(['billing-rules', 'legal-terms']);

    // The confirmed name still works; the appended one does not resolve to its (unique, existing) provider.
    expect(registry.has('billing-rules')).toBe(true);
    expect(registry.has('legal-terms')).toBe(false);
    expect(source.unresolved()).toEqual([{ slug: 'legal-terms', reason: 'provider-unreachable', detail: UNCONFIRMED_DETAIL }]);
    expect(rows()).toEqual([
      { name: 'billing-rules', description: 'How billing works.', projectId: 'billing', projectType: 'skill', uses: true, status: 'ok', confirmed: true },
      { name: 'legal-terms', description: 'Terms.', projectId: 'legal', projectType: 'skill', uses: true, status: 'ok', confirmed: false },
    ]);
  });

  it('[section:uluzymnm] a confirmed name absent from `skill.uses` does nothing and is no error; taking an attachment off needs no confirmation', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const LEGAL: ExposedProject = { ...BILLING, projectId: 'legal', name: 'legal-terms', description: 'Terms.' };
    const c = consumer({ uses: ['billing-rules'], exposed: [BILLING, LEGAL], confirmed: ['billing-rules', 'legal-terms'] });
    // `legal-terms` is confirmed but not attached: nothing on the listing, nothing unresolved.
    expect(c.resolver.resolveForContext('chat', { writingStyle: null }).listing.map((e) => e.slug)).toEqual(['billing-rules']);
    expect(c.registry.unresolvedReason('legal-terms')?.reason).toBe('outside-registry');
    // Taking `billing-rules` off: no confirmation involved, it simply leaves the listing.
    c.state.uses = [];
    expect(c.resolver.resolveForContext('chat', { writingStyle: null }).listing).toEqual([]);
    // 2.1.69 (M52 `qtq9iusb`): a row carries the confirmation of its name, attached or not —
    // taking the attachment off leaves the confirmation in place.
    expect(listExposedProjectRows('consumer', [], [BILLING, LEGAL], ['billing-rules', 'legal-terms']).map((r) => [r.uses, r.confirmed])).toEqual([
      [false, true],
      [false, true],
    ]);
  });

  it('[section:rkbsi6ky] an unconfirmed attachment warns and the start does not fail; the writing style of such a provider stays out of the thread', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = consumer({
      uses: ['house-style'],
      exposed: [{ ...BILLING, name: 'house-style', scope: 'writing-style' }],
      packages: { billing: () => pkg('# House style\n') },
      confirmed: [],
    });
    const verdict = checkWritingStyleAtStart(c.registry, 'house-style');
    expect(verdict.ok).toBe(true);
    expect(verdict.ok && verdict.warning).toBeTruthy();
    const { writingStyle } = c.resolver.resolveForContext('chat', { writingStyle: 'house-style' });
    expect(writingStyle).toBeNull();
    expect(prompt({ writingStyleSkill: writingStyle })).not.toContain('<project_writing_skill');
  });

  it('[section:ybbal0vf] a project without attachments needs no confirmation and reads nothing to decide it', () => {
    let workspaceReads = 0;
    let exposedReads = 0;
    const registry = SkillRegistry.load([], { rescanTtlMs: 0 });
    registry.registerSource(
      new ProjectExposedSkillSource('consumer', {
        own: () => ({ uses: [], name: null }),
        workspace: () => {
          workspaceReads += 1;
          return {
            confirmed: [],
            listExposed: () => {
              exposedReads += 1;
              return [BILLING];
            },
          };
        },
        readProvider: async () => pkg('never read'),
      }),
    );
    expect(registry.has('billing-rules')).toBe(false);
    expect(registry.unresolvedReason('billing-rules')?.reason).toBe('outside-registry');
    expect(workspaceReads).toBe(0);
    expect(exposedReads).toBe(0);
  });

  it('[section:ybbal0vf] a project with no attachment confirmed reads no peer config (no listExposed); with one confirmed it reads the registry once per query', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const providerCwd = tmp();
    const otherCwd = tmp();
    const consumerCwd = tmp();
    writeConfig(providerCwd, { name: 'Billing', projectType: 'skill', skill: { name: 'billing-rules', description: 'How billing works.' } });
    writeConfig(otherCwd, { name: 'Legal', projectType: 'skill', skill: { name: 'legal-terms', description: 'Terms.' } });
    writeConfig(consumerCwd, { name: 'Shop', projectType: 'skill', skill: { name: 'shop-skill', description: 'The shop.', uses: ['billing-rules', 'shop-skill'] } });
    const record: { projects: ProjectRecord[] } = {
      projects: [
        { id: 'billing', cwd: providerCwd, projectType: 'skill' },
        { id: 'legal', cwd: otherCwd, projectType: 'skill' },
        // Confirming its own name changes nothing: attaching oneself is ignored.
        { id: 'shop', cwd: consumerCwd, projectType: 'skill', confirmedSkillUses: ['shop-skill'] },
      ],
    };
    let registryReads = 0;
    const peerReads: string[] = [];
    // Driven directly: one `list()` / `unresolved()` call is one query of the source.
    const source = new ProjectExposedSkillSource(
      'shop',
      workspaceExposedSkillAccess({
        consumerId: 'shop',
        readOwnSkill: () => normalizeSkillConfig(readConfig(consumerCwd)),
        readWorkspaceProjects: () => {
          registryReads += 1;
          // A fresh copy per read, as the registry file is re-parsed each time.
          return record.projects.map((p) => ({ ...p }));
        },
        readPeerSkill: (cwd) => {
          peerReads.push(cwd);
          return normalizeSkillConfig(readConfig(cwd));
        },
        readProvider: async () => pkg('# Billing\n'),
      }),
    );

    // Nothing confirmed: each query reads the registry once and no peer config at all.
    expect(source.list().entries).toEqual([]);
    expect(registryReads).toBe(1);
    expect(source.unresolved()).toEqual([
      { slug: 'billing-rules', reason: 'provider-unreachable', detail: UNCONFIRMED_DETAIL },
    ]);
    expect(registryReads).toBe(2);
    expect(peerReads).toEqual([]);
    // The self rule still holds, from the consumer's own config: `shop-skill` is not reported as unreachable.
    expect(source.unresolved().map((u) => u.slug)).not.toContain('shop-skill');

    // `billing-rules` confirmed: one registry read per query; each peer read once, never the consumer itself.
    record.projects[2]!.confirmedSkillUses = ['billing-rules'];
    registryReads = 0;
    expect(source.list().entries.map((e) => [e.slug, e.project])).toEqual([['billing-rules', 'billing']]);
    expect(registryReads).toBe(1);
    expect([...peerReads].sort()).toEqual([providerCwd, otherCwd].sort());
    peerReads.length = 0;
    expect(source.unresolved()).toEqual([]);
    expect(registryReads).toBe(2);
    expect([...peerReads].sort()).toEqual([providerCwd, otherCwd].sort());
  });
});

/**
 * 2.1.67 — M52 `uluzymnm` "Chwila": a name confirmed with `c4s confirm-skill-uses`
 * (M31, server-free, into the machine-local registry) BEFORE the server starts
 * is what the server reads: the attached provider's writing style is in the
 * project's first thread. Runs against a throwaway `C4S_HOME` and a throwaway
 * home workspace of two projects.
 */
describe('a name confirmed by the CLI before the server starts (M52 uluzymnm, 2.1.67)', () => {
  let prevHome: string | undefined;
  afterEach(() => {
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
  });

  it('[ac:ac-po-potwierdzeniu-nazwy-komenda-c4s-co] after `c4s confirm-skill-uses <name>` before the server starts, the attached provider\'s writing style is in the first thread of the project', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const root = fs.realpathSync(tmp());
    prevHome = process.env.C4S_HOME;
    process.env.C4S_HOME = path.join(root, 'registry');
    const home = path.join(root, 'team-repo');
    const providerDir = path.join(home, 'specs', 'style');
    const consumerDir = path.join(home, 'specs', 'app');
    writeConfig(providerDir, {
      name: 'Style',
      projectType: 'writing-style',
      skill: { name: 'house-style', description: 'The house writing style.' },
    });
    writeConfig(consumerDir, { name: 'App', writingStyle: 'house-style', skill: { uses: ['house-style'] } });
    put(
      path.join(home, '.claude4spec', 'workspace.json'),
      JSON.stringify({ projects: [{ id: 'style', path: 'specs/style', projectType: 'writing-style' }, { id: 'app', path: 'specs/app' }], plugins: [] }, null, 2),
    );

    // The CLI, server-free: register the home, then confirm the name.
    let stdout = '';
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout += String(chunk);
      return true;
    });
    try {
      await runRegisterHome(parseArgs(['register-home', '--cwd', home, '--port', '4711']));
      stdout = '';
      await runConfirmSkillUses(parseArgs(['confirm-skill-uses', 'house-style', '--cwd', consumerDir, '--port', '4711']));
    } finally {
      write.mockRestore();
    }
    const confirmedByCli = JSON.parse(stdout) as { workspace: string; projectId: string; confirmedSkillUses: string[] };
    expect(confirmedByCli).toMatchObject({ projectId: 'app', confirmedSkillUses: ['house-style'] });

    // The server starts: a fresh registry reader, the project context's own wiring of the source.
    const wsRegistry = new WorkspaceRegistry();
    const workspaceProjects = () => wsRegistry.getWorkspace(confirmedByCli.workspace)?.projects ?? [];
    expect(workspaceProjects().find((p) => p.id === 'app')?.confirmedSkillUses).toEqual(['house-style']);
    const registry = SkillRegistry.load([], { rescanTtlMs: 0 });
    registry.registerSource(
      new ProjectExposedSkillSource(
        'app',
        workspaceExposedSkillAccess({
          consumerId: 'app',
          readOwnSkill: () => normalizeSkillConfig(readConfig(consumerDir)),
          readWorkspaceProjects: workspaceProjects,
          readProvider: async () => pkg('# House style\n'),
        }),
      ),
    );
    // The start check passes with no warning: the style resolves.
    expect(checkWritingStyleAtStart(registry, 'house-style')).toEqual({ ok: true });
    // The first thread: its prompt carries the provider's writing style.
    const first = new SkillResolver(registry, consumerDir).resolveForContext('chat', { writingStyle: readConfig(consumerDir).writingStyle ?? null });
    expect(first.writingStyle).toEqual({ slug: 'house-style', title: 'house-style' });
    expect(prompt({ writingStyleSkill: first.writingStyle })).toContain('<project_writing_skill');
  });
});

/**
 * 2.1.57 — M52 `9j9cxrsr`: an attachment does not pin the provider's release —
 * the content is read live on every load_skill_file.
 */
describe('an attachment pins no provider release (M52 9j9cxrsr, 2.1.57)', () => {
  it('[section:9j9cxrsr] the attachment is a bare name; every load reads the provider now, so a provider change acts at once with nothing bumped at the consumer', async () => {
    const provider = providerOnDisk();
    const c = consumer({ uses: ['billing-rules'], exposed: [BILLING], packages: { billing: provider.read } });
    const usesBefore = [...c.state.uses];

    expect((await loadSkillFileLive(c.registry, 'billing-rules')).content).toContain('# Billing rules v1');
    put(path.join(provider.pagesDir, 'index.md'), '# Billing rules v2\n');
    expect((await loadSkillFileLive(c.registry, 'billing-rules')).content).toContain('# Billing rules v2');
    put(path.join(provider.pagesDir, 'index.md'), '# Billing rules v3\n');
    expect((await loadSkillFileLive(c.registry, 'billing-rules')).content).toContain('# Billing rules v3');

    // One provider read per load — no pinned copy, no cache.
    expect(c.reads).toEqual(['billing', 'billing', 'billing']);
    // Nothing at the consumer names a release: the attachment is still the bare name.
    expect(c.state.uses).toEqual(usesBefore);
    expect(c.state.uses).toEqual(['billing-rules']);
    // Nothing is copied into the consumer either.
    expect(tree(c.cwd)).toEqual([]);
  });
});
