import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assetContentType,
  effectiveFrontendSources,
  envelopeFrontendSource,
  nearestPackageRoot,
  npmFrontendSource,
  overlayFrontendSources,
  packageFrontendEntry,
  resolvePluginAsset,
  type FrontendPool,
} from './frontend-assets.js';
import type { BuiltinEnvelope } from './builtin-envelopes.js';

/** Write `files` (relative path → content) under `dir`. */
function writeTree(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

describe('frontend-assets — sources, effective pool, asset resolution', () => {
  let tmp: string;
  let cwd: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-frontend-'));
    cwd = path.join(tmp, 'project');
    fs.mkdirSync(cwd);
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  /** `<cwd>/.claude4spec/plugins/<folder>/` with a package.json and the given files. */
  function overlay(folder: string, pkg: Record<string, unknown> | null, files: Record<string, string>): string {
    const dir = path.join(cwd, '.claude4spec', 'plugins', folder);
    fs.mkdirSync(dir, { recursive: true });
    if (pkg) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
    writeTree(dir, files);
    return dir;
  }

  /** A package root under `tmp` (stands in for `node_modules/<pkg>`). */
  function pkgRoot(id: string, pkg: Record<string, unknown>, files: Record<string, string>): string {
    const dir = path.join(tmp, 'node_modules', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
    writeTree(dir, files);
    return dir;
  }

  it('assetContentType allowlists only .js/.css/.map', () => {
    expect(assetContentType('dto-ABC123.js')).toBe('text/javascript');
    expect(assetContentType('frontend.css')).toBe('text/css');
    expect(assetContentType('frontend.js.map')).toBe('application/json');
    expect(assetContentType('package.json')).toBeNull();
    expect(assetContentType('secret.env')).toBeNull();
    expect(assetContentType('noext')).toBeNull();
  });

  it('overlay: the entry is always dist/frontend.js — exports are not read; name = folder, version from its package.json', () => {
    const dir = overlay(
      'glossary',
      { name: '@acme/glossary', version: '1.2.3', exports: { './frontend': './out/fe.js' } },
      { 'dist/frontend.js': 'export {}', 'dist/frontend.css': '.x{}', 'out/fe.js': 'export {}' },
    );
    overlay('unbuilt', { name: 'unbuilt', version: '1.0.0' }, {});
    overlay('legacy', null, { 'dist/frontend.js': 'export {}' });
    const byName = new Map(overlayFrontendSources(cwd).map((s) => [s.name, s]));
    expect([...byName.keys()].sort()).toEqual(['glossary', 'legacy']);
    expect(byName.get('glossary')).toMatchObject({
      kind: 'overlay',
      version: '1.2.3',
      entry: path.join(dir, 'dist', 'frontend.js'),
      css: path.join(dir, 'dist', 'frontend.css'),
      recordKey: 'glossary',
    });
    expect(byName.get('legacy')).toMatchObject({ version: '0.0.0', css: null });
  });

  it('npm package: exports[./frontend] (import → module → default → node → require), else dist/frontend.js; name + version from package.json', () => {
    const declared = pkgRoot(
      'declared',
      { name: '@scope/declared', version: '3.1.4', exports: { './frontend': { require: './cjs/fe.js', import: './out/client.js' } } },
      { 'out/client.js': 'export {}', 'out/frontend.css': '.x{}', 'cjs/fe.js': '', 'dist/frontend.js': 'export {}' },
    );
    const fallback = pkgRoot('fallback', { name: 'fallback', version: '1.0.0' }, { 'dist/frontend.js': 'export {}' });
    const roots: Record<string, string> = { declared, fallback };
    const resolveRoot = (n: string) => roots[n] ?? null;

    expect(npmFrontendSource('declared', resolveRoot)).toMatchObject({
      kind: 'npm',
      name: '@scope/declared',
      version: '3.1.4',
      entry: path.join(declared, 'out', 'client.js'),
      css: path.join(declared, 'out', 'frontend.css'),
      recordKey: 'declared',
    });
    expect(npmFrontendSource('fallback', resolveRoot)).toMatchObject({
      entry: path.join(fallback, 'dist', 'frontend.js'),
      css: null,
    });
    expect(npmFrontendSource('not-installed', resolveRoot)).toBeNull();
  });

  it('effective pool: only backend-`loaded` sources, overlay > npm > envelope on a name collision, overlay only when trusted', () => {
    const npm = pkgRoot('shared', { name: 'shared', version: '2.0.0' }, { 'dist/frontend.js': 'export {}' });
    const envDir = path.join(tmp, 'envelopes', 'shared-env');
    writeTree(envDir, { 'package.json': JSON.stringify({ name: 'shared', version: '1.0.0' }), 'dist/frontend.js': 'export {}' });
    const env: BuiltinEnvelope = { name: 'shared-env', dir: envDir, specifier: 'file:///x' };
    overlay('shared', { name: 'shared', version: '9.9.9' }, { 'dist/frontend.js': 'export {}' });
    const resolveRoot = (n: string) => (n === 'shared' ? npm : null);
    const pool = (o: Partial<{ trusted: boolean; overlay: string[]; base: string[] }>): FrontendPool => ({
      envelopes: { list: [env], loaded: new Set(o.base ?? []) },
      npm: { packages: ['shared'], loaded: new Set(o.base ?? []), resolveRoot },
      overlay: { cwd, trusted: o.trusted ?? true, loaded: new Set(o.overlay ?? []) },
    });
    const pick = (p: FrontendPool) => effectiveFrontendSources(p).map((s) => `${s.kind}@${s.version}`);

    expect(pick(pool({ base: ['shared-env', 'shared'], overlay: ['shared'] }))).toEqual(['overlay@9.9.9']);
    expect(pick(pool({ base: ['shared-env', 'shared'], overlay: ['shared'], trusted: false }))).toEqual(['npm@2.0.0']);
    expect(pick(pool({ base: ['shared-env', 'shared'] }))).toEqual(['npm@2.0.0']);
    expect(pick(pool({ base: ['shared-env'] }))).toEqual(['envelope@1.0.0']);
    expect(pick(pool({}))).toEqual([]);
  });

  it('asset resolution: siblings of the announced entry only; extension / separator / traversal / missing ⇒ null', () => {
    const dir = overlay('glossary', { name: 'glossary', version: '1.0.0' }, {
      'dist/frontend.js': 'export {}',
      'dist/dto-ABC123.js': 'export {}',
      'dist/frontend.js.map': '{}',
      'dist/secret.json': '{}',
      'package.json.js': '',
    });
    const pool: FrontendPool = { overlay: { cwd, trusted: true, loaded: new Set(['glossary']) } };
    const dist = path.join(dir, 'dist');
    expect(resolvePluginAsset(pool, 'glossary', 'dto-ABC123.js')).toBe(path.join(dist, 'dto-ABC123.js'));
    expect(resolvePluginAsset(pool, 'glossary', 'frontend.js.map')).toBe(path.join(dist, 'frontend.js.map'));
    expect(resolvePluginAsset(pool, 'glossary', 'secret.json')).toBeNull();
    expect(resolvePluginAsset(pool, 'glossary', '../package.json.js')).toBeNull();
    expect(resolvePluginAsset(pool, 'glossary', 'sub/x.js')).toBeNull();
    expect(resolvePluginAsset(pool, 'glossary', 'absent.js')).toBeNull();
    expect(resolvePluginAsset(pool, 'nope', 'frontend.js')).toBeNull();
    expect(resolvePluginAsset({ overlay: { cwd, trusted: false, loaded: new Set(['glossary']) } }, 'glossary', 'frontend.js')).toBeNull();
  });
});

// `defaultWorkspaceRoot` resolves a plugin's package root by walking up from the
// `import.meta.resolve`d entry via this pure helper. The regression: it must NOT
// gate on the manifest `name`, so a plugin installed under an unscoped dir name
// whose real `package.json` `name` is scoped still resolves (else its frontend
// is silently dropped — no manifest entry, no sidebar link).
describe('nearestPackageRoot', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-pkgroot-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('walks up from a nested entry dir to the package root (name mismatch tolerated)', () => {
    // Dir/install name (unscoped) ≠ real package.json name (scoped) — the bug case.
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: '@inharness-ai/c4s-plugin-simple-database-tables', version: '1.0.0' }),
    );
    fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
    // entry resolves to <root>/dist/frontend.js → start the walk from <root>/dist.
    expect(nearestPackageRoot(path.join(root, 'dist'))).toBe(root);
  });

  it('returns the start dir itself when it owns a package.json', () => {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'whatever' }));
    expect(nearestPackageRoot(root)).toBe(root);
  });

  it('returns null when no ancestor owns a readable package.json', () => {
    // A temp dir with no package.json and (within 12 hops) none up the chain.
    const deep = path.join(root, 'a', 'b', 'c');
    fs.mkdirSync(deep, { recursive: true });
    // Guard: only assert null when the real fs has no package.json up to root.
    // os.tmpdir() chains have none, so the walk terminates at filesystem root.
    expect(nearestPackageRoot(deep)).toBeNull();
  });
});

