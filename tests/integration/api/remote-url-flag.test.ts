import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
import { ProjectContextCache, type ProjectBuildStateChange } from '../../../src/server/workspace/context-cache.js';
import { projectDispatchMiddleware } from '../../../src/server/workspace/middleware.js';
import { buildProjectContext, type ProjectContext } from '../../../src/server/workspace/project-context.js';
import { WorkspaceRegistry } from '../../../src/server/workspace/registry.js';
import { activatingBuild, backgroundBuild, bootstrapProject } from '../../../src/server/workspace/bootstrap.js';
import { configPath } from '../../../src/server/config.js';
import { PROD_REMOTE_URL } from '../../../src/server/services/remote-http-client.js';
import type { ProjectRecord, WorkspaceRecord } from '../../../src/server/workspace/types.js';

/**
 * 2.1.58 (M24 `ux690pt2`, M01 `3ebblo1q`) — the effective remote address on a
 * REAL project build, behind the cache and the dispatch middleware the server
 * mounts, with the activation on the first request (`activatingBuild`, as
 * `startServer` wires it). `--remote-url` reaches the build as the process
 * value `deps.remoteApiUrl` (`startServer` → every project's build); which
 * address a project talks to is read off the outbound request of its first
 * remote action (`POST /remote-account/login/start` → `/v1/auth/device/code`),
 * captured by a stubbed `fetch`.
 */
