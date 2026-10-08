import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
import type { Root } from '../shared/types.js';

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

  // 0.2.112: the brief's criterion uses a value DIFFERENT from the default — a
  // preserved default proves nothing — so these seed an explicit `true`.
  it('deep-merges agent: writing allowedPaths alone preserves claudeUsePreset', () => {
    write({ claudeUsePreset: true });
    const merged = writeConfig(dir, { agent: { allowedPaths: ['/extra'] } });
    expect(merged.agent).toEqual({
      claudeUsePreset: true,
      allowedPaths: ['/extra'],
      // 0.2.8: writeConfig returns the NORMALIZED view, so untouched fields
      // carry their defaults; the file itself keeps only the two written keys.
      conversationalLanguage: null,
      disallowedPaths: [],
      // 0.2.53: absent from the file, so the normalizer supplies the default.
      disableDirectFilesystemAccess: true,
    });
  });
});

// 0.2.112: `agent.claudeUsePreset` default flipped to `false`, with no
// `$schemaVersion` bump and no migration — every project without the field,
// including ones created before this version, now runs without the preset.
describe('config — agent.claudeUsePreset default (0.2.112)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-cfg-preset-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const writeRaw = (cfg: Record<string, unknown>) => {
    const file = configPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ $schemaVersion: 4, name: 'X', ...cfg }));
  };

  it('no `agent` object ⇒ false', () => {
    writeRaw({});
    expect(readConfig(dir).agent.claudeUsePreset).toBe(false);
  });

  it('`agent` without `claudeUsePreset` ⇒ false', () => {
    writeRaw({ agent: { conversationalLanguage: 'Polski' } });
    expect(readConfig(dir).agent.claudeUsePreset).toBe(false);
  });

  it('explicit true stays true, and the file is not migrated', () => {
    writeRaw({ agent: { claudeUsePreset: true } });
    expect(readConfig(dir).agent.claudeUsePreset).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(configPath(dir), 'utf8')) as Record<string, unknown>;
    expect(onDisk.$schemaVersion).toBe(4);
  });

  it('onboarding [Continue] (agent: { conversationalLanguage }) keeps an explicit non-default true', () => {
    writeRaw({ agent: { claudeUsePreset: true } });
    const merged = writeConfig(dir, { agent: { conversationalLanguage: 'Polski' } });
    expect(merged.agent.claudeUsePreset).toBe(true);
    expect(readConfig(dir).agent.claudeUsePreset).toBe(true);
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
  /** A 2.1.8 user root: exactly four fields. */
  const userRoot = (id: string, dir: string): Root => ({ id, name: id, dir, builtin: false });

  it('migrateConfigToV4 maps a legacy pagesDir to the built-in pages root', () => {
    writeRaw({ $schemaVersion: 3, name: 'X', pagesDir: 'docs', briefsDir: '.claude4spec/briefs' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { migrated, config } = migrateConfigToV4(dir);
      expect(migrated).toBe(true);
      expect(config.$schemaVersion).toBe(4);
      const pages = config.roots.find((r) => r.id === 'pages');
      expect(pages).toEqual({ id: 'pages', name: 'Pages', dir: 'docs', builtin: true });
      // pagesDir is physically removed; the legacy briefsDir is an unknown field
      // left in the file untouched.
      const raw = JSON.parse(fs.readFileSync(configPath(dir), 'utf8'));
      expect('pagesDir' in raw).toBe(false);
      expect(raw.briefsDir).toBe('.claude4spec/briefs');
      // idempotent: a second run is a no-op.
      expect(migrateConfigToV4(dir).migrated).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  // 2.1.8: roots[] entries are no longer materialized — legacy per-root flags are
  // unknown fields, left in the file and dropped from the parsed root.
  it('migrateConfigToV4 leaves an already-v4 config with legacy per-root flags untouched', () => {
    const roots = [
      { id: 'pages', name: 'Pages', dir: 'pages', builtin: true, sidebar: 'accordion', releasable: true },
      { id: 'guides', name: 'Guides', dir: 'guides', builtin: false, linkTargets: [] },
    ];
    writeRaw({ $schemaVersion: 4, name: 'X', roots });
    const { migrated, config } = migrateConfigToV4(dir);
    expect(migrated).toBe(false);
    expect(config.roots).toEqual([
      { id: 'pages', name: 'Pages', dir: 'pages', builtin: true },
      { id: 'guides', name: 'Guides', dir: 'guides', builtin: false },
    ]);
    expect(JSON.parse(fs.readFileSync(configPath(dir), 'utf8')).roots).toEqual(roots);
  });

  it('migrateConfigToV4 does NOT invent a root identity field', () => {
    // A missing `dir` must stay the loud `roots[0].dir` error, not become './pages'.
    writeRaw({
      $schemaVersion: 4,
      name: 'X',
      roots: [{ id: 'pages', name: 'Pages', builtin: true }],
      git: { syncCommitOnRelease: true },
    });
    expect(() => migrateConfigToV4(dir)).toThrow(/roots\[0\]\.dir/);
    // ...and the unrepairable file is left exactly as it was, not half-written.
    const raw = JSON.parse(fs.readFileSync(configPath(dir), 'utf8'));
    expect(raw.roots[0]).toEqual({ id: 'pages', name: 'Pages', builtin: true });
    expect(raw.git).toEqual({ syncCommitOnRelease: true });
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
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(migrateConfigToV4(dir).migrated).toBe(true);
    } finally {
      log.mockRestore();
    }
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

  it('builtinPagesRoot returns exactly the four root fields', () => {
    expect(builtinPagesRoot('docs')).toEqual({ id: 'pages', name: 'Pages', dir: 'docs', builtin: true });
  });

  it('validateRootDirs flags a hard overlap between a user root and a system root', () => {
    const { errors } = validateRootDirs([builtinPagesRoot('pages'), userRoot('ent', '.claude4spec/entities')]);
    expect(errors).toContain("config.json: 'ent' overlaps write-target 'entities'");
  });

  it('validateRootDirs rejects a root overlapping the .claude4spec/plugins write-target', () => {
    const { errors } = validateRootDirs([builtinPagesRoot('pages'), userRoot('gen', '.claude4spec/plugins')]);
    expect(errors).toContain("config.json: 'gen' overlaps write-target '.claude4spec/plugins'");
  });

  it('validateRootDirs returns only errors', () => {
    expect(Object.keys(validateRootDirs([builtinPagesRoot('pages')]))).toEqual(['errors']);
  });

  it('[ac:ac-korzen-uzytkownika-z-dir-przechodzi-w] dir: "." passes validateRootDirs — the namespace of "." excludes .claude4spec/', () => {
    expect(validateRootDirs([builtinPagesRoot('.')]).errors).toEqual([]);
  });

  it('[ac:ac-korzen-uzytkownika-z-dir-rownym-claud] dir under .claude4spec/plans is an overlap error', () => {
    const { errors } = validateRootDirs([builtinPagesRoot('pages'), userRoot('x', '.claude4spec/plans/x')]);
    expect(errors).toContain("config.json: 'x' overlaps write-target 'plans'");
    // …and a root AT the system root's dir too.
    expect(validateRootDirs([builtinPagesRoot('.claude4spec/plans')]).errors).toContain(
      "config.json: 'pages' overlaps write-target 'plans'",
    );
  });

  it('validateRootDirs flags two user roots on the same dir', () => {
    const { errors } = validateRootDirs([builtinPagesRoot('shared'), userRoot('b', 'shared')]);
    expect(errors).toContain("config.json: 'pages' overlaps write-target 'b'");
  });

  it('validateRootDirs allows a root nested under another root inside a dot-directory', () => {
    // Two roots that never see each other's files: the namespace of '.' skips the
    // dot-dir, and the one inside it never climbs out.
    const skills = userRoot('skills', '.claude4spec/skills');
    expect(validateRootDirs([builtinPagesRoot('.'), skills]).errors).toEqual([]);
    // Order must not change the verdict either.
    expect(validateRootDirs([skills, builtinPagesRoot('.')]).errors).toEqual([]);

    expect(validateRootDirs([userRoot('docs', 'docs'), userRoot('arch', 'docs/.archive')]).errors).toEqual([]);
  });

  it('validateRootDirs still flags a root nested under another when the namespace DOES reach it', () => {
    const docs = userRoot('docs', 'docs');
    // No dot segment on the way down — both namespaces hold the same files.
    expect(validateRootDirs([docs, userRoot('sub', 'docs/sub')]).errors).toHaveLength(1);
    // And a root at '.' still swallows an ordinary sibling directory.
    expect(validateRootDirs([builtinPagesRoot('.'), docs]).errors).toHaveLength(1);
  });

  it('validateRootDirs verdict does not depend on the order of roots[]', () => {
    const a = userRoot('a', 'shared');
    const b = userRoot('b', 'shared/nested');
    const forward = validateRootDirs([builtinPagesRoot('pages'), a, b]).errors.length;
    const reversed = validateRootDirs([builtinPagesRoot('pages'), b, a]).errors.length;
    expect(forward).toBeGreaterThan(0);
    expect(reversed).toBe(forward);
  });

  it('validateRootDirs allows .claude4spec/skills as a user root (0.1.104: nothing writes there anymore)', () => {
    expect(validateRootDirs([builtinPagesRoot('pages'), userRoot('gen', '.claude4spec/skills')]).errors).toHaveLength(0);
  });

  it('validateRootDirs allows .claude/skills as a user root (writing styles, M15)', () => {
    expect(validateRootDirs([builtinPagesRoot('pages'), userRoot('styles', '.claude/skills')]).errors).toHaveLength(0);
  });

  it('[ac:ac-korzen-uzytkownika-o-identyfikatorze] roots[] entry with id plans is a reserved-identifier error', () => {
    expect(() => parseRootsArray([builtinPagesRoot(), userRoot('plans', 'my-plans')])).toThrow(
      /root id 'plans' is reserved for a system root/,
    );
    // Every system-root id, on read as well as on write.
    for (const id of ['plans', 'briefs', 'patches', 'entities', 'releases']) {
      expect(() => parseRootsArray([builtinPagesRoot(), userRoot(id, `x-${id}`)], { reservedIds: 'warn', idShape: 'warn' })).toThrow(
        /reserved for a system root/,
      );
    }
    writeRaw({ $schemaVersion: 4, name: 'X', roots: [builtinPagesRoot(), userRoot('plans', 'my-plans')] });
    expect(() => readConfig(dir)).toThrow(/root id 'plans' is reserved for a system root/);
    fs.rmSync(configPath(dir));
    expect(() => writeConfig(dir, { roots: [builtinPagesRoot(), userRoot('plans', 'my-plans')] })).toThrow(
      /reserved for a system root/,
    );
  });

  it('[ac:ac-konfiguracja-ktorej-roots-nie-ma-dokl] config without exactly one builtin is rejected on read and on write', () => {
    writeRaw({ $schemaVersion: 4, name: 'X', roots: [userRoot('docs', 'docs')] });
    expect(() => readConfig(dir)).toThrow(/exactly one root must have builtin: true \(found 0\)/);
    writeRaw({ $schemaVersion: 4, name: 'X', roots: [builtinPagesRoot(), { ...builtinPagesRoot('docs'), id: 'docs' }] });
    expect(() => readConfig(dir)).toThrow(/exactly one root must have builtin: true \(found 2\)/);

    fs.rmSync(configPath(dir));
    expect(() => writeConfig(dir, { roots: [userRoot('docs', 'docs')] })).toThrow(/found 0/);
    expect(() =>
      writeConfig(dir, { roots: [builtinPagesRoot(), { ...builtinPagesRoot('docs'), id: 'docs' }] }),
    ).toThrow(/found 2/);
    // Nothing was written by the refused writes.
    expect(fs.existsSync(configPath(dir))).toBe(false);
  });

  it('[ac:ac-wpis-roots-z-polem-spoza-id-name-dir] unknown field on a roots[] entry loads without error and the root keeps exactly 4 keys', () => {
    writeRaw({
      $schemaVersion: 4,
      name: 'X',
      roots: [{ ...builtinPagesRoot(), releasable: false, foo: 1 }, { ...userRoot('docs', 'docs'), sidebar: 'hidden', linkTargets: ['ghost'] }],
    });
    const cfg = readConfig(dir);
    expect(cfg.roots).toEqual([
      { id: 'pages', name: 'Pages', dir: 'pages', builtin: true },
      { id: 'docs', name: 'docs', dir: 'docs', builtin: false },
    ]);
    for (const r of cfg.roots) expect(Object.keys(r).sort()).toEqual(['builtin', 'dir', 'id', 'name']);
  });

  it('[ac:ac-config-json-z-kluczem-dir-dla-planow] plansDir in config.json is ignored with a warning and absent from the read config', () => {
    writeRaw({ $schemaVersion: 4, name: 'X', roots: [builtinPagesRoot()], plansDir: 'docs/plans' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const cfg = readConfig(dir);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/plansDir/));
      expect('plansDir' in cfg).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it('a legacy *Dir equal to the fixed system dir is ignored silently', () => {
    writeRaw({ $schemaVersion: 4, name: 'X', roots: [builtinPagesRoot()], briefsDir: '.claude4spec/briefs' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const cfg = readConfig(dir);
      expect(warn).not.toHaveBeenCalled();
      expect('briefsDir' in cfg).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it('parseRootsArray rejects a root id that a route already claims', () => {
    /**
     * 0.2.13 mounts the cross-root `search_pages` rendering at
     * `GET /api/pages/search`, ahead of `/api/pages/:rootId`. A root called
     * `search` would lose that path SILENTLY, so the id is refused at config
     * validation, where the collision is visible.
     */
    const search = userRoot('search', 'search');
    expect(() => parseRootsArray([builtinPagesRoot(), search])).toThrow(/reserved/);
    // Only the ids a route actually claims — this is a reserved LIST, not a
    // blanket restriction on what a root may be called.
    expect(() => parseRootsArray([builtinPagesRoot(), { ...search, id: 'searches', dir: 'searches' }])).not.toThrow();
  });

  /**
   * 0.2.101 — rule 5 rewritten: the base root is the entry carrying
   * `builtin: true`, and there must be exactly one. The identifier `'pages'`
   * became nothing but the default a new project starts with.
   */
  it('parseRootsArray requires exactly one builtin root, whatever its id', () => {
    const skills = userRoot('skills', 'skills');
    expect(() => parseRootsArray([skills])).toThrow(/exactly one root must have builtin: true \(found 0\)/);
    expect(() =>
      parseRootsArray([builtinPagesRoot(), { ...builtinPagesRoot(), id: 'docs', dir: 'docs' }]),
    ).toThrow(/exactly one root must have builtin: true \(found 2\)/);
    // The BASE root renamed away from `pages`, with no entry of that name left,
    // is a perfectly ordinary config — this is the whole point of 0.2.101.
    expect(() => parseRootsArray([{ ...builtinPagesRoot(), id: 'docs' }, skills])).not.toThrow();
  });

  it('parseRootsArray requires builtin on every entry', () => {
    expect(() => parseRootsArray([builtinPagesRoot(), { id: 'docs', name: 'Docs', dir: 'docs' }])).toThrow(
      /roots\[1\]\.builtin/,
    );
  });

  it('parseRootsArray rejects a root id that is not a kebab-case slug', () => {
    for (const bad of ['', 'Pages', 'my pages', 'a/b', '-lead', 'trail-', 'double--dash']) {
      expect(() => parseRootsArray([{ ...builtinPagesRoot(), id: bad }])).toThrow(
        bad === '' ? /expected non-empty string/ : /must be a kebab-case slug/,
      );
    }
  });

  /**
   * The slug rule arrived in 0.2.101; earlier releases accepted any non-empty
   * id. A config already on disk must keep loading — the read path warns, only
   * a write refuses.
   */
  it('readConfig still loads a config written before the slug rule, with a warning', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-legacy-id-'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const file = configPath(dir);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const legacy = userRoot('api_docs', 'api_docs');
      fs.writeFileSync(
        file,
        JSON.stringify({ $schemaVersion: 4, name: 'X', roots: [builtinPagesRoot(), legacy] }, null, 2),
      );
      expect(readConfig(dir).roots.map((r) => r.id)).toEqual(['pages', 'api_docs']);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/invalid root id 'api_docs'/));
      // …while a write carrying a non-slug id is still refused.
      expect(() => parseRootsArray([builtinPagesRoot(), legacy])).toThrow(/must be a kebab-case slug/);
    } finally {
      warn.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * Rule 7 — an identifier a rename retired stays taken forever. Supplied by the
   * WRITE paths only; the boot read never passes it, so a project already on
   * disk cannot become unloadable because of the sidecar registry.
   */
  it('parseRootsArray refuses a retired id when the caller supplies the retired set', () => {
    const roots = [{ ...builtinPagesRoot(), id: 'docs', dir: 'docs' }];
    expect(() => parseRootsArray(roots)).not.toThrow();
    expect(() => parseRootsArray(roots, { retiredIds: new Set(['docs']) })).toThrow(
      /root id 'docs' was retired by an earlier rename/,
    );
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
      // 0.2.112: absent = OFF (was `true`) — no migration, no schema bump.
      claudeUsePreset: false,
      conversationalLanguage: null,
      allowedPaths: [],
      disallowedPaths: [],
      disableDirectFilesystemAccess: true,
    });
    expect(cfg.git).toEqual({
      enabled: false,
      syncPushOnPush: false,
      commitTarget: { mode: 'current', branch: null, template: null, base: null },
      switchAfterRelease: false,
    });
    expect(cfg.consistency).toEqual({ requireAcCoverage: 'off', requireModuleAc: 'off', requireTagConsumer: 'off' });
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
      expect(config.agent.claudeUsePreset).toBe(false);
      // …absent on disk.
      const onDisk = JSON.parse(fs.readFileSync(configPath(fresh), 'utf8')) as Record<string, unknown>;
      expect(onDisk.git).toBeUndefined();
      expect(onDisk.agent).toBeUndefined();
      expect(onDisk.plugins).toBeUndefined();
      expect(onDisk.onboardingCompleted).toBe(false);
      expect(onDisk.roots).toEqual([{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }]);
      // 2.1.8: the artifact dir keys are gone — system roots live in code.
      for (const k of ['plansDir', 'briefsDir', 'patchesDir', 'entitiesDir', 'releasesDir']) {
        expect(k in onDisk).toBe(false);
      }
    } finally {
      fs.rmSync(fresh, { recursive: true, force: true });
    }
  });
});

/**
 * 2.1.8 — the envelope of `.claude4spec/config.json` (code-snippet
 * `config-json-shape`): the current version and the top-level keys; `roots[]`
 * entries are `{ id, name, dir, builtin }`, and the system roots have no keys.
 */
describe('config — the config.json envelope (2.1.8)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-cfg-shape-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const ENVELOPE_KEYS = [
    '$schemaVersion',
    'name',
    'description',
    'language',
    'writingStyle',
    'roots',
    'entities',
    'agent',
    'git',
    'consistency',
    'onboardingCompleted',
    'remoteApiUrl',
    'remoteProjectId',
    'plugins',
  ];

  it('[entity:config-json-shape] a fresh file is version 4, uses only envelope keys, roots entries carry four fields and no system-root key exists', () => {
    loadOrCreateConfig(dir, {});
    const raw = JSON.parse(fs.readFileSync(configPath(dir), 'utf8')) as Record<string, unknown>;
    expect(raw.$schemaVersion).toBe(4);
    for (const key of Object.keys(raw)) expect(ENVELOPE_KEYS, key).toContain(key);
    for (const key of ['plansDir', 'briefsDir', 'patchesDir', 'entitiesDir', 'releasesDir']) expect(raw).not.toHaveProperty(key);
    const roots = raw.roots as Array<Record<string, unknown>>;
    expect(roots).toEqual([{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }]);

    // A full write keeps to the same envelope: every key it persists is one of the snippet's.
    writeConfig(dir, {
      description: 'd',
      language: 'English',
      entities: ['endpoint'],
      agent: { claudeUsePreset: true } as never,
      git: { enabled: true } as never,
      plugins: { 'c4s-plugin-x': { on: true } },
    });
    const after = JSON.parse(fs.readFileSync(configPath(dir), 'utf8')) as Record<string, unknown>;
    for (const key of Object.keys(after)) expect(ENVELOPE_KEYS, key).toContain(key);
    expect(after.$schemaVersion).toBe(4);
  });

  it('a legacy file with *Dir keys and extra per-root fields is not rewritten and stays at version 4', () => {
    const file = configPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const text = JSON.stringify({
      $schemaVersion: 4,
      name: 'X',
      roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true, briefTarget: true }],
      briefsDir: 'docs/briefs',
    });
    fs.writeFileSync(file, text);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      loadOrCreateConfig(dir, {});
      readConfig(dir);
    } finally {
      warn.mockRestore();
    }
    expect(fs.readFileSync(file, 'utf8')).toBe(text);
  });
});
