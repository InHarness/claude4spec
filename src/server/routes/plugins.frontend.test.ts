/**
 * M33 / L11 (2.1.20) — plugin frontend delivery over HTTP:
 *   GET /api/plugins/frontend-manifest  → FrontendManifestResponse (server-filtered)
 *   GET /api/plugins/:name/:asset       → `.js` / `.css` / `.map` from the folder of
 *                                         the plugin's frontend entry, or
 *                                         404 PluginFrontendAssetError
 *
 * Three sources feed both routes: a project-local overlay (trust-gated), a
 * workspace npm package and a built-in envelope (both ungated). Fixtures are temp
 * folders; a workspace package's root is injected through `resolveWorkspaceRoot`
 * (the route's test seam) instead of touching the repo's `node_modules`.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import request from 'supertest';
import { pluginsRouter, type PluginRoutesDeps } from './plugins.js';
import { PluginRegistryImpl } from '../core/plugin-host/registry.js';
import { loadWorkspacePlugins, type PluginLoadRecord } from '../core/plugin-host/loader.js';
import type { BuiltinEnvelope } from '../core/plugin-host/builtin-envelopes.js';
import { buildImportMap } from '../core/plugin-host/runtime-shims.js';
import { HOST_API_VERSION } from '../../shared/plugin-host/manifest.js';
import { SHARED_PEER_SPECIFIERS } from '../../shared/plugin-host/frontend-manifest.js';

let tmp: string;
let cwd: string;
const roots = new Map<string, string>();

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-plugins-fe-'));
  cwd = path.join(tmp, 'project');
  fs.mkdirSync(cwd);
  roots.clear();
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeTree(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

/** A workspace npm package root, registered with the test resolver under `listed`. */
function npmPackage(listed: string, pkg: Record<string, unknown>, files: Record<string, string>): string {
  const dir = path.join(tmp, 'node_modules', listed.replace('/', '__'));
  writeTree(dir, { 'package.json': JSON.stringify({ name: listed, version: '1.0.0', ...pkg }), ...files });
  roots.set(listed, dir);
  return dir;
}

/** `<cwd>/.claude4spec/plugins/<folder>/`. */
function overlayPlugin(folder: string, version: string, files: Record<string, string>): string {
  const dir = path.join(cwd, '.claude4spec', 'plugins', folder);
  writeTree(dir, { 'package.json': JSON.stringify({ name: folder, version }), ...files });
  return dir;
}

/** A built-in envelope folder (`name` = its directory = its load-record id). */
function envelope(dirName: string, pkg: Record<string, unknown>, files: Record<string, string>): BuiltinEnvelope {
  const dir = path.join(tmp, 'plugins', dirName);
  writeTree(dir, { 'package.json': JSON.stringify({ name: dirName, version: '1.0.0', ...pkg }), ...files });
  return { name: dirName, dir, specifier: pathToFileURL(path.join(dir, 'dist/index.js')).href };
}

const loaded = (pkg: string): PluginLoadRecord => ({ package: pkg, status: 'loaded', layer: 'base' });

interface AppOpts {
  records?: PluginLoadRecord[];
  workspacePackages?: string[];
  envelopes?: BuiltinEnvelope[];
  /** Overlay serving: `undefined` = workspace-only start. */
  overlay?: { trusted: boolean; loaded: string[] };
}

function makeApp(opts: AppOpts): express.Express {
  const deps: PluginRoutesDeps = {
    pluginRegistry: new PluginRegistryImpl(),
    pluginRecords: opts.records ?? [],
    workspacePackages: opts.workspacePackages ?? [],
    envelopes: opts.envelopes ?? [],
    resolveWorkspaceRoot: (n) => roots.get(n) ?? null,
    frontendServing: opts.overlay
      ? {
          cwd,
          isTrusted: () => opts.overlay!.trusted,
          overlayLoaded: async () => new Set(opts.overlay!.loaded),
        }
      : undefined,
  };
  const app = express();
  app.use('/api', pluginsRouter(deps));
  return app;
}

