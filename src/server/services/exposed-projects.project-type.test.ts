/**
 * 2.1.77 — the project type decides the exposure of a skill (M52 `ybbal0vf`,
 * `0ay8qh6u`, `8zu57gsf`, `wqvq1esb`, `1osy2o5r`; M37 `prwobscq`, `r8sajsmk`;
 * M15 `2oha8chk`, `m15edg001`).
 *
 * A provider is a project whose type has `skill-exposure`, read from the type
 * copy in the workspace record — no toggle. The scope of its entry follows from
 * the type: `writing-style` → a selectable writing style, `skill` → a
 * `contextual` listing entry. A type the current version does not know does not
 * activate: no entry, the name known and unresolved. Without `skill-exposure`
 * the exposure keys are inactive: `GET /api/config` does not return them.
 *
 * The rig is the project context's own wiring of the `project-exposed` source
 * (`workspaceExposedSkillAccess` over a registry record and the projects'
 * `config.json` on disk, read through the sanctioned peer read).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import { configPath, normalizeSkillConfig, readConfig, writeConfig } from '../config.js';
import { configRouter } from '../routes/config.js';
import { STATIC_FIELD_REGISTRY } from '../settings/registry.js';
import { projectCapabilitySet } from '../project-types/capabilities.js';
import type { ProjectRecord } from '../workspace/types.js';
import { buildSystemPrompt } from './chat-context.js';
import { exposedScopeOf, listExposedProjectRows, listExposedProjects } from './exposed-projects.js';
import { ProjectExposedSkillSource, workspaceExposedSkillAccess } from './project-exposed-skills.js';
import { SkillRegistry, SkillResolver } from './skill-registry.js';

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function dir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-exposure-by-type-'));
  tmpDirs.push(d);
  return d;
}

/** The capability sets of the host's types (M58 / M59 / M60). */
const SPEC_CAPS = projectCapabilitySet(['briefs', 'entities', 'multi-root']);
const PROVIDER_CAPS = projectCapabilitySet(['skill-exposure']);

/**
 * A workspace on disk: the consumer `app` (a Specification) attaches — all
 * confirmed on this machine — `house-style` (a Writing Style project),
 * `team-skill` (a Skill project), `odd-skill` (a project of a type this version
 * does not know) and `spec-skill` (a Specification with exposure keys copied
 * into its file).
 */
function workspace() {
  const cwds = { app: dir(), style: dir(), team: dir(), odd: dir(), spec: dir() };
  writeConfig(cwds.app, { name: 'App', skill: { uses: ['house-style', 'team-skill', 'odd-skill', 'spec-skill'] } });
  writeConfig(cwds.style, { name: 'Style', projectType: 'writing-style', skill: { name: 'house-style', description: 'The house writing style.' } });
  writeConfig(cwds.team, { name: 'Team', projectType: 'skill', skill: { name: 'team-skill', description: 'How the team works.' } });
  writeConfig(cwds.odd, { name: 'Odd', projectType: 'future-type', skill: { name: 'odd-skill', description: 'From a newer version.' } });
  writeConfig(cwds.spec, { name: 'Spec', skill: { name: 'spec-skill', description: 'Copied by hand.' } });
  const projects: ProjectRecord[] = [
    { id: 'app', cwd: cwds.app, confirmedSkillUses: ['house-style', 'team-skill', 'odd-skill', 'spec-skill'] },
    { id: 'style', cwd: cwds.style, projectType: 'writing-style' },
    { id: 'team', cwd: cwds.team, projectType: 'skill' },
    { id: 'odd', cwd: cwds.odd, projectType: 'future-type' },
    { id: 'spec', cwd: cwds.spec },
  ];
  const registry = SkillRegistry.load([], { rescanTtlMs: 0 });
  registry.registerSource(
    new ProjectExposedSkillSource(
      'app',
      workspaceExposedSkillAccess({
        consumerId: 'app',
        readOwnSkill: () => normalizeSkillConfig(readConfig(cwds.app)),
        readWorkspaceProjects: () => projects,
        readProvider: async (id) => ({ entry: 'index.md', content: `# ${id}\n`, files: {} }),
      }),
    ),
  );
  const app = express().use(express.json()).use(configRouter({ cwd: cwds.app, skillRegistry: registry, capabilities: SPEC_CAPS }));
  return { cwds, projects, registry, app, resolver: new SkillResolver(registry, cwds.app) };
}

