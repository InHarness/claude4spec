import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PluginRegistryImpl } from '../../../src/server/core/plugin-host/registry.js';
import { registerAllPlugins } from '../../../src/server/core/plugin-host/register-builtins.js';
import { loadBuiltinEnvelopes, type PluginLoadRecord } from '../../../src/server/core/plugin-host/loader.js';
import { FileWatchRuntime } from '../../../src/server/fs/watcher.js';
import { WsGateway } from '../../../src/server/ws/gateway.js';
import { ProjectContextCache } from '../../../src/server/workspace/context-cache.js';
import { projectDispatchMiddleware } from '../../../src/server/workspace/middleware.js';
import { buildProjectContext } from '../../../src/server/workspace/project-context.js';
import { WorkspaceRegistry } from '../../../src/server/workspace/registry.js';
import { bootstrapProject } from '../../../src/server/workspace/bootstrap.js';
import { pluginsRouter } from '../../../src/server/routes/plugins.js';
import { errorHandler } from '../../../src/server/routes/errors.js';
import { HOST_API_VERSION } from '../../../src/shared/plugin-host/manifest.js';
import type { ProjectRecord, WorkspaceRecord } from '../../../src/server/workspace/types.js';

/**
 * M33 / L11 (2.1.22) — the frontend manifest and the overlay assets are served
 * PER PROJECT, on the project router, from REAL `ProjectContext` builds behind
 * the same `/api/projects/:id` dispatch middleware and the same process-level
 * `/api` composition `startServer` mounts.
 *
 * The composition here has NO initial project: it is what a start without
 * `--cwd` mounts (`createProject: false` — nothing registered by the CLI start,
 * no eager warm, every project built lazily on its first request). Serving must
 * not depend on the project the process started with.
 *
 * A trusted overlay package is imported through the context's `overlayImporter`
 * test seam (the trust gate is not bypassable through it), so no project-local
 * code runs in the test process.
 */

type ManifestBody = {
  hostApiVersion: string;
  importMap: Record<string, string>;
  plugins: Array<{ name: string; version: string; entry: string; css?: string }>;
};

