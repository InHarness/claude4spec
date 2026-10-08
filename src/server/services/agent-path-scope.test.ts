import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveAgentPathScope, type ResolveAgentPathScopeInput } from './agent-path-scope.js';
import type { Root } from '../../shared/types.js';
import { registryList } from '../../shared/root-kinds.js';
import { RootRegistry } from '../roots/registry.js';
import { readConfig } from '../config.js';

const CWD = '/home/me/project';

// 2.1.8: the implicit deny-set is the dir of every registry root whose kind has
// `agentDirectFs = false` — the five system roots at their FIXED dirs, in registry order.
const SYSTEM_DIRS = [
  '.claude4spec/plans',
  '.claude4spec/briefs',
  '.claude4spec/patches',
  '.claude4spec/entities',
  '.claude4spec/releases',
] as const;

/** The absolute artifact deny-set for a given cwd, in resolver order. */
function artifactAbs(cwd = CWD): string[] {
  return SYSTEM_DIRS.map((d) => path.resolve(cwd, d));
}

/** A user (kind `pages`) root at `dir`. */
function rootAt(dir: string, id = 'pages'): Root {
  return { id, name: id, dir, builtin: id === 'pages' };
}

/** resolveAgentPathScope over the registry built from the given USER roots. */
function resolve(
  input: Partial<Omit<ResolveAgentPathScopeInput, 'roots'>> & { roots: Root[] },
) {
  return resolveAgentPathScope({
    cwd: CWD,
    allowedPaths: [],
    disallowedPaths: [],
    ...input,
    roots: new RootRegistry(input.roots).list(),
  });
}