const host = { listEntities: () => [] } as unknown as ProjectPluginHost;

describe('the provider\'s type decides its entry (M37 r8sajsmk, M52 8zu57gsf, 2.1.77)', () => {
  it('[ac:ac-styl-podpietego-projektu-typu-writing] the style of an attached Writing Style project is a position of listSelectable() and of the GET /api/writing-styles answer with source "project-exposed"', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { registry, app } = workspace();
    const selectable = registry.listSelectable().find((m) => m.slug === 'house-style');
    expect(selectable).toMatchObject({ slug: 'house-style', scope: 'writing-style', source: 'project-exposed', project: 'style' });
    const res = await request(app).get('/writing-styles');
    expect(res.status).toBe(200);
    expect(res.body.available).toContainEqual(expect.objectContaining({ slug: 'house-style', source: 'project-exposed' }));
  });

  it('[ac:ac-wpis-podpietego-projektu-typu-skill-n] the entry of an attached Skill project is not a position of listSelectable() — it is a contextual entry of list()', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { registry } = workspace();
    expect(registry.list().filter((m) => m.slug === 'team-skill')).toEqual([
      expect.objectContaining({ slug: 'team-skill', scope: 'contextual', source: 'project-exposed', project: 'team' }),
    ]);
    expect(registry.listSelectable().map((m) => m.slug)).not.toContain('team-skill');
    expect(registry.isSelectable('team-skill')).toBe(false);
  });

  it('[ac:ac-element-writing-style-na-karcie-proje] the `Writing style` element of the #project card shows no option for the style of an attached Skill project: its options are GET /api/writing-styles `available[]`, which does not carry it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app } = workspace();
    const res = await request(app).get('/writing-styles');
    // The element maps `available[]` one to one onto its options (pinned in
    // client writingStyleSourceBadge.test.ts `[section:m6ukdbsc]`).
    const slugs = (res.body.available as Array<{ slug: string }>).map((s) => s.slug);
    expect(slugs).not.toContain('team-skill');
    // The Writing Style project's style is offered — the filter is the provider's type.
    expect(slugs).toContain('house-style');
  });

  it('[ac:ac-podpiety-projekt-o-typie-nieznanym-bi] an attached project of a type the current version does not know brings no entry into the registry\'s list(); its name is known, unresolved — provider unreachable', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { registry } = workspace();
    expect(registry.list().map((m) => m.slug)).not.toContain('odd-skill');
    expect(registry.has('odd-skill')).toBe(false);
    expect(registry.unresolvedReason('odd-skill')?.reason).toBe('provider-unreachable');
    // The branch itself: an unknown type is no provider, nor is a type without `skill-exposure`.
    expect(exposedScopeOf('future-type')).toBeNull();
    expect(exposedScopeOf('spec')).toBeNull();
    expect(exposedScopeOf(undefined)).toBeNull();
    expect(exposedScopeOf('skill')).toBe('contextual');
    expect(exposedScopeOf('writing-style')).toBe('writing-style');
  });

  it('[ac:ac-podpiety-projekt-typu-skill-jest-pozy] an attached Skill project is a position of the consumer\'s <available_skills> in a `chat` turn', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { resolver } = workspace();
    const { listing } = resolver.resolveForContext('chat', { writingStyle: null });
    expect(listing).toContainEqual({ slug: 'team-skill', description: 'How the team works.', origin: 'project-exposed', project: 'team' });
    const text = buildSystemPrompt({
      host,
      projectName: 'App',
      cwd: '/tmp/app',
      roots: [{ id: 'pages', name: 'pages', dir: 'pages', builtin: true }],
      currentPagePath: null,
      currentPageBody: null,
      contextType: 'chat',
      availableSkills: listing,
    });
    const block = /<available_skills>[\s\S]*?<\/available_skills>/.exec(text)?.[0] ?? '';
    expect(block).toContain('<skill slug="team-skill" description="How the team works." origin="project-exposed" project="team"/>');
    // The Writing Style project is no listing entry: its style is a selectable style.
    expect(block).not.toContain('slug="house-style"');
  });

  it('a Specification with exposure keys in its file is no provider: no entry, no row; a provider without skill.description is none either', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { registry, projects, cwds } = workspace();
    expect(registry.has('spec-skill')).toBe(false);
    expect(listExposedProjects(projects).map((p) => p.name).sort()).toEqual(['house-style', 'team-skill']);
    // M52 `rkbsi6ky` #17: a Skill project without a description is no listing entry and no row.
    writeConfig(cwds.team, { skill: { description: null } });
    expect(registry.has('team-skill')).toBe(false);
    const rows = listExposedProjectRows('app', ['team-skill'], listExposedProjects(projects), ['team-skill']);
    // The described Skill project's name is no `ok` row any more: only the attachment's `unavailable` row is left.
    expect(rows.find((r) => r.name === 'team-skill')).toEqual({ name: 'team-skill', uses: true, status: 'unavailable', confirmed: true });
    // The other provider (the Writing Style project, which has its description) keeps its row.
    expect(rows.map((r) => [r.name, r.status])).toEqual([
      ['house-style', 'ok'],
      ['team-skill', 'unavailable'],
    ]);
  });
});

