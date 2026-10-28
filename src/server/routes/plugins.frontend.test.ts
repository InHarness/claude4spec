/**
 * M33 / L11 (2.1.22) — plugin frontend delivery over HTTP, one address per tier:
 *   GET /api/projects/:id/plugins/frontend-manifest → the project's FrontendManifestResponse
 *                                                    (base ∪ this project's overlay)
 *   GET /api/plugins/:name/:asset                   → BASE tier only (npm package,
 *                                                    built-in envelope), ungated
 *   GET /api/projects/:id/plugins/:name/:asset      → this project's OVERLAY only,
 *                                                    behind the live trust flag
 * Both asset routes answer 404 PluginFrontendAssetError on any refusal and
 * revalidate under a fixed address (`Cache-Control: no-cache`, content `ETag`, 304).
 *
 * The routers are composed here the way the server composes them: the
 * process-global `pluginsRouter` at `/api`, and one `projectPluginsFrontendRouter`
 * per project under `/api/projects/<id>` (on a real server the per-context router,
 * behind the M31 dispatch — `tests/integration/api/plugins-frontend-per-project.test.ts`).
 * Fixtures are temp folders; a workspace package's root is injected through
 * `resolveWorkspaceRoot` instead of touching the repo's `node_modules`.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';
import request from 'supertest';
import { pluginsRouter } from './plugins.js';
import { projectPluginsFrontendRouter } from './plugins-project.js';
import { PluginRegistryImpl } from '../core/plugin-host/registry.js';
import { loadWorkspacePlugins, type PluginLoadRecord } from '../core/plugin-host/loader.js';
import type { BuiltinEnvelope } from '../core/plugin-host/builtin-envelopes.js';
import { buildImportMap } from '../core/plugin-host/runtime-shims.js';
import { HOST_API_VERSION } from '../../shared/plugin-host/manifest.js';
import { SHARED_PEER_SPECIFIERS } from '../../shared/plugin-host/frontend-manifest.js';

let tmp: string;
/** Project `p1`'s directory (the default project of `makeApp`). */
let cwd: string;
/** Project `p2`'s directory. */
let cwdB: string;
const roots = new Map<string, string>();

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-plugins-fe-'));
  cwd = path.join(tmp, 'project');
  cwdB = path.join(tmp, 'project-b');
  fs.mkdirSync(cwd);
  fs.mkdirSync(cwdB);
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

/** `<projectCwd>/.claude4spec/plugins/<folder>/` (default: project `p1`). */
function overlayPlugin(folder: string, version: string, files: Record<string, string>, projectCwd = cwd): string {
  const dir = path.join(projectCwd, '.claude4spec', 'plugins', folder);
  writeTree(dir, { 'package.json': JSON.stringify({ name: folder, version }), ...files });
  return dir;
}

/** A built-in envelope folder (`name` = its directory = its load-record id). */
function envelope(dirName: string, pkg: Record<string, unknown>, files: Record<string, string>): BuiltinEnvelope {
  const dir = path.join(tmp, 'plugins', dirName);
  writeTree(dir, { 'package.json': JSON.stringify({ name: dirName, version: '1.0.0', ...pkg }), ...files });
  return { name: dirName, dir, specifier: pathToFileURL(path.join(dir, 'dist/index.js')).href };
}

const loaded = (pkg: string, contributedTypes?: string[]): PluginLoadRecord => ({
  package: pkg,
  status: 'loaded',
  layer: 'base',
  ...(contributedTypes ? { contributedTypes } : {}),
});

interface ProjectOpts {
  id: string;
  cwd: string;
  /** The live `trustProjectPlugins` flag of (workspace × project). */
  trusted: boolean | (() => boolean);
  /** Overlay folders whose backend is `loaded` in the project's context instance. */
  loaded: string[];
  /** Entity types each loaded overlay folder contributed (default: none). */
  overlayTypes?: Record<string, string[]>;
  /** The project's active entity types (`config.entities`); absent ⇒ every type active. */
  activeTypes?: string[];
}

interface AppOpts {
  records?: PluginLoadRecord[];
  workspacePackages?: string[];
  envelopes?: BuiltinEnvelope[];
  /** Shorthand for project `p1` (directory `cwd`). Default: untrusted, nothing loaded. */
  overlay?: { trusted: boolean | (() => boolean); loaded: string[]; types?: Record<string, string[]> };
  /** Project `p1`'s active entity types (`config.entities`); absent ⇒ every type active. */
  activeTypes?: string[];
  /** Further projects of the same process. */
  projects?: ProjectOpts[];
}

function makeApp(opts: AppOpts): express.Express {
  const base = {
    pluginRecords: opts.records ?? [],
    workspacePackages: opts.workspacePackages ?? [],
    envelopes: opts.envelopes ?? [],
    resolveWorkspaceRoot: (n: string) => roots.get(n) ?? null,
  };
  const app = express();
  app.use('/api', pluginsRouter({ pluginRegistry: new PluginRegistryImpl(), ...base }));
  const projects: ProjectOpts[] = [
    {
      id: 'p1',
      cwd,
      trusted: opts.overlay?.trusted ?? false,
      loaded: opts.overlay?.loaded ?? [],
      overlayTypes: opts.overlay?.types,
      activeTypes: opts.activeTypes,
    },
    ...(opts.projects ?? []),
  ];
  for (const p of projects) {
    const trusted = p.trusted;
    const active = p.activeTypes;
    app.use(
      `/api/projects/${p.id}`,
      projectPluginsFrontendRouter({
        projectId: p.id,
        cwd: p.cwd,
        isTrusted: typeof trusted === 'function' ? trusted : () => trusted,
        overlayRecords: p.loaded.map((folder) => ({
          package: folder,
          status: 'loaded',
          contributedTypes: p.overlayTypes?.[folder] ?? [],
        })),
        base,
        isTypeActive: active ? (type) => active.includes(type) : () => true,
      }),
    );
  }
  return app;
}

interface ManifestBody {
  hostApiVersion: string;
  importMap: Record<string, string>;
  plugins: Array<{ name: string; version: string; entry: string; css?: string }>;
}

async function manifest(app: express.Express, projectId = 'p1'): Promise<ManifestBody> {
  const res = await request(app).get(`/api/projects/${projectId}/plugins/frontend-manifest`).expect(200);
  return res.body as ManifestBody;
}

/** GET with the body kept as raw text whatever its content type. */
function getRaw(app: express.Express, url: string, headers: Record<string, string> = {}) {
  let req = request(app).get(url);
  for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
  return req.buffer(true).parse((r, cb) => {
    let data = '';
    r.setEncoding('utf8');
    r.on('data', (c: string) => (data += c));
    r.on('end', () => cb(null, data));
  });
}

async function expectRefused(app: express.Express, url: string): Promise<void> {
  const res = await request(app).get(url);
  expect(res.status, url).toBe(404);
  expect(Object.keys(res.body), url).toEqual(['error']);
  expect(res.body.error.code, url).toBe('PLUGIN_FRONTEND_NOT_FOUND');
  expect(typeof res.body.error.message, url).toBe('string');
}