describe('plugin frontend serving per project — real contexts, no initial project', () => {
  let home: string;
  let prevHome: string | undefined;
  let registry: WorkspaceRegistry;
  let workspace: WorkspaceRecord;
  let cache: ProjectContextCache;
  /** The `/api` composition `startServer` mounts: process routers, project dispatch, error envelope. */
  let serverApp: express.Express;
  let httpServer: http.Server;
  let watchRuntime: FileWatchRuntime;
  /** Trusted, with a project-local overlay `local-a` that has a frontend. */
  let projectA: ProjectRecord;
  /** No overlay, no trust decision. */
  let projectB: ProjectRecord;
  /** Trusted overlays whose consent the CLI revokes (one per criterion). */
  let revokeManifest: ProjectRecord;
  let revokeRoute: ProjectRecord;
  /** An overlay without consent, granted in-process (POST /trust-plugins). */
  let grantInProcess: ProjectRecord;
  /** A project registered in ANOTHER workspace of the same registry. */
  let foreign: ProjectRecord;

  function writeTree(dir: string, files: Record<string, string>): void {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
  }

  /** Commit `<cwd>/.claude4spec/plugins/<folder>/` with a backend entry and a built frontend. */
  function commitOverlay(cwd: string, folder: string): void {
    writeTree(path.join(cwd, '.claude4spec', 'plugins', folder), {
      'package.json': JSON.stringify({ name: folder, version: '0.3.0', type: 'module', main: 'index.js' }),
      'index.js': '// imported only through the test importer',
      'dist/frontend.js': `import { CHUNK } from "./chunk-1.js"; export const FROM = "${folder}:" + CHUNK;`,
      'dist/chunk-1.js': `export const CHUNK = "${folder}-chunk";`,
      'dist/frontend.css': `.${folder}{}`,
    });
  }

  /** The trusted-overlay importer: a valid manifest named after the package folder. */
  const overlayImporter = async (href: string): Promise<unknown> => {
    const folder = /\/plugins\/([^/]+)\/index\.js/.exec(decodeURIComponent(new URL(href).pathname))?.[1];
    if (!folder) throw new Error(`unexpected overlay import: ${href}`);
    return { manifest: { name: folder, version: '0.3.0', hostApiVersion: `^${HOST_API_VERSION}`, contributes: {} } };
  };

  function register(name: string): { project: ProjectRecord; cwd: string } {
    const cwd = path.join(home, name);
    return { project: bootstrapProject(registry, workspace, cwd).project, cwd };
  }

  async function manifestOf(project: ProjectRecord): Promise<ManifestBody> {
    const res = await request(serverApp).get(`/api/projects/${project.id}/plugins/frontend-manifest`);
    expect(res.status).toBe(200);
    return res.body as ManifestBody;
  }

  async function contextOf(project: ProjectRecord) {
    return cache.get(registry.getProject(workspace, project.id)!);
  }

  beforeAll(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-fe-per-project-'));
    prevHome = process.env.C4S_HOME;
    process.env.C4S_HOME = path.join(home, 'registry');
    registry = new WorkspaceRegistry(process.env.C4S_HOME);
    workspace = registry.selectOrCreate({ name: 'default' });

    const a = register('project-a');
    projectA = a.project;
    commitOverlay(a.cwd, 'local-a');
    registry.setProjectTrust(workspace, projectA.id, true);

    projectB = register('project-b').project;

    const rm = register('revoke-manifest');
    revokeManifest = rm.project;
    commitOverlay(rm.cwd, 'local-rm');
    registry.setProjectTrust(workspace, revokeManifest.id, true);

    const rr = register('revoke-route');
    revokeRoute = rr.project;
    commitOverlay(rr.cwd, 'local-rr');
    registry.setProjectTrust(workspace, revokeRoute.id, true);

    const g = register('grant-in-process');
    grantInProcess = g.project;
    commitOverlay(g.cwd, 'local-g');

    const otherWs = registry.selectOrCreate({ name: 'other-workspace' });
    foreign = registry.registerProject(otherWs, path.join(home, 'foreign-project'));
    workspace = registry.getWorkspace('default')!;

    // A base-tier (workspace npm) package with a built frontend and a loaded backend.
    const baseDir = path.join(home, 'node_modules', 'base-glossary');
    writeTree(baseDir, {
      'package.json': JSON.stringify({ name: 'base-glossary', version: '1.4.0' }),
      'dist/frontend.js': 'export const FROM = "base";',
      'dist/frontend.css': '.base{}',
    });

    const pluginRegistry = new PluginRegistryImpl();
    registerAllPlugins(pluginRegistry);
    const envelopeLoad = await loadBuiltinEnvelopes(pluginRegistry);
    const pluginRecords: PluginLoadRecord[] = [
      ...envelopeLoad.records,
      { package: 'base-glossary', status: 'loaded', layer: 'base' },
    ];
    const frontendBase = {
      workspacePackages: ['base-glossary'],
      envelopes: [],
      resolveWorkspaceRoot: (n: string) => (n === 'base-glossary' ? baseDir : null),
    };

    httpServer = http.createServer();
    const gateway = new WsGateway(httpServer, () => true);
    watchRuntime = new FileWatchRuntime({ broadcaster: { broadcast: () => {} } });
    cache = new ProjectContextCache((project) =>
      buildProjectContext({
        registry,
        pluginRegistry,
        pluginRecords,
        frontendBase,
        overlayImporter,
        workspace,
        projectId: project.id,
        cwd: project.cwd,
        gateway,
        watchRuntime,
        mode: 'prod',
        onContextConfigChanged: (opts) => cache.invalidate(project.id, opts),
      }),
    );

    serverApp = express();
    serverApp.use(express.json());
    serverApp.use('/api', pluginsRouter({ pluginRegistry, pluginRecords, ...frontendBase }));
    serverApp.use('/api/projects/:id', projectDispatchMiddleware(registry, workspace, cache));
    serverApp.use('/api', errorHandler);
  }, 60_000);

  afterAll(async () => {
    await cache.disposeAll();
    await watchRuntime.close();
    httpServer.close();
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('[ac:ac-start-bez-cwd-manifest-oglasza-baze] after a start without --cwd, the frontend manifest of every project announces the frontend of base-tier plugins with a loaded backend', async () => {
    for (const project of [projectA, projectB, revokeManifest]) {
      const base = (await manifestOf(project)).plugins.find((p) => p.name === 'base-glossary');
      expect(base, project.id).toEqual({
        name: 'base-glossary',
        version: '1.4.0',
        entry: '/api/plugins/base-glossary/frontend.js',
        css: '/api/plugins/base-glossary/frontend.css',
      });
    }
    const served = await request(serverApp).get('/api/plugins/base-glossary/frontend.js').expect(200);
    expect(served.text).toBe('export const FROM = "base";');
  }, 120_000);

  it('[ac:ac-start-bez-cwd-manifest-oglasza-nakladke] after a start without --cwd, the frontend manifest of a project with a trusted overlay announces that overlay\'s frontend', async () => {
    const { plugins } = await manifestOf(projectA);
    const local = plugins.find((p) => p.name === 'local-a');
    expect(local).toEqual({
      name: 'local-a',
      version: '0.3.0',
      entry: `/api/projects/${projectA.id}/plugins/local-a/frontend.js`,
      css: `/api/projects/${projectA.id}/plugins/local-a/frontend.css`,
    });
    const served = await request(serverApp).get(local!.entry).expect(200);
    expect(served.headers['content-type']).toMatch(/^text\/javascript/);
    expect(served.text).toContain('export const FROM = "local-a:"');
  }, 120_000);

  it('[ac:ac-manifest-b-nie-oglasza-nakladki-a] the frontend manifest of project B does not announce the frontend of project A\'s project-local overlay', async () => {
    expect((await manifestOf(projectA)).plugins.map((p) => p.name)).toContain('local-a');
    const b = await manifestOf(projectB);
    expect(b.plugins.map((p) => p.name)).not.toContain('local-a');
    for (const p of b.plugins) expect(p.entry).not.toContain(`/api/projects/${projectA.id}/`);
  }, 120_000);

  it('[ac:ac-route-projektu-404-dla-nakladki-innego] GET /api/projects/:id/plugins/:name/frontend.js for a plugin contributed only by another project\'s overlay gets 404 with code PLUGIN_FRONTEND_NOT_FOUND', async () => {
    await request(serverApp).get(`/api/projects/${projectA.id}/plugins/local-a/frontend.js`).expect(200);
    const res = await request(serverApp).get(`/api/projects/${projectB.id}/plugins/local-a/frontend.js`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'PLUGIN_FRONTEND_NOT_FOUND', message: expect.any(String) } });
  }, 120_000);

  it('[ac:ac-route-nakladki-id-spoza-workspace-404] a request to the overlay asset route with an :id outside the instance\'s workspace gets 404 with code PROJECT_NOT_IN_WORKSPACE', async () => {
    for (const id of ['not-a-project', foreign.id]) {
      const res = await request(serverApp).get(`/api/projects/${id}/plugins/local-a/frontend.js`);
      expect(res.status, id).toBe(404);
      expect(res.body.error.code, id).toBe('PROJECT_NOT_IN_WORKSPACE');
    }
    // Control: the same path under a member project is served.
    await request(serverApp).get(`/api/projects/${projectA.id}/plugins/local-a/frontend.js`).expect(200);
  }, 120_000);

  it('[ac:ac-wpis-bazowy-ten-sam-entry-w-projektach] a base-tier plugin entry has the same entry address in the frontend manifests of all projects of the process', async () => {
    const entries = [];
    for (const project of [projectA, projectB, revokeRoute]) {
      const e = (await manifestOf(project)).plugins.find((p) => p.name === 'base-glossary');
      expect(e, project.id).toBeDefined();
      entries.push(e!.entry);
    }
    expect(new Set(entries)).toEqual(new Set(['/api/plugins/base-glossary/frontend.js']));
  }, 120_000);

  it('[ac:ac-wzgledny-import-chunka-ten-sam-projekt] a relative chunk import from project :id\'s overlay entry is served by the asset route of the same project :id', async () => {
    const entry = (await manifestOf(projectA)).plugins.find((p) => p.name === 'local-a')!.entry;
    const source = (await request(serverApp).get(entry).expect(200)).text;
    const spec = /from "(\.\/[^"]+)"/.exec(source)![1]!;
    const chunk = new URL(spec, `http://host${entry}`).pathname;
    expect(chunk).toBe(`/api/projects/${projectA.id}/plugins/local-a/chunk-1.js`);
    expect((await request(serverApp).get(chunk).expect(200)).text).toBe('export const CHUNK = "local-a-chunk";');
  }, 120_000);

  it('[ac:ac-cofniecie-zgody-cli-manifest-bez-nakladki] after consent is revoked from the CLI while the server runs, the project manifest stops announcing the overlay frontend without a context rebuild', async () => {
    expect((await manifestOf(revokeManifest)).plugins.map((p) => p.name)).toContain('local-rm');
    const before = await contextOf(revokeManifest);

    // `c4s trust-plugins --cwd <dir> false`: another process writes the registry
    // (`setProjectTrust`), nothing passes through this server.
    const cli = new WorkspaceRegistry(process.env.C4S_HOME);
    cli.setProjectTrust(cli.getWorkspace('default')!, revokeManifest.id, false);

    expect((await manifestOf(revokeManifest)).plugins.map((p) => p.name)).not.toContain('local-rm');
    // Same context instance: no rebuild happened.
    expect(await contextOf(revokeManifest)).toBe(before);
  }, 120_000);

  it('[ac:ac-cofniecie-zgody-cli-route-404] after consent is revoked from the CLI while the server runs, the overlay asset route answers 404 without a context rebuild', async () => {
    const url = `/api/projects/${revokeRoute.id}/plugins/local-rr/frontend.js`;
    await request(serverApp).get(url).expect(200);
    const before = await contextOf(revokeRoute);

    const cli = new WorkspaceRegistry(process.env.C4S_HOME);
    cli.setProjectTrust(cli.getWorkspace('default')!, revokeRoute.id, false);

    for (const asset of ['frontend.js', 'chunk-1.js', 'frontend.css']) {
      const res = await request(serverApp).get(`/api/projects/${revokeRoute.id}/plugins/local-rr/${asset}`);
      expect(res.status, asset).toBe(404);
      expect(res.body.error.code, asset).toBe('PLUGIN_FRONTEND_NOT_FOUND');
    }
    expect(await contextOf(revokeRoute)).toBe(before);
  }, 120_000);

  it('setProjectTrust called in the server process (POST /trust-plugins) invalidates the project context: granted consent takes effect from the next build', async () => {
    expect((await manifestOf(grantInProcess)).plugins.map((p) => p.name)).not.toContain('local-g');
    const before = await contextOf(grantInProcess);

    await request(serverApp)
      .post(`/api/projects/${grantInProcess.id}/trust-plugins`)
      .send({ trust: true })
      .expect(200);

    const after = await contextOf(grantInProcess);
    expect(after).not.toBe(before);
    const local = (await manifestOf(grantInProcess)).plugins.find((p) => p.name === 'local-g');
    expect(local?.entry).toBe(`/api/projects/${grantInProcess.id}/plugins/local-g/frontend.js`);
  }, 120_000);
});
