import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PluginRegistryImpl } from '../../../src/server/core/plugin-host/registry.js';
import { registerAllPlugins } from '../../../src/server/core/plugin-host/register-builtins.js';
import { loadBuiltinEnvelopes } from '../../../src/server/core/plugin-host/loader.js';
import { FileWatchRuntime } from '../../../src/server/fs/watcher.js';
import { WsGateway } from '../../../src/server/ws/gateway.js';
import { ProjectContextCache } from '../../../src/server/workspace/context-cache.js';
import { projectDispatchMiddleware } from '../../../src/server/workspace/middleware.js';
import { buildProjectContext, type ProjectContext } from '../../../src/server/workspace/project-context.js';
import { WorkspaceRegistry } from '../../../src/server/workspace/registry.js';
import { backgroundBuild, bootstrapProject, type BackgroundBuildResult } from '../../../src/server/workspace/bootstrap.js';
import { errorHandler } from '../../../src/server/routes/errors.js';
import type { ProjectRecord } from '../../../src/server/workspace/types.js';

/**
 * 2.1.60 — M01 `dsh8ezbz` («Budowa w tle a aktywacja»), through a REAL
 * `buildProjectContext`: the background build (`projectWrites: 'none'`) creates
 * and changes no file in the project directory — no anchor minted into a page,
 * no migration to text — and a project that would need one ends in «needs
 * activation» with its directory untouched. The build with writes (the one
 * after an activation) is the contrast: it does write.
 */
