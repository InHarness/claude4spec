import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RootRegistry } from './registry.js';
import { readConfig } from '../config.js';
import {
  KIND_DECLARATIONS,
  SYSTEM_ROOTS,
  agentDeniedDirs,
  fileMapEntryOf,
  fileMapFilter,
  globToRegExp,
  isSystemRootId,
  namespacesOverlap,
} from '../../shared/root-kinds.js';

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
    expect(reg.withFlag('release').map((r) => r.id)).toEqual(['pages', 'adr', 'entities']);
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

  it('narrows the filter by version track: only `file_version` entries, in any format (M17 yg8keaew)', () => {
    const all = ['markdown', 'json', 'raw'] as const;
    // pages: `.html` is track `none`, so it falls out.
    expect(fileMapFilter('pages', all, ['file_version'])).toBe('**/*.{md,mdx}');
    expect(fileMapFilter('plans', all, ['file_version'])).toBe('*.md');
    // entities (`entity_version`) and releases (`none`) carry no `file_version` entry.
    expect(fileMapFilter('entities', all, ['file_version'])).toBeUndefined();
    expect(fileMapFilter('releases', all, ['file_version'])).toBeUndefined();
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

  it('the `entities` system root is a registry entry from code: id = kind, fixed .claude4spec/entities, hidden, reserved id, found by kind even when the base root is renamed (M02 l13model0)', () => {
    const renamed = new RootRegistry([{ id: 'docs', name: 'Docs', dir: '.', builtin: true }]);
    const entities = renamed.system('entities');
    expect(entities).toEqual({ id: 'entities', name: 'Entities', dir: '.claude4spec/entities', kind: 'entities', builtin: false });
    expect(SYSTEM_ROOTS.filter((r) => r.kind === 'entities')).toHaveLength(1);
    expect(KIND_DECLARATIONS.entities.source).toBe('code');
    expect(KIND_DECLARATIONS.entities.sidebar).toBe('hidden');
    expect(isSystemRootId('entities')).toBe(true);
    // A root at `.` coexists with the fixed dir: the dot subtree is outside its namespace (D4).
    expect(namespacesOverlap('.', entities.dir)).toBe(false);
  });

  it('M29 f952122v: the `entities` kind declaration — tags.json on HEAD, */*.json on entity_version, only `release` = yes, reaction m29-entity-indexer', () => {
    const decl = KIND_DECLARATIONS.entities;
    expect(decl).toEqual({
      kind: 'entities',
      source: 'code',
      sidebar: 'hidden',
      fileMap: [
        { pattern: 'tags.json', format: 'json', track: 'HEAD' },
        { pattern: '*/*.json', format: 'json', track: 'entity_version' },
      ],
      flags: { release: true, references: false, gitignore: false, agentDirectFs: false },
      reactions: ['m29-entity-indexer'],
    });
    // First matching entry wins: tag definitions vs one entity snapshot per `<type>/<slug>.json`.
    expect(fileMapEntryOf('entities', 'tags.json')).toMatchObject({ format: 'json', track: 'HEAD' });
    expect(fileMapEntryOf('entities', 'endpoint/get-user.json')).toMatchObject({ format: 'json', track: 'entity_version' });
    expect(fileMapEntryOf('entities', 'endpoint\\get-user.json')?.track).toBe('entity_version');
    // Anything else in the root is not an entry of the kind.
    expect(fileMapEntryOf('entities', 'other.json')).toBeUndefined();
    expect(fileMapEntryOf('entities', 'endpoint/nested/x.json')).toBeUndefined();
    expect(fileMapEntryOf('entities', 'endpoint/tags.json')?.track).toBe('entity_version');
    expect(fileMapEntryOf('entities', 'notes.md')).toBeUndefined();
    // The indexer's binding filter is exactly that map, compiled by the matcher M40 uses.
    const filter = fileMapFilter('entities', ['json'])!;
    expect(filter).toBe('{tags.json,*/*.json}');
    const re = globToRegExp(filter);
    expect(['tags.json', 'endpoint/a.json', 'dto/b.json'].every((p) => re.test(p))).toBe(true);
    expect(['other.json', 'a/b/c.json', 'endpoint/a.md', 'xtags.json'].some((p) => re.test(p))).toBe(false);
    // No file_version entry: m17-capture can never be bound on it; the HEAD entry alone is selectable by track.
    expect(fileMapFilter('entities', ['json'], ['file_version'])).toBeUndefined();
    expect(fileMapFilter('entities', ['json'], ['HEAD'])).toBe('tags.json');
    // Only `release` is set, so the entities root (and only it among system roots) joins the release-flag roots.
    const reg = new RootRegistry(user);
    expect(reg.withFlag('release').filter((r) => r.kind !== 'pages').map((r) => r.id)).toEqual(['entities']);
    expect(reg.withFlag('references').some((r) => r.kind === 'entities')).toBe(false);
    expect(reg.withFlag('gitignore').some((r) => r.kind === 'entities')).toBe(false);
    expect(reg.withFlag('agentDirectFs', false).map((r) => r.id)).toContain('entities');
    expect(reg.selecting('m29-entity-indexer').map((r) => r.id)).toEqual(['entities']);
  });

  it('every kind carries the four policy flags and only system kinds come from code', () => {
    for (const decl of Object.values(KIND_DECLARATIONS)) {
      expect(Object.keys(decl.flags).sort()).toEqual(['agentDirectFs', 'gitignore', 'references', 'release']);
      expect(decl.source).toBe(decl.kind === 'pages' ? 'config' : 'code');
    }
  });
});
