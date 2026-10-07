import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RootRegistry } from './registry.js';
import { readConfig } from '../config.js';
import { KIND_DECLARATIONS, SYSTEM_ROOTS, agentDeniedDirs, fileMapFilter, namespacesOverlap } from '../../shared/root-kinds.js';

/** 2.1.8 — the root registry: user roots (kind `pages`) + five system roots in code. */
describe('RootRegistry', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const user = [
    { id: 'pages', name: 'Pages', dir: 'pages', builtin: true },
    { id: 'adr', name: 'ADRs', dir: 'docs/adr', builtin: false },
  ];

  it('lists the user roots (kind pages, roots[] order) followed by the five system roots', () => {
    const reg = new RootRegistry(user);
    expect(reg.list().map((r) => [r.id, r.kind, r.dir])).toEqual([
      ['pages', 'pages', 'pages'],
      ['adr', 'pages', 'docs/adr'],
      ['plans', 'plans', '.claude4spec/plans'],
      ['briefs', 'briefs', '.claude4spec/briefs'],
      ['patches', 'patches', '.claude4spec/patches'],
      ['entities', 'entities', '.claude4spec/entities'],
      ['releases', 'releases', '.claude4spec/releases'],
    ]);
    expect(reg.builtin().id).toBe('pages');
    expect(reg.pages().map((r) => r.id)).toEqual(['pages', 'adr']);
  });

  it('gates behaviour by the kind: release roots, reference roots, roots selecting a reaction', () => {
    const reg = new RootRegistry(user);
    expect(reg.withFlag('release').map((r) => r.id)).toEqual(['pages', 'adr']);
    expect(reg.withFlag('references').map((r) => r.id)).toEqual(['pages', 'adr']);
    expect(reg.withFlag('gitignore').map((r) => r.id)).toEqual(['plans', 'briefs', 'patches', 'releases']);
    expect(reg.selecting('m06-anchor-injection').map((r) => r.id)).toEqual(['pages', 'adr', 'plans']);
    expect(reg.selecting('m06-section-indexer').map((r) => r.id)).toEqual(['pages', 'adr']);
  });

  it('the agent deny-set is the dir of every root whose kind has agentDirectFs = false', () => {
    expect(agentDeniedDirs(user)).toEqual(SYSTEM_ROOTS.map((r) => r.dir));
  });

  it('[ac:ac-przy-config-json-z-kluczem-dir-dla-pl] a legacy plansDir pointing elsewhere warns, and plans still resolve ONLY to .claude4spec/plans', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-registry-'));
    dirs.push(cwd);
    fs.mkdirSync(path.join(cwd, '.claude4spec'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, '.claude4spec', 'config.json'),
      JSON.stringify({ $schemaVersion: 4, name: 'x', roots: [user[0]], plansDir: 'docs/plans' }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cfg = readConfig(cwd);
    expect(warn.mock.calls.flat().join(' ')).toMatch(/plansDir.*\.claude4spec\/plans/);
    expect(cfg).not.toHaveProperty('plansDir');
    expect(new RootRegistry(cfg.roots).system('plans').dir).toBe('.claude4spec/plans');
  });
});

describe('root kinds', () => {
  it('merges a kind file map into one mechanical filter per accepted format set', () => {
    expect(fileMapFilter('pages', ['markdown'])).toBe('**/*.{md,mdx}');
    expect(fileMapFilter('pages', ['markdown', 'json', 'raw'])).toBe('**/*.{md,mdx,html}');
    expect(fileMapFilter('entities', ['markdown'])).toBeUndefined();
    expect(fileMapFilter('releases', ['json'])).toBe('*.json');
  });

  it('namespaces exclude dot-segment subtrees, both ways', () => {
    expect(namespacesOverlap('.', '.claude4spec/plans')).toBe(false);
    expect(namespacesOverlap('.claude4spec', '.claude4spec/plans')).toBe(true);
    expect(namespacesOverlap('.claude4spec/plans/x', '.claude4spec/plans')).toBe(true);
    expect(namespacesOverlap('docs', 'docs/adr')).toBe(true);
    expect(namespacesOverlap('docs', 'docs/.hidden')).toBe(false);
    // Non-canonical spellings of a system root's dir still collide with it.
    expect(namespacesOverlap('pages/../.claude4spec/plans', '.claude4spec/plans')).toBe(true);
    expect(namespacesOverlap('.claude4spec//plans', '.claude4spec/plans')).toBe(true);
    expect(namespacesOverlap('./.claude4spec/./plans/', '.claude4spec/plans')).toBe(true);
  });

  it('every kind carries the four policy flags and only system kinds come from code', () => {
    for (const decl of Object.values(KIND_DECLARATIONS)) {
      expect(Object.keys(decl.flags).sort()).toEqual(['agentDirectFs', 'gitignore', 'references', 'release']);
      expect(decl.source).toBe(decl.kind === 'pages' ? 'config' : 'code');
    }
  });
});
