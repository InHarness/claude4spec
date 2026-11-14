import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hostApiContextTypesFor } from './contribution-scope.js';
import { admitSkillContextTypes } from './manifest-adapter.js';
import { PluginRegistryImpl } from './registry.js';
import { HOST_API_CONTEXT_TYPES, type PluginManifest } from '../../../shared/plugin-host/manifest.js';
import { HOST_API_RELEASES, recordedRunningContextTypes } from '../../../shared/plugin-host/host-api.js';
import { contextTypesFor } from '../../services/chat-context.js';
import { SkillRegistry, SkillResolver } from '../../services/skill-registry.js';
import { fanPluginSkills } from '../../workspace/project-skills.js';

/**
 * 2.1.88 — unit contribution-scope (M13 `irsmg4jn` / `nhhw8c1y` / `alhdc6xo` /
 * `3zxftfv8`, M33 `emco4ju2` / `9734yj2e`): the contribution scope of a plugin's
 * skills counts against the `ContextType` set of the Host API version the plugin
 * declared, frozen there; the loader skips an out-of-set entry with a warning and
 * goes on; narrowing to the project registry is not the loader's job; and there
 * is no "omitted = the four fixed types" rule left. The frozen-set behaviour
 * through the real loader, with a release registry that grows, is in
 * `contribution-scope.frozen.test.ts`.
 */

/** A synthetic registry in which a later release announces one more value. */
const GROWING = [
  { version: '2.0.0', contextTypes: ['chat', 'brief', 'patch', 'ask'] },
  { version: '2.1.0', contextTypes: ['chat', 'brief', 'patch', 'ask'] },
  { version: '2.3.0', contextTypes: ['chat', 'brief', 'patch', 'ask', 'review'] },
] as const;

const skill = (over: Record<string, unknown> = {}) =>
  ({
    slug: 'house-rules',
    title: 'House Rules',
    description: 'always on',
    version: 1,
    language: 'en' as const,
    scope: 'contextual' as const,
    content: '# House rules',
    ...over,
  }) as never;