describe('M01 — the background context build writes nothing into the project', () => {
  let home: string;
  let prevHome: string | undefined;
  let registry: WorkspaceRegistry;
  let httpServer: http.Server;
  let watchRuntime: FileWatchRuntime;
  /** The build with writes, behind the server's cache and dispatch (REST writes the entity files). */
  let cache: ProjectContextCache;
  let app: express.Express;
  let background: (project: ProjectRecord) => Promise<BackgroundBuildResult<ProjectContext>>;

  const ENTITIES = path.join('.claude4spec', 'entities');

  beforeAll(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-m01-background-'));
    prevHome = process.env.C4S_HOME;
    process.env.C4S_HOME = path.join(home, 'registry');
    registry = new WorkspaceRegistry(process.env.C4S_HOME);
    const workspace = registry.selectOrCreate({ name: 'default' });

    const pluginRegistry = new PluginRegistryImpl();
    registerAllPlugins(pluginRegistry);
    const envelopeLoad = await loadBuiltinEnvelopes(pluginRegistry);
    httpServer = http.createServer();
    const gateway = new WsGateway(httpServer, () => true);
    watchRuntime = new FileWatchRuntime({ broadcaster: { broadcast: () => {} } });
    const frontendBase = { workspacePackages: [], envelopes: [], resolveWorkspaceRoot: () => null };
    const build = (project: ProjectRecord, projectWrites: 'allowed' | 'none') =>
      buildProjectContext({
        registry,
        pluginRegistry,
        pluginRecords: envelopeLoad.records,
        frontendBase,
        workspace: registry.getWorkspace('default')!,
        projectId: project.id,
        cwd: project.cwd,
        gateway,
        watchRuntime,
        mode: 'prod',
        projectWrites,
      });
    cache = new ProjectContextCache((project) => build(project, 'allowed'));
    background = backgroundBuild(registry, (project, mode) => build(project, mode.projectWrites));
    app = express();
    app.use(express.json());
    app.use('/api/projects/:id', projectDispatchMiddleware(registry, workspace, cache));
    app.use('/api', errorHandler);
  }, 60_000);

  afterAll(async () => {
    await cache.disposeAll();
    await watchRuntime.close();
    httpServer.close();
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  /** Every file under `dir` with its bytes and mtime, plus every directory. */
  const snapshot = (dir: string) => {
    const files: Record<string, { bytes: string; mtimeMs: number }> = {};
    const dirs: string[] = [];
    const walk = (abs: string) => {
      for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        const child = path.join(abs, e.name);
        const rel = path.relative(dir, child);
        if (e.isDirectory()) {
          dirs.push(rel);
          walk(child);
        } else {
          files[rel] = { bytes: fs.readFileSync(child, 'base64'), mtimeMs: fs.statSync(child).mtimeMs };
        }
      }
    };
    walk(dir);
    return { files, dirs: dirs.sort() };
  };

  /** A project activated at registration, one entity created through REST, its context released. */
  async function projectWithEntity(name: string): Promise<{ project: ProjectRecord; slug: string }> {
    const project = bootstrapProject(registry, registry.getWorkspace('default')!, path.join(home, name)).project;
    const created = await request(app).post(`/api/projects/${project.id}/acs`).send({ title: `${name} holds` });
    expect(created.status).toBe(201);
    const slug = created.body.data.slug as string;
    expect(fs.existsSync(path.join(project.cwd, ENTITIES, 'ac', `${slug}.json`))).toBe(true);
    await (await cache.get(project)).bootSettled;
    await cache.retire(project.id);
    return { project, slug };
  }

  /** A page whose headings carry no anchor — a build with writes mints them into the file. */
  const PAGE = '# Notes\n\n## First\n\nSome text.\n\n## Second\n\nMore text.\n';

  it('[ac:ac-budowa-kontekstu-w-tle-nie-tworzy-ani] the background build creates and changes no file in the project directory — the context is built and its index filled all the same', async () => {
    const { project, slug } = await projectWithEntity('background-ready');
    fs.writeFileSync(path.join(project.cwd, 'pages', 'notes.md'), PAGE);
    const before = snapshot(project.cwd);

    const result = await background(project);
    expect(result.state).toBe('ready');
    if (result.state !== 'ready') return;
    const ctx = result.context;
    try {
      // The boot passes (anchor injection would run there) have finished.
      await ctx.bootSettled;
      // The context is real: the entity index was rebuilt from the files.
      const rows = ctx.db.handle.prepare('SELECT slug FROM ac').all() as Array<{ slug: string }>;
      expect(rows.map((r) => r.slug)).toContain(slug);

      const after = snapshot(project.cwd);
      // No file created, none changed — bytes and mtime alike.
      expect(after.files).toEqual(before.files);
      expect(fs.readFileSync(path.join(project.cwd, 'pages', 'notes.md'), 'utf8')).toBe(PAGE);
      // No directory created either: every registry root's directory was already there.
      expect(after.dirs).toEqual(before.dirs);
    } finally {
      await ctx.dispose();
    }

    // Contrast — the build with writes (after an activation) mints the anchors into the page.
    const written = await cache.get(project);
    await written.bootSettled;
    expect(fs.readFileSync(path.join(project.cwd, 'pages', 'notes.md'), 'utf8')).not.toBe(PAGE);
    await cache.retire(project.id);
  });

  it('[ac:ac-budowa-kontekstu-w-tle-nie-tworzy-ani] [section:dsh8ezbz] the background build of a project whose entities live only in the database (a migration to text) ends in «needs activation» and writes no entity file — the build with writes exports them', async () => {
    const { project, slug } = await projectWithEntity('background-text-migration');
    // The committed text is gone; the slot's index still holds the entity.
    const acDir = path.join(project.cwd, ENTITIES, 'ac');
    fs.rmSync(path.join(acDir, `${slug}.json`));
    const before = snapshot(project.cwd);

    const result = await background(project);
    expect(result).toEqual({ state: 'needs-activation', needs: ['text-migration'] });
    expect(snapshot(project.cwd)).toEqual(before);
    expect(fs.existsSync(path.join(acDir, `${slug}.json`))).toBe(false);

    // The build with writes is the one that exports the entity back to text.
    const written = await cache.get(project);
    await written.bootSettled;
    expect(fs.existsSync(path.join(acDir, `${slug}.json`))).toBe(true);
    await cache.retire(project.id);
  });

  it('[ac:ac-budowa-projektu-ktorego-katalog-nie-i] a REAL background build of a project whose directory was removed fails and does not recreate it', async () => {
    const { project } = await projectWithEntity('background-removed');
    fs.rmSync(project.cwd, { recursive: true, force: true });

    await expect(background(project)).rejects.toThrow(/does not exist/);
    expect(fs.existsSync(project.cwd)).toBe(false);
  });
});
