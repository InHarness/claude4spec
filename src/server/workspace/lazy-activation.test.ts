import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { Router } from 'express';
import request from 'supertest';
import { WorkspaceRegistry } from './registry.js';
import {
  ActivatedProjects,
  activateProject,
  activateProjectDir,
  activatingBuild,
  bootstrapProject,
  WorkspaceHomeNotProjectError,
} from './bootstrap.js';
import { ProjectBuildFailedError, ProjectContextCache } from './context-cache.js';
import { projectDispatchMiddleware } from './middleware.js';
import { workspaceFilePath } from './home-workspace.js';
import type { ProjectContext } from './project-context.js';
import type { ProjectRecord, WorkspaceRecord } from './types.js';
import { configPath } from '../config.js';
import { openDb } from '../db/index.js';
import { configRouter } from '../routes/config.js';
import { errorHandler } from '../routes/errors.js';
import { workspaceRouter } from './routes.js';
import type { SkillRegistry } from '../services/skill-registry.js';
import { parseLaunchArgs, prepareStart } from '../../bin/launch.js';

// Deterministic stand-in for the OS sandbox probe the config response reports
// (same stand-in as config.route.test.ts), so GET /config does not depend on the host.
vi.mock('@inharness-ai/agent-adapters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@inharness-ai/agent-adapters')>();
  return {
    ...actual,
    probePathScope: (...args: Parameters<typeof actual.probePathScope>) => ({
      ...actual.probePathScope(...args),
      strength: 'soft' as const,
    }),
  };
});

/**
 * 2.1.58 — lazy project activation (M01 `dsh8ezbz`, M31 `m31ctx001`, M29
 * `m29idx001`): no project is activated or built before listen; each activates
 * on its first request, from its `config.json` and the code defaults alone (the
 * command line is not a project-config input); a broken config is that
 * activation's error, never the start's; a workspace home is refused.
 */
