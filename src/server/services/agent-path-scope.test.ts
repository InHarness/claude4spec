import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { resolveAgentPathScope, type ResolveAgentPathScopeInput } from './agent-path-scope.js';
import { DEFAULT_PAGES_ROOT_PROPS, type Root } from '../../shared/types.js';

const CWD = '/home/me/project';

// 0.1.130: the resolver always folds these 5 artifact dirs into the implicit deny-set.
// Tests default to config-relative dirs (the real config defaults); each resolves absolute
// vs cwd and lands (in this order) at the front of `disallowedPaths` + as `artifactDenyDirs`.
const ARTIFACT_DIRS = {
  plansDir: '.claude4spec/plans',
  briefsDir: '.claude4spec/briefs',
  patchesDir: '.claude4spec/patches',
  entitiesDir: '.claude4spec/entities',
  releasesDir: '.claude4spec/releases',
} as const;

/** The absolute artifact deny-set for a given cwd, in resolver order. */
function artifactAbs(cwd = CWD): string[] {
  return [
    ARTIFACT_DIRS.plansDir,
    ARTIFACT_DIRS.briefsDir,
    ARTIFACT_DIRS.patchesDir,
    ARTIFACT_DIRS.entitiesDir,
    ARTIFACT_DIRS.releasesDir,
  ].map((d) => path.resolve(cwd, d));
}

/** Build a minimal Root at `dir` for scope tests (only `.dir` is read by the resolver). */
function rootAt(dir: string, id = 'pages'): Root {
  return { id, name: id, dir, builtin: id === 'pages', ...DEFAULT_PAGES_ROOT_PROPS, linkTargets: [] };
}

/** resolveAgentPathScope with the artifact dirs defaulted in (override any field as needed). */
function resolve(input: Partial<ResolveAgentPathScopeInput> & Pick<ResolveAgentPathScopeInput, 'roots'>) {
  return resolveAgentPathScope({
    cwd: CWD,
    allowedPaths: [],
    disallowedPaths: [],
    ...ARTIFACT_DIRS,
    ...input,
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

  it('0.1.130: builds the implicit artifact deny-set from config dirs, absolute + deduped', () => {
    const r = resolve({ roots: [rootAt(path.join(CWD, 'pages'))] });
    expect(r.artifactDenyDirs).toEqual(artifactAbs());
    // it is a subset of the sandbox deny list.
    for (const d of r.artifactDenyDirs) expect(r.disallowedPaths).toContain(d);
  });

  it('0.1.130: respects custom (config-overridden) artifact dir locations', () => {
    const r = resolve({
      roots: [rootAt(path.join(CWD, 'pages'))],
      plansDir: 'spec/plans',
      briefsDir: '/abs/briefs',
    });
    expect(r.artifactDenyDirs).toContain(path.resolve(CWD, 'spec/plans'));
    expect(r.artifactDenyDirs).toContain('/abs/briefs');
  });

  it('0.1.130: an artifact dir also listed in allowedPaths still lands in disallowedPaths (deny wins)', () => {
    const plansAbs = path.resolve(CWD, ARTIFACT_DIRS.plansDir);
    const r = resolve({
      roots: [rootAt(path.join(CWD, 'pages'))],
      allowedPaths: [ARTIFACT_DIRS.plansDir],
    });
    // it appears on both lists; precedence (deny > allow) is enforced downstream by the library.
    expect(r.allowedPaths).toContain(plansAbs);
    expect(r.disallowedPaths).toContain(plansAbs);
  });
});
