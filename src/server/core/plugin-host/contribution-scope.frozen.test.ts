import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadWorkspacePlugins } from './loader.js';
import { loadProjectOverlay } from './overlay-loader.js';
import { resolvePluginSubagents } from '../../services/plugin-subagents.js';
import { PluginRegistryImpl } from './registry.js';
import type { PluginManifest } from '../../../shared/plugin-host/manifest.js';
import { SkillRegistry, SkillResolver } from '../../services/skill-registry.js';
import { fanPluginSkills } from '../../workspace/project-skills.js';

/**
 * 2.1.88 — unit contribution-scope, through the real loader and the M37
 * resolver, with a Host API release registry whose set GROWS: 2.0.0 announces
 * `chat` and `brief`, 2.1.0 adds `patch`, 2.2.0 (the running version) adds
 * `ask`. Every value is a row of the host's code map, so the resolver can list
 * in all four; what differs is only the declared version of each package.
 */
vi.mock('../../../shared/plugin-host/host-api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/plugin-host/host-api.js')>();
  const grow = [['chat', 'brief'], ['chat', 'brief', 'patch'], ['chat', 'brief', 'patch', 'ask']];
  return {
    ...actual,
    HOST_API_RELEASES: actual.HOST_API_RELEASES.map((r, i) => ({ ...r, contextTypes: grow[i] ?? grow[2] })),
  };
});

const contextual = (slug: string, contextTypes?: string[]) => ({
  slug,
  title: slug,
  description: `${slug} description`,
  version: 1,
  language: 'en' as const,
  scope: 'contextual' as const,
  content: `# ${slug}`,
  ...(contextTypes ? { contextTypes } : {}),
});

function pkg(name: string, hostApiVersion: string, skills: unknown[], subagents?: unknown[]): { manifest: PluginManifest } {
  return {
    manifest: {
      name,
      version: '1.0.0',
      hostApiVersion,
      contributes: { skills, ...(subagents ? { subagents } : {}) } as PluginManifest['contributes'],
    },
  };
}

const subagent = (name: string, contextTypes?: string[]) => ({
  name,
  description: `${name} description`,
  promptBody: `${name} body`,
  tools: [],
  ...(contextTypes ? { contextTypes } : {}),
});

function importerOf(modules: Record<string, unknown>) {
  return vi.fn(async (specifier: string) => {
    const key = specifier.split('?')[0]!;
    if (key in modules) return modules[key];
    throw new Error(`Cannot find package '${specifier}'`);
  });
}

let warn: ReturnType<typeof vi.spyOn>;
let cwd: string;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-contribution-frozen-'));
});
afterEach(() => {
  warn.mockRestore();
  fs.rmSync(cwd, { recursive: true, force: true });
});

async function load(modules: Record<string, { manifest: PluginManifest }>) {
  const plugins = new PluginRegistryImpl();
  const { records } = await loadWorkspacePlugins(plugins, Object.keys(modules), importerOf(modules));
  const skills = SkillRegistry.load([], { rescanTtlMs: 0 });
  fanPluginSkills(skills, plugins);
  const resolver = new SkillResolver(skills, cwd);
  const listedIn = (ct: 'chat' | 'brief' | 'patch' | 'ask') =>
    resolver.resolveForContext(ct, { writingStyle: null }).listing.map((l) => l.slug);
  return { records, plugins, skills, listedIn };
}

describe('contribution-scope — the declared version\'s set, frozen there', () => {
  it('[entity:m33-requires-m13] a skill omitting contextTypes gets the set of its declared version, not the running one and not four fixed types', async () => {
    const { records, listedIn } = await load({
      'pkg-old': pkg('@acme/old', '^2.0.0', [contextual('old-open')]),
      'pkg-new': pkg('@acme/new', '^2.2.0', [contextual('new-open')]),
    });
    expect(records.map((r) => r.status)).toEqual(['loaded', 'loaded']);

    // Declared 2.0.0: `chat` + `brief` only — `patch` and `ask` came later.
    expect(listedIn('chat')).toContain('old-open');
    expect(listedIn('brief')).toContain('old-open');
    expect(listedIn('patch')).not.toContain('old-open');
    expect(listedIn('ask')).not.toContain('old-open');

    // Declared 2.2.0: the whole set of that version.
    for (const ct of ['chat', 'brief', 'patch', 'ask'] as const) expect(listedIn(ct), ct).toContain('new-open');
  });

  it('a later value reaches a package only when it names it — and only if its declared version announces it', async () => {
    const { records, plugins, listedIn } = await load({
      'pkg-old': pkg('@acme/old', '^2.0.0', [contextual('old-ask', ['ask']), contextual('old-brief', ['brief'])]),
      'pkg-new': pkg('@acme/new', '^2.2.0', [contextual('new-ask', ['ask'])]),
    });
    // The package declaring 2.0.0 does not know `ask`: that entry is skipped with
    // a warning, the package still loads with its other skill.
    expect(records.map((r) => r.status)).toEqual(['loaded', 'loaded']);
    expect(warn.mock.calls.flat().join(' ')).toMatch(
      /@acme\/old: skill "old-ask".*"ask".*declared Host API 2\.0\.0.*skipping this contribution \(the rest of the package still loads\)/,
    );
    expect(plugins.listUnloadedSkills().map((u) => u.slug)).toEqual(['old-ask']);
    expect(listedIn('brief')).toContain('old-brief');
    expect(listedIn('ask')).not.toContain('old-ask');

    // The package declaring 2.2.0 names `ask`, which its version announces.
    expect(listedIn('ask')).toContain('new-ask');
  });
});