interface ManifestBody {
  hostApiVersion: string;
  importMap: Record<string, string>;
  plugins: Array<{ name: string; version: string; entry: string; css?: string }>;
}

async function manifest(app: express.Express): Promise<ManifestBody> {
  const res = await request(app).get('/api/plugins/frontend-manifest').expect(200);
  return res.body as ManifestBody;
}

describe('GET /api/plugins/frontend-manifest', () => {
  it('[entity:get-api-plugins-frontend-manifest] GET /api/plugins/frontend-manifest answers 200 with a FrontendManifestResponse JSON body', async () => {
    const res = await request(makeApp({})).get('/api/plugins/frontend-manifest');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(Object.keys(res.body).sort()).toEqual(['hostApiVersion', 'importMap', 'plugins']);
  });

  it('[entity:frontend-manifest-response] hostApiVersion: string, importMap: Record<string,string>, plugins: PluginFrontendEntry[] — and no top-level css[]', async () => {
    npmPackage('styled', {}, { 'dist/frontend.js': 'export {}', 'dist/frontend.css': '.x{}' });
    npmPackage('plain', { version: '2.0.0' }, { 'dist/frontend.js': 'export {}' });
    const body = await manifest(
      makeApp({ records: [loaded('styled'), loaded('plain')], workspacePackages: ['styled', 'plain'] }),
    );
    expect(typeof body.hostApiVersion).toBe('string');
    expect(body.hostApiVersion).toBe(HOST_API_VERSION);
    for (const [k, v] of Object.entries(body.importMap)) {
      expect(typeof k).toBe('string');
      expect(typeof v).toBe('string');
    }
    expect(body).not.toHaveProperty('css');
    expect(Array.isArray(body.plugins)).toBe(true);
    for (const p of body.plugins) {
      expect(typeof p.name).toBe('string');
      expect(typeof p.version).toBe('string');
      expect(typeof p.entry).toBe('string');
      if ('css' in p) expect(typeof p.css).toBe('string');
      // No per-plugin Host API version travels in the entry.
      expect(Object.keys(p).every((k) => ['name', 'version', 'entry', 'css'].includes(k))).toBe(true);
    }
    expect(body.plugins).toEqual([
      { name: 'styled', version: '1.0.0', entry: '/api/plugins/styled/frontend.js', css: '/api/plugins/styled/frontend.css' },
      { name: 'plain', version: '2.0.0', entry: '/api/plugins/plain/frontend.js' },
    ]);
  });

  it('[ac:ac-endpoint-manifestu-frontendu-option-b] plugins[] with entry + precompiled CSS URLs from the effective pool base ∪ overlay (base ungated, overlay gated), and an informational importMap of the peer shims and both runtime specifiers with no plugin entries', async () => {
    npmPackage('base-pkg', {}, { 'dist/frontend.js': 'export {}', 'dist/frontend.css': '.b{}' });
    overlayPlugin('local-pkg', '0.3.0', { 'dist/frontend.js': 'export {}', 'dist/frontend.css': '.l{}' });
    const opts = (trusted: boolean): AppOpts => ({
      records: [loaded('base-pkg')],
      workspacePackages: ['base-pkg'],
      overlay: { trusted, loaded: ['local-pkg'] },
    });

    // Trusted: base ∪ overlay.
    const trusted = await manifest(makeApp(opts(true)));
    expect(trusted.plugins).toEqual([
      { name: 'base-pkg', version: '1.0.0', entry: '/api/plugins/base-pkg/frontend.js', css: '/api/plugins/base-pkg/frontend.css' },
      { name: 'local-pkg', version: '0.3.0', entry: '/api/plugins/local-pkg/frontend.js', css: '/api/plugins/local-pkg/frontend.css' },
    ]);
    // Untrusted: the overlay is gated out, the base stays.
    const untrusted = await manifest(makeApp(opts(false)));
    expect(untrusted.plugins.map((p) => p.name)).toEqual(['base-pkg']);

    // importMap: exactly the host's peer shims, incl. both runtime specifiers…
    expect(trusted.importMap).toEqual(buildImportMap());
    expect(Object.keys(trusted.importMap).sort()).toEqual([...SHARED_PEER_SPECIFIERS].sort());
    expect(trusted.importMap['@c4s/plugin-runtime']).toBe('/api/plugins/runtime/plugin-runtime.js');
    expect(trusted.importMap['@c4s/plugin-runtime/ui']).toMatch(/^\/api\/plugins\/runtime\/.+\.js$/);
    expect(trusted.importMap.react).toBe('/api/plugins/runtime/react.js');
    // …and no plugin entries: no key is a plugin name, every value is a runtime shim.
    for (const p of trusted.plugins) expect(trusted.importMap).not.toHaveProperty(p.name);
    for (const v of Object.values(trusted.importMap)) expect(v).toMatch(/^\/api\/plugins\/runtime\//);
  });

  it('[ac:ac-frontend-bundle-esm-dist-frontend-js] an npm package without exports[./frontend] has its entry at dist/frontend.js, served from its package folder WITHOUT the trustProjectPlugins gate, and — backend loaded — is in the manifest of every project of the process', async () => {
    const root = npmPackage('no-exports', { version: '4.5.6' }, { 'dist/frontend.js': 'export const FROM = "dist";' });
    expect(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))).not.toHaveProperty('exports');
    const base = { records: [loaded('no-exports')], workspacePackages: ['no-exports'] };
    const expected = { name: 'no-exports', version: '4.5.6', entry: '/api/plugins/no-exports/frontend.js' };

    // The manifest is process-global: the same entry with an untrusted primary
    // project, a trusted one, and on a workspace-only start (no project at all).
    for (const app of [
      makeApp({ ...base, overlay: { trusted: false, loaded: [] } }),
      makeApp({ ...base, overlay: { trusted: true, loaded: [] } }),
      makeApp(base),
    ]) {
      expect((await manifest(app)).plugins).toEqual([expected]);
    }

    // Served ungated (the primary project has NOT trusted project plugins).
    const res = await request(makeApp({ ...base, overlay: { trusted: false, loaded: [] } }))
      .get('/api/plugins/no-exports/frontend.js')
      .expect(200);
    expect(res.text).toBe('export const FROM = "dist";');
  });

  it('[ac:ac-frontend-pluginu-ktorego-backend-ma-s] a plugin whose backend is incompatible, failed or skipped is not in plugins[] (npm package and overlay alike)', async () => {
    for (const n of ['ok', 'incompat', 'broken', 'skipped']) npmPackage(n, {}, { 'dist/frontend.js': 'export {}' });
    overlayPlugin('local-ok', '1.0.0', { 'dist/frontend.js': 'export {}' });
    overlayPlugin('local-failed', '1.0.0', { 'dist/frontend.js': 'export {}' });
    const app = makeApp({
      records: [
        loaded('ok'),
        { package: 'incompat', status: 'incompatible', code: 'PLUGIN_HOST_API_MISMATCH' },
        { package: 'broken', status: 'failed', code: 'PLUGIN_IMPORT_FAILED' },
        { package: 'skipped', status: 'skipped', code: 'PLUGIN_ENGINE_UNSATISFIED' },
      ],
      workspacePackages: ['ok', 'incompat', 'broken', 'skipped'],
      // `local-failed` has no `loaded` overlay record.
      overlay: { trusted: true, loaded: ['local-ok'] },
    });
    const names = (await manifest(app)).plugins.map((p) => p.name).sort();
    expect(names).toEqual(['local-ok', 'ok']);
    for (const n of ['incompat', 'broken', 'skipped', 'local-failed']) {
      expect(names).not.toContain(n);
    }
  });

  it('[ac:ac-pakiet-npm-bez-wejscia-backendowego-n] an npm package without a backend entry is not in plugins[]', async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      // A frontend-only package: `exports` declares only `./frontend`, no backend file.
      npmPackage('frontend-only', { exports: { './frontend': './dist/frontend.js' } }, { 'dist/frontend.js': 'export {}' });
      // A control package with a backend entry exporting a valid PluginManifest.
      npmPackage('full', { exports: { '.': './dist/index.mjs', './frontend': './dist/frontend.js' } }, {
        'dist/frontend.js': 'export {}',
        'dist/index.mjs': `export const manifest = { name: 'full', version: '1.0.0', hostApiVersion: '^${HOST_API_VERSION}', contributes: {} };`,
      });
      // The real loader, importing each package's backend entry from its folder.
      const registry = new PluginRegistryImpl();
      const { records } = await loadWorkspacePlugins(registry, ['frontend-only', 'full'], (spec) =>
        import(/* @vite-ignore */ pathToFileURL(path.join(roots.get(spec)!, 'dist', 'index.mjs')).href),
      );
      expect(records.find((r) => r.package === 'frontend-only')?.status).toBe('failed');
      expect(records.find((r) => r.package === 'full')?.status).toBe('loaded');

      const app = makeApp({ records, workspacePackages: ['frontend-only', 'full'] });
      expect((await manifest(app)).plugins.map((p) => p.name)).toEqual(['full']);
    } finally {
      console.warn = warn;
    }
  });

  it('[ac:ac-przy-kolizji-nazwy-pluginu-manifest-f] on a name collision the manifest announces the entry from the project-local overlay, not from the npm package', async () => {
    npmPackage('glossary', { version: '1.0.0' }, { 'dist/frontend.js': 'export const FROM = "npm";' });
    overlayPlugin('glossary', '9.9.9', { 'dist/frontend.js': 'export const FROM = "overlay";' });
    const app = makeApp({
      records: [loaded('glossary')],
      workspacePackages: ['glossary'],
      overlay: { trusted: true, loaded: ['glossary'] },
    });
    const { plugins } = await manifest(app);
    expect(plugins).toEqual([{ name: 'glossary', version: '9.9.9', entry: '/api/plugins/glossary/frontend.js' }]);
    // The asset route serves the same source the manifest announced.
    expect((await request(app).get(plugins[0]!.entry).expect(200)).text).toBe('export const FROM = "overlay";');
  });

  it('[ac:ac-przy-kolizji-nazwy-pluginu-manifest-f-2] on a name collision the manifest announces the entry from the npm package, not from the built-in envelope', async () => {
    const env = envelope('c4s-plugin-tables', { name: '@acme/tables', version: '0.1.0' }, {
      'dist/frontend.js': 'export const FROM = "envelope";',
    });
    npmPackage('@acme/tables', { version: '2.0.0' }, { 'dist/frontend.js': 'export const FROM = "npm";' });
    const app = makeApp({
      records: [loaded('c4s-plugin-tables'), loaded('@acme/tables')],
      workspacePackages: ['@acme/tables'],
      envelopes: [env],
    });
    const { plugins } = await manifest(app);
    expect(plugins).toEqual([
      { name: '@acme/tables', version: '2.0.0', entry: `/api/plugins/${encodeURIComponent('@acme/tables')}/frontend.js` },
    ]);
    expect((await request(app).get(plugins[0]!.entry).expect(200)).text).toBe('export const FROM = "npm";');
  });

  it('[ac:ac-plugin-bandlujacy-wlasna-kopie-reacta-ti] a plugin whose frontend bundles its own React and Tiptap copy is announced and served like any other — the host does not detect the bundled copy at load', async () => {
    // What a build without `external` peers emits: React's and Tiptap's own code inlined.
    const bundled = [
      '/** @license React react.production.min.js */',
      'var ReactSharedInternals = { ReactCurrentDispatcher: { current: null } };',
      'function useState(i) { return ReactSharedInternals.ReactCurrentDispatcher.current.useState(i); }',
      '// node_modules/@tiptap/core/dist/index.js',
      'class Editor { constructor() { this.schema = null; } }',
      'export { useState, Editor };',
    ].join('\n');
    npmPackage('bundles-react', {}, { 'dist/frontend.js': bundled });
    const app = makeApp({ records: [loaded('bundles-react')], workspacePackages: ['bundles-react'] });

    expect((await manifest(app)).plugins.map((p) => p.name)).toEqual(['bundles-react']);
    const res = await request(app).get('/api/plugins/bundles-react/frontend.js').expect(200);
    expect(res.text).toBe(bundled);
  });
});