describe('a Writing Style project cannot select the style it exposes itself (M15 m15edg001, 2.1.77)', () => {
  it('[ac:ac-w-projekcie-typu-writing-style-patch] in a Writing Style project PATCH /api/config { writingStyle } with the slug of the style the same project exposes answers 400 as for an unknown slug', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const styleCwd = dir();
    const appCwd = dir();
    // The Writing Style project exposes `house-style` — and attaches its own name.
    writeConfig(styleCwd, {
      name: 'Style',
      projectType: 'writing-style',
      skill: { name: 'house-style', description: 'The house writing style.', uses: ['house-style'] },
    });
    writeConfig(appCwd, { name: 'App', skill: { uses: ['house-style'] } });
    const projects: ProjectRecord[] = [
      { id: 'style', cwd: styleCwd, projectType: 'writing-style', confirmedSkillUses: ['house-style'] },
      { id: 'app', cwd: appCwd, confirmedSkillUses: ['house-style'] },
    ];
    const rig = (id: string, cwd: string, capabilities: ReadonlySet<string>) => {
      const registry = SkillRegistry.load([], { rescanTtlMs: 0 });
      registry.registerSource(
        new ProjectExposedSkillSource(
          id,
          workspaceExposedSkillAccess({
            consumerId: id,
            readOwnSkill: () => normalizeSkillConfig(readConfig(cwd)),
            readWorkspaceProjects: () => projects,
            readProvider: async () => ({ entry: 'index.md', content: '# House style\n', files: {} }),
          }),
        ),
      );
      return express().use(express.json()).use(configRouter({ cwd, skillRegistry: registry, capabilities }));
    };
    const style = rig('style', styleCwd, PROVIDER_CAPS);
    const before = fs.readFileSync(configPath(styleCwd), 'utf8');

    const own = await request(style).patch('/config').send({ writingStyle: 'house-style' });
    const unknown = await request(style).patch('/config').send({ writingStyle: 'no-such-style' });
    expect(own.status).toBe(400);
    expect(unknown.status).toBe(400);
    // The same refusal as an unknown slug: the same code, the same field, the same wording.
    expect(own.body.error.code).toBe(unknown.body.error.code);
    expect(own.body.error.details).toEqual(unknown.body.error.details);
    expect(own.body.error.message.replace('house-style', '<slug>')).toBe(unknown.body.error.message.replace('no-such-style', '<slug>'));
    expect(fs.readFileSync(configPath(styleCwd), 'utf8')).toBe(before);
    expect((await request(style).get('/writing-styles')).body.available.map((s: { slug: string }) => s.slug)).not.toContain('house-style');

    // Another project attaching it selects it (200): the refusal is the self-attachment, not the style.
    const app = rig('app', appCwd, SPEC_CAPS);
    expect((await request(app).patch('/config').send({ writingStyle: 'house-style' })).status).toBe(200);
  });
});