describe('[goal:contribution-scope] m33-requires-m13 — the declared set is carried, and subagents are counted against it', () => {
  it('[goal:contribution-scope] m33-requires-m13: the declared set travels WITH each admitted skill to the fan-out — a copy of the entry keeps it', async () => {
    const modules = {
      'pkg-old': pkg('@acme/old', '^2.0.0', [contextual('old-open')]),
      'pkg-new': pkg('@acme/new', '^2.2.0', [contextual('new-open')]),
    };
    const plugins = new PluginRegistryImpl();
    await loadWorkspacePlugins(plugins, Object.keys(modules), importerOf(modules));

    // Each admitted entry is paired with its own manifest's declared set.
    expect(plugins.listScopedSkills().map((s) => [s.skill.slug, [...s.declaredContextTypes]])).toEqual([
      ['old-open', ['chat', 'brief']],
      ['new-open', ['chat', 'brief', 'patch', 'ask']],
    ]);

    // A clone of every entry between admission and fan-out (no object identity
    // left to look anything up by) still scopes the old package by ITS set.
    const cloned = {
      listScopedSkills: () => plugins.listScopedSkills().map((s) => ({ ...s, skill: { ...s.skill } })),
      listUnloadedSkills: () => plugins.listUnloadedSkills(),
    };
    const skills = SkillRegistry.load([], { rescanTtlMs: 0 });
    fanPluginSkills(skills, cloned);
    expect(skills.list().find((m) => m.slug === 'old-open')!.contextTypes).toEqual(['chat', 'brief']);
    const resolver = new SkillResolver(skills, cwd);
    const listedIn = (ct: 'chat' | 'brief' | 'patch' | 'ask') =>
      resolver.resolveForContext(ct, { writingStyle: null }).listing.map((l) => l.slug);
    expect(listedIn('ask')).not.toContain('old-open');
    expect(listedIn('ask')).toContain('new-open');
  });

  it('[goal:contribution-scope] m33-requires-m13: a base subagent naming a value outside its declared set is dropped with a warning; the package still loads', async () => {
    const modules = {
      'pkg-old': pkg('@acme/old', '^2.0.0', [], [subagent('old-ask', ['ask']), subagent('old-brief', ['brief']), subagent('old-default')]),
      'pkg-new': pkg('@acme/new', '^2.2.0', [], [subagent('new-ask', ['ask'])]),
    };
    const plugins = new PluginRegistryImpl();
    const { records } = await loadWorkspacePlugins(plugins, Object.keys(modules), importerOf(modules));
    expect(records.map((r) => r.status)).toEqual(['loaded', 'loaded']);
    expect(warn.mock.calls.flat().join(' ')).toMatch(
      /@acme\/old: subagent "old-ask".*"ask".*declared Host API 2\.0\.0.*skipping this contribution \(the rest of the package still loads\)/,
    );
    const contributions = plugins.listPluginRecords().flatMap((r) => r.subagents);
    // An omitted contextTypes is untouched here — the resolver gives it ['chat'].
    expect(contributions.map((c) => c.name)).toEqual(['old-brief', 'old-default', 'new-ask']);

    const delegable = (contextType: 'chat' | 'brief' | 'ask') =>
      resolvePluginSubagents({ contextType, contributions, hasSkillSlug: () => false, taken: new Set(), warn: () => {} }).map(
        (d) => d.name,
      );
    expect(delegable('ask')).toEqual(['new-ask']);
    expect(delegable('brief')).toEqual(['old-brief']);
    expect(delegable('chat')).toEqual(['old-default']);
  });

  it('[goal:contribution-scope] m33-requires-m13: a project-local subagent is held to its declared set too, and overlay skills carry theirs', async () => {
    const dir = path.join(cwd, '.claude4spec', 'plugins', 'local-old');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.js'), '// fixture');
    const url = pathToFileURL(path.join(dir, 'index.js')).href;
    const res = await loadProjectOverlay(
      cwd,
      importerOf({ [url]: pkg('@local/old', '^2.0.0', [contextual('local-open')], [subagent('local-ask', ['ask']), subagent('local-chat', ['chat'])]) }),
    );
    expect(res.records[0]).toMatchObject({ status: 'loaded' });
    expect(res.overlay?.listSubagents().map((c) => c.name)).toEqual(['local-chat']);
    expect(warn.mock.calls.flat().join(' ')).toMatch(/@local\/old: subagent "local-ask".*declared Host API 2\.0\.0/);
    expect(res.scopedSkills.map((s) => [s.skill.slug, [...s.declaredContextTypes]])).toEqual([['local-open', ['chat', 'brief']]]);
  });
});