/**
 * 2.1.20 (M33 `ywud56l6`) — a built-in envelope's frontend entry is found by the
 * SAME rule as an npm package's: `exports['./frontend']`, falling back to
 * `dist/frontend.js`, relative to the envelope folder. Moving an envelope out of
 * the host repo therefore does not change how its frontend is discovered.
 */
describe('[section:ywud56l6] envelope frontend entry — the npm package rule, relative to the envelope folder', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-envelope-fe-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function envelope(name: string, pkg: Record<string, unknown>, files: string[]): BuiltinEnvelope {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.2.3', ...pkg }));
    for (const f of files) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), '// built\n');
    }
    return { name, dir, specifier: `file://${path.join(dir, 'dist/index.js')}` };
  }

  it('[section:ywud56l6] resolves exports[./frontend] when declared, and dist/frontend.js otherwise — the same path the npm package rule resolves', () => {
    const declared = envelope(
      'declared',
      { exports: { '.': './dist/index.js', './frontend': { import: './out/fe.js' } } },
      ['out/fe.js', 'out/frontend.css', 'out/chunk-1.js'],
    );
    const fallback = envelope('fallback', {}, ['dist/frontend.js']);
    const unbuilt = envelope('unbuilt', { exports: { './frontend': './dist/frontend.js' } }, []);
    const envelopes = [declared, fallback, unbuilt];

    expect(envelopeFrontendSource(declared)).toMatchObject({
      kind: 'envelope',
      name: 'declared',
      version: '1.2.3',
      entry: path.join(declared.dir, 'out/fe.js'),
      css: path.join(declared.dir, 'out/frontend.css'),
    });
    expect(envelopeFrontendSource(fallback)).toMatchObject({ entry: path.join(fallback.dir, 'dist/frontend.js'), css: null });
    expect(envelopeFrontendSource(unbuilt)).toBeNull();

    // Assets are served next to the resolved entry, inside the envelope folder.
    const pool: FrontendPool = { envelopes: { list: envelopes, loaded: new Set(['declared', 'fallback', 'unbuilt']) } };
    expect(resolvePluginAsset(pool, 'declared', 'fe.js')).toBe(path.join(declared.dir, 'out/fe.js'));
    expect(resolvePluginAsset(pool, 'declared', 'chunk-1.js')).toBe(path.join(declared.dir, 'out/chunk-1.js'));
    expect(resolvePluginAsset(pool, 'fallback', 'frontend.js')).toBe(path.join(fallback.dir, 'dist/frontend.js'));
    expect(resolvePluginAsset(pool, 'unbuilt', 'frontend.js')).toBeNull();

    // The npm-package rule, applied to the same folders as package roots, lands on the same files.
    expect(packageFrontendEntry(declared.dir)).toBe(path.join(declared.dir, 'out/fe.js'));
    expect(packageFrontendEntry(fallback.dir)).toBe(path.join(fallback.dir, 'dist/frontend.js'));
    const asPackageRoot = (name: string) => envelopes.find((e) => e.name === name)?.dir ?? null;
    expect(npmFrontendSource('declared', asPackageRoot)?.entry).toBe(path.join(declared.dir, 'out/fe.js'));
  });
});