describe('resolveAgentPathScope', () => {
  it('returns only the artifact deny-set when nothing is configured and a root is inside cwd', () => {
    const r = resolve({ roots: [rootAt(path.join(CWD, 'pages'))] });
    expect(r.allowedPaths).toEqual([]);
    // 0.1.130: disallowedPaths is never empty — it always carries the implicit deny-set.
    expect(r.disallowedPaths).toEqual(artifactAbs());
    expect(r.artifactDenyDirs).toEqual(artifactAbs());
  });

  it('[ac:ac-puste-allowedpaths-i-disallowedpaths-n] empty user lists → only the implicit base (pages roots outside cwd) minus the agentDirectFs=false root dirs; cwd never appended', () => {
    const outside = '/var/data/notes';
    const r = resolve({ roots: [rootAt('pages'), rootAt(outside, 'notes')] });
    // Base extras: only the `pages`-kind root lying outside cwd; the inside one is covered by cwd.
    expect(r.allowedPaths).toEqual([outside]);
    // cwd is NOT appended — the library adds the base itself.
    expect(r.allowedPaths).not.toContain(CWD);
    // No system root dir ever enters the allow-list.
    for (const d of artifactAbs()) expect(r.allowedPaths).not.toContain(d);
    // Deny = exactly the dirs of the roots whose kind has agentDirectFs = false.
    expect(r.disallowedPaths).toEqual(artifactAbs());
    expect(r.artifactDenyDirs).toEqual(artifactAbs());
  });

  it('adds a root dir when it is outside cwd', () => {
    const pagesDir = '/var/data/spec-pages';
    const r = resolve({ roots: [rootAt(pagesDir)] });
    expect(r.allowedPaths).toEqual([pagesDir]);
  });

  it('never appends cwd itself to allowedPaths (library adds the base)', () => {
    const r = resolve({ roots: [rootAt(path.join(CWD, 'pages'))], allowedPaths: ['/extra/lib'] });
    expect(r.allowedPaths).not.toContain(CWD);
    expect(r.allowedPaths).toEqual(['/extra/lib']);
  });

  it('resolves relative entries against cwd to absolute paths', () => {
    const r = resolve({
      roots: [rootAt(path.join(CWD, 'pages'))],
      allowedPaths: ['../sibling', 'sub/dir'],
      disallowedPaths: ['secret'],
    });
    expect(r.allowedPaths).toEqual(['/home/me/sibling', path.join(CWD, 'sub/dir')]);
    // user disallowedPaths follow the artifact deny-set.
    expect(r.disallowedPaths).toEqual([...artifactAbs(), path.join(CWD, 'secret')]);
    // Everything must be absolute.
    for (const p of [...r.allowedPaths, ...r.disallowedPaths]) {
      expect(path.isAbsolute(p)).toBe(true);
    }
  });

  it('passes user disallowedPaths through (normalized, absolute) after the artifact deny-set', () => {
    const r = resolve({
      roots: [rootAt(path.join(CWD, 'pages'))],
      allowedPaths: ['/code'],
      disallowedPaths: ['/code/src', 'node_modules'],
    });
    expect(r.disallowedPaths).toEqual([...artifactAbs(), '/code/src', path.join(CWD, 'node_modules')]);
  });

  it('combines an outside-cwd root base with configured allowedPaths and dedupes', () => {
    const pagesDir = '/var/data/spec-pages';
    const r = resolve({ roots: [rootAt(pagesDir)], allowedPaths: [pagesDir, '/extra'] });
    // the root dir appears once despite also being listed in allowedPaths.
    expect(r.allowedPaths).toEqual([pagesDir, '/extra']);
  });

  it('2.1.8: builds the implicit deny-set from the registry (agentDirectFs=false kinds), absolute + deduped', () => {
    const r = resolve({ roots: [rootAt(path.join(CWD, 'pages'))] });
    expect(r.artifactDenyDirs).toEqual(artifactAbs());
    // it is a subset of the sandbox deny list.
    for (const d of r.artifactDenyDirs) expect(r.disallowedPaths).toContain(d);
  });

  it('2.1.8: the deny-set is exactly the five .claude4spec/<kind> dirs (absolute), independent of a legacy plansDir in config', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-path-scope-'));
    try {
      fs.mkdirSync(path.join(cwd, '.claude4spec'), { recursive: true });
      fs.writeFileSync(
        path.join(cwd, '.claude4spec', 'config.json'),
        JSON.stringify({
          $schemaVersion: 4,
          name: 'legacy',
          roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }],
          // Pre-2.1.8 relocation keys — no longer honoured.
          plansDir: 'spec/plans',
          briefsDir: '/abs/briefs',
        }),
      );
      const cfg = readConfig(cwd);
      const r = resolveAgentPathScope({
        cwd,
        roots: registryList(cfg.roots),
        allowedPaths: [],
        disallowedPaths: [],
      });
      expect(r.artifactDenyDirs).toEqual(artifactAbs(cwd));
      expect(r.artifactDenyDirs).toHaveLength(5);
      for (const d of r.artifactDenyDirs) expect(path.isAbsolute(d)).toBe(true);
      expect(r.artifactDenyDirs).not.toContain(path.resolve(cwd, 'spec/plans'));
      expect(r.artifactDenyDirs).not.toContain('/abs/briefs');
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('2.1.8: pageRootDirs lists every kind:pages root (inside or outside cwd) and none of the system roots', () => {
    const r = resolve({ roots: [rootAt('pages'), rootAt('/var/data/notes', 'notes')] });
    expect(r.pageRootDirs).toEqual([path.join(CWD, 'pages'), '/var/data/notes']);
    for (const d of artifactAbs()) expect(r.pageRootDirs).not.toContain(d);
    // system roots never enter the allow base, even though they are registry roots.
    expect(r.allowedPaths).toEqual(['/var/data/notes']);
  });

  it('0.1.130: an artifact dir also listed in allowedPaths still lands in disallowedPaths (deny wins)', () => {
    const plansAbs = path.resolve(CWD, SYSTEM_DIRS[0]);
    const r = resolve({
      roots: [rootAt(path.join(CWD, 'pages'))],
      allowedPaths: [SYSTEM_DIRS[0]],
    });
    // it appears on both lists; precedence (deny > allow) is enforced downstream by the library.
    expect(r.allowedPaths).toContain(plansAbs);
    expect(r.disallowedPaths).toContain(plansAbs);
  });
});
