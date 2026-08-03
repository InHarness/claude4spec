import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readConfig,
  writeConfig,
  loadOrCreateConfig,
  configPath,
  migrateConfigToV4,
  validateRootDirs,
  parseRootsArray,
  builtinPagesRoot,
} from './config.js';

// 0.1.58: additive `description` field (string | null, 0–200). Type validation
// lives in config.ts `validate()` (mirrors `language`); the 0–200 length cap is
// enforced at the PATCH /api/config route, not here.
describe('config — description field (0.1.58)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-cfg-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (cfg: Record<string, unknown>) => {
    const file = configPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ $schemaVersion: 3, name: 'X', ...cfg }));
  };

  it('rejects a non-string, non-null description with a typed error', () => {
    write({ description: 42 });
    expect(() => readConfig(dir)).toThrow(
      "config.json: field 'description' expected string | null, got number",
    );
  });

  it('accepts a string description', () => {
    write({ description: 'An elevator pitch.' });
    expect(readConfig(dir).description).toBe('An elevator pitch.');
  });

  it('accepts a null description', () => {
    write({ description: null });
    expect(readConfig(dir).description).toBeNull();
  });

  // 0.2.8 (C23): a missing description is normalized to the default `null`
  // (previously `undefined` — every consumer re-defaulted it with `?? null`).
  it('normalizes a missing description to null', () => {
    write({});
    expect(readConfig(dir).description).toBeNull();
  });
});

// 0.1.65: the M24 remote client bootstrap is "cold". `validate()` checks only URL
// *syntax* — parsable via `new URL()` + an `http(s)://` scheme — never reachability.
// A syntactically-valid but unreachable host must NOT block config load / boot; its
// reachability error surfaces only at the first remote action.
describe('config — remoteApiUrl syntax-only validation (0.1.65)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-cfg-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (cfg: Record<string, unknown>) => {
    const file = configPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ $schemaVersion: 3, name: 'X', ...cfg }));
  };

  const INVALID_URL = "config.json: field 'remoteApiUrl': invalid URL";

  it('accepts a syntactically-valid http(s) URL', () => {
    write({ remoteApiUrl: 'http://localhost:3000' });
    expect(readConfig(dir).remoteApiUrl).toBe('http://localhost:3000');
    write({ remoteApiUrl: 'https://api.example.com' });
    expect(readConfig(dir).remoteApiUrl).toBe('https://api.example.com');
  });

  it('accepts a syntactically-valid but unreachable host (no boot-time probe)', () => {
    // Reachability is deferred to the first remote action — config load must succeed.
    write({ remoteApiUrl: 'https://nope.invalid:9999' });
    expect(readConfig(dir).remoteApiUrl).toBe('https://nope.invalid:9999');
  });

  it('rejects an unparsable URL with the shortened message (no "unreachable host")', () => {
    write({ remoteApiUrl: 'not-a-url' });
    expect(() => readConfig(dir)).toThrow(INVALID_URL);
  });

  it('rejects a URL without an http(s) scheme', () => {
    // `new URL('localhost:3000')` parses (protocol 'localhost:'); the scheme check rejects it.
    write({ remoteApiUrl: 'localhost:3000' });
    expect(() => readConfig(dir)).toThrow(INVALID_URL);
    write({ remoteApiUrl: 'ftp://example.com' });
    expect(() => readConfig(dir)).toThrow(INVALID_URL);
  });

  it('rejects a non-string, non-null remoteApiUrl with a typed error', () => {
    write({ remoteApiUrl: 42 });
    expect(() => readConfig(dir)).toThrow(
      "config.json: field 'remoteApiUrl' expected string | null, got number",
    );
  });

  it('accepts a null remoteApiUrl (use prod default)', () => {
    write({ remoteApiUrl: null });
    expect(readConfig(dir).remoteApiUrl).toBeNull();
  });
});

