import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry } from '../workspace/registry.js';
import { bootstrapProject } from '../workspace/bootstrap.js';
import { workspaceFilePath } from '../workspace/home-workspace.js';
import { workspaceRouter } from '../workspace/routes.js';
import { errorHandler } from './errors.js';
import { configPath } from '../config.js';
import { ProjectContextCache } from '../workspace/context-cache.js';
import type { BackgroundBuildResult } from '../workspace/bootstrap.js';
import type { ProjectContext } from '../workspace/project-context.js';
import type { WorkspaceRecord } from '../workspace/types.js';

/**
 * 2.1.58 (M31 L4, `m31boot01`, `7fgfpqzf`) — the workspace routes in both kinds
 * of workspace, through the real registry and the real registration with
 * activation (`bootstrapProject`, as `startServer` wires it):
 * `GET /api/workspace` (WorkspaceResponse), the directory browser's start,
 * adding a project to a workspace with a home (relative path in
 * `workspace.json`, two refusals before anything is written) and its detach.
 */
describe('M31 workspace routes — workspace with a home and registry workspace (2.1.58)', () => {
  let tmp: string;
  let registryHome: string;
  let home: string;
  let registry: WorkspaceRegistry;

  const registryFile = () => path.join(registryHome, 'workspaces.json');
  const readWorkspaceJson = () => JSON.parse(fs.readFileSync(workspaceFilePath(home), 'utf8')) as {
    projects: Array<{ id: string; path: string }>;
    plugins: string[];
  };
  const dirOf = (...segments: string[]) => {
    const dir = path.join(...segments);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-ws-route-'));
    registryHome = dirOf(tmp, 'registry');
    home = dirOf(tmp, 'repo');
    dirOf(home, '.claude4spec');
    dirOf(home, 'services', 'api');
    fs.writeFileSync(
      workspaceFilePath(home),
      JSON.stringify({ projects: [{ id: 'api', path: 'services/api' }], plugins: [] }, null, 2),
    );
    fs.writeFileSync(
      registryFile(),
      JSON.stringify({
        $schemaVersion: 3,
        workspaces: [
          { name: 'team', mode: 'prod', defaultPort: 4601, home },
          { name: 'solo', mode: 'prod', defaultPort: 4602, projects: [] },
        ],
      }),
    );
    registry = new WorkspaceRegistry(registryHome);
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const cache = {
    readStates: () => new Map(),
    enqueue: () => {},
    getLive: () => null,
    retire: async () => {},
    remove: () => {},
  } as unknown as ProjectContextCache;

  /** The server's composition for one workspace: its start view, the POST through `bootstrapProject`. */
  const appFor = (
    name: string,
    contexts: ProjectContextCache = cache,
  ): { app: express.Express; view: WorkspaceRecord } => {
    const view = registry.openView(name);
    const app = express()
      .use(express.json())
      .use(
        '/api',
        workspaceRouter({
          registry,
          workspace: view,
          cache: contexts,
          mode: 'prod',
          activateProject: async (cwd) => bootstrapProject(registry, view, cwd).project,
        }),
      )
      .use('/api', errorHandler);
    return { app, view };
  };

  /** Every file under `dir` with its content (directories omitted). */
  const snapshot = (dir: string): Record<string, string> => {
    const out: Record<string, string> = {};
    const walk = (abs: string) => {
      for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        const child = path.join(abs, e.name);
        if (e.isDirectory()) walk(child);
        else out[path.relative(dir, child)] = fs.readFileSync(child, 'utf8');
      }
    };
    if (fs.existsSync(dir)) walk(dir);
    return out;
  };

  it('[entity:get-api-workspace] [entity:workspace-response] [ac:ac-get-api-workspace-zwraca-nazwe-rodzaj] GET /api/workspace answers 200 with the name, kind and lastOpenedProject of the workspace the process serves — and writes nothing', async () => {
    const { app } = appFor('team');
    registry.touchLastOpened('team', 'api');
    const before = { registry: fs.readFileSync(registryFile(), 'utf8'), home: snapshot(home) };

    const res = await request(app).get('/api/workspace');

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('team');
    expect(res.body.kind).toBe('home');
    expect(res.body.lastOpenedProject).toBe('api');
    // WorkspaceResponse: every field present with its type.
    expect(typeof res.body.name).toBe('string');
    expect(['registry', 'home']).toContain(res.body.kind);
    expect(typeof res.body.lastOpenedProject).toBe('string');
    // A read: neither the registry nor the home changed.
    expect(fs.readFileSync(registryFile(), 'utf8')).toBe(before.registry);
    expect(snapshot(home)).toEqual(before.home);
  });

  it('[entity:get-api-workspace] [entity:workspace-response] [ac:ac-get-api-workspace-zwraca-nazwe-rodzaj] a fresh registry workspace answers kind `registry` and lastOpenedProject `null`; a last opened id that left the workspace reads as `null`', async () => {
    const { app } = appFor('solo');
    const fresh = await request(app).get('/api/workspace');
    expect(fresh.status).toBe(200);
    expect(fresh.body).toMatchObject({ name: 'solo', kind: 'registry', lastOpenedProject: null });
    expect(fresh.body).toHaveProperty('lastOpenedProject', null);

    registry.touchLastOpened('solo', 'gone');
    const stale = await request(app).get('/api/workspace');
    expect(stale.body.lastOpenedProject).toBeNull();
  });

  it('[entity:get-api-workspace-fs] without `path` the directory browser starts at the workspace home when the workspace has one, at the process CWD otherwise; it lists directories only and answers a missing path with 400 VALIDATION', async () => {
    fs.writeFileSync(path.join(home, 'README.md'), 'x');
    const atHome = await request(appFor('team').app).get('/api/workspace/fs');
    expect(atHome.status).toBe(200);
    expect(atHome.body.path).toBe(home);
    expect(atHome.body.parent).toBe(path.dirname(home));
    // Directories only — README.md is a file.
    expect(atHome.body.entries.map((e: { name: string }) => e.name).sort()).toEqual(['.claude4spec', 'services']);

    const atCwd = await request(appFor('solo').app).get('/api/workspace/fs');
    expect(atCwd.status).toBe(200);
    expect(atCwd.body.path).toBe(process.cwd());

    const missing = await request(appFor('team').app).get('/api/workspace/fs').query({ path: path.join(tmp, 'nope') });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION');
  });

  it('[entity:post-api-workspace-projects] [ac:ac-projekt-dodany-w-workspace-ie-z-katal] [section:m31boot01] a project added in a workspace with a home lands in workspace.json with its path relative to the home, and answers 201 { projectId }', async () => {
    const { app } = appFor('team');
    const billing = dirOf(home, 'services', 'billing');

    const res = await request(app).post('/api/workspace/projects').send({ cwd: billing });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ projectId: 'billing' });
    expect(readWorkspaceJson().projects).toEqual([
      { id: 'api', path: 'services/api' },
      { id: 'billing', path: 'services/billing' },
    ]);
    // Activated without any start flag: the project got its config file.
    expect(fs.existsSync(configPath(billing))).toBe(true);
    // The view follows at once.
    expect((await request(app).get('/api/workspace')).body.projects.map((p: { id: string }) => p.id)).toEqual([
      'api',
      'billing',
    ]);
  });

  it('[entity:post-api-workspace-projects] [ac:ac-dodanie-projektu-spoza-katalogu-domow] adding a directory outside the workspace home is refused with PROJECT_PATH_OUTSIDE_HOME before anything is written', async () => {
    const { app } = appFor('team');
    const elsewhere = dirOf(tmp, 'elsewhere');
    const before = snapshot(home);

    const res = await request(app).post('/api/workspace/projects').send({ cwd: elsewhere });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PROJECT_PATH_OUTSIDE_HOME');
    expect(snapshot(home)).toEqual(before);
    expect(snapshot(elsewhere)).toEqual({});
    expect(fs.existsSync(path.join(elsewhere, '.claude4spec'))).toBe(false);
  });

  it('[entity:post-api-workspace-projects] [ac:ac-dodanie-samego-katalogu-domowego-work] adding the workspace home itself as a project is refused with PROJECT_PATH_IS_HOME before anything is written', async () => {
    const { app } = appFor('team');
    const before = snapshot(home);

    const res = await request(app).post('/api/workspace/projects').send({ cwd: home });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PROJECT_PATH_IS_HOME');
    expect(snapshot(home)).toEqual(before);
    expect(fs.existsSync(configPath(home))).toBe(false);
  });

  it('[ac:ac-detach-projektu-w-workspace-ie-z-kata] [section:7fgfpqzf] detaching a project of a workspace with a home removes its entry from workspace.json; the slot in local/ and the project files stay — purge removes the slot', async () => {
    const { app, view } = appFor('team');
    const api = path.join(home, 'services', 'api');
    fs.writeFileSync(path.join(api, 'notes.md'), 'keep me');
    const billing = registry.registerProject(view, dirOf(home, 'services', 'billing'));
    const apiSlot = registry.prepareSlot(view, 'api', api);
    const billingSlot = registry.slotDir(view, billing.id);

    const detach = await request(app).delete('/api/workspace/projects/api');
    expect(detach.status).toBe(200);
    expect(readWorkspaceJson().projects).toEqual([{ id: 'billing', path: 'services/billing' }]);
    expect(fs.existsSync(apiSlot)).toBe(true);
    expect(fs.readFileSync(path.join(api, 'notes.md'), 'utf8')).toBe('keep me');
    expect(detach.body.projects.map((p: { id: string }) => p.id)).toEqual(['billing']);

    const purge = await request(app).delete('/api/workspace/projects/billing').query({ purgeData: 'true' });
    expect(purge.status).toBe(200);
    expect(readWorkspaceJson().projects).toEqual([]);
    expect(fs.existsSync(billingSlot)).toBe(false);
    expect(fs.existsSync(path.join(home, 'services', 'billing'))).toBe(true);
  });

  it('[ac:ac-purge-projektu-w-trakcie-jego-budowy] [section:7fgfpqzf] a purge of a project during its build deletes the db slot only after the context that build produced is released', async () => {
    // The real cache; the project's background build is held open by the test.
    let finishBuild!: (result: BackgroundBuildResult<ProjectContext>) => void;
    const contexts = new ProjectContextCache(
      async () => {
        throw new Error('no activation in this case');
      },
      { background: () => new Promise((resolve) => (finishBuild = resolve)) },
    );
    const tick = () => new Promise((resolve) => setImmediate(resolve));
    try {
      const { app, view } = appFor('team', contexts);
      const api = path.join(home, 'services', 'api');
      const apiSlot = registry.prepareSlot(view, 'api', api);
      fs.writeFileSync(path.join(apiSlot, 'db.sqlite'), '');
      contexts.start(view.projects);
      await tick();
      expect(contexts.readStates().get('api')).toBe('building');

      let answered = false;
      const purge = request(app)
        .delete('/api/workspace/projects/api')
        .query({ purgeData: 'true' })
        .then((res) => {
          answered = true;
          return res;
        });
      // The route has removed the entry and now waits for the build to end:
      // the slot is still there, and there is no answer yet.
      while (readWorkspaceJson().projects.length > 0) await tick();
      for (let i = 0; i < 5; i++) await tick();
      expect(answered).toBe(false);
      expect(fs.existsSync(path.join(apiSlot, 'db.sqlite'))).toBe(true);

      // The build ends: its context is released first — the slot still on disk
      // while it closes — and only then the slot goes.
      const slotAtDispose: boolean[] = [];
      const built = {
        projectId: 'api',
        hasInFlightTurn: () => false,
        dispose: async () => {
          slotAtDispose.push(fs.existsSync(path.join(apiSlot, 'db.sqlite')));
        },
      } as unknown as ProjectContext;
      finishBuild({ state: 'ready', context: built });
      const res = await purge;
      expect(res.status).toBe(200);
      expect(slotAtDispose).toEqual([true]);
      expect(fs.existsSync(apiSlot)).toBe(false);
      expect(contexts.getLive('api')).toBeNull();
      expect(contexts.readStates().has('api')).toBe(false);
    } finally {
      await contexts.disposeAll();
    }
  });

  it('[section:7fgfpqzf] rev-0021: when this machine dropped the stored entry after the start, detach, purge and registration are refused with 409 WORKSPACE_NOT_REGISTERED — workspace.json, the registry, the slot and the project directory (no .claude4spec/) stay as they were', async () => {
    const { app, view } = appFor('team');
    const apiSlot = registry.prepareSlot(view, 'api', path.join(home, 'services', 'api'));
    fs.writeFileSync(path.join(apiSlot, 'keep.db'), 'x');
    // Another process of this machine drops the entry: the route's view is stale.
    fs.writeFileSync(
      registryFile(),
      JSON.stringify({ $schemaVersion: 3, workspaces: [{ name: 'solo', mode: 'prod', defaultPort: 4602, projects: [] }] }),
    );
    const before = { registry: fs.readFileSync(registryFile(), 'utf8'), workspaceJson: fs.readFileSync(workspaceFilePath(home), 'utf8') };

    const detach = await request(app).delete('/api/workspace/projects/api');
    expect(detach.status).toBe(409);
    expect(detach.body.error.code).toBe('WORKSPACE_NOT_REGISTERED');
    expect(detach.body.projects).toBeUndefined();

    const purge = await request(app).delete('/api/workspace/projects/api').query({ purgeData: 'true' });
    expect(purge.status).toBe(409);
    expect(purge.body.error.code).toBe('WORKSPACE_NOT_REGISTERED');
    expect(fs.existsSync(path.join(apiSlot, 'keep.db'))).toBe(true);

    const billing = dirOf(home, 'services', 'billing');
    const add = await request(app).post('/api/workspace/projects').send({ cwd: billing });
    expect(add.status).toBe(409);
    expect(add.body.error.code).toBe('WORKSPACE_NOT_REGISTERED');
    // rev-0022: refused before the activation — the project directory is untouched.
    expect(fs.existsSync(path.join(billing, '.claude4spec'))).toBe(false);
    expect(fs.readdirSync(billing)).toEqual([]);

    expect(fs.readFileSync(registryFile(), 'utf8')).toBe(before.registry);
    expect(fs.readFileSync(workspaceFilePath(home), 'utf8')).toBe(before.workspaceJson);
  });

  it('[section:7fgfpqzf] rev-0021: a registry workspace whose stored entry is gone refuses detach with 409 WORKSPACE_NOT_REGISTERED instead of reporting it done, and refuses registration with it before the project directory is touched', async () => {
    const project = registry.registerProject(registry.openView('solo'), dirOf(tmp, 'solo-project'));
    // The process's view is taken while the entry still lists the project.
    const { app } = appFor('solo');
    fs.writeFileSync(
      registryFile(),
      JSON.stringify({ $schemaVersion: 3, workspaces: [{ name: 'team', mode: 'prod', defaultPort: 4601, home }] }),
    );
    const before = fs.readFileSync(registryFile(), 'utf8');

    const res = await request(app).delete(`/api/workspace/projects/${project.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('WORKSPACE_NOT_REGISTERED');

    // rev-0022: the registration is refused before the activation — the
    // directory gets no `.claude4spec/`, no config, no root directories.
    const fresh = dirOf(tmp, 'solo-fresh');
    const add = await request(app).post('/api/workspace/projects').send({ cwd: fresh });
    expect(add.status).toBe(409);
    expect(add.body.error.code).toBe('WORKSPACE_NOT_REGISTERED');
    expect(fs.existsSync(path.join(fresh, '.claude4spec'))).toBe(false);
    expect(fs.readdirSync(fresh)).toEqual([]);
    expect(fs.readFileSync(registryFile(), 'utf8')).toBe(before);
  });
});