describe('M01 lazy project activation (2.1.58)', () => {
  let tmp: string;
  let registryHome: string;
  let registry: WorkspaceRegistry;
  let ws: WorkspaceRecord;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-lazy-activation-'));
    registryHome = path.join(tmp, 'registry');
    registry = new WorkspaceRegistry(registryHome);
    ws = registry.selectOrCreate({ name: 'default' });
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const dirOf = (name: string) => {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const writeRawConfig = (cwd: string, text: string) => {
    fs.mkdirSync(path.dirname(configPath(cwd)), { recursive: true });
    fs.writeFileSync(configPath(cwd), text);
  };
  const BASE_ROOT = { id: 'pages', name: 'Pages', dir: 'pages', builtin: true };
  /** The workspace view after this registry's own registrations. */
  const view = () => registry.getWorkspace('default')!;

  /** A stand-in context: the cache and the dispatch middleware need only these. */
  const stubContext = (project: ProjectRecord): ProjectContext => {
    const router = Router();
    router.get('/ping', (_req, res) => {
      res.json({ project: project.id });
    });
    return {
      projectId: project.id,
      cwd: project.cwd,
      router,
      hasInFlightTurn: () => false,
      dispose: async () => {},
    } as unknown as ProjectContext;
  };
  /** The server's composition: the cache builds through `activatingBuild`, requests reach it via the dispatch middleware. */
  const serve = (built: string[]) => {
    const cache = new ProjectContextCache(
      activatingBuild(registry, view(), async (project) => {
        built.push(project.id);
        return stubContext(project);
      }),
    );
    const app = express().use('/api/projects/:id', projectDispatchMiddleware(registry, view(), cache));
    return { app, cache };
  };

  /**
   * The server's registration composition: POST /api/workspace/projects runs
   * `bootstrapProject` with the same record of activated projects the cache's
   * `activatingBuild` reads (as `startServer` wires them).
   */
  const serveWithRegistration = (built: string[], activated = new ActivatedProjects()) => {
    const cache = new ProjectContextCache(
      activatingBuild(
        registry,
        view(),
        async (project) => {
          built.push(project.id);
          return stubContext(project);
        },
        activated,
      ),
    );
    const app = express()
      .use(express.json())
      .use(
        '/api',
        workspaceRouter({
          registry,
          workspace: view(),
          cache,
          mode: 'prod',
          activateProject: async (cwd) => bootstrapProject(registry, view(), cwd, activated).project,
        }),
      )
      .use('/api/projects/:id', projectDispatchMiddleware(registry, view(), cache))
      .use('/api', errorHandler);
    return { app, cache };
  };

  /** Every file under `dir`, relative, sorted (directories omitted). */
  const filesUnder = (dir: string): string[] => {
    const out: string[] = [];
    const walk = (abs: string) => {
      for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        const child = path.join(abs, e.name);
        if (e.isDirectory()) walk(child);
        else out.push(path.relative(dir, child));
      }
    };
    if (fs.existsSync(dir)) walk(dir);
    return out.sort();
  };
  const snapshot = (dir: string) =>
    Object.fromEntries(filesUnder(dir).map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));

  it('[ac:ac-aktywacja-katalogu-ktorego-claude4spe] activation of a directory whose .claude4spec/ carries workspace.json is refused — nothing is written, nothing registered', async () => {
    const home = dirOf('team-home');
    fs.mkdirSync(path.join(home, '.claude4spec'), { recursive: true });
    fs.writeFileSync(workspaceFilePath(home), JSON.stringify({ projects: [], plugins: [] }));
    const before = snapshot(home);

    expect(() => activateProjectDir(registry, ws, home)).toThrow(WorkspaceHomeNotProjectError);
    expect(() => activateProjectDir(registry, ws, home)).toThrow(/workspace\.json/);
    // The refusal is the first step: no config.json, no .gitignore, no root directory.
    expect(snapshot(home)).toEqual(before);
    expect(fs.readdirSync(home)).toEqual(['.claude4spec']);
    expect(fs.readdirSync(path.join(home, '.claude4spec'))).toEqual(['workspace.json']);

    // The registration path refuses before it registers.
    expect(() => bootstrapProject(registry, ws, home)).toThrow(WorkspaceHomeNotProjectError);
    expect(view().projects).toEqual([]);

    // A request to such a project, had it been listed, is that project's build failure.
    const listed = registry.registerProject(ws, home);
    const built: string[] = [];
    const { app } = serve(built);
    const res = await request(app).get(`/api/projects/${listed.id}/ping`);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('PROJECT_BUILD_FAILED');
    expect(res.body.error.message).toContain('workspace.json');
    expect(built).toEqual([]);
    expect(snapshot(home)).toEqual(before);
  });

  it('[ac:ac-aktywacja-katalogu-ktorego-claude4spe] POST /api/workspace/projects at a workspace home answers 400 VALIDATION (never a 500) and registers nothing', async () => {
    const home = dirOf('team-home-post');
    fs.mkdirSync(path.join(home, '.claude4spec'), { recursive: true });
    fs.writeFileSync(workspaceFilePath(home), JSON.stringify({ projects: [], plugins: [] }));
    const before = snapshot(home);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const built: string[] = [];
      const { app } = serveWithRegistration(built);
      const res = await request(app).post('/api/workspace/projects').send({ cwd: home });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
      expect(res.body.error.message).toContain('workspace.json');
      // The refusal is the user's choice, not a server fault: nothing logged as INTERNAL.
      expect(errorLog).not.toHaveBeenCalled();
      expect(view().projects).toEqual([]);
      expect(snapshot(home)).toEqual(before);
      expect(built).toEqual([]);
    } finally {
      errorLog.mockRestore();
    }
  });

  it('[section:dsh8ezbz] a project added through POST /api/workspace/projects is activated once — its first build only builds, it does not re-run the activation\'s file steps', async () => {
    const cwd = dirOf('added');
    const built: string[] = [];
    const { app } = serveWithRegistration(built);

    const added = await request(app).post('/api/workspace/projects').send({ cwd });
    expect(added.status).toBe(201);
    const projectId = added.body.projectId as string;
    expect(view().projects.map((p) => p.id)).toEqual([projectId]);
    // The registration activated it: the fresh config and the managed .gitignore are there.
    expect(fs.existsSync(configPath(cwd))).toBe(true);
    expect(fs.existsSync(path.join(cwd, '.gitignore'))).toBe(true);
    // Remove what the activation wrote: a second activation would write it again.
    fs.rmSync(path.join(cwd, '.gitignore'));

    const first = await request(app).get(`/api/projects/${projectId}/ping`);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ project: projectId });
    expect(built).toEqual([projectId]);
    // The first build did not activate again.
    expect(fs.existsSync(path.join(cwd, '.gitignore'))).toBe(false);

    // Contrast: a build that does not share the registration's record activates
    // (and writes the .gitignore back) — the shared record is what skips it.
    const unshared: string[] = [];
    const { app: other } = serve(unshared);
    expect((await request(other).get(`/api/projects/${projectId}/ping`)).status).toBe(200);
    expect(unshared).toEqual([projectId]);
    expect(fs.existsSync(path.join(cwd, '.gitignore'))).toBe(true);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    '[ac:ac-brak-uprawnien-do-zapisu-do-cwd-erro] no write permission in the project directory → the activation fails with EACCES and the system message',
    async () => {
      const cwd = dirOf('read-only');
      const project = registry.registerProject(ws, cwd);
      fs.chmodSync(cwd, 0o555);
      try {
        let thrown: NodeJS.ErrnoException | undefined;
        try {
          activateProject(registry, view(), project);
        } catch (err) {
          thrown = err as NodeJS.ErrnoException;
        }
        expect(thrown?.code).toBe('EACCES');
        expect(thrown?.message).toMatch(/^EACCES: permission denied, mkdir '.*\.claude4spec'$/);

        // Through the server's build: the project's 500 carries the same system message.
        const built: string[] = [];
        const { app } = serve(built);
        const res = await request(app).get(`/api/projects/${project.id}/ping`);
        expect(res.status).toBe(500);
        expect(res.body.error.code).toBe('PROJECT_BUILD_FAILED');
        expect(res.body.error.message).toMatch(/EACCES: permission denied/);
        expect(built).toEqual([]);
      } finally {
        fs.chmodSync(cwd, 0o755);
      }
    },
  );

  it('[ac:ac-config-json-malformed-json-hard-erro] activating a project whose config.json is not valid JSON fails with the JSON.parse position, and does not go on with an empty config', async () => {
    const cwd = dirOf('malformed');
    const broken = '{ "name": "x", }';
    writeRawConfig(cwd, broken);
    const project = registry.registerProject(ws, cwd);

    expect(() => activateProject(registry, view(), project)).toThrow(/^config\.json: invalid JSON — .*position \d+/);
    // The file stays as the user left it — no fresh file of defaults replaces it.
    expect(fs.readFileSync(configPath(cwd), 'utf8')).toBe(broken);
    expect(fs.readdirSync(cwd)).toEqual(['.claude4spec']);

    // No continuation: the context is never built on an empty config.
    const built: string[] = [];
    const { app } = serve(built);
    const res = await request(app).get(`/api/projects/${project.id}/ping`);
    expect(res.status).toBe(500);
    expect(res.body.error.message).toMatch(/config\.json: invalid JSON — .*position \d+/);
    expect(built).toEqual([]);
    expect(fs.readFileSync(configPath(cwd), 'utf8')).toBe(broken);
  });

  it('[ac:ac-config-json-type-mismatch-np-schem] a config.json type mismatch is a hard error naming the field at activation — no conversion is guessed — while the start goes through', () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['schema-string', { $schemaVersion: '3', name: 'x', roots: [BASE_ROOT] }, "config.json: field '$schemaVersion' expected number, got string"],
      ['entities-string', { $schemaVersion: 4, name: 'x', roots: [BASE_ROOT], entities: 'endpoint' }, "config.json: field 'entities' expected string[], got string"],
    ];
    for (const [name, cfg, message] of cases) {
      const cwd = dirOf(name);
      const text = JSON.stringify(cfg, null, 2);
      writeRawConfig(cwd, text);

      // The start of the workspace listing this very directory is not refused…
      const project = registry.registerProject(view(), cwd);
      const prepared = prepareStart(registry, parseLaunchArgs(['--workspace', 'default'], tmp));
      expect(prepared.workspace.projects.some((p) => p.id === project.id), name).toBe(true);
      // …the activation is, with the field's name.
      expect(() => activateProject(registry, prepared.workspace, project), name).toThrow(message);
      // `"3"` was not "converted" to a number: the file is untouched.
      expect(fs.readFileSync(configPath(cwd), 'utf8'), name).toBe(text);
    }
  });

  it('[ac:ac-projekt-z-nieprawidlowym-config-json] a project with an invalid config.json does not block the process start — the error comes at that project\'s activation, the others serve', async () => {
    const broken = dirOf('broken');
    writeRawConfig(broken, '{ "name": ');
    const fine = dirOf('fine');
    const brokenProject = registry.registerProject(ws, broken);
    const fineProject = registry.registerProject(ws, fine);

    // Both starts — by name and the bare one — prepare without touching the project.
    expect(() => prepareStart(registry, parseLaunchArgs(['--workspace', 'default'], tmp))).not.toThrow();
    const prepared = prepareStart(registry, parseLaunchArgs([], tmp));
    expect(prepared.workspace.projects.map((p) => p.id)).toEqual([brokenProject.id, fineProject.id]);
    expect(fs.readFileSync(configPath(broken), 'utf8')).toBe('{ "name": ');

    // The first request activates: the broken project answers 500, the other serves.
    const built: string[] = [];
    const { app } = serve(built);
    const bad = await request(app).get(`/api/projects/${brokenProject.id}/ping`);
    expect(bad.status).toBe(500);
    expect(bad.body.error.code).toBe('PROJECT_BUILD_FAILED');
    expect(bad.body.error.message).toContain('config.json: invalid JSON');
    const ok = await request(app).get(`/api/projects/${fineProject.id}/ping`);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ project: fineProject.id });
    expect(built).toEqual([fineProject.id]);
  });

  it('[ac:ac-npx-inharness-ai-claude4spec-w-katalo] activating a project with an existing config.json loads the values from the file without rewriting it', () => {
    const cwd = dirOf('existing');
    const text = JSON.stringify({ $schemaVersion: 4, name: 'Kept Name', roots: [{ id: 'docs', name: 'Docs', dir: 'docs', builtin: true }], writingStyle: null, language: 'English', onboardingCompleted: true });
    writeRawConfig(cwd, text);
    const project = registry.registerProject(ws, cwd);

    const first = activateProject(registry, view(), project);
    expect(first.configCreated).toBe(false);
    expect(first.config.name).toBe('Kept Name');
    expect(first.config.language).toBe('English');
    expect(first.config.roots).toEqual([{ id: 'docs', name: 'Docs', dir: 'docs', builtin: true }]);
    expect(fs.readFileSync(configPath(cwd), 'utf8')).toBe(text);

    const second = activateProject(registry, view(), project);
    expect(second.configCreated).toBe(false);
    expect(fs.readFileSync(configPath(cwd), 'utf8')).toBe(text);
  });

  it('[ac:ac-npx-inharness-ai-claude4spec-gola-ko] the bare command builds no project before listen — no .claude4spec/, config, db slot or pages/ in the CWD, nor for a project of the workspace', () => {
    const cwd = dirOf('bare-cwd');
    const listedDir = dirOf('listed');
    const listed = registry.registerProject(ws, listedDir);

    const args = parseLaunchArgs([], cwd);
    const prepared = prepareStart(registry, args);

    expect(prepared.workspace.name).toBe('default');
    expect(fs.readdirSync(cwd)).toEqual([]);
    expect(view().projects.map((p) => p.id)).toEqual([listed.id]);
    // The workspace's own project is not activated either: no config, no pages/, no db.
    expect(fs.readdirSync(listedDir)).toEqual([]);
    expect(fs.existsSync(path.join(registry.slotDir(ws, listed.id), 'db.sqlite'))).toBe(false);
  });

  it('[section:dsh8ezbz] activation is idempotent and reads no flag: a second activation changes nothing, and only the first request activates', async () => {
    const cwd = dirOf('idem');
    const project = registry.registerProject(ws, cwd);
    // Registered, not activated.
    expect(fs.readdirSync(cwd)).toEqual([]);

    const built: string[] = [];
    const { app, cache } = serve(built);
    expect((await request(app).get(`/api/projects/${project.id}/ping`)).status).toBe(200);
    const after = snapshot(cwd);
    expect(Object.keys(after)).toEqual(expect.arrayContaining(['.claude4spec/config.json', '.gitignore']));
    // The cached context serves the next request; no second activation.
    expect((await request(app).get(`/api/projects/${project.id}/ping`)).status).toBe(200);
    expect(built).toEqual([project.id]);
    // A rebuild after an invalidation is a build, not a new activation: what the
    // activation wrote and the user removed since is not written again.
    fs.rmSync(path.join(cwd, '.gitignore'));
    cache.invalidate(project.id);
    expect((await request(app).get(`/api/projects/${project.id}/ping`)).status).toBe(200);
    expect(built).toEqual([project.id, project.id]);
    expect(fs.existsSync(path.join(cwd, '.gitignore'))).toBe(false);
    fs.writeFileSync(path.join(cwd, '.gitignore'), after['.gitignore']!);

    // Re-running the activation creates nothing new and rewrites nothing.
    const again = activateProject(registry, view(), project);
    expect(again.configCreated).toBe(false);
    expect(snapshot(cwd)).toEqual(after);
    // The activation takes the registry, the view and the project — no flags.
    expect(activateProject.length).toBe(3);
  });

  it('[section:85hp4f2v] the start writes nothing into a project of the workspace; its first activation gives it a config file of defaults, and the index lives in the workspace slot', () => {
    const cwd = path.join(tmp, 'goal');
    const project = registry.registerProject(ws, cwd);
    const prepared = prepareStart(registry, parseLaunchArgs(['--workspace', 'default'], tmp));
    expect(fs.existsSync(cwd)).toBe(false);

    const activation = activateProject(registry, prepared.workspace, project);
    expect(activation.configCreated).toBe(true);
    expect(activation.config.name).toBe('goal');
    const db = openDb(registry.slotDir(prepared.workspace, project.id));
    db.close();
    expect(filesUnder(cwd).filter((f) => f.includes('sqlite'))).toEqual([]);
  });

  it('[section:7yzhxgmw] a workspace home is not a project, and the bare command does not register the CWD', () => {
    const home = dirOf('home-dir');
    fs.mkdirSync(path.join(home, '.claude4spec'), { recursive: true });
    fs.writeFileSync(workspaceFilePath(home), JSON.stringify({ projects: [], plugins: [] }));
    expect(() => activateProjectDir(registry, ws, home)).toThrow(WorkspaceHomeNotProjectError);

    const plain = dirOf('plain');
    prepareStart(registry, parseLaunchArgs([], plain));
    expect(view().projects).toEqual([]);
    expect(fs.readdirSync(plain)).toEqual([]);
  });

  it('[section:c0nf1g4a] [section:v878dqht] the file is created at the first activation from the defaults — only the bootstrap key set, onboarding open — the rest comes from the defaults on read', () => {
    const cwd = dirOf('fresh');
    const activation = activateProjectDir(registry, ws, cwd);
    expect(activation.configCreated).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(configPath(cwd), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(onDisk).sort()).toEqual(
      ['$schemaVersion', 'language', 'name', 'onboardingCompleted', 'remoteApiUrl', 'roots', 'writingStyle'].sort(),
    );
    expect(onDisk).toEqual({
      $schemaVersion: 4,
      name: 'fresh',
      roots: [BASE_ROOT],
      writingStyle: null,
      language: null,
      onboardingCompleted: false,
      remoteApiUrl: null,
    });
    // Absent keys are not "off": the read fills them from the defaults.
    expect(activation.config.git.enabled).toBe(false);
    expect(activation.config.agent.disableDirectFilesystemAccess).toBe(true);
  });

  it('[section:3ebblo1q] precedence is the file, then the default; no start flag is a project value — --remote-url is a process value never written to a file', () => {
    // File > default.
    const cwd = dirOf('precedence');
    writeRawConfig(cwd, JSON.stringify({ $schemaVersion: 4, name: 'From File', roots: [BASE_ROOT] }));
    const fromFile = activateProjectDir(registry, ws, cwd);
    expect(fromFile.config.name).toBe('From File');
    expect(fromFile.config.language).toBeNull();

    // The command line carries no project value.
    const args = parseLaunchArgs(['--name', 'Flag Name', '--pages', 'docs', '--remote-url', 'https://staging.example'], tmp);
    expect(Object.keys(args)).not.toContain('name');
    expect(Object.keys(args)).not.toContain('pagesDir');
    expect(Object.values(args)).not.toContain('Flag Name');
    expect(Object.values(args)).not.toContain('docs');

    // --remote-url reaches the server for the process (every project), not a file.
    const prepared = prepareStart(registry, args);
    expect(prepared.workspace.projects).toEqual([]);
    expect(prepared.options.remoteApiUrl).toBe('https://staging.example');
    const fresh = dirOf('remote-fresh');
    activateProjectDir(registry, ws, fresh);
    expect((JSON.parse(fs.readFileSync(configPath(fresh), 'utf8')) as { remoteApiUrl: unknown }).remoteApiUrl).toBeNull();
  });

  it('[section:cfg0gitw] after activation the project .claude4spec/ holds committed text only — the database lives in the workspace slot, outside the project', () => {
    const cwd = dirOf('committed');
    const project = registry.registerProject(ws, cwd);
    activateProject(registry, view(), project);
    const slot = registry.slotDir(ws, project.id);
    const db = openDb(slot);
    db.close();
    expect(fs.existsSync(path.join(slot, 'db.sqlite'))).toBe(true);
    expect(path.relative(cwd, slot).startsWith('..')).toBe(true);
    const files = filesUnder(path.join(cwd, '.claude4spec'));
    expect(files).toEqual(['config.json']);
  });

  it('[section:m31ctx001] no context is built before its first request; a failed activation is cached as that project\'s PROJECT_BUILD_FAILED, the others serve', async () => {
    const good = dirOf('good');
    const bad = dirOf('bad');
    writeRawConfig(bad, '[]');
    const goodProject = registry.registerProject(ws, good);
    const badProject = registry.registerProject(ws, bad);

    const built: string[] = [];
    const { app, cache } = serve(built);
    // Nothing built, nothing activated yet.
    expect(cache.isLive(goodProject.id)).toBe(false);
    expect(fs.readdirSync(good)).toEqual([]);

    const first = await request(app).get(`/api/projects/${badProject.id}/ping`);
    expect(first.status).toBe(500);
    expect(first.body.error.code).toBe('PROJECT_BUILD_FAILED');
    // Within the failed-build window the result is cached: no second activation attempt.
    await expect(cache.get(badProject)).rejects.toBeInstanceOf(ProjectBuildFailedError);

    expect((await request(app).get(`/api/projects/${goodProject.id}/ping`)).status).toBe(200);
    expect(cache.isLive(goodProject.id)).toBe(true);
    expect(built).toEqual([goodProject.id]);
  });

  it('[section:za9e9492] [entity:app-config-response] the activation writes the project directory name, which GET /config returns as `name` for the onboarding pre-fill — every response field with its type', async () => {
    const cwd = dirOf('My Spec Dir');
    const project = registry.registerProject(ws, cwd);
    activateProject(registry, view(), project);

    const app = express()
      .use(express.json())
      .use(
        configRouter({
          cwd,
          skillRegistry: { isSelectable: () => true, unselectableReason: () => '' } as unknown as SkillRegistry,
        }),
      );
    const res = await request(app).get('/config');
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.name).toBe('My Spec Dir');
    expect(body.onboarding).toEqual({ completed: false });
    expect(body.roots).toEqual([BASE_ROOT]);
    expect(typeof body.configHash).toBe('string');
    expect(body.writingStyle).toBeNull();
    expect(body.language).toBeNull();
    expect(body.remoteApiUrl).toBeNull();
    expect(body.$schemaVersion).toBe(4);
    expect(typeof body.agent).toBe('object');
    expect(typeof body.git).toBe('object');
    expect('consistency' in body).toBe(false);
  });
});