describe('without skill-exposure the exposure keys are gone (M52 0ay8qh6u, wqvq1esb, rkbsi6ky #18, 2.1.77)', () => {
  it('[ac:ac-get-api-config-projektu-typu-specyfik] GET /api/config of a Specification project does not return the key `skill.name`, even when the config file carries it', async () => {
    const cwd = dir();
    writeConfig(cwd, { name: 'Spec', skill: { name: 'copied-skill', description: 'Copied by hand.', uses: ['billing-rules'] } });
    const raw = JSON.parse(fs.readFileSync(configPath(cwd), 'utf8')) as { skill: Record<string, unknown> };
    expect(raw.skill.name).toBe('copied-skill');
    const registry = SkillRegistry.load([], { rescanTtlMs: 0 });
    const spec = express().use(express.json()).use(configRouter({ cwd, skillRegistry: registry, capabilities: SPEC_CAPS }));
    const res = await request(spec).get('/config');
    expect(res.status).toBe(200);
    expect(res.body.skill).not.toHaveProperty('name');
    expect(res.body.skill).not.toHaveProperty('description');
    // `skill.uses` exists in every type.
    expect(res.body.skill.uses).toEqual(['billing-rules']);
    // The file keeps the key untouched.
    expect(JSON.parse(fs.readFileSync(configPath(cwd), 'utf8')).skill.name).toBe('copied-skill');
    // A project whose type has `skill-exposure` returns it.
    const skill = express().use(express.json()).use(configRouter({ cwd, skillRegistry: registry, capabilities: PROVIDER_CAPS }));
    expect((await request(skill).get('/config')).body.skill.name).toBe('copied-skill');
  });

  it('the four exposure keys require skill-exposure; the exposure toggle and the scope key are no keys of the registry any more', () => {
    for (const key of ['skill.name', 'skill.description', 'skill.entry', 'skill.contextTypes']) {
      expect(STATIC_FIELD_REGISTRY.get(key)?.requires, key).toEqual(['skill-exposure']);
    }
    expect(STATIC_FIELD_REGISTRY.get('skill.uses')?.requires).toBeUndefined();
    expect(STATIC_FIELD_REGISTRY.get('skill.exposed')).toBeUndefined();
    expect(STATIC_FIELD_REGISTRY.get('skill.scope')).toBeUndefined();
    expect(STATIC_FIELD_REGISTRY.crossFieldRules().map((r) => r.id)).not.toContain('skill-exposure-required-fields');
    expect(STATIC_FIELD_REGISTRY.inactiveKeys(SPEC_CAPS).filter((k) => k.startsWith('skill.')).sort()).toEqual([
      'skill.contextTypes',
      'skill.description',
      'skill.entry',
      'skill.name',
    ]);
    // A legacy file key is ignored, never copied into the normalized config.
    const cwd = dir();
    fs.mkdirSync(path.dirname(configPath(cwd)), { recursive: true });
    fs.writeFileSync(configPath(cwd), JSON.stringify({ $schemaVersion: 4, name: 'Old', skill: { exposed: true, scope: 'writing-style', name: 'old' } }));
    const normalized = normalizeSkillConfig(readConfig(cwd));
    expect(normalized).not.toHaveProperty('exposed');
    expect(normalized).not.toHaveProperty('scope');
  });
});