describe('GET /api/projects/:id/plugins/frontend-manifest', () => {
  it('[entity:get-api-plugins-frontend-manifest] GET /api/projects/:id/plugins/frontend-manifest answers 200 with a FrontendManifestResponse JSON body; without the project prefix the route does not exist', async () => {
    const app = makeApp({});
    const res = await request(app).get('/api/projects/p1/plugins/frontend-manifest');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(Object.keys(res.body).sort()).toEqual(['hostApiVersion', 'importMap', 'plugins']);
    // The process-global router no longer carries a manifest.
    const bare = await request(app).get('/api/plugins/frontend-manifest');
    expect(bare.status).toBe(404);
    expect(bare.body?.hostApiVersion).toBeUndefined();
  });

  it('[entity:get-api-plugins-frontend-manifest] the answer depends on no project but :id — the same body whichever other projects the process serves', async () => {
    npmPackage('base-pkg', {}, { 'dist/frontend.js': 'export {}' });
    overlayPlugin('local-a', '0.1.0', { 'dist/frontend.js': 'export {}' });
    overlayPlugin('local-b', '0.2.0', { 'dist/frontend.js': 'export {}' }, cwdB);
    const common = { records: [loaded('base-pkg')], workspacePackages: ['base-pkg'] };
    const p2: ProjectOpts = { id: 'p2', cwd: cwdB, trusted: true, loaded: ['local-b'] };

    const alone = await manifest(makeApp({ ...common, overlay: { trusted: true, loaded: ['local-a'] } }));
    const withPeer = makeApp({ ...common, overlay: { trusted: true, loaded: ['local-a'] }, projects: [p2] });
    expect(await manifest(withPeer, 'p1')).toEqual(alone);
    expect(alone.plugins.map((p) => p.entry)).toEqual([
      '/api/plugins/base-pkg/frontend.js',
      '/api/projects/p1/plugins/local-a/frontend.js',
    ]);
    // p2 gets its own overlay and the same base entry; nothing of p1 leaks in.
    const second = await manifest(withPeer, 'p2');
    expect(second.plugins.map((p) => p.entry)).toEqual([
      '/api/plugins/base-pkg/frontend.js',
      '/api/projects/p2/plugins/local-b/frontend.js',
    ]);
  });

  it('[entity:frontend-manifest-response] hostApiVersion: string, importMap: Record<string,string>, plugins: PluginFrontendEntry[] { name, version, entry, css? } — no top-level css[], no project identity field; base entries under /api/plugins/<name>/, overlay entries under /api/projects/<id>/plugins/<name>/, a scoped name one %2F-encoded segment', async () => {
    npmPackage('@acme/styled', {}, { 'dist/frontend.js': 'export {}', 'dist/frontend.css': '.x{}' });
    npmPackage('plain', { version: '2.0.0' }, { 'dist/frontend.js': 'export {}' });
    overlayPlugin('local', '0.3.0', { 'dist/frontend.js': 'export {}', 'dist/frontend.css': '.l{}' });
    const body = await manifest(
      makeApp({
        records: [loaded('@acme/styled'), loaded('plain')],
        workspacePackages: ['@acme/styled', 'plain'],
        overlay: { trusted: true, loaded: ['local'] },
      }),
    );
    expect(typeof body.hostApiVersion).toBe('string');
    expect(body.hostApiVersion).toBe(HOST_API_VERSION);
    for (const [k, v] of Object.entries(body.importMap)) {
      expect(typeof k).toBe('string');
      expect(typeof v).toBe('string');
    }
    expect(body).not.toHaveProperty('css');
    // The project appears only in the overlay entries' addresses.
    expect(Object.keys(body).sort()).toEqual(['hostApiVersion', 'importMap', 'plugins']);
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
      {
        name: '@acme/styled',
        version: '1.0.0',
        entry: '/api/plugins/@acme%2Fstyled/frontend.js',
        css: '/api/plugins/@acme%2Fstyled/frontend.css',
      },
      { name: 'plain', version: '2.0.0', entry: '/api/plugins/plain/frontend.js' },
      {
        name: 'local',
        version: '0.3.0',
        entry: '/api/projects/p1/plugins/local/frontend.js',
        css: '/api/projects/p1/plugins/local/frontend.css',
      },
    ]);
  });

  it('[ac:ac-endpoint-manifestu-frontendu-option-b] every plugins[] entry of a project manifest carries the absolute URL of the plugin\'s ESM entry module', async () => {
    npmPackage('base-pkg', {}, { 'dist/frontend.js': 'export const FROM = "base";' });
    const env = envelope('env-pkg', {}, { 'dist/frontend.js': 'export const FROM = "envelope";' });
    overlayPlugin('local-pkg', '0.3.0', { 'dist/frontend.js': 'export const FROM = "overlay";' });
    const app = makeApp({
      records: [loaded('base-pkg'), loaded('env-pkg')],
      workspacePackages: ['base-pkg'],
      envelopes: [env],
      overlay: { trusted: true, loaded: ['local-pkg'] },
    });
    const { plugins } = await manifest(app);
    expect(plugins.map((p) => p.name).sort()).toEqual(['base-pkg', 'env-pkg', 'local-pkg']);
    const expected: Record<string, string> = { 'base-pkg': 'base', 'env-pkg': 'envelope', 'local-pkg': 'overlay' };
    for (const p of plugins) {
      // Absolute: an origin-relative URL path, independent of the importing document's location.
      expect(p.entry.startsWith('/api/'), p.entry).toBe(true);
      expect(new URL(p.entry, 'http://host/some/deep/page').pathname).toBe(p.entry);
      // …of an ESM module: served as JavaScript, the plugin's own entry file.
      const res = await request(app).get(p.entry).expect(200);
      expect(res.headers['content-type']).toMatch(/^text\/javascript/);
      expect(res.text).toBe(`export const FROM = "${expected[p.name]}";`);
    }
  });

  it('[ac:ac-importmap-bez-wpisow-pluginow] the importMap of a project manifest has no plugin entries — no key is a plugin name, every value is a host runtime shim', async () => {
    npmPackage('base-pkg', {}, { 'dist/frontend.js': 'export {}' });
    overlayPlugin('local-pkg', '0.3.0', { 'dist/frontend.js': 'export {}' });
    const body = await manifest(
      makeApp({
        records: [loaded('base-pkg')],
        workspacePackages: ['base-pkg'],
        overlay: { trusted: true, loaded: ['local-pkg'] },
      }),
    );
    expect(body.plugins.map((p) => p.name)).toEqual(['base-pkg', 'local-pkg']);
    for (const p of body.plugins) {
      expect(body.importMap).not.toHaveProperty(p.name);
      expect(Object.values(body.importMap)).not.toContain(p.entry);
    }
    for (const v of Object.values(body.importMap)) expect(v).toMatch(/^\/api\/plugins\/runtime\//);
    for (const k of Object.keys(body.importMap)) expect(SHARED_PEER_SPECIFIERS as readonly string[]).toContain(k);
  });

  it('[ac:ac-importmap-shimy-peerow-i-runtime] the importMap of a project manifest holds the host\'s externalized-peer shims and both runtime specifiers', async () => {
    const body = await manifest(makeApp({}));
    expect(body.importMap).toEqual(buildImportMap());
    expect(Object.keys(body.importMap).sort()).toEqual([...SHARED_PEER_SPECIFIERS].sort());
    for (const peer of ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', '@tiptap/core', '@tanstack/react-query', '@tanstack/react-router']) {
      expect(body.importMap[peer], peer).toMatch(/^\/api\/plugins\/runtime\/.+\.js$/);
    }
    expect(body.importMap.react).toBe('/api/plugins/runtime/react.js');
    expect(body.importMap['@c4s/plugin-runtime']).toBe('/api/plugins/runtime/plugin-runtime.js');
    expect(body.importMap['@c4s/plugin-runtime/ui']).toMatch(/^\/api\/plugins\/runtime\/.+\.js$/);
  });

  it('[ac:ac-wpis-pluginu-niesie-url-frontend-css] a plugins[] entry of a plugin shipping precompiled CSS carries the URL of frontend.css from its entry folder (base and overlay); without one, no css', async () => {
    npmPackage('styled', { exports: { './frontend': './out/client.js' } }, { 'out/client.js': 'export {}', 'out/frontend.css': '.npm{}' });
    npmPackage('bare', {}, { 'dist/frontend.js': 'export {}' });
    overlayPlugin('local', '1.0.0', { 'dist/frontend.js': 'export {}', 'dist/frontend.css': '.overlay{}' });
    const app = makeApp({
      records: [loaded('styled'), loaded('bare')],
      workspacePackages: ['styled', 'bare'],
      overlay: { trusted: true, loaded: ['local'] },
    });
    const byName = new Map((await manifest(app)).plugins.map((p) => [p.name, p]));
    const styled = byName.get('styled')!;
    const local = byName.get('local')!;
    // `frontend.css` in the same URL folder as the entry, served from the entry's folder.
    expect(styled.css).toBe('/api/plugins/styled/frontend.css');
    expect(styled.css!.slice(0, styled.css!.lastIndexOf('/'))).toBe(styled.entry.slice(0, styled.entry.lastIndexOf('/')));
    expect(local.css).toBe('/api/projects/p1/plugins/local/frontend.css');
    expect(local.css!.slice(0, local.css!.lastIndexOf('/'))).toBe(local.entry.slice(0, local.entry.lastIndexOf('/')));
    for (const [url, css] of [[styled.css!, '.npm{}'], [local.css!, '.overlay{}']] as const) {
      const res = await request(app).get(url).expect(200);
      expect(res.headers['content-type']).toMatch(/^text\/css/);
      expect(res.text).toBe(css);
    }
    expect(byName.get('bare')).not.toHaveProperty('css');
  });

  it('[ac:ac-wpis-bazowy-ten-sam-entry-w-projektach] a base-tier plugin entry has the same entry address in the manifests of all projects of the process', async () => {
    npmPackage('@acme/glossary', {}, { 'dist/frontend.js': 'export {}', 'dist/frontend.css': '.g{}' });
    overlayPlugin('local-b', '1.0.0', { 'dist/frontend.js': 'export {}' }, cwdB);
    const app = makeApp({
      records: [loaded('@acme/glossary')],
      workspacePackages: ['@acme/glossary'],
      // p1: no consent; p2: a trusted overlay of its own; p3: no overlay at all.
      overlay: { trusted: false, loaded: [] },
      projects: [
        { id: 'p2', cwd: cwdB, trusted: true, loaded: ['local-b'] },
        { id: 'p3', cwd: path.join(tmp, 'project-c'), trusted: false, loaded: [] },
      ],
    });
    const entries = [];
    for (const id of ['p1', 'p2', 'p3']) {
      const entry = (await manifest(app, id)).plugins.find((p) => p.name === '@acme/glossary');
      expect(entry, id).toBeDefined();
      entries.push(entry!);
    }
    expect(entries[0]!.entry).toBe('/api/plugins/@acme%2Fglossary/frontend.js');
    for (const e of entries) {
      expect(e.entry).toBe(entries[0]!.entry);
      expect(e.css).toBe(entries[0]!.css);
    }
  });

  it('[ac:ac-wpis-nakladki-entry-pod-prefiksem-id] an overlay plugin entry in the manifest of project :id has its entry address under /api/projects/:id/plugins/<name>/', async () => {
    overlayPlugin('glossary', '1.0.0', { 'dist/frontend.js': 'export {}' });
    overlayPlugin('glossary', '1.0.0', { 'dist/frontend.js': 'export {}' }, cwdB);
    const app = makeApp({
      overlay: { trusted: true, loaded: ['glossary'] },
      projects: [{ id: 'project-two', cwd: cwdB, trusted: true, loaded: ['glossary'] }],
    });
    const [one] = (await manifest(app, 'p1')).plugins;
    const [two] = (await manifest(app, 'project-two')).plugins;
    expect(one!.entry.startsWith('/api/projects/p1/plugins/glossary/')).toBe(true);
    expect(one!.entry).toBe('/api/projects/p1/plugins/glossary/frontend.js');
    expect(two!.entry.startsWith('/api/projects/project-two/plugins/glossary/')).toBe(true);
    expect(two!.entry).not.toBe(one!.entry);
  });

  it('[ac:ac-frontend-bundle-esm-dist-frontend-js] an npm package without exports[./frontend] has its entry at dist/frontend.js, served from its package folder WITHOUT the trustProjectPlugins gate, and — backend loaded — is in the manifest of every project of the process', async () => {
    const root = npmPackage('no-exports', { version: '4.5.6' }, { 'dist/frontend.js': 'export const FROM = "dist";' });
    expect(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))).not.toHaveProperty('exports');
    const expected = { name: 'no-exports', version: '4.5.6', entry: '/api/plugins/no-exports/frontend.js' };
    const app = makeApp({
      records: [loaded('no-exports')],
      workspacePackages: ['no-exports'],
      overlay: { trusted: false, loaded: [] },
      projects: [{ id: 'p2', cwd: cwdB, trusted: true, loaded: [] }],
    });
    // Untrusted project and trusted project alike.
    for (const id of ['p1', 'p2']) expect((await manifest(app, id)).plugins).toEqual([expected]);
    // Served ungated by the process-global route.
    const res = await request(app).get('/api/plugins/no-exports/frontend.js').expect(200);
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

describe('project manifest — overlay condition and name collisions', () => {
  it('[ac:ac-serwowanie-frontendu-nakladki-project-lo] without trustProjectPlugins consent for (workspace × project) the project manifest does not announce the frontend of its project-local overlay', async () => {
    overlayPlugin('local-glossary', '1.2.0', {
      'dist/frontend.js': 'export const FROM = "overlay";',
      'dist/frontend.css': '.overlay{}',
    });
    let trusted = false;
    const app = makeApp({ overlay: { trusted: () => trusted, loaded: ['local-glossary'] } });

    // No consent (read live): not announced.
    expect((await manifest(app)).plugins).toEqual([]);
    // Control — with consent the very same overlay is announced, so the gate is what cut it.
    trusted = true;
    expect((await manifest(app)).plugins.map((p) => p.name)).toEqual(['local-glossary']);
    // An undecided/untrusted project whose context never built the overlay announces nothing either.
    const neverBuilt = makeApp({ overlay: { trusted: false, loaded: [] } });
    expect((await manifest(neverBuilt)).plugins).toEqual([]);
  });

  it('[ac:ac-przy-kolizji-nazwy-pluginu-manifest-f] on a name collision with an npm package, the manifest of a project with a trusted overlay announces the overlay entry of that project', async () => {
    npmPackage('glossary', { version: '1.0.0' }, { 'dist/frontend.js': 'export const FROM = "npm";' });
    overlayPlugin('glossary', '9.9.9', { 'dist/frontend.js': 'export const FROM = "overlay";' });
    const app = makeApp({
      records: [loaded('glossary')],
      workspacePackages: ['glossary'],
      overlay: { trusted: true, loaded: ['glossary'] },
    });
    const { plugins } = await manifest(app);
    expect(plugins).toEqual([{ name: 'glossary', version: '9.9.9', entry: '/api/projects/p1/plugins/glossary/frontend.js' }]);
    // The announced address serves this project's overlay file.
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
      { name: '@acme/tables', version: '2.0.0', entry: '/api/plugins/@acme%2Ftables/frontend.js' },
    ]);
    expect((await request(app).get(plugins[0]!.entry).expect(200)).text).toBe('export const FROM = "npm";');
  });

  it('[ac:ac-kolizja-z-niezaufana-nakladka-npm] on a name collision with an untrusted overlay the project manifest announces the npm package\'s entry under the process-global route', async () => {
    npmPackage('glossary', { version: '1.0.0' }, { 'dist/frontend.js': 'export const FROM = "npm";' });
    overlayPlugin('glossary', '9.9.9', { 'dist/frontend.js': 'export const FROM = "overlay";' });
    // Untrusted: the context never built the overlay — no `loaded` overlay record.
    const app = makeApp({
      records: [loaded('glossary')],
      workspacePackages: ['glossary'],
      overlay: { trusted: false, loaded: [] },
    });
    const { plugins } = await manifest(app);
    expect(plugins).toEqual([{ name: 'glossary', version: '1.0.0', entry: '/api/plugins/glossary/frontend.js' }]);
    expect((await request(app).get(plugins[0]!.entry).expect(200)).text).toBe('export const FROM = "npm";');
  });

  it('[ac:ac-kolizja-z-nakladka-nie-loaded-npm] on a name collision with an overlay whose backend is not `loaded`, the project manifest announces the npm package\'s entry', async () => {
    npmPackage('glossary', { version: '1.0.0' }, { 'dist/frontend.js': 'export const FROM = "npm";' });
    overlayPlugin('glossary', '9.9.9', { 'dist/frontend.js': 'export const FROM = "overlay";' });
    // Trusted, but the overlay's backend failed: no `loaded` record for it.
    const app = makeApp({
      records: [loaded('glossary')],
      workspacePackages: ['glossary'],
      overlay: { trusted: true, loaded: [] },
    });
    const { plugins } = await manifest(app);
    expect(plugins).toEqual([{ name: 'glossary', version: '1.0.0', entry: '/api/plugins/glossary/frontend.js' }]);
    // …and the overlay's own route does not serve the not-loaded overlay.
    await expectRefused(app, '/api/projects/p1/plugins/glossary/frontend.js');
  });

  it('[ac:ac-kolizja-z-nakladka-bez-frontendu-brak] on a name collision with an overlay whose backend is `loaded` but which has no frontend entry, the project manifest announces no entry under that name', async () => {
    npmPackage('glossary', { version: '1.0.0' }, { 'dist/frontend.js': 'export const FROM = "npm";' });
    // The overlay plugin exists and is loaded, but ships no dist/frontend.js.
    overlayPlugin('glossary', '9.9.9', { 'index.js': 'export const manifest = {};' });
    npmPackage('other', {}, { 'dist/frontend.js': 'export {}' });
    const app = makeApp({
      records: [loaded('glossary'), loaded('other')],
      workspacePackages: ['glossary', 'other'],
      overlay: { trusted: true, loaded: ['glossary'] },
    });
    const { plugins } = await manifest(app);
    expect(plugins.filter((p) => p.name === 'glossary')).toEqual([]);
    // Control: an unrelated base plugin is still announced.
    expect(plugins.map((p) => p.name)).toEqual(['other']);
  });

  it('[ac:ac-manifest-b-nie-oglasza-nakladki-a] the frontend manifest of project B does not announce the frontend of project A\'s project-local overlay', async () => {
    overlayPlugin('only-in-a', '1.0.0', { 'dist/frontend.js': 'export {}' });
    const app = makeApp({
      overlay: { trusted: true, loaded: ['only-in-a'] },
      // B is a trusted project of the same process, without that overlay.
      projects: [{ id: 'p2', cwd: cwdB, trusted: true, loaded: [] }],
    });
    expect((await manifest(app, 'p1')).plugins.map((p) => p.name)).toEqual(['only-in-a']);
    const b = await manifest(app, 'p2');
    expect(b.plugins).toEqual([]);
    for (const p of b.plugins) expect(p.entry).not.toContain('/api/projects/p1/');
  });
});