// M33 phase 3: additive top-level `plugins` namespace (Record<string, object>),
// PATCH deep-merges per `plugins[<name>]` (precedent: agent/git), one level deeper.
describe('config — plugins namespace (M33 phase 3)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-cfg-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (cfg: Record<string, unknown>) => {
    const file = configPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ $schemaVersion: 3, name: 'X', ...cfg }));
  };

  // 0.2.8 (C23): normalized to the `{}` default rather than left undefined.
  it('normalizes a missing plugins field to {}', () => {
    write({});
    expect(readConfig(dir).plugins).toEqual({});
  });

  it('reads a plugins namespace of per-plugin objects', () => {
    write({ plugins: { '@c4s/foo': { a: 1, b: 2 } } });
    expect(readConfig(dir).plugins).toEqual({ '@c4s/foo': { a: 1, b: 2 } });
  });

  it('rejects a non-object plugins field', () => {
    write({ plugins: 42 });
    expect(() => readConfig(dir)).toThrow(/plugins.*expected object/);
  });

  it('rejects a non-object plugin sub-value', () => {
    write({ plugins: { '@c4s/foo': 'nope' } });
    expect(() => readConfig(dir)).toThrow(/plugins\.@c4s\/foo.*expected object/);
  });

  it('deep-merges plugins[name]: one-field write preserves the other fields and other namespaces', () => {
    write({ plugins: { '@c4s/foo': { a: 1, b: 2 }, '@c4s/bar': { x: true } } });
    const merged = writeConfig(dir, { plugins: { '@c4s/foo': { a: 9 } } });
    expect(merged.plugins).toEqual({
      '@c4s/foo': { a: 9, b: 2 },
      '@c4s/bar': { x: true },
    });
  });

  it('creates the namespace when none existed before', () => {
    write({});
    const merged = writeConfig(dir, { plugins: { '@c4s/foo': { a: 1 } } });
    expect(merged.plugins).toEqual({ '@c4s/foo': { a: 1 } });
  });
});

// 0.1.90: additive agent FS path-scope fields (string[]). Type validation lives in
// config.ts `validate()` (same shape check as `entities`); path normalization happens
// later in the M05 runtime resolver, not here.
describe('config — agent path scope (0.1.90)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-cfg-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (agent: Record<string, unknown>) => {
    const file = configPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ $schemaVersion: 3, name: 'X', agent }));
  };

  it('accepts string[] allowedPaths and disallowedPaths', () => {
    write({ allowedPaths: ['/a', '/b'], disallowedPaths: ['/a/secret'] });
    const cfg = readConfig(dir);
    expect(cfg.agent?.allowedPaths).toEqual(['/a', '/b']);
    expect(cfg.agent?.disallowedPaths).toEqual(['/a/secret']);
  });

  // 0.2.8 (C23): missing path-scope fields normalize to empty lists — an empty
  // scope reads as "no user scope", exactly what `?? []` meant at each call site.
  it('normalizes missing path-scope fields to empty arrays', () => {
    write({ claudeUsePreset: true });
    expect(readConfig(dir).agent.allowedPaths).toEqual([]);
    expect(readConfig(dir).agent.disallowedPaths).toEqual([]);
  });

  it('rejects a non-array allowedPaths', () => {
    write({ allowedPaths: '/a' });
    expect(() => readConfig(dir)).toThrow("config.json: field 'agent.allowedPaths' expected string[]");
  });

  it('rejects a non-string element in disallowedPaths', () => {
    write({ disallowedPaths: ['/a', 42] });
    expect(() => readConfig(dir)).toThrow(
      "config.json: field 'agent.disallowedPaths' expected string[], got non-string element",
    );
  });

  it('deep-merges agent: writing allowedPaths alone preserves claudeUsePreset', () => {
    write({ claudeUsePreset: false });
    const merged = writeConfig(dir, { agent: { allowedPaths: ['/extra'] } });
    expect(merged.agent).toEqual({
      claudeUsePreset: false,
      allowedPaths: ['/extra'],
      // 0.2.8: writeConfig returns the NORMALIZED view, so untouched fields
      // carry their defaults; the file itself keeps only the two written keys.
      conversationalLanguage: null,
      disallowedPaths: [],
    });
  });
});