function manifest(name: string, contributes: PluginManifest['contributes'], hostApiVersion = '^2.0.0'): PluginManifest {
  return { name, version: '1.0.0', hostApiVersion, contributes };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe('contribution-scope — the ContextType set of a Host API version', () => {
  it('[entity:m33-requires-m13] every Host API release announces a ContextType set; the running one is HOST_API_CONTEXT_TYPES', () => {
    for (const r of HOST_API_RELEASES) expect(r.contextTypes.length, r.version).toBeGreaterThan(0);
    expect([...recordedRunningContextTypes()]).toEqual([...HOST_API_CONTEXT_TYPES]);
  });

  it('the set is the one of the DECLARED version — the lowest the range admits — not of the running host', () => {
    expect(hostApiContextTypesFor('^2.0.0', GROWING)).toEqual({ version: '2.0.0', contextTypes: GROWING[0].contextTypes });
    expect(hostApiContextTypesFor('^2.2.0', GROWING)).toEqual({ version: '2.1.0', contextTypes: GROWING[1].contextTypes });
    expect(hostApiContextTypesFor('^2.3.0', GROWING).contextTypes).toContain('review');
  });

  it('the set is frozen at the declared version: a value a later release adds is not in it', () => {
    // A package written against 2.0.0 still loads on a 2.3.0 host (`^2.0.0`
    // admits it), but its set does not grow with the host.
    expect(hostApiContextTypesFor('^2.0.0', GROWING).contextTypes).not.toContain('review');
    expect(hostApiContextTypesFor('>=2.1.0', GROWING).contextTypes).not.toContain('review');
  });

  it('a range below the oldest release, or one semver cannot read, gets the oldest (narrowest) set', () => {
    expect(hostApiContextTypesFor('>=1.0.0', GROWING).version).toBe('2.0.0');
    expect(hostApiContextTypesFor('not a range', GROWING).version).toBe('2.0.0');
  });
});

describe('contribution-scope — the loader checks contextTypes against the declared set', () => {
  it('[entity:m33-requires-m13] skips an entry with a value outside the declared set, warning, and keeps the rest', () => {
    const rejected: string[] = [];
    const admitted = admitSkillContextTypes(
      '@acme/p',
      [skill({ slug: 'late', contextTypes: ['chat', 'review'] }), skill({ slug: 'fine', contextTypes: ['brief'] })],
      rejected,
      hostApiContextTypesFor('^2.0.0', GROWING),
    );
    expect(admitted.map((s: { slug: string }) => s.slug)).toEqual(['fine']);
    expect(rejected).toEqual(['late']);
    expect(warn.mock.calls.flat().join(' ')).toMatch(
      /"late".*"review".*outside the context types of the declared Host API 2\.0\.0.*skipping this contribution/,
    );
  });

  it('the same value is admitted for a package that declared the version announcing it', () => {
    const rejected: string[] = [];
    const admitted = admitSkillContextTypes(
      '@acme/p',
      [skill({ slug: 'late', contextTypes: ['chat', 'review'] })],
      rejected,
      hostApiContextTypesFor('^2.3.0', GROWING),
    );
    expect(admitted).toHaveLength(1);
    expect(rejected).toEqual([]);
  });

  it('through registerPlugin: the out-of-set entry is skipped and reported, the package loads with its other contributions', () => {
    const registry = new PluginRegistryImpl();
    expect(() =>
      registry.registerPlugin(
        manifest('@acme/mixed', {
          skills: [skill({ slug: 'bad', contextTypes: ['review'] }), skill({ slug: 'good' })],
          writingStyles: [{ slug: 'terse', title: 'Terse', description: 'short', version: 1, language: 'en', content: 'x' }],
        }),
      ),
    ).not.toThrow();
    expect(registry.listSkills().map((s) => s.slug)).toEqual(['good', 'terse']);
    expect(registry.listPluginRecords().map((r) => r.name)).toEqual(['@acme/mixed']);
    expect(registry.listUnloadedSkills().map((u) => u.slug)).toEqual(['bad']);
    expect(registry.listUnloadedSkills()[0]!.detail).toMatch(/declared Host API version's context types/);
  });

  it('narrowing to the project registry is not the loader\'s job: a value of the Host API set the project has no row for is admitted', () => {
    // A project without the Specification capability has no `brief` / `patch` rows …
    const projectRows = contextTypesFor({ has: () => false });
    expect(projectRows).not.toContain('brief');

    // … yet the loader admits a skill scoped to `brief`, with no warning.
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(manifest('@acme/brief-only', { skills: [skill({ slug: 'brief-only', contextTypes: ['brief'] })] }));
    expect(registry.listSkills().map((s) => s.slug)).toEqual(['brief-only']);
    expect(registry.listUnloadedSkills()).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('an omitted contextTypes passes the loader unchanged — no default is written into the entry', () => {
    const registry = new PluginRegistryImpl();
    registry.registerPlugin(manifest('@acme/open', { skills: [skill({ slug: 'open' })] }));
    expect(registry.listSkills()[0]!.contextTypes).toBeUndefined();
  });
});

describe('contribution-scope — an omitted contextTypes is the declared set, not a fixed list', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-contribution-scope-'));
  });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  it('[entity:m33-requires-m13] the plugin skill source scopes an omitted entry by the declared Host API version\'s set', () => {
    const plugins = new PluginRegistryImpl();
    plugins.registerPlugin(manifest('@acme/open', { skills: [skill({ slug: 'open' })] }));
    const skills = SkillRegistry.load([], { rescanTtlMs: 0 });
    fanPluginSkills(skills, plugins);

    const meta = skills.list().find((s) => s.slug === 'open')!;
    expect(meta.contextTypes).toEqual([...hostApiContextTypesFor('^2.0.0').contextTypes]);
    const resolver = new SkillResolver(skills, cwd);
    for (const ct of HOST_API_CONTEXT_TYPES) {
      expect(resolver.resolveForContext(ct, { writingStyle: null }).listing.map((l) => l.slug), ct).toContain('open');
    }
  });
});