describe('project manifest — type activation is the second condition of an entry (2.1.57)', () => {
  it('[section:9g96q3pp] the manifest consults config.entities: a plugin contributing entity types is announced only when one of them is active, a plugin without entity types is not subject to it — for the npm package, the envelope and the overlay alike', async () => {
    npmPackage('npm-on', {}, { 'dist/frontend.js': 'export {}' });
    npmPackage('npm-off', {}, { 'dist/frontend.js': 'export {}' });
    npmPackage('npm-typeless', {}, { 'dist/frontend.js': 'export {}' });
    const envOn = envelope('env-on', {}, { 'dist/frontend.js': 'export {}' });
    const envOff = envelope('env-off', {}, { 'dist/frontend.js': 'export {}' });
    overlayPlugin('local-on', '1.0.0', { 'dist/frontend.js': 'export {}' });
    overlayPlugin('local-off', '1.0.0', { 'dist/frontend.js': 'export {}' });
    overlayPlugin('local-typeless', '1.0.0', { 'dist/frontend.js': 'export {}' });
    const opts: AppOpts = {
      records: [
        loaded('npm-on', ['glossary']),
        loaded('npm-off', ['gadget']),
        loaded('npm-typeless', []),
        loaded('env-on', ['diagramish']),
        loaded('env-off', ['widget']),
      ],
      workspacePackages: ['npm-on', 'npm-off', 'npm-typeless'],
      envelopes: [envOn, envOff],
      overlay: {
        trusted: true,
        loaded: ['local-on', 'local-off', 'local-typeless'],
        types: { 'local-on': ['note'], 'local-off': ['memo'] },
      },
    };

    // Field absent: every type active — every plugin announced.
    const all = (await manifest(makeApp(opts))).plugins.map((p) => p.name).sort();
    expect(all).toEqual(
      ['env-off', 'env-on', 'local-off', 'local-on', 'local-typeless', 'npm-off', 'npm-on', 'npm-typeless'].sort(),
    );

    // A whitelist: the plugins whose every type is off drop out of the manifest.
    const whitelisted = (
      await manifest(makeApp({ ...opts, activeTypes: ['glossary', 'diagramish', 'note'] }))
    ).plugins.map((p) => p.name).sort();
    expect(whitelisted).toEqual(['env-on', 'local-on', 'local-typeless', 'npm-on', 'npm-typeless'].sort());
    for (const off of ['npm-off', 'env-off', 'local-off']) expect(whitelisted).not.toContain(off);

    // An empty list: only the plugins without entity types stay.
    const none = (await manifest(makeApp({ ...opts, activeTypes: [] }))).plugins.map((p) => p.name).sort();
    expect(none).toEqual(['local-typeless', 'npm-typeless']);
  });

  it('[section:m13actv0] one activation gate for the backend and the frontend: a partly disabled plugin is announced, and a plugin is dropped only once all its types are off', async () => {
    npmPackage('@acme/contracts', {}, { 'dist/frontend.js': 'export {}' });
    const opts: AppOpts = {
      records: [loaded('@acme/contracts', ['endpoint', 'dto'])],
      workspacePackages: ['@acme/contracts'],
    };
    const names = async (activeTypes: string[]) =>
      (await manifest(makeApp({ ...opts, activeTypes }))).plugins.map((p) => p.name);

    // One of its two types active → the frontend is announced (its client mount takes only `endpoint`).
    expect(await names(['endpoint'])).toEqual(['@acme/contracts']);
    expect(await names(['dto', 'ui-view'])).toEqual(['@acme/contracts']);
    // None of its types active → not announced, even though the backend is `loaded` and the bundle exists.
    expect(await names(['ui-view'])).toEqual([]);
  });

  it('[section:j1jk3ykt] "active" in the manifest is backend loaded + a resolvable frontend entry + (for a plugin contributing entity types) one type active — each condition is necessary', async () => {
    npmPackage('ok', {}, { 'dist/frontend.js': 'export {}' });
    npmPackage('no-entry', {}, {}); // backend loaded, no resolvable frontend entry
    npmPackage('not-loaded', {}, { 'dist/frontend.js': 'export {}' });
    npmPackage('type-off', {}, { 'dist/frontend.js': 'export {}' });
    const app = makeApp({
      records: [
        loaded('ok', ['glossary']),
        loaded('no-entry', ['glossary']),
        { package: 'not-loaded', status: 'failed', layer: 'base', contributedTypes: ['glossary'] },
        loaded('type-off', ['gadget']),
      ],
      workspacePackages: ['ok', 'no-entry', 'not-loaded', 'type-off'],
      activeTypes: ['glossary'],
    });
    expect((await manifest(app)).plugins.map((p) => p.name)).toEqual(['ok']);
    // The asset route is not the manifest: a disabled type's bundle stays servable (nothing mounts it).
    await request(app).get('/api/plugins/type-off/frontend.js').expect(200);
  });
});

