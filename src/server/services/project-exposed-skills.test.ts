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
import { readConfig, writeConfig } from '../config.js';
import { RootRegistry } from '../roots/registry.js';
import { sidebarAccordionsRouter } from '../routes/sidebar-accordions.js';
import { buildSystemPrompt, type SystemPromptInput } from './chat-context.js';
import { listExposedProjectRows, listExposedProjects, type ExposedProject } from './exposed-projects.js';
import { PagesService } from './pages.js';
import {
  EXPOSED_SKILL_MANIFEST_LIMIT,
  ProjectExposedSkillSource,
  exposedReadOnlyReason,
  readExposedPackage,
  stripForSkill,
  type ExposedSkillAccess,
  type ExposedSkillPackage,
} from './project-exposed-skills.js';
import { registerProjectRootedSkills } from './project-rooted-skills.js';
import { SidebarAccordionsService } from './sidebar-accordions.js';
import { SkillRegistry, SkillResolver, toPackageFiles } from './skill-registry.js';
import { loadSkillFileLive } from './skill-operations.js';
import { DomainError } from './tags.js';
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
}) {
  const state = { uses: initial.uses ?? [], exposed: initial.exposed ?? [], packages: initial.packages ?? {} };
  const reads: string[] = [];
  const access: ExposedSkillAccess = {
    uses: () => state.uses,
    listExposed: () => state.exposed,
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
        uses: () => exposure.uses,
        listExposed: () => [{ ...BILLING, name: 'house-style', scope: 'writing-style' }],
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
        uses: () => [],
        listExposed: () => [BILLING],
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
    expect(listExposedProjectRows('consumer', ['my-skill'], [own, BILLING]).map((r) => r.name)).toEqual(['billing-rules']);
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
    writeConfig(providerCwd, { name: 'Billing', skill: { exposed: true, name: 'billing-rules', description: 'How billing works.' } });
    writeConfig(consumerCwd, { name: 'Shop', skill: { uses: ['billing-rules'] } });
    const projects = [
      { id: 'billing', cwd: providerCwd },
      { id: 'shop', cwd: consumerCwd },
    ];
    const registry = SkillRegistry.load([], { rescanTtlMs: 0 });
    registry.registerSource(
      new ProjectExposedSkillSource('shop', {
        uses: () => readConfig(consumerCwd).skill?.uses ?? [],
        listExposed: () => listExposedProjects(projects),
        readProvider: async () => pkg('# Billing\n'),
      }),
    );
    const rows = () => listExposedProjectRows('shop', readConfig(consumerCwd).skill?.uses ?? [], listExposedProjects(projects));
    return { providerCwd, consumerCwd, registry, rows };
  }

  it('[ac:m52-edge-renamed-provider-unavailable] after the provider changes its `skill.name`, the attachment by the old name is marked Unavailable', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ws = workspace();
    expect(ws.rows()).toEqual([
      { name: 'billing-rules', description: 'How billing works.', projectId: 'billing', uses: true, status: 'ok' },
    ]);
    expect(ws.registry.has('billing-rules')).toBe(true);

    writeConfig(ws.providerCwd, { skill: { name: 'billing-v2' } });
    expect(ws.rows()).toEqual([
      { name: 'billing-rules', uses: true, status: 'unavailable' },
      { name: 'billing-v2', description: 'How billing works.', projectId: 'billing', uses: false, status: 'ok' },
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
