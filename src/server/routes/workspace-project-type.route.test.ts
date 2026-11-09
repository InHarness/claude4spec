import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry } from '../workspace/registry.js';
import {
  activateProject,
  activateProjectDir,
  backgroundActivationSteps,
  bootstrapProject,
  settleProjectType,
} from '../workspace/bootstrap.js';
import { workspaceFilePath } from '../workspace/home-workspace.js';
import { workspaceRouter } from '../workspace/routes.js';
import { errorHandler } from './errors.js';
import { configPath, readConfig } from '../config.js';
import { SPEC_WELCOME_TEMPLATE } from '../project-types/entries.js';
import type { ProjectContextCache } from '../workspace/context-cache.js';
import type { WorkspaceRecord } from '../workspace/types.js';

/**
 * 2.1.77 (M31 `bzgfftsf`, `m31boot01`, `t97gncju`; M01 `dsh8ezbz`, `v878dqht`,
 * `qi8w2tmj`, `hbib9dy0`; M57 `zy42cyj7`, `366wogto`) — registration with a
 * project type: `POST /api/workspace/projects` tells the path by the presence of
 * `projectType`, refuses a directory that does not fit it or an unknown type
 * before anything is written, writes the type to `config.json` and its copy to
 * the workspace record; the activation settles the type and refuses a conflict,
 * an unknown type and a mismatch with the copy.
 */