describe('GET /api/plugins/:name/:asset — base tier', () => {
  it('[entity:get-api-plugins-name-asset] GET /api/plugins/:name/:asset answers 200 with the raw file, its Content-Type, nosniff, Cache-Control: no-cache and a content ETag; a scoped name is one %2F-encoded segment; refusals are 404 PluginFrontendAssetError', async () => {
    npmPackage('@scope/pkg', {}, {
      'dist/frontend.js': 'export const a = 1;',
      'dist/frontend.css': '.a{color:red}',
      'dist/frontend.js.map': '{"version":3}',
    });
    const app = makeApp({ records: [loaded('@scope/pkg')], workspacePackages: ['@scope/pkg'] });
    const seg = '@scope%2Fpkg';
    // The manifest announces exactly this one-segment form.
    expect((await manifest(app)).plugins[0]!.entry).toBe(`/api/plugins/${seg}/frontend.js`);
    // A fully percent-encoded name addresses the same plugin.
    await request(app).get(`/api/plugins/${encodeURIComponent('@scope/pkg')}/frontend.js`).expect(200);
    const cases: Array<[string, RegExp, string]> = [
      ['frontend.js', /^text\/javascript/, 'export const a = 1;'],
      ['frontend.css', /^text\/css/, '.a{color:red}'],
      ['frontend.js.map', /^application\/json/, '{"version":3}'],
    ];
    for (const [asset, type, body] of cases) {
      const res = await getRaw(app, `/api/plugins/${seg}/${asset}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(type);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.headers.etag).toMatch(/^"[^"]+"$/);
      expect(res.body).toBe(body);
    }
    await expectRefused(app, `/api/plugins/${seg}/absent.js`);
  });

  it('[ac:ac-route-api-plugins-name-frontend-js-cs] GET /api/plugins/:name/:asset serves .js, .css and .map files from the frontend entry folder of an npm package or a built-in envelope', async () => {
    const files = (tag: string) => ({
      'dist/frontend.js': `export const FROM = "${tag}";`,
      'dist/frontend.css': `.${tag}{}`,
      'dist/frontend.js.map': `{"file":"${tag}"}`,
      'dist/chunk-1.js': `export const CHUNK = "${tag}";`,
    });
    npmPackage('from-npm', {}, files('npm'));
    const env = envelope('from-envelope', {}, files('envelope'));
    overlayPlugin('from-overlay', '1.0.0', files('overlay'));
    const app = makeApp({
      records: [loaded('from-npm'), loaded('from-envelope')],
      workspacePackages: ['from-npm'],
      envelopes: [env],
      overlay: { trusted: true, loaded: ['from-overlay'] },
    });
    for (const [name, tag] of [['from-npm', 'npm'], ['from-envelope', 'envelope']]) {
      expect((await request(app).get(`/api/plugins/${name}/frontend.js`).expect(200)).text).toBe(`export const FROM = "${tag}";`);
      expect((await request(app).get(`/api/plugins/${name}/chunk-1.js`).expect(200)).text).toBe(`export const CHUNK = "${tag}";`);
      const css = await request(app).get(`/api/plugins/${name}/frontend.css`).expect(200);
      expect(css.headers['content-type']).toMatch(/^text\/css/);
      expect(css.text).toBe(`.${tag}{}`);
      const map = await request(app).get(`/api/plugins/${name}/frontend.js.map`).expect(200);
      expect(map.headers['content-type']).toMatch(/^application\/json/);
      expect(map.body).toEqual({ file: tag });
    }
    // Not an overlay, even a trusted one: that is the project route's.
    await expectRefused(app, '/api/plugins/from-overlay/frontend.js');
  });

  it('[ac:ac-route-bazowy-404-dla-samej-nakladki] GET /api/plugins/:name/frontend.js for a plugin contributed only by a project-local overlay gets 404 with code PLUGIN_FRONTEND_NOT_FOUND', async () => {
    overlayPlugin('only-local', '1.0.0', { 'dist/frontend.js': 'export const FROM = "overlay";' });
    const app = makeApp({ overlay: { trusted: true, loaded: ['only-local'] } });
    // The overlay is trusted, loaded and served by its project route…
    await request(app).get('/api/projects/p1/plugins/only-local/frontend.js').expect(200);
    // …but the process-global route refuses it.
    await expectRefused(app, '/api/plugins/only-local/frontend.js');
  });

  it('[ac:ac-route-bazowy-serwuje-npm-przy-kolizji] when a project\'s overlay shadows an npm package of the same name, GET /api/plugins/:name/:asset serves the npm package\'s file', async () => {
    npmPackage('glossary', {}, {
      'dist/frontend.js': 'export const FROM = "npm";',
      'dist/frontend.css': '.npm{}',
    });
    overlayPlugin('glossary', '9.9.9', {
      'dist/frontend.js': 'export const FROM = "overlay";',
      'dist/frontend.css': '.overlay{}',
    });
    const app = makeApp({
      records: [loaded('glossary')],
      workspacePackages: ['glossary'],
      overlay: { trusted: true, loaded: ['glossary'] },
    });
    // The project's manifest announces the overlay (it shadows the package)…
    expect((await manifest(app)).plugins[0]!.entry).toBe('/api/projects/p1/plugins/glossary/frontend.js');
    // …while the base route keeps serving the npm package.
    expect((await request(app).get('/api/plugins/glossary/frontend.js').expect(200)).text).toBe('export const FROM = "npm";');
    expect((await request(app).get('/api/plugins/glossary/frontend.css').expect(200)).text).toBe('.npm{}');
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
    await expectRefused(app, '/api/plugins/declares/frontend.js');
  });
});

describe('GET /api/projects/:id/plugins/:name/:asset — project overlay', () => {
  it('[entity:get-api-projects-id-plugins-name-asset] GET /api/projects/:id/plugins/:name/:asset answers 200 with the raw overlay file, its Content-Type, nosniff, Cache-Control: no-cache and a content ETag; never an npm package or envelope; refusals are 404 PluginFrontendAssetError', async () => {
    overlayPlugin('glossary', '1.0.0', {
      'dist/frontend.js': 'export const a = 1;',
      'dist/frontend.css': '.a{}',
      'dist/frontend.js.map': '{"version":3}',
    });
    npmPackage('npm-only', {}, { 'dist/frontend.js': 'export {}' });
    const env = envelope('env-only', {}, { 'dist/frontend.js': 'export {}' });
    const app = makeApp({
      records: [loaded('npm-only'), loaded('env-only')],
      workspacePackages: ['npm-only'],
      envelopes: [env],
      overlay: { trusted: true, loaded: ['glossary'] },
    });
    const cases: Array<[string, RegExp, string]> = [
      ['frontend.js', /^text\/javascript/, 'export const a = 1;'],
      ['frontend.css', /^text\/css/, '.a{}'],
      ['frontend.js.map', /^application\/json/, '{"version":3}'],
    ];
    for (const [asset, type, body] of cases) {
      const res = await getRaw(app, `/api/projects/p1/plugins/glossary/${asset}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(type);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.headers.etag).toMatch(/^"[^"]+"$/);
      expect(res.body).toBe(body);
    }
    // Base-tier plugins are not this route's.
    await expectRefused(app, '/api/projects/p1/plugins/npm-only/frontend.js');
    await expectRefused(app, '/api/projects/p1/plugins/env-only/frontend.js');
    await expectRefused(app, '/api/projects/p1/plugins/glossary/absent.js');
  });

  it('[ac:ac-route-projektu-serwuje-assety-nakladki] GET /api/projects/:id/plugins/:name/:asset serves .js, .css and .map files from the frontend entry folder of project :id\'s project-local overlay', async () => {
    overlayPlugin('glossary', '1.0.0', {
      'dist/frontend.js': 'export const FROM = "overlay";',
      'dist/chunk-1.js': 'export const CHUNK = "overlay";',
      'dist/frontend.css': '.overlay{}',
      'dist/frontend.js.map': '{"file":"overlay"}',
    });
    const app = makeApp({ overlay: { trusted: true, loaded: ['glossary'] } });
    const base = '/api/projects/p1/plugins/glossary';
    expect((await request(app).get(`${base}/frontend.js`).expect(200)).text).toBe('export const FROM = "overlay";');
    expect((await request(app).get(`${base}/chunk-1.js`).expect(200)).text).toBe('export const CHUNK = "overlay";');
    const css = await request(app).get(`${base}/frontend.css`).expect(200);
    expect(css.headers['content-type']).toMatch(/^text\/css/);
    expect(css.text).toBe('.overlay{}');
    const map = await request(app).get(`${base}/frontend.js.map`).expect(200);
    expect(map.headers['content-type']).toMatch(/^application\/json/);
    expect(map.body).toEqual({ file: 'overlay' });
  });

  it('[ac:ac-route-projektu-bez-zgody-odpowiada-404] without trustProjectPlugins consent for (workspace × project), GET /api/projects/:id/plugins/:name/:asset answers 404 with code PLUGIN_FRONTEND_NOT_FOUND', async () => {
    overlayPlugin('glossary', '1.0.0', { 'dist/frontend.js': 'export {}', 'dist/frontend.css': '.g{}' });
    let trusted = true;
    // The context instance HAS the overlay loaded; only the live flag decides.
    const app = makeApp({ overlay: { trusted: () => trusted, loaded: ['glossary'] } });
    await request(app).get('/api/projects/p1/plugins/glossary/frontend.js').expect(200);
    trusted = false;
    for (const asset of ['frontend.js', 'frontend.css']) {
      await expectRefused(app, `/api/projects/p1/plugins/glossary/${asset}`);
    }
    // An untrusted project whose context never built the overlay refuses too.
    const neverBuilt = makeApp({ overlay: { trusted: false, loaded: [] } });
    await expectRefused(neverBuilt, '/api/projects/p1/plugins/glossary/frontend.js');
  });

  it('[ac:ac-route-projektu-404-dla-nakladki-innego] GET /api/projects/:id/plugins/:name/frontend.js for a plugin contributed only by another project\'s overlay gets 404 with code PLUGIN_FRONTEND_NOT_FOUND', async () => {
    overlayPlugin('only-in-a', '1.0.0', { 'dist/frontend.js': 'export const FROM = "A";' });
    const app = makeApp({
      overlay: { trusted: true, loaded: ['only-in-a'] },
      projects: [{ id: 'p2', cwd: cwdB, trusted: true, loaded: [] }],
    });
    // Served on A's own route…
    expect((await request(app).get('/api/projects/p1/plugins/only-in-a/frontend.js').expect(200)).text).toBe('export const FROM = "A";');
    // …refused on B's.
    await expectRefused(app, '/api/projects/p2/plugins/only-in-a/frontend.js');
  });

  it('[ac:ac-route-nakladki-separator-w-name-404] a request to the overlay asset route with a path separator or .. in :name gets 404 with code PLUGIN_FRONTEND_NOT_FOUND', async () => {
    // A trusted, loaded overlay — and files a composed path WOULD reach.
    overlayPlugin('glossary', '1.0.0', { 'dist/frontend.js': 'export const FROM = "glossary";' });
    writeTree(path.join(cwd, '.claude4spec'), { 'dist/frontend.js': 'export const FROM = "escaped";' });
    writeTree(cwd, { 'dist/frontend.js': 'export const FROM = "project-root";' });
    const app = makeApp({ overlay: { trusted: true, loaded: ['glossary'] } });
    // (A bare `..` / `%2E%2E` segment is collapsed by the URL parser before any
    // request leaves the client, so the separator always travels encoded.)
    const names = [
      encodeURIComponent('../glossary'),
      encodeURIComponent('glossary/..'),
      encodeURIComponent('glossary/../glossary'),
      encodeURIComponent('../..'),
      encodeURIComponent('sub\\glossary'),
      encodeURIComponent('..\\glossary'),
      encodeURIComponent('/glossary'),
    ];
    for (const name of names) {
      await expectRefused(app, `/api/projects/p1/plugins/${name}/frontend.js`);
    }
    // Control: the plain name is served.
    await request(app).get('/api/projects/p1/plugins/glossary/frontend.js').expect(200);
  });

  it('[ac:ac-wzgledny-import-chunka-ten-sam-projekt] a relative chunk import from project :id\'s overlay entry is served by the asset route of the same project :id', async () => {
    // Two projects, each with an overlay of the SAME name, each with its own chunk.
    overlayPlugin('glossary', '1.0.0', {
      'dist/frontend.js': 'import { CHUNK } from "./chunk-1.js"; export const FROM = CHUNK;',
      'dist/chunk-1.js': 'export const CHUNK = "project-A";',
    });
    overlayPlugin('glossary', '1.0.0', {
      'dist/frontend.js': 'import { CHUNK } from "./chunk-1.js"; export const FROM = CHUNK;',
      'dist/chunk-1.js': 'export const CHUNK = "project-B";',
    }, cwdB);
    const app = makeApp({
      overlay: { trusted: true, loaded: ['glossary'] },
      projects: [{ id: 'p2', cwd: cwdB, trusted: true, loaded: ['glossary'] }],
    });
    for (const [id, expected] of [['p1', 'project-A'], ['p2', 'project-B']] as const) {
      const entry = (await manifest(app, id)).plugins[0]!.entry;
      const source = (await request(app).get(entry).expect(200)).text;
      const spec = /from "(\.\/[^"]+)"/.exec(source)![1]!;
      // The browser resolves the relative specifier against the entry's URL.
      const chunkUrl = new URL(spec, `http://host${entry}`).pathname;
      expect(chunkUrl).toBe(`/api/projects/${id}/plugins/glossary/chunk-1.js`);
      expect((await request(app).get(chunkUrl).expect(200)).text).toBe(`export const CHUNK = "${expected}";`);
    }
  });
});