// 0.1.96 multiroot — config v4 (pagesDir → roots[]) migration + roots validation.
describe('config — roots[] / v4 migration (0.1.96)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-cfg-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const writeRaw = (cfg: Record<string, unknown>) => {
    const file = configPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(cfg));
  };

  it('migrateConfigToV4 maps a legacy pagesDir to the built-in pages root', () => {
    writeRaw({ $schemaVersion: 3, name: 'X', pagesDir: 'docs', briefsDir: '.claude4spec/briefs' });
    const { migrated, config } = migrateConfigToV4(dir);
    expect(migrated).toBe(true);
    expect(config.$schemaVersion).toBe(4);
    const pages = config.roots.find((r) => r.id === 'pages');
    expect(pages?.dir).toBe('docs');
    expect(pages?.builtin).toBe(true);
    // pagesDir is physically removed; briefsDir untouched.
    const raw = JSON.parse(fs.readFileSync(configPath(dir), 'utf8'));
    expect('pagesDir' in raw).toBe(false);
    expect(raw.briefsDir).toBe('.claude4spec/briefs');
    // idempotent: a second run is a no-op.
    expect(migrateConfigToV4(dir).migrated).toBe(false);
  });

  // 0.2.8: the loader REJECTS an incomplete roots[] entry instead of defaulting
  // it, so materializing the missing fields is the migration's job — otherwise a
  // config written before a field existed is permanently unloadable.
  it('migrateConfigToV4 materializes missing root fields on an already-v4 config', () => {
    writeRaw({
      $schemaVersion: 4,
      name: 'X',
      roots: [
        { id: 'pages', name: 'Pages', dir: 'pages', builtin: true, sidebar: 'accordion' },
        { id: 'guides', name: 'Guides', dir: 'guides' },
      ],
    });
    const { migrated, config } = migrateConfigToV4(dir);
    expect(migrated).toBe(true);
    const pages = config.roots.find((r) => r.id === 'pages');
    expect(pages).toMatchObject({ releasable: true, sectionIndexed: true, referenceValidated: true, briefTarget: true, linkTargets: [] });
    // A user root gets the full-lifecycle defaults, and is NOT marked builtin.
    const guides = config.roots.find((r) => r.id === 'guides');
    expect(guides).toMatchObject({ builtin: false, releasable: true, sectionIndexed: true, referenceValidated: true, sidebar: 'accordion', briefTarget: true });
    // Values already present are preserved, and a second run is a no-op.
    expect(migrateConfigToV4(dir).migrated).toBe(false);
  });

  it('migrateConfigToV4 does NOT invent a root identity field', () => {
    // A missing `dir` must stay the loud `roots[0].dir` error, not become './pages'.
    writeRaw({
      $schemaVersion: 4,
      name: 'X',
      roots: [{ id: 'pages', name: 'Pages', builtin: true, sidebar: 'accordion' }],
    });
    expect(() => migrateConfigToV4(dir)).toThrow(/roots\[0\]\.dir/);
    // ...and the unrepairable file is left exactly as it was, not half-written.
    const raw = JSON.parse(fs.readFileSync(configPath(dir), 'utf8'));
    expect(raw.roots[0]).toEqual({ id: 'pages', name: 'Pages', builtin: true, sidebar: 'accordion' });
    expect('briefTarget' in raw.roots[0]).toBe(false);
  });

  it('migrateConfigToV4 refuses a config from a NEWER schema version', () => {
    writeRaw({ $schemaVersion: 99, name: 'X', roots: [builtinPagesRoot('pages')] });
    expect(() => migrateConfigToV4(dir)).toThrow(/schema version 99 not supported/);
    // Not downgraded to 4 on the way out.
    expect(JSON.parse(fs.readFileSync(configPath(dir), 'utf8')).$schemaVersion).toBe(99);
  });

  it('migrateConfigToV4 carries a legacy git.syncCommitOnRelease onto git.enabled', () => {
    writeRaw({
      $schemaVersion: 4,
      name: 'X',
      roots: [builtinPagesRoot('pages')],
      git: { syncCommitOnRelease: true, syncPushOnPush: false },
    });
    expect(migrateConfigToV4(dir).migrated).toBe(true);
    const raw = JSON.parse(fs.readFileSync(configPath(dir), 'utf8'));
    expect(raw.git).toEqual({ enabled: true, syncPushOnPush: false });
    expect(readConfig(dir).git.enabled).toBe(true);
  });

  it('migrateConfigToV4 lets an explicit git.enabled win over the legacy flag', () => {
    writeRaw({
      $schemaVersion: 4,
      name: 'X',
      roots: [builtinPagesRoot('pages')],
      git: { enabled: false, syncCommitOnRelease: true },
    });
    expect(migrateConfigToV4(dir).migrated).toBe(true);
    const raw = JSON.parse(fs.readFileSync(configPath(dir), 'utf8'));
    expect(raw.git).toEqual({ enabled: false });
  });

  it('readConfig synthesizes the pages root from a legacy pagesDir (in-memory forward-compat)', () => {
    writeRaw({ $schemaVersion: 3, name: 'X', pagesDir: '.' });
    const cfg = readConfig(dir);
    expect(cfg.roots.find((r) => r.id === 'pages')?.dir).toBe('.');
  });

  it('validateRootDirs flags a hard overlap between a root and entitiesDir', () => {
    const roots = [builtinPagesRoot('pages'), {
      id: 'ent', name: 'Ent', dir: '.claude4spec/entities', builtin: false,
      releasable: false, sectionIndexed: false, referenceValidated: false,
      linkTargets: [], sidebar: 'accordion' as const, briefTarget: false,
    }];
    const { errors } = validateRootDirs(roots, {
      entitiesDir: '.claude4spec/entities', releasesDir: '.claude4spec/releases', briefsDir: '.claude4spec/briefs', patchesDir: '.claude4spec/patches', plansDir: '.claude4spec/plans',
    });
    expect(errors.some((e) => e.includes('entitiesDir'))).toBe(true);
  });

  it('validateRootDirs rejects a root overlapping the .claude4spec/plugins write-target', () => {
    const roots = [builtinPagesRoot('pages'), {
      id: 'gen', name: 'Gen', dir: '.claude4spec/plugins', builtin: false,
      releasable: false, sectionIndexed: false, referenceValidated: false,
      linkTargets: [], sidebar: 'accordion' as const, briefTarget: false,
    }];
    const { errors } = validateRootDirs(roots, {
      entitiesDir: '.claude4spec/entities', releasesDir: '.claude4spec/releases', briefsDir: '.claude4spec/briefs', patchesDir: '.claude4spec/patches', plansDir: '.claude4spec/plans',
    });
    expect(errors).toContain(
      "config.json: root 'gen' dir overlaps write-target '.claude4spec/plugins'",
    );
  });

  it('validateRootDirs allows .claude4spec/skills as a user root (0.1.104: nothing writes there anymore)', () => {
    const roots = [builtinPagesRoot('pages'), {
      id: 'gen', name: 'Gen', dir: '.claude4spec/skills', builtin: false,
      releasable: false, sectionIndexed: false, referenceValidated: false,
      linkTargets: [], sidebar: 'accordion' as const, briefTarget: false,
    }];
    const { errors } = validateRootDirs(roots, {
      entitiesDir: '.claude4spec/entities', releasesDir: '.claude4spec/releases', briefsDir: '.claude4spec/briefs', patchesDir: '.claude4spec/patches', plansDir: '.claude4spec/plans',
    });
    expect(errors).toHaveLength(0);
  });

  it('validateRootDirs allows .claude/skills as a user root (writing styles, M15)', () => {
    const roots = [builtinPagesRoot('pages'), {
      id: 'styles', name: 'Styles', dir: '.claude/skills', builtin: false,
      releasable: false, sectionIndexed: false, referenceValidated: false,
      linkTargets: [], sidebar: 'accordion' as const, briefTarget: false,
    }];
    const { errors } = validateRootDirs(roots, {
      entitiesDir: '.claude4spec/entities', releasesDir: '.claude4spec/releases', briefsDir: '.claude4spec/briefs', patchesDir: '.claude4spec/patches', plansDir: '.claude4spec/plans',
    });
    expect(errors).toHaveLength(0);
  });

  it('parseRootsArray rejects a dangling linkTargets id', () => {
    expect(() => parseRootsArray([{ ...builtinPagesRoot(), linkTargets: ['ghost'] }])).toThrow(
      /dangling link scope/,
    );
  });

  it('parseRootsArray requires the built-in pages root', () => {
    const userRoot = {
      id: 'skills', name: 'Skills', dir: 'skills', builtin: false,
      releasable: false, sectionIndexed: false, referenceValidated: false,
      linkTargets: [], sidebar: 'accordion', briefTarget: false,
    };
    expect(() => parseRootsArray([userRoot])).toThrow(/built-in 'pages' root is required/);
  });

  it('parseRootsArray rejects a root dir escaping cwd', () => {
    expect(() => parseRootsArray([{ ...builtinPagesRoot('../evil') }])).toThrow(/relative path inside cwd/);
  });
});

