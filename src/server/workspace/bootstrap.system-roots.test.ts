import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry } from './registry.js';
import { bootstrapProject } from './bootstrap.js';
import { RootRegistry } from '../roots/registry.js';
import { KIND_DECLARATIONS, SYSTEM_ROOTS, type RootKind } from '../../shared/root-kinds.js';

/**
 * 2.1.8 — activation creates the directory of every registry root, the five
 * system roots included, and writes none of them into `config.json`.
 */
describe('bootstrapProject — system roots', () => {
  let dir: string;
  let cwd: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-boot-roots-'));
    cwd = path.join(dir, 'project');
    fs.mkdirSync(cwd, { recursive: true });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const boot = () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    return bootstrapProject(registry, ws, cwd);
  };

  it('[ac:ac-swiezy-bootstrap-tworzy-katalogi-wszy] a fresh bootstrap creates `.claude4spec/<kind>` for every root of a kind with source `code` in the root registry', () => {
    // The set comes from the registry — the kinds whose declaration says
    // `source: 'code'` — not from a list kept by bootstrap or by this test.
    const codeKinds = (Object.keys(KIND_DECLARATIONS) as RootKind[]).filter((k) => KIND_DECLARATIONS[k].source === 'code');
    const codeRoots = new RootRegistry([{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }]).codeRoots();
    expect(codeRoots.map((r) => r.kind)).toEqual(codeKinds);
    expect(codeRoots.map((r) => r.id)).toEqual(SYSTEM_ROOTS.map((r) => r.id));
    // Today's code-source kinds — a premise of the fixture, not of the rule.
    expect(codeKinds).toEqual(expect.arrayContaining(['plans', 'briefs', 'patches', 'entities', 'releases']));
    for (const root of codeRoots) {
      expect(root.dir).toBe(`.claude4spec/${root.kind}`);
      expect(fs.existsSync(path.join(cwd, root.dir))).toBe(false);
    }
    const result = boot();
    for (const root of codeRoots) {
      expect(fs.statSync(path.join(cwd, '.claude4spec', root.kind)).isDirectory(), root.kind).toBe(true);
    }
    expect([...result.systemRootDirsCreated].sort()).toEqual(codeRoots.map((r) => `.claude4spec/${r.kind}`).sort());
  });

  it('[ac:ac-swiezy-bootstrap-nie-zapisuje-w-confi] a fresh bootstrap writes no system root into config.json — neither as roots[] entries nor as separate keys', () => {
    boot();
    const raw = JSON.parse(fs.readFileSync(path.join(cwd, '.claude4spec', 'config.json'), 'utf8')) as Record<string, unknown>;
    for (const key of ['plansDir', 'briefsDir', 'patchesDir', 'entitiesDir', 'releasesDir']) expect(raw).not.toHaveProperty(key);
    const roots = raw.roots as Array<Record<string, unknown>>;
    expect(roots.map((r) => r.id)).toEqual(['pages']);
    // No value in the file names a system root's fixed directory.
    expect(JSON.stringify(raw)).not.toContain('.claude4spec/');
    expect(Object.keys(roots[0]!).sort()).toEqual(['builtin', 'dir', 'id', 'name']);
    // `tags.json` stays lazy.
    expect(fs.existsSync(path.join(cwd, '.claude4spec', 'entities', 'tags.json'))).toBe(false);
  });

  it('activation creates the directory of every registry root — user roots of kind pages included (M31 bootstrap)', () => {
    fs.mkdirSync(path.join(cwd, '.claude4spec'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, '.claude4spec', 'config.json'),
      JSON.stringify({
        $schemaVersion: 4,
        name: 'p',
        roots: [
          { id: 'pages', name: 'Pages', dir: 'pages', builtin: true },
          { id: 'adr', name: 'ADRs', dir: 'docs/adr', builtin: false },
        ],
      }),
    );
    const result = boot();
    for (const dir of ['pages', 'docs/adr']) expect(fs.statSync(path.join(cwd, dir)).isDirectory()).toBe(true);
    // Only system roots are reported for the clone rollback; user roots are rolled back by their own list.
    expect(result.systemRootDirsCreated).not.toContain('pages');
    expect(result.systemRootDirsCreated).not.toContain('docs/adr');
  });

  it('the CLI --pages override names the base root dir the activation creates', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    bootstrapProject(registry, ws, cwd, { pagesDir: 'spec' });
    expect(fs.statSync(path.join(cwd, 'spec')).isDirectory()).toBe(true);
  });

  it('[ac:ac-bootstrap-tworzy-aktualizuje-gitignore] with git disabled the managed .gitignore block lists the gitignore-flagged roots, then *.deprecated', () => {
    boot();
    const text = fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8');
    const block = text.slice(text.indexOf('# claude4spec (auto-added)'), text.indexOf('# /claude4spec (auto-added)'));
    expect(block.split('\n').slice(1).filter(Boolean)).toEqual([
      '.claude4spec/plans/',
      '.claude4spec/briefs/',
      '.claude4spec/patches/',
      '.claude4spec/releases/',
      '*.deprecated',
    ]);
    expect(block).not.toContain('entities');
    expect(block).not.toContain('config.json');
    expect(text).not.toContain('db.sqlite');
  });

  it('[ac:ac-bootstrap-tworzy-aktualizuje-gitignore] with git disabled bootstrap updates an existing .gitignore — the user lines stay, the managed block is appended', () => {
    fs.writeFileSync(path.join(cwd, '.gitignore'), 'node_modules/\n');
    boot();
    const text = fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8');
    expect(text.startsWith('node_modules/\n')).toBe(true);
    const block = text.slice(text.indexOf('# claude4spec (auto-added)'), text.indexOf('# /claude4spec (auto-added)'));
    for (const d of ['.claude4spec/plans/', '.claude4spec/briefs/', '.claude4spec/patches/', '.claude4spec/releases/', '*.deprecated']) {
      expect(block).toContain(d);
    }
    expect(block).not.toContain('entities');
    expect(block).not.toContain('config.json');
    expect(text).not.toContain('db.sqlite');
  });
});