describe('both asset routes — refusals and revalidation under a fixed address', () => {
  /** One base-tier and one overlay asset folder, each with the same files. */
  function bothTiers() {
    const files = { 'dist/frontend.js': 'export const V = 1;', 'dist/frontend.css': '.v1{}' };
    const npmDir = npmPackage('glossary-base', {}, files);
    const overlayDir = overlayPlugin('glossary-local', '1.0.0', files);
    const app = makeApp({
      records: [loaded('glossary-base')],
      workspacePackages: ['glossary-base'],
      overlay: { trusted: true, loaded: ['glossary-local'] },
    });
    return {
      app,
      routes: [
        { url: '/api/plugins/glossary-base', dir: npmDir },
        { url: '/api/projects/p1/plugins/glossary-local', dir: overlayDir },
      ],
    };
  }

  it('[ac:ac-zadanie-route-u-assetow-pluginu-o-pli] a request to a plugin asset route for a file with an extension outside .js, .css and .map gets 404 with code PLUGIN_FRONTEND_NOT_FOUND', async () => {
    const extra = {
      'dist/meta.json': '{}',
      'dist/index.html': '<html></html>',
      'dist/source.ts': 'export {}',
      'dist/secret.env': 'K=V',
    };
    npmPackage('pkg', {}, { 'dist/frontend.js': 'export {}', ...extra });
    overlayPlugin('local', '1.0.0', { 'dist/frontend.js': 'export {}', ...extra });
    const app = makeApp({
      records: [loaded('pkg')],
      workspacePackages: ['pkg'],
      overlay: { trusted: true, loaded: ['local'] },
    });
    for (const base of ['/api/plugins/pkg', '/api/projects/p1/plugins/local']) {
      for (const asset of ['meta.json', 'index.html', 'source.ts', 'secret.env']) {
        await expectRefused(app, `${base}/${asset}`);
      }
      await request(app).get(`${base}/frontend.js`).expect(200);
    }
  });

  it('[entity:plugin-frontend-asset-error] every refusal of both asset routes is a 404 { error: { code: PLUGIN_FRONTEND_NOT_FOUND, message: string } } — extension, separator / .., untrusted overlay, plugin absent from the project overlay, missing file', async () => {
    npmPackage('pkg', {}, { 'dist/frontend.js': 'export {}', 'dist/meta.json': '{}' });
    overlayPlugin('local', '1.0.0', { 'dist/frontend.js': 'export {}', 'dist/meta.json': '{}' });
    overlayPlugin('local-b', '1.0.0', { 'dist/frontend.js': 'export {}' }, cwdB);
    const app = makeApp({
      records: [loaded('pkg')],
      workspacePackages: ['pkg'],
      overlay: { trusted: true, loaded: ['local'] },
      projects: [{ id: 'p2', cwd: cwdB, trusted: false, loaded: ['local-b'] }],
    });
    const refusals = [
      // Base tier.
      '/api/plugins/pkg/meta.json', // extension
      `/api/plugins/pkg/${encodeURIComponent('../package.json.js')}`, // separator + ..
      `/api/plugins/pkg/${encodeURIComponent('sub\\x.js')}`, // separator
      '/api/plugins/pkg/..js', // ..
      '/api/plugins/local/frontend.js', // an overlay is never base
      '/api/plugins/pkg/absent.js', // missing file
      '/api/plugins/unknown/frontend.js', // unknown plugin
      // Project overlay.
      '/api/projects/p1/plugins/local/meta.json', // extension
      `/api/projects/p1/plugins/local/${encodeURIComponent('../package.json.js')}`, // separator + .. in the file
      `/api/projects/p1/plugins/${encodeURIComponent('../local')}/frontend.js`, // separator + .. in the name
      '/api/projects/p2/plugins/local-b/frontend.js', // untrusted overlay
      '/api/projects/p2/plugins/local/frontend.js', // absent from p2's overlay
      '/api/projects/p1/plugins/pkg/frontend.js', // a base plugin is not in the overlay
      '/api/projects/p1/plugins/local/absent.js', // missing file
    ];
    for (const url of refusals) await expectRefused(app, url);
  });

  it('[ac:ac-asset-200-cache-control-no-cache] a 200 of either plugin asset route carries Cache-Control: no-cache', async () => {
    const { app, routes } = bothTiers();
    for (const { url } of routes) {
      for (const asset of ['frontend.js', 'frontend.css']) {
        const res = await request(app).get(`${url}/${asset}`);
        expect(res.status, url).toBe(200);
        expect(res.headers['cache-control'], url).toBe('no-cache');
      }
    }
  });

  it('[ac:ac-asset-if-none-match-304] a request for a plugin frontend file with If-None-Match equal to the file\'s current ETag gets 304 without a body', async () => {
    const { app, routes } = bothTiers();
    for (const { url } of routes) {
      const first = await request(app).get(`${url}/frontend.js`).expect(200);
      const etag = first.headers.etag as string;
      expect(etag, url).toMatch(/^"[^"]+"$/);
      // A second plain request names the same validator (derived from the unchanged content).
      expect((await request(app).get(`${url}/frontend.js`)).headers.etag).toBe(etag);
      const again = await request(app).get(`${url}/frontend.js`).set('If-None-Match', etag);
      expect(again.status, url).toBe(304);
      expect(again.text ?? '', url).toBe('');
      expect(again.headers['content-type'], url).toBeUndefined();
      // A stale validator is not a match.
      await request(app).get(`${url}/frontend.js`).set('If-None-Match', '"stale"').expect(200);
    }
  });

  it('[ac:ac-asset-etag-po-przebudowie-200] after a plugin frontend rebuild, a request with If-None-Match equal to the pre-rebuild ETag gets 200 with the new content', async () => {
    const { app, routes } = bothTiers();
    for (const { url, dir } of routes) {
      const before = await request(app).get(`${url}/frontend.js`).expect(200);
      const oldEtag = before.headers.etag as string;
      expect(before.text).toBe('export const V = 1;');
      // The rebuild rewrites the file under the SAME address.
      fs.writeFileSync(path.join(dir, 'dist', 'frontend.js'), 'export const V = 2;');
      const after = await request(app).get(`${url}/frontend.js`).set('If-None-Match', oldEtag);
      expect(after.status, url).toBe(200);
      expect(after.text, url).toBe('export const V = 2;');
      expect(after.headers.etag, url).not.toBe(oldEtag);
    }
  });
});

