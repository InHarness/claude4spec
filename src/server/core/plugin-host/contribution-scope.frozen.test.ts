import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadWorkspacePlugins } from './loader.js';
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

function pkg(name: string, hostApiVersion: string, skills: unknown[]): { manifest: PluginManifest } {
  return { manifest: { name, version: '1.0.0', hostApiVersion, contributes: { skills } as PluginManifest['contributes'] } };
}

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