describe('GET /api/plugins/:name/:asset', () => {
  it('[entity:get-api-plugins-name-asset] GET /api/plugins/:name/:asset answers 200 with the raw file, its Content-Type, nosniff and no Cache-Control; a scoped name is one encoded segment', async () => {
    npmPackage('@scope/pkg', {}, {
      'dist/frontend.js': 'export const a = 1;',
      'dist/frontend.css': '.a{color:red}',
      'dist/frontend.js.map': '{"version":3}',
    });
    const app = makeApp({ records: [loaded('@scope/pkg')], workspacePackages: ['@scope/pkg'] });
    const seg = encodeURIComponent('@scope/pkg');
    const cases: Array<[string, RegExp, string]> = [
      ['frontend.js', /^text\/javascript/, 'export const a = 1;'],
      ['frontend.css', /^text\/css/, '.a{color:red}'],
      ['frontend.js.map', /^application\/json/, '{"version":3}'],
    ];
    for (const [asset, type, body] of cases) {
      const res = await request(app).get(`/api/plugins/${seg}/${asset}`).buffer(true).parse((r, cb) => {
        let data = '';
        r.setEncoding('utf8');
        r.on('data', (c: string) => (data += c));
        r.on('end', () => cb(null, data));
      });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(type);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBeUndefined();
      expect(res.body).toBe(body);
    }
  });

  it('[ac:ac-route-api-plugins-name-frontend-js-cs] serves .js, .css and .map files from the frontend entry folder of a plugin admitted in any of the three sources: overlay, npm package, built-in envelope', async () => {
    const files = (tag: string) => ({
      'dist/frontend.js': `export const FROM = "${tag}";`,
      'dist/frontend.css': `.${tag}{}`,
      'dist/frontend.js.map': `{"file":"${tag}"}`,
      'dist/chunk-1.js': `export const CHUNK = "${tag}";`,
    });
    overlayPlugin('from-overlay', '1.0.0', files('overlay'));
    npmPackage('from-npm', {}, files('npm'));
    const env = envelope('from-envelope', {}, files('envelope'));
    const app = makeApp({
      records: [loaded('from-npm'), loaded('from-envelope')],
      workspacePackages: ['from-npm'],
      envelopes: [env],
      overlay: { trusted: true, loaded: ['from-overlay'] },
    });
    for (const [name, tag] of [['from-overlay', 'overlay'], ['from-npm', 'npm'], ['from-envelope', 'envelope']]) {
      expect((await request(app).get(`/api/plugins/${name}/frontend.js`).expect(200)).text).toBe(`export const FROM = "${tag}";`);
      expect((await request(app).get(`/api/plugins/${name}/chunk-1.js`).expect(200)).text).toBe(`export const CHUNK = "${tag}";`);
      expect((await request(app).get(`/api/plugins/${name}/frontend.css`).expect(200)).text).toBe(`.${tag}{}`);
      const map = await request(app).get(`/api/plugins/${name}/frontend.js.map`).expect(200);
      expect(map.headers['content-type']).toMatch(/^application\/json/);
      expect(map.body).toEqual({ file: tag });
    }
    // The overlay is admitted only behind the trust gate.
    const untrusted = makeApp({ overlay: { trusted: false, loaded: ['from-overlay'] } });
    await request(untrusted).get('/api/plugins/from-overlay/frontend.js').expect(404);
  });

  it('[ac:ac-route-assetow-pluginu-serwuje-jako-we] the asset route serves as a package\'s frontend entry the file exports[./frontend] names in its package.json, not dist/frontend.js', async () => {
    npmPackage('declares', { exports: { '.': './dist/index.js', './frontend': { import: './out/client.js' } } }, {
      'out/client.js': 'export const FROM = "exports";',
      'out/frontend.css': '.c{}',
      'dist/frontend.js': 'export const FROM = "dist";',
    });
    const app = makeApp({ records: [loaded('declares')], workspacePackages: ['declares'] });
    const { plugins } = await manifest(app);
    expect(plugins).toEqual([
      { name: 'declares', version: '1.0.0', entry: '/api/plugins/declares/client.js', css: '/api/plugins/declares/frontend.css' },
    ]);
    expect((await request(app).get(plugins[0]!.entry).expect(200)).text).toBe('export const FROM = "exports";');
    // dist/frontend.js is not the entry folder: it is not served.
    const res = await request(app).get('/api/plugins/declares/frontend.js').expect(404);
    expect(res.body.error.code).toBe('PLUGIN_FRONTEND_NOT_FOUND');
  });

  it('[ac:ac-zadanie-route-u-assetow-pluginu-o-pli] a request for a file with an extension outside .js, .css and .map gets 404 with code PLUGIN_FRONTEND_NOT_FOUND', async () => {
    npmPackage('pkg', {}, {
      'dist/frontend.js': 'export {}',
      'dist/meta.json': '{}',
      'dist/index.html': '<html></html>',
      'dist/source.ts': 'export {}',
      'dist/secret.env': 'K=V',
    });
    const app = makeApp({ records: [loaded('pkg')], workspacePackages: ['pkg'] });
    for (const asset of ['meta.json', 'index.html', 'source.ts', 'secret.env']) {
      const res = await request(app).get(`/api/plugins/pkg/${asset}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PLUGIN_FRONTEND_NOT_FOUND');
    }
    await request(app).get('/api/plugins/pkg/frontend.js').expect(200);
  });

  it('[entity:plugin-frontend-asset-error] every refusal is a 404 { error: { code: PLUGIN_FRONTEND_NOT_FOUND, message: string } } — extension, separator / .., untrusted overlay, missing file', async () => {
    npmPackage('pkg', {}, { 'dist/frontend.js': 'export {}', 'dist/meta.json': '{}' });
    overlayPlugin('local', '1.0.0', { 'dist/frontend.js': 'export {}' });
    const app = makeApp({
      records: [loaded('pkg')],
      workspacePackages: ['pkg'],
      overlay: { trusted: false, loaded: ['local'] },
    });
    const refusals = [
      '/api/plugins/pkg/meta.json', // extension
      `/api/plugins/pkg/${encodeURIComponent('../package.json.js')}`, // separator + ..
      `/api/plugins/pkg/${encodeURIComponent('sub\\x.js')}`, // separator
      '/api/plugins/pkg/..js', // ..
      '/api/plugins/local/frontend.js', // untrusted overlay
      '/api/plugins/pkg/absent.js', // missing file
      '/api/plugins/unknown/frontend.js', // unknown plugin
    ];
    for (const url of refusals) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(404);
      expect(Object.keys(res.body)).toEqual(['error']);
      expect(res.body.error.code).toBe('PLUGIN_FRONTEND_NOT_FOUND');
      expect(typeof res.body.error.message).toBe('string');
    }
  });
});