/**
 * Run a served runtime shim against a given `__c4s_shared` table and return its
 * exports. The shim is plain ESM of the form `const __m = globalThis.__c4s_shared[…]`
 * + `export const X = __m["X"]` / `export default …`; its exports are rebound to an
 * object so the test can compare them by identity with the host namespace.
 */
function evalShim(source: string, shared: Record<string, unknown>): Record<string, unknown> {
  const body = source
    .replace(/^export default /m, '__out.default = ')
    .replace(/^export const ([A-Za-z_$][\w$]*) = /gm, '__out.$1 = ');
  expect(body).not.toMatch(/^\s*(export|import)\b/m);
  const out: Record<string, unknown> = {};
  new Function('globalThis', '__out', body)({ __c4s_shared: shared }, out);
  return out;
}

async function servedShim(app: express.Express, importMap: Record<string, string>, specifier: string): Promise<string> {
  const url = importMap[specifier];
  expect(url, specifier).toMatch(/^\/api\/plugins\/runtime\/.+\.js$/);
  const res = await request(app).get(url!).expect(200);
  expect(res.headers['content-type']).toMatch(/javascript/);
  return res.text;
}

describe('import map peers (criteria carried over to 2.1.20)', () => {
  it('[ac:ac-frontend-pluginu-nie-bandluje-wlasnej-ko] @tanstack/react-router resolves through the import map to the host\'s one router instance, so a plugin RouteTreeFragment (frontend.routes) builds on the host router library', async () => {
    const app = makeApp({});
    const { importMap } = await manifest(app);
    const source = await servedShim(app, importMap, '@tanstack/react-router');
    // The shim re-exports the host singleton; it carries no router code of its own.
    expect(source).toContain('globalThis.__c4s_shared["@tanstack/react-router"]');
    expect(source).toContain('export const createRoute = __m["createRoute"];');

    // Evaluated against the host's published namespace, every routing export the
    // plugin's fragment uses IS the host's object — one library instance, one tree.
    const hostRouter = (await import('@tanstack/react-router')) as Record<string, unknown>;
    const pluginView = evalShim(source, { '@tanstack/react-router': hostRouter });
    for (const name of ['createRoute', 'createRootRoute', 'createRouter', 'useRouter', 'Outlet', 'Link']) {
      expect(pluginView[name], name).toBe(hostRouter[name]);
    }
    // And a RouteTreeFragment built with the plugin's import is a route of the host
    // router library, hung off the host's root route.
    const createRoute = pluginView.createRoute as (o: object) => { options: { getParentRoute: () => unknown } };
    const hostRoot = (hostRouter.createRootRoute as (o?: object) => unknown)();
    const fragment = (ctx: { rootRoute: unknown }) => [createRoute({ getParentRoute: () => ctx.rootRoute, path: '/glossary' })];
    const [child] = fragment({ rootRoute: hostRoot });
    expect(child).toBeInstanceOf(hostRouter.Route as new (...a: never[]) => unknown);
    expect(child!.options.getParentRoute()).toBe(hostRoot);
  });

  it('[ac:ac-frontend-pluginu-zbudowany-automatycznym] react/jsx-runtime and react/jsx-dev-runtime are their own import-map peers (not covered by "react") resolving jsx/jsxs/jsxDEV to the host React', async () => {
    const app = makeApp({});
    const { importMap } = await manifest(app);
    // Separate entries — a bare subpath is not resolved by the `react` entry.
    expect(importMap['react/jsx-runtime']).toBe('/api/plugins/runtime/react-jsx-runtime.js');
    expect(importMap['react/jsx-dev-runtime']).toBe('/api/plugins/runtime/react-jsx-dev-runtime.js');
    expect(importMap['react/jsx-runtime']).not.toBe(importMap.react);
    expect(importMap['react/jsx-dev-runtime']).not.toBe(importMap.react);

    const jsxSource = await servedShim(app, importMap, 'react/jsx-runtime');
    const devSource = await servedShim(app, importMap, 'react/jsx-dev-runtime');
    expect(jsxSource).toContain('globalThis.__c4s_shared["react/jsx-runtime"]');
    expect(devSource).toContain('globalThis.__c4s_shared["react/jsx-dev-runtime"]');
    expect(devSource).toContain('export const jsxDEV = __m["jsxDEV"];');

    // Bound to the host's own namespaces: the plugin's jsx/jsxs/jsxDEV are the host's.
    const hostJsx = (await import('react/jsx-runtime')) as Record<string, unknown>;
    const hostDev = (await import('react/jsx-dev-runtime')) as Record<string, unknown>;
    const viaJsx = evalShim(jsxSource, { 'react/jsx-runtime': hostJsx });
    const viaDev = evalShim(devSource, { 'react/jsx-dev-runtime': hostDev });
    expect(viaJsx.jsx).toBe(hostJsx.jsx);
    expect(viaJsx.jsxs).toBe(hostJsx.jsxs);
    expect(viaJsx.Fragment).toBe(hostJsx.Fragment);
    expect(viaDev.jsxDEV).toBe(hostDev.jsxDEV);
    // Without the host singleton the module refuses to load instead of falling back to a copy.
    expect(() => evalShim(jsxSource, {})).toThrow(/missing shared singleton "react\/jsx-runtime"/);
  });

  it('[ac:ac-lucide-react-jest-externalized-peer-w] lucide-react is an externalized peer of the manifest\'s import map, its icons re-exported from the host copy', async () => {
    const app = makeApp({});
    const { importMap } = await manifest(app);
    expect(importMap['lucide-react']).toBe('/api/plugins/runtime/lucide-react.js');
    const source = await servedShim(app, importMap, 'lucide-react');
    expect(source).toContain('globalThis.__c4s_shared["lucide-react"]');
    expect(source).toContain('export const Search = __m["Search"];');
    const hostLucide = (await import('lucide-react')) as Record<string, unknown>;
    const viaPeer = evalShim(source, { 'lucide-react': hostLucide });
    expect(viaPeer.Search).toBe(hostLucide.Search);
    expect(viaPeer.Trash2).toBe(hostLucide.Trash2);
  });
});
