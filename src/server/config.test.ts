import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readConfig, writeConfig, configPath } from './config.js';

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

  it('treats a missing description as absent (no error)', () => {
    write({});
    expect(readConfig(dir).description).toBeUndefined();
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

  it('treats a missing plugins field as absent', () => {
    write({});
    expect(readConfig(dir).plugins).toBeUndefined();
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

  it('treats missing path-scope fields as absent (no error)', () => {
    write({ claudeUsePreset: true });
    expect(readConfig(dir).agent?.allowedPaths).toBeUndefined();
    expect(readConfig(dir).agent?.disallowedPaths).toBeUndefined();
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
    expect(merged.agent).toEqual({ claudeUsePreset: false, allowedPaths: ['/extra'] });
  });
});