describe('--remote-url and config.remoteApiUrl on a real project build (M24)', () => {
  const FLAG = 'https://flag.example';
  const CONFIGURED = 'https://configured.example';

  let home: string;
  let prevHome: string | undefined;
  let registry: WorkspaceRegistry;
  let workspace: WorkspaceRecord;
  let httpServer: http.Server;
  let watchRuntime: FileWatchRuntime;
  const caches: ProjectContextCache[] = [];
  /** A process started WITH `--remote-url FLAG`. */
  let flagApp: express.Express;
  /** A process started without the flag. */
  let plainApp: express.Express;

  /** One real context build — the process value `--remote-url`, the project, the build's write mode. */
  let buildWith: (
    remoteApiUrl: string | undefined,
    project: ProjectRecord,
    projectWrites: 'allowed' | 'none',
  ) => Promise<ProjectContext>;
  const appOver = (cache: ProjectContextCache): express.Express => {
    const app = express();
    app.use(express.json());
    app.use('/api/projects/:id', projectDispatchMiddleware(registry, workspace, cache));
    return app;
  };

  /** Projects: with a configured remote, without one, invalid, unreachable — one per process each. */
  const projects: Record<string, ProjectRecord> = {};

  function addProject(name: string, remoteApiUrl: string | null): ProjectRecord {
    const cwd = path.join(home, name);
    const project = bootstrapProject(registry, workspace, cwd).project;
    const file = configPath(cwd);
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    fs.writeFileSync(file, JSON.stringify({ ...cfg, remoteApiUrl }, null, 2));
    return project;
  }

  const readRaw = (project: ProjectRecord): string => fs.readFileSync(configPath(project.cwd), 'utf8');

  /** The outbound URLs the stubbed remote saw. */
  let outbound: string[];
  function stubRemote(): void {
    outbound = [];
    vi.stubGlobal('fetch', async (input: string | URL) => {
      outbound.push(String(input));
      return new Response(
        JSON.stringify({
          device_code: 'dc-1',
          user_code: 'ABCD-0001',
          verification_uri: 'https://remote.example/device',
          verification_uri_complete: 'https://remote.example/device?code=ABCD-0001',
          expires_in: 900,
          interval: 5,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
  }

  beforeAll(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-remote-url-'));
    prevHome = process.env.C4S_HOME;
    process.env.C4S_HOME = path.join(home, 'registry');
    registry = new WorkspaceRegistry(process.env.C4S_HOME);
    workspace = registry.selectOrCreate({ name: 'default' });

    projects.flagConfigured = addProject('flag-configured', CONFIGURED);
    projects.flagBare = addProject('flag-bare', null);
    projects.plainConfigured = addProject('plain-configured', CONFIGURED);
    projects.plainBare = addProject('plain-bare', null);
    projects.invalid = addProject('invalid', 'not-a-url');
    // Syntactically valid, nothing listens there: a closed loopback port.
    projects.unreachable = addProject('unreachable', 'http://127.0.0.1:1');
    workspace = registry.getWorkspace('default')!;

    const pluginRegistry = new PluginRegistryImpl();
    registerAllPlugins(pluginRegistry);
    const envelopeLoad = await loadBuiltinEnvelopes(pluginRegistry);
    httpServer = http.createServer();
    const gateway = new WsGateway(httpServer, () => true);
    watchRuntime = new FileWatchRuntime({ broadcaster: { broadcast: () => {} } });
    const frontendBase = { workspacePackages: [], envelopes: [], resolveWorkspaceRoot: () => null };

    buildWith = (remoteApiUrl, project, projectWrites) =>
      buildProjectContext({
        registry,
        pluginRegistry,
        pluginRecords: envelopeLoad.records,
        frontendBase,
        workspace,
        projectId: project.id,
        cwd: project.cwd,
        gateway,
        watchRuntime,
        mode: 'prod',
        remoteApiUrl,
        projectWrites,
      });
    const serve = (remoteApiUrl: string | undefined): express.Express => {
      const cache = new ProjectContextCache(
        activatingBuild(registry, workspace, (project) => buildWith(remoteApiUrl, project, 'allowed')),
      );
      caches.push(cache);
      return appOver(cache);
    };
    flagApp = serve(FLAG);
    plainApp = serve(undefined);
  }, 60_000);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    for (const cache of caches) await cache.disposeAll();
    httpServer.close();
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  /** Builds the project (first request), then runs its first remote action; returns the address it went to. */
  async function remoteOf(app: express.Express, project: ProjectRecord): Promise<string> {
    expect((await request(app).get(`/api/projects/${project.id}/meta`)).status).toBe(200);
    stubRemote();
    const res = await request(app).post(`/api/projects/${project.id}/remote-account/login/start`);
    vi.unstubAllGlobals();
    expect(res.status).toBe(200);
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.endsWith('/v1/auth/device/code')).toBe(true);
    return outbound[0]!.slice(0, -'/v1/auth/device/code'.length);
  }

  // One project build per test (the default timeout carries one build): the
  // flag's process — flag > config, flag > production — and the same files
  // without the flag — config > production.
  it.each([
    { process: 'with --remote-url', app: () => flagApp, project: 'flagConfigured', expected: () => FLAG, rule: 'the flag over its config.remoteApiUrl' },
    { process: 'with --remote-url', app: () => flagApp, project: 'flagBare', expected: () => FLAG, rule: 'the flag over the production constant' },
    { process: 'without the flag', app: () => plainApp, project: 'plainConfigured', expected: () => CONFIGURED, rule: 'config.remoteApiUrl over the production constant' },
    { process: 'without the flag', app: () => plainApp, project: 'plainBare', expected: () => PROD_REMOTE_URL, rule: 'the production constant' },
  ])('[ac:ac-remote-url-url-ustawia-effectivec] $process, project $project talks to $rule', async ({ app, project, expected }) => {
    expect(await remoteOf(app(), projects[project]!)).toBe(expected());
  });

  it('[ac:ac-remote-url-url-nie-zapisuje-wartosci] --remote-url writes its value to no project\'s config.json — the activation, the build and the remote action leave remoteApiUrl as the file had it', async () => {
    const before = {
      configured: readRaw(projects.flagConfigured!),
      bare: readRaw(projects.flagBare!),
    };
    // Activated, built and used under the flag (the build is cached — this also
    // covers a project that the previous test built).
    await remoteOf(flagApp, projects.flagConfigured!);
    await remoteOf(flagApp, projects.flagBare!);

    for (const [project, raw, expected] of [
      [projects.flagConfigured!, before.configured, CONFIGURED],
      [projects.flagBare!, before.bare, null],
    ] as const) {
      const after = readRaw(project);
      expect(after).not.toContain(FLAG);
      expect((JSON.parse(after) as { remoteApiUrl: unknown }).remoteApiUrl).toBe(expected);
      expect(JSON.parse(after)).toEqual(JSON.parse(raw));
    }
    // No file anywhere under the workspace's projects or the registry carries the flag.
    const all: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.json')) all.push(p);
      }
    };
    walk(home);
    expect(all.length).toBeGreaterThan(0);
    for (const file of all) expect(fs.readFileSync(file, 'utf8'), file).not.toContain(FLAG);
    // Two project builds when run alone (the precedence cases build them otherwise).
  }, 30_000);

  it('[ac:ac-nieparsowalny-bez-schematu-remoteapiur] an unparsable remoteApiUrl is a hard error "config.json: field \'remoteApiUrl\': invalid URL" in the cause of the project\'s failed build; a valid but unreachable one builds normally and fails only its first remote action, gracefully', async () => {
    // The server's composition: the background build queue after listen.
    const cache = new ProjectContextCache(
      activatingBuild(registry, workspace, (project) => buildWith(undefined, project, 'allowed')),
      { background: backgroundBuild(registry, (project, mode) => buildWith(undefined, project, mode.projectWrites)) },
    );
    caches.push(cache);
    const outcomes = new Map<string, ProjectBuildStateChange>();
    const settled = new Promise<void>((resolve) => {
      cache.onStateChange((change) => {
        if (change.state === 'queued' || change.state === 'building') return;
        outcomes.set(change.projectId, change);
        if (outcomes.size === 2) resolve();
      });
    });
    cache.start([projects.invalid!, projects.unreachable!]);
    await settled;
    // The invalid address: the failed build, its cause naming the field.
    expect(outcomes.get(projects.invalid!.id)).toEqual({
      projectId: projects.invalid!.id,
      state: 'failed',
      cause: expect.stringContaining("config.json: field 'remoteApiUrl': invalid URL"),
    });
    // The unreachable one: built normally — no probe at the build.
    expect(outcomes.get(projects.unreachable!.id)).toEqual({ projectId: projects.unreachable!.id, state: 'ready' });

    const app = appOver(cache);
    const bad = await request(app).get(`/api/projects/${projects.invalid!.id}/meta`);
    expect(bad.status).toBe(500);
    expect(bad.body.error.code).toBe('PROJECT_BUILD_FAILED');
    expect(bad.body.error.message).toContain("config.json: field 'remoteApiUrl': invalid URL");

    // Unreachable: the project serves from its background build.
    const base = `/api/projects/${projects.unreachable!.id}`;
    expect((await request(app).get(`${base}/meta`)).status).toBe(200);
    expect((await request(app).get(`${base}/remote-account`)).body).toEqual({ connected: false });

    // The first remote action fails — that action only, with the reachability error.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const login = await request(app).post(`${base}/remote-account/login/start`);
      expect(login.status).toBe(500);
      expect(login.body.error.message).toContain('request to remote /v1/auth/device/code failed');
    } finally {
      errSpy.mockRestore();
    }
    // … and the project keeps serving.
    expect((await request(app).get(`${base}/meta`)).status).toBe(200);
    // Two background builds (one fails at its config read, one builds).
  }, 30_000);
});