// 0.2.8 (C23): one central normalizer applies default values deeply at read
// time, so consumers never re-apply them with `??`. These cases pin the four
// rules the normalizer must obey — the fourth (arrays replace wholesale) is the
// one a naive deep-merge gets wrong.
describe('config — central default normalizer (C23, 0.2.8)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-cfg-norm-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (cfg: Record<string, unknown>) => {
    const file = configPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ $schemaVersion: 4, name: 'X', ...cfg }));
  };

  it('fills every nested branch a config omits entirely', () => {
    write({});
    const cfg = readConfig(dir);
    expect(cfg.agent).toEqual({
      claudeUsePreset: true,
      conversationalLanguage: null,
      allowedPaths: [],
      disallowedPaths: [],
    });
    expect(cfg.git).toEqual({
      enabled: false,
      syncPushOnPush: false,
      commitTarget: { mode: 'current', branch: null, template: null, base: null },
      switchAfterRelease: false,
    });
    expect(cfg.consistency).toEqual({ requireAcCoverage: 'off', requireModuleAc: 'off' });
    expect(cfg.plugins).toEqual({});
  });

  it('merges a partial branch instead of replacing it', () => {
    write({ git: { enabled: true } });
    const cfg = readConfig(dir);
    expect(cfg.git.enabled).toBe(true);
    expect(cfg.git.syncPushOnPush).toBe(false);
    expect(cfg.git.commitTarget.mode).toBe('current');
  });

  it('merges one level deeper (git.commitTarget)', () => {
    write({ git: { commitTarget: { mode: 'named', branch: 'spec' } } });
    const { commitTarget } = readConfig(dir).git;
    expect(commitTarget).toEqual({ mode: 'named', branch: 'spec', template: null, base: null });
  });

  it('keeps an explicit null where null carries meaning (writingStyle, remoteApiUrl)', () => {
    write({ writingStyle: null, remoteApiUrl: null });
    const cfg = readConfig(dir);
    expect(cfg.writingStyle).toBeNull();
    expect(cfg.remoteApiUrl).toBeNull();
  });

  it('keeps an explicit null inside a nested branch', () => {
    write({ agent: { conversationalLanguage: null }, git: { commitTarget: { branch: null } } });
    const cfg = readConfig(dir);
    expect(cfg.agent.conversationalLanguage).toBeNull();
    expect(cfg.git.commitTarget.branch).toBeNull();
  });

  it('replaces arrays wholesale — never element-wise', () => {
    write({
      roots: [{ ...builtinPagesRoot('docs') }],
      agent: { allowedPaths: ['/only'] },
    });
    const cfg = readConfig(dir);
    expect(cfg.roots).toHaveLength(1);
    expect(cfg.roots[0]!.dir).toBe('docs');
    expect(cfg.agent.allowedPaths).toEqual(['/only']);
  });

  it('leaves `entities` undefined when absent — undefined means "all types", not "none"', () => {
    write({});
    expect(readConfig(dir).entities).toBeUndefined();
    write({ entities: [] });
    expect(readConfig(dir).entities).toEqual([]);
  });

  it('does not persist the normalized branches — defaults stay live for the project', () => {
    write({ writingStyle: null });
    writeConfig(dir, { name: 'Renamed' });
    const onDisk = JSON.parse(fs.readFileSync(configPath(dir), 'utf8')) as Record<string, unknown>;
    expect(onDisk.name).toBe('Renamed');
    expect(onDisk.git).toBeUndefined();
    expect(onDisk.agent).toBeUndefined();
    expect(onDisk.consistency).toBeUndefined();
    // …while the read-back view still carries them.
    expect(readConfig(dir).git.commitTarget.mode).toBe('current');
  });

  it('a fresh bootstrap writes only the historical key set', () => {
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-cfg-boot-'));
    try {
      const { config, created } = loadOrCreateConfig(fresh, {});
      expect(created).toBe(true);
      // Normalized in memory…
      expect(config.git.enabled).toBe(false);
      expect(config.agent.claudeUsePreset).toBe(true);
      // …absent on disk.
      const onDisk = JSON.parse(fs.readFileSync(configPath(fresh), 'utf8')) as Record<string, unknown>;
      expect(onDisk.git).toBeUndefined();
      expect(onDisk.agent).toBeUndefined();
      expect(onDisk.plugins).toBeUndefined();
      expect(onDisk.onboardingCompleted).toBe(false);
      expect(onDisk.briefsDir).toBe('.claude4spec/briefs');
    } finally {
      fs.rmSync(fresh, { recursive: true, force: true });
    }
  });
});