describe('[entity:post-api-workspace-projects] [entity:add-project-request] registration and activation with a project type', () => {
  let tmp: string;
  let registryHome: string;
  let home: string;
  let registry: WorkspaceRegistry;

  const registryFile = () => path.join(registryHome, 'workspaces.json');
  const readWorkspaceJson = () =>
    JSON.parse(fs.readFileSync(workspaceFilePath(home), 'utf8')) as {
      projects: Array<{ id: string; path: string; projectType?: string }>;
    };
  const dirOf = (...segments: string[]) => {
    const dir = path.join(...segments);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const writeConfigFile = (cwd: string, body: Record<string, unknown>) => {
    fs.mkdirSync(path.join(cwd, '.claude4spec'), { recursive: true });
    fs.writeFileSync(configPath(cwd), JSON.stringify({ $schemaVersion: 4, name: path.basename(cwd), ...body }, null, 2) + '\n');
  };
  const snapshot = () => ({
    registry: fs.readFileSync(registryFile(), 'utf8'),
    workspaceJson: fs.readFileSync(workspaceFilePath(home), 'utf8'),
  });

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-ws-type-'));
    registryHome = dirOf(tmp, 'registry');
    home = dirOf(tmp, 'repo');
    dirOf(home, '.claude4spec');
    fs.writeFileSync(workspaceFilePath(home), JSON.stringify({ projects: [], plugins: [] }, null, 2));
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

  const appFor = (name: string): { app: express.Express; view: WorkspaceRecord } => {
    const view = registry.openView(name);
    const app = express()
      .use(express.json())
      .use(
        '/api',
        workspaceRouter({
          registry,
          workspace: view,
          cache,
          mode: 'prod',
          activateProject: async (cwd, projectType) => bootstrapProject(registry, view, cwd, undefined, projectType).project,
        }),
      )
      .use('/api', errorHandler);
    return { app, view };
  };

  it('[ac:m31-new-project-type-in-config-json] [ac:ac-swiezy-config-json-projektu-zarejestr] a project created on the New project path with type `skill` has `projectType: "skill"` in its fresh config.json', async () => {
    const { app } = appFor('team');
    const cwd = dirOf(home, 'skills', 'review');
    const res = await request(app).post('/api/workspace/projects').send({ cwd, projectType: 'skill' });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body)).toEqual(['projectId']);
    const file = JSON.parse(fs.readFileSync(configPath(cwd), 'utf8')) as Record<string, unknown>;
    expect(file.projectType).toBe('skill');
    expect(file.onboardingCompleted).toBe(false);
  });

  it('[ac:m31-new-project-type-copy-in-workspace-record] a project created on the New project path with type `skill` carries the type `skill` in its record of the workspace description', async () => {
    const { app } = appFor('team');
    const cwd = dirOf(home, 'skills', 'review');
    const res = await request(app).post('/api/workspace/projects').send({ cwd, projectType: 'skill' });
    expect(res.status).toBe(201);
    const record = readWorkspaceJson().projects.find((p) => p.id === res.body.projectId);
    expect(record).toEqual({ id: res.body.projectId, path: 'skills/review', projectType: 'skill' });
    // The registry workspace's record carries the same copy.
    const solo = appFor('solo');
    const other = dirOf(tmp, 'solo-skill');
    const res2 = await request(solo.app).post('/api/workspace/projects').send({ cwd: other, projectType: 'skill' });
    expect(res2.status).toBe(201);
    expect(registry.getProject(registry.openView('solo'), res2.body.projectId)?.projectType).toBe('skill');
  });

  it('[ac:m31-existing-directory-without-type-registers-as-spec] a directory whose config.json has no `projectType`, added on the Add existing directory path, gets the type `spec` in its workspace record', async () => {
    const { app } = appFor('team');
    const cwd = dirOf(home, 'legacy');
    // A complete v4 file but for `projectType` — a file without `roots` would be
    // rewritten by the roots repair, which is not what this criterion is about.
    writeConfigFile(cwd, { roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }] });
    const before = fs.readFileSync(configPath(cwd), 'utf8');
    const res = await request(app).post('/api/workspace/projects').send({ cwd });
    expect(res.status).toBe(201);
    expect(readWorkspaceJson().projects.find((p) => p.id === res.body.projectId)?.projectType).toBe('spec');
    // The existing file is not filled in: no key means Specification.
    expect(fs.readFileSync(configPath(cwd), 'utf8')).toBe(before);
  });

  it('[ac:ac-katalog-z-istniejacym-claude4spec-con] a directory with an existing config.json added on the Add existing directory path recovers its DB slot', async () => {
    const { app } = appFor('solo');
    const cwd = dirOf(tmp, 'kept');
    const first = await request(app).post('/api/workspace/projects').send({ cwd, projectType: 'spec' });
    expect(first.status).toBe(201);
    const id = first.body.projectId as string;
    const slot = registry.slotDir(registry.openView('solo'), id);
    fs.writeFileSync(path.join(slot, 'keep.db'), 'state');
    expect(registry.removeProject(registry.openView('solo'), id)).toBe(true);
    const again = await request(appFor('solo').app).post('/api/workspace/projects').send({ cwd });
    expect(again.status).toBe(201);
    expect(again.body.projectId).toBe(id);
    expect(fs.readFileSync(path.join(slot, 'keep.db'), 'utf8')).toBe('state');
  });

  it('[ac:m31-existing-path-refuses-uninitialized-directory] a directory without .claude4spec/config.json sent on the Add existing directory path is refused with PROJECT_PATH_NOT_INITIALIZED, the workspace registry unchanged', async () => {
    const { app } = appFor('team');
    const cwd = dirOf(home, 'empty');
    const before = snapshot();
    const res = await request(app).post('/api/workspace/projects').send({ cwd });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PROJECT_PATH_NOT_INITIALIZED');
    expect(snapshot()).toEqual(before);
    expect(fs.readdirSync(cwd)).toEqual([]);
  });

  it('[ac:m31-new-project-path-refuses-initialized-directory] a directory with .claude4spec/config.json sent on the New project path is refused with PROJECT_PATH_ALREADY_INITIALIZED, the workspace registry unchanged', async () => {
    const { app } = appFor('team');
    const cwd = dirOf(home, 'taken');
    writeConfigFile(cwd, { projectType: 'spec' });
    const config = fs.readFileSync(configPath(cwd), 'utf8');
    const before = snapshot();
    const res = await request(app).post('/api/workspace/projects').send({ cwd, projectType: 'spec' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PROJECT_PATH_ALREADY_INITIALIZED');
    expect(snapshot()).toEqual(before);
    expect(fs.readFileSync(configPath(cwd), 'utf8')).toBe(config);
  });

  it('[ac:m31-unknown-project-type-refused-at-registration] POST /api/workspace/projects with a `projectType` outside the type registry is refused with PROJECT_TYPE_UNKNOWN, the workspace registry unchanged', async () => {
    const { app } = appFor('team');
    const cwd = dirOf(home, 'novel');
    const before = snapshot();
    const res = await request(app).post('/api/workspace/projects').send({ cwd, projectType: 'novel' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PROJECT_TYPE_UNKNOWN');
    expect(snapshot()).toEqual(before);
    expect(fs.existsSync(configPath(cwd))).toBe(false);
  });

  it('[entity:add-project-request] a `projectType` that is not a string is a 400 VALIDATION', async () => {
    const { app } = appFor('team');
    const cwd = dirOf(home, 'typo');
    const res = await request(app).post('/api/workspace/projects').send({ cwd, projectType: 7 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('[ac:m31-register-with-conflicting-type-refused] [ac:ac-aktywacja-projektu-ktorego-config-jso] a registration with a type given from outside over a directory whose config.json carries another type is refused with PROJECT_TYPE_CONFLICT, config.json untouched', () => {
    const view = registry.openView('solo');
    const cwd = dirOf(tmp, 'skilled');
    writeConfigFile(cwd, { projectType: 'skill', roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }] });
    const config = fs.readFileSync(configPath(cwd), 'utf8');
    const registryBefore = fs.readFileSync(registryFile(), 'utf8');
    // The activation's step 3 — the core of every registration, given an outside
    // type (the HTTP new-project path refuses such a directory earlier, as initialized).
    expect(() => activateProjectDir(registry, view, cwd, { inputType: 'spec' })).toThrow(
      expect.objectContaining({ code: 'PROJECT_TYPE_CONFLICT' }),
    );
    expect(() => settleProjectType(cwd, 'spec')).toThrow(expect.objectContaining({ code: 'PROJECT_TYPE_CONFLICT' }));
    expect(fs.readFileSync(configPath(cwd), 'utf8')).toBe(config);
    expect(fs.readFileSync(registryFile(), 'utf8')).toBe(registryBefore);
    expect(fs.readdirSync(cwd)).toEqual(['.claude4spec']);
    // The same type as the file is no conflict.
    expect(settleProjectType(cwd, 'skill').entry.slug).toBe('skill');
  });

  it('[ac:ac-projekt-z-nieznana-wartoscia-projectt] a project with an unknown `projectType` does not activate: refused with PROJECT_TYPE_UNKNOWN (the build ends in the error state)', () => {
    const view = registry.openView('solo');
    const cwd = dirOf(tmp, 'unknown');
    const project = registry.registerProject(view, cwd, 'spec');
    writeConfigFile(cwd, { projectType: 'novel', roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }] });
    expect(() => activateProject(registry, view, { ...project, projectType: 'novel' })).toThrow(
      expect.objectContaining({ code: 'PROJECT_TYPE_UNKNOWN' }),
    );
    expect(() => backgroundActivationSteps(registry, { ...project, projectType: 'novel' })).toThrow(
      expect.objectContaining({ code: 'PROJECT_TYPE_UNKNOWN' }),
    );
  });

  it('[ac:ac-projekt-ktorego-typ-w-config-json-roz] a project whose type in config.json differs from the copy in workspace.json does not activate and is refused with PROJECT_TYPE_MISMATCH', () => {
    const cwd = dirOf(home, 'edited');
    writeConfigFile(cwd, { projectType: 'skill', roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }] });
    fs.writeFileSync(
      workspaceFilePath(home),
      JSON.stringify({ projects: [{ id: 'edited', path: 'edited', projectType: 'spec' }], plugins: [] }),
    );
    const fresh = new WorkspaceRegistry(registryHome).openView('team');
    const project = fresh.projects.find((p) => p.id === 'edited')!;
    expect(project.projectType).toBe('spec');
    expect(() => activateProject(registry, fresh, project)).toThrow(expect.objectContaining({ code: 'PROJECT_TYPE_MISMATCH' }));
    expect(() => backgroundActivationSteps(registry, project)).toThrow(
      expect.objectContaining({ code: 'PROJECT_TYPE_MISMATCH' }),
    );
  });

  it('[ac:ac-projekt-ktorego-config-json-nie-ma-kl] a project whose config.json has no `projectType` key works as a Specification project', () => {
    const view = registry.openView('solo');
    const cwd = dirOf(tmp, 'old');
    writeConfigFile(cwd, { roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }] });
    const { type, config } = bootstrapProject(registry, view, cwd);
    expect(type.entry.slug).toBe('spec');
    expect([...type.capabilities].sort()).toEqual(['briefs', 'entities', 'multi-root']);
    expect(readConfig(cwd).projectType).toBe('spec');
    expect(config.projectType).toBe('spec');
    // The file is not filled in.
    expect(JSON.parse(fs.readFileSync(configPath(cwd), 'utf8')).projectType).toBeUndefined();
  });

  it('[ac:ac-rejestracja-swiezego-projektu-start-z] a project registered on the New project path has `onboardingCompleted: false` in config.json after activation', async () => {
    const { app } = appFor('solo');
    const cwd = dirOf(tmp, 'brand-new');
    const res = await request(app).post('/api/workspace/projects').send({ cwd, projectType: 'spec' });
    expect(res.status).toBe(201);
    const file = JSON.parse(fs.readFileSync(configPath(cwd), 'utf8')) as Record<string, unknown>;
    expect(file.onboardingCompleted).toBe(false);
    expect(file.projectType).toBe('spec');
  });

  it('[ac:ac-aktywacja-projektu-typu-skill-nie-two] the activation of a `skill` project creates no entity store', () => {
    const view = registry.openView('solo');
    const cwd = dirOf(tmp, 'skill-proj');
    bootstrapProject(registry, view, cwd, undefined, 'skill');
    expect(fs.existsSync(path.join(cwd, '.claude4spec', 'entities'))).toBe(false);
    // A `spec` project's activation does create it.
    const spec = dirOf(tmp, 'spec-proj');
    bootstrapProject(registry, view, spec, undefined, 'spec');
    expect(fs.existsSync(path.join(spec, '.claude4spec', 'entities'))).toBe(true);
  });

  it('[ac:ac-projekt-typu-specyfikacja-po-domkniec] [entity:welcome-template-index] a Specification project, once onboarding has closed, has the welcome page from welcome-template-index in its base space', () => {
    const view = registry.openView('solo');
    const cwd = dirOf(tmp, 'onboarded');
    // A file whose onboarding has closed (no field = a project from before onboarding).
    writeConfigFile(cwd, { projectType: 'spec', roots: [{ id: 'pages', name: 'Pages', dir: 'docs', builtin: true }] });
    bootstrapProject(registry, view, cwd);
    expect(fs.readFileSync(path.join(cwd, 'docs', 'index.md'), 'utf8')).toBe(SPEC_WELCOME_TEMPLATE);
    // A fresh project (onboarding open) gets no page yet.
    const fresh = dirOf(tmp, 'not-onboarded');
    bootstrapProject(registry, view, fresh, undefined, 'spec');
    expect(fs.existsSync(path.join(fresh, 'pages', 'index.md'))).toBe(false);
    // A `skill` project's page comes from its own entry, never the Specification's template.
    const skill = dirOf(tmp, 'skill-onboarded');
    writeConfigFile(skill, { projectType: 'skill', roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }] });
    bootstrapProject(registry, view, skill);
    expect(fs.readdirSync(path.join(skill, 'pages'))).toEqual(['index.md']);
    expect(fs.readFileSync(path.join(skill, 'pages', 'index.md'), 'utf8')).not.toBe(SPEC_WELCOME_TEMPLATE);
  });
  it('[ac:ac-projekt-z-nieznana-wartoscia-projectt] rev-0002: a legacy directory (v2 file with port/mode) whose config.json carries an unknown type is refused with PROJECT_TYPE_UNKNOWN before the migrations rewrite config.json and before the registry gets the carried defaults', () => {
    const view = registry.openView('solo');
    const cwd = dirOf(tmp, 'legacy-unknown');
    fs.mkdirSync(path.join(cwd, '.claude4spec'), { recursive: true });
    // No $schemaVersion, a legacy `pagesDir`, `port` and `mode`: both v4 and v3 would rewrite it, v3 would carry port/mode.
    const legacy = JSON.stringify({ name: 'legacy', pagesDir: 'docs', port: 4999, mode: 'dev', projectType: 'novel' }, null, 2) + '\n';
    fs.writeFileSync(configPath(cwd), legacy);
    const registryBefore = fs.readFileSync(registryFile(), 'utf8');

    expect(() => activateProjectDir(registry, view, cwd)).toThrow(expect.objectContaining({ code: 'PROJECT_TYPE_UNKNOWN' }));
    // config.json is byte-for-byte the legacy file (not migrated), the registry carries nothing.
    expect(fs.readFileSync(configPath(cwd), 'utf8')).toBe(legacy);
    expect(fs.readFileSync(registryFile(), 'utf8')).toBe(registryBefore);
    expect(fs.readdirSync(cwd)).toEqual(['.claude4spec']);
    expect(fs.readdirSync(path.join(cwd, '.claude4spec'))).toEqual(['config.json']);
  });

  it('[ac:m31-welcome-row-shows-type-name] [entity:get-api-workspace] the UI listing of GET /api/workspace carries each project\'s type from its record copy (absent = `spec`) and the type\'s name from the type registry', async () => {
    const { app } = appFor('team');
    const skill = await request(app).post('/api/workspace/projects').send({ cwd: dirOf(home, 'skills', 'review'), projectType: 'skill' });
    expect(skill.status).toBe(201);
    const plain = dirOf(home, 'plain');
    writeConfigFile(plain, {});
    const spec = await request(app).post('/api/workspace/projects').send({ cwd: plain });
    expect(spec.status).toBe(201);

    const res = await request(appFor('team').app).get('/api/workspace');
    expect(res.status).toBe(200);
    const rows = res.body.projects as Array<{ id: string; projectType: string; projectTypeName: string | null }>;
    expect(rows.find((r) => r.id === skill.body.projectId)).toMatchObject({ projectType: 'skill', projectTypeName: 'Skill' });
    expect(rows.find((r) => r.id === spec.body.projectId)).toMatchObject({ projectType: 'spec', projectTypeName: 'Specification' });
  });

  it('[ac:ac-projekt-z-nieznana-wartoscia-projectt-2] a project whose record carries a `projectType` the current version does not know stays on the workspace listing, its slug as is and no type name', async () => {
    dirOf(home, 'future');
    fs.writeFileSync(
      workspaceFilePath(home),
      JSON.stringify({ projects: [{ id: 'future', path: 'future', projectType: 'novel' }], plugins: [] }, null, 2),
    );
    const res = await request(appFor('team').app).get('/api/workspace');
    expect(res.status).toBe(200);
    expect(res.body.projects).toHaveLength(1);
    expect(res.body.projects[0]).toMatchObject({ id: 'future', projectType: 'novel', projectTypeName: null });
  });

  it('[ac:ac-katalog-wskazany-w-modalu-welcome-i-z] a directory confirmed through POST /api/workspace/projects (as the /create-project page sends it) becomes a project of the workspace listing', async () => {
    const { app } = appFor('solo');
    const cwd = dirOf(tmp, 'picked');
    const before = (await request(app).get('/api/workspace')).body.projects as unknown[];
    expect(before).toEqual([]);
    const res = await request(app).post('/api/workspace/projects').send({ cwd, projectType: 'spec' });
    expect(res.status).toBe(201);
    const after = (await request(appFor('solo').app).get('/api/workspace')).body.projects as Array<{ id: string; cwd: string }>;
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(res.body.projectId);
    expect(fs.realpathSync(after[0]!.cwd)).toBe(fs.realpathSync(cwd));
  });
});
