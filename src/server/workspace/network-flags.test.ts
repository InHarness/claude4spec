import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry } from './registry.js';
import { applyNetworkFlags, InvalidPublicUrlError, noAuthWarning } from './network-flags.js';
import {
  effectiveBindHost,
  effectivePublicUrl,
  localServerUrl,
  validatePublicUrl,
} from '../../core/workspace/network.js';

describe('workspace network attributes — which address serves whom', () => {
  it('publicUrl defaults to http://localhost:<defaultPort>', () => {
    expect(effectivePublicUrl({ defaultPort: 4600 })).toBe('http://localhost:4600');
    expect(effectivePublicUrl({ defaultPort: 4600, publicUrl: 'https://c4s.firma.dev/' })).toBe('https://c4s.firma.dev');
  });

  it('bindHost defaults to loopback', () => {
    expect(effectiveBindHost({ defaultPort: 4500 })).toBe('127.0.0.1');
    expect(effectiveBindHost({ defaultPort: 4500, bindHost: '0.0.0.0' })).toBe('0.0.0.0');
  });

  it('the LOCAL address is loopback or a concrete bindHost — never publicUrl, never a wildcard', () => {
    const pub = 'https://c4s.firma.dev';
    expect(localServerUrl({ defaultPort: 4500, publicUrl: pub })).toBe('http://localhost:4500');
    expect(localServerUrl({ defaultPort: 4500, bindHost: '0.0.0.0', publicUrl: pub })).toBe('http://localhost:4500');
    expect(localServerUrl({ defaultPort: 4500, bindHost: '::' })).toBe('http://localhost:4500');
    expect(localServerUrl({ defaultPort: 4500, bindHost: '10.0.0.5' })).toBe('http://10.0.0.5:4500');
    expect(localServerUrl({ defaultPort: 4500, bindHost: 'fd00::5' })).toBe('http://[fd00::5]:4500');
  });

  it('--public-url must be an absolute http(s) URL without a path', () => {
    expect(validatePublicUrl('https://c4s.firma.dev')).toEqual({ ok: true, origin: 'https://c4s.firma.dev' });
    expect(validatePublicUrl('http://10.0.0.5:4500/')).toEqual({ ok: true, origin: 'http://10.0.0.5:4500' });
    for (const bad of ['c4s.firma.dev', 'ftp://c4s.firma.dev', 'https://c4s.firma.dev/spec', 'https://x.dev/?a=1', '/rel']) {
      expect(validatePublicUrl(bad).ok, bad).toBe(false);
    }
  });
});

describe('applyNetworkFlags — --host / --public-url persist on the workspace', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-netflags-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('writes bindHost/publicUrl into the registry (not config.json), overwriting on each start', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'team' });
    applyNetworkFlags(registry, ws, { host: '0.0.0.0', publicUrl: 'https://c4s.firma.dev/' });
    expect(registry.getWorkspace('team')).toMatchObject({ bindHost: '0.0.0.0', publicUrl: 'https://c4s.firma.dev' });

    applyNetworkFlags(registry, registry.getWorkspace('team')!, { publicUrl: 'https://other.dev' });
    expect(registry.getWorkspace('team')).toMatchObject({ bindHost: '0.0.0.0', publicUrl: 'https://other.dev' });
  });

  it('an empty value (--host= / --public-url=) restores the default', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'team' });
    applyNetworkFlags(registry, ws, { host: '0.0.0.0', publicUrl: 'https://c4s.firma.dev' });
    const reset = applyNetworkFlags(registry, registry.getWorkspace('team')!, { host: '', publicUrl: '' });
    expect(reset.bindHost).toBeUndefined();
    expect(reset.publicUrl).toBeUndefined();
    expect(effectivePublicUrl(reset)).toBe(`http://localhost:${reset.defaultPort}`);
  });

  it('an invalid --public-url refuses the start and writes nothing', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'team' });
    const before = fs.readFileSync(registry.filePath, 'utf8');
    expect(() => applyNetworkFlags(registry, ws, { host: '0.0.0.0', publicUrl: 'https://c4s.firma.dev/app' })).toThrow(
      InvalidPublicUrlError,
    );
    expect(fs.readFileSync(registry.filePath, 'utf8')).toBe(before);
  });

  it('no flags → nothing written', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'team' });
    const before = fs.readFileSync(registry.filePath, 'utf8');
    applyNetworkFlags(registry, ws, {});
    expect(fs.readFileSync(registry.filePath, 'utf8')).toBe(before);
  });
});

describe('noAuthWarning — on every start beyond loopback', () => {
  it('warns for a non-loopback bindHost, stays silent on loopback', () => {
    expect(noAuthWarning({ defaultPort: 4500 })).toBeNull();
    expect(noAuthWarning({ defaultPort: 4500, bindHost: '127.0.0.1' })).toBeNull();
    expect(noAuthWarning({ defaultPort: 4500, bindHost: 'localhost' })).toBeNull();
    const warning = noAuthWarning({ defaultPort: 4500, bindHost: '0.0.0.0' });
    expect(warning).toContain('does NOT authenticate');
    expect(warning).toContain('0.0.0.0:4500');
  });
});
