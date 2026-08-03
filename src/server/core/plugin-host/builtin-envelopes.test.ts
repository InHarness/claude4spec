import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../../tests/helpers/fixture-module.js';
/**
 * 0.2.2 (brief item 10) — tier (b), built-in envelopes.
 *
 * The repo carries no envelope yet (`c4s-plugin-api-contracts` lands in Tier B),
 * so these tests drive the discovery + load pipeline against a temp-dir fixture
 * shaped exactly like a `c4s create-plugin` output. That parity is the point of
 * the tier: what these tests exercise must keep working unchanged when the
 * envelope is later `git mv`d into its own repository.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverBuiltinEnvelopes, hostPackageRoot, servableEnvelopes } from './builtin-envelopes.js';
import { loadBuiltinEnvelopes } from './loader.js';
import { PluginRegistryImpl } from './registry.js';
import type { EntityContribution, PluginManifest } from '../../../shared/plugin-host/manifest.js';

let root: string;

function writeEnvelope(
  name: string,
  opts: { pkg?: Record<string, unknown>; entry?: string; entryPath?: string } = {},
): string {
  const dir = path.join(root, 'plugins', name);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(opts.pkg ?? { name, version: '1.0.0', type: 'module', main: 'src/index.js' }),
  );
  if (opts.entry !== undefined) {
    const rel = opts.entryPath ?? 'src/index.js';
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), opts.entry);
  }
  return dir;
}

function entity(type: string): EntityContribution {
  return {
    type,
    data: FIXTURE_DATA,
    slugPattern: FIXTURE_SLUG_PATTERN,
    payloadVersion: 1,
    label: type,
    labelPlural: `${type}s`,
    displayOrder: 10,
    pathPrefix: `/${type}s`,
    serializer: { type, version: '1.0.0' },
    systemPrompt: {
      roleNoun: type,
      countStat: { placeholder: `${type}Count`, sqlQuery: 'SELECT 0 AS count', label: type },
    },
  };
}

function manifest(over: Partial<PluginManifest> = {}): PluginManifest {
  return {
    name: 'c4s-plugin-api-contracts',
    version: '1.0.0',
    hostApiVersion: '^2.0.0',
    onUnregister: () => {},
    contributes: { entities: [entity('endpoint'), entity('dto')] },
    ...over,
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-envelopes-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'host' }));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('discoverBuiltinEnvelopes', () => {
  it('returns [] when the host repo has no plugins/ directory — the state until Tier B', () => {
    expect(discoverBuiltinEnvelopes(root)).toEqual([]);
  });

  it('discovers a create-plugin-shaped package and resolves its entry from package.json main', () => {
    writeEnvelope('c4s-plugin-api-contracts', { entry: 'export const manifest = {};' });
    const found = discoverBuiltinEnvelopes(root);
    expect(found).toHaveLength(1);
    expect(found[0]!.name).toBe('c4s-plugin-api-contracts');
    expect(found[0]!.specifier).toMatch(/^file:\/\/.*src\/index\.js$/);
  });

  it('honours an exports["."].import condition over main', () => {
    writeEnvelope('envelope-exports', {
      pkg: {
        name: 'envelope-exports',
        type: 'module',
        main: 'src/wrong.js',
        exports: { '.': { import: './src/entry.js' } },
      },
      entry: 'export const manifest = {};',
      entryPath: 'src/entry.js',
    });
    expect(discoverBuiltinEnvelopes(root)[0]!.specifier).toMatch(/src\/entry\.js$/);
  });

  it('prefers a specific `node` condition over `default` (Node precedence)', () => {
    // Regression: trying `default` before `node` resolved a server-side envelope
    // to its BROWSER bundle, which then fails to import or exports no manifest —
    // so the envelope's types silently never register.
    writeEnvelope('envelope-node-cond', {
      pkg: {
        name: 'envelope-node-cond',
        type: 'module',
        exports: { '.': { node: './dist/server.js', default: './dist/browser.js' } },
      },
      entry: 'export const manifest = {};',
      entryPath: 'dist/server.js',
    });
    fs.writeFileSync(
      path.join(root, 'plugins', 'envelope-node-cond', 'dist', 'browser.js'),
      'export const manifest = {};',
    );
    expect(discoverBuiltinEnvelopes(root)[0]!.specifier).toMatch(/dist\/server\.js$/);
  });

  it('falls back to `default` when no specific condition matches', () => {
    writeEnvelope('envelope-default-only', {
      pkg: {
        name: 'envelope-default-only',
        type: 'module',
        exports: { '.': { default: './dist/only.js' } },
      },
      entry: 'export const manifest = {};',
      entryPath: 'dist/only.js',
    });
    expect(discoverBuiltinEnvelopes(root)[0]!.specifier).toMatch(/dist\/only\.js$/);
  });

  it('sorts by directory name so registration order is deterministic', () => {
    writeEnvelope('b-envelope', { entry: 'export const manifest = {};' });
    writeEnvelope('a-envelope', { entry: 'export const manifest = {};' });
    expect(discoverBuiltinEnvelopes(root).map((e) => e.name)).toEqual(['a-envelope', 'b-envelope']);
  });

  it('skips a directory with no resolvable entry instead of throwing', () => {
    writeEnvelope('broken', {}); // package.json, but no src/index.js
    writeEnvelope('good', { entry: 'export const manifest = {};' });
    expect(discoverBuiltinEnvelopes(root).map((e) => e.name)).toEqual(['good']);
  });

  it('ignores dotfiles and plain files under plugins/', () => {
    fs.mkdirSync(path.join(root, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(root, 'plugins', 'README.md'), '#');
    fs.mkdirSync(path.join(root, 'plugins', '.cache'));
    expect(discoverBuiltinEnvelopes(root)).toEqual([]);
  });
});

describe('hostPackageRoot', () => {
  it('walks up to the NEAREST directory containing a package.json', () => {
    const deep = path.join(root, 'a', 'b', 'c');
    fs.mkdirSync(deep, { recursive: true });
    expect(hostPackageRoot(deep)).toBe(root);
  });

  it('stops at the nearest one, not the outermost', () => {
    const inner = path.join(root, 'a', 'b');
    fs.mkdirSync(inner, { recursive: true });
    fs.writeFileSync(path.join(inner, 'package.json'), '{}');
    expect(hostPackageRoot(path.join(inner, 'c'))).toBe(inner);
  });

  it('resolves the real host package from this module — dev (src/) and dist/ alike', () => {
    // Not hardcoded to a path: the contract is only that it finds A package root
    // holding the host's own package.json, which is what makes `plugins/` resolvable
    // identically whether the server runs from src/ or from an installed dist/.
    const found = hostPackageRoot();
    expect(found).not.toBeNull();
    expect(fs.existsSync(path.join(found!, 'package.json'))).toBe(true);
  });
});

describe('loadBuiltinEnvelopes', () => {
  it('registers a discovered envelope through the ordinary loader pipeline', async () => {
    writeEnvelope('c4s-plugin-api-contracts', { entry: '' });
    const registry = new PluginRegistryImpl();
    const result = await loadBuiltinEnvelopes(registry, async () => ({ manifest: manifest() }), root);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]!.status).toBe('loaded');
    // The record is labelled by DIRECTORY NAME, not the file:// specifier it was
    // imported by — a `file://…/src/index.js` string in the diagnostics route
    // would be unreadable and would leak the developer's absolute paths.
    expect(result.records[0]!.package).toBe('c4s-plugin-api-contracts');
    expect(result.records[0]!.contributedTypes).toEqual(['endpoint', 'dto']);
    expect(registry.getAvailable('endpoint')).not.toBeNull();
    expect(registry.getAvailable('dto')).not.toBeNull();
  });

  it('carries endpoint and dto in ONE envelope — they are structurally coupled', async () => {
    // The brief is explicit that splitting them would push the endpoint_dto join
    // back onto the host, which is exactly what the envelope exists to prevent.
    writeEnvelope('c4s-plugin-api-contracts', { entry: '' });
    const registry = new PluginRegistryImpl();
    await loadBuiltinEnvelopes(registry, async () => ({ manifest: manifest() }), root);
    const records = registry.listPluginRecords();
    expect(records).toHaveLength(1);
    expect(records[0]!.contributedTypes.sort()).toEqual(['dto', 'endpoint']);
  });

  it('applies the host-API version gate, same as an external package', async () => {
    writeEnvelope('stale-envelope', { entry: '' });
    const registry = new PluginRegistryImpl();
    const result = await loadBuiltinEnvelopes(
      registry,
      async () => ({ manifest: manifest({ hostApiVersion: '^99.0.0' }) }),
      root,
    );
    expect(result.records[0]!.status).toBe('incompatible');
    expect(result.records[0]!.code).toBe('PLUGIN_HOST_API_MISMATCH');
    expect(registry.getAvailable('endpoint')).toBeNull();
  });

  it('isolates a throwing envelope — the process survives and the record says why', async () => {
    writeEnvelope('boom', { entry: '' });
    const registry = new PluginRegistryImpl();
    const result = await loadBuiltinEnvelopes(
      registry,
      async () => {
        throw new Error('kaboom');
      },
      root,
    );
    expect(result.records[0]!.status).toBe('failed');
    expect(result.records[0]!.code).toBe('PLUGIN_IMPORT_FAILED');
    expect(result.records[0]!.reason).toContain('kaboom');
  });

  it('is a no-op with no records when there are no envelopes', async () => {
    const registry = new PluginRegistryImpl();
    expect(await loadBuiltinEnvelopes(registry, async () => ({}), root)).toEqual({ records: [] });
  });
});

/**
 * An envelope that failed to load must not have its frontend served.
 *
 * The two decisions — "register the backend" and "serve the browser bundle" —
 * were made from different facts: the first from the load result, the second
 * from disk. Since the loader is fail-soft by design, that gap is reachable
 * (a bad chunk, a `module.register` hook that cannot install on node <20.6), and
 * what it produces is worse than the absence it was meant to degrade into: the
 * type's sidebar tab and routes mount, and every request behind them 404s.
 */
describe('servableEnvelopes', () => {
  const env = (name: string) => ({ name, dir: `/x/${name}`, specifier: `file:///x/${name}` });

  it('drops an envelope whose backend did not load', () => {
    const discovered = [env('good'), env('broken')];
    const records = [
      { package: 'good', status: 'loaded' },
      { package: 'broken', status: 'failed' },
    ];
    expect(servableEnvelopes(discovered, records).map((e) => e.name)).toEqual(['good']);
  });

  it('drops an envelope with no load record at all', () => {
    expect(servableEnvelopes([env('ghost')], [])).toEqual([]);
  });

  it('keeps the ones that loaded', () => {
    const discovered = [env('a'), env('b')];
    const records = [
      { package: 'a', status: 'loaded' },
      { package: 'b', status: 'loaded' },
    ];
    expect(servableEnvelopes(discovered, records)).toEqual(discovered);
  });
});
