import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { Router } from 'express';
import request from 'supertest';
import { WorkspaceRegistry } from './registry.js';
import {
  activatingBuild,
  backgroundActivationSteps,
  backgroundBuild,
  ProjectDirMissingError,
  ProjectNeedsActivationError,
  WorkspaceHomeNotProjectError,
} from './bootstrap.js';
import { ProjectContextCache } from './context-cache.js';
import { projectDispatchMiddleware } from './middleware.js';
import { workspaceFilePath } from './home-workspace.js';
import type { ProjectContext } from './project-context.js';
import type { ProjectRecord, WorkspaceRecord } from './types.js';
import { configPath } from '../config.js';

/**
 * 2.1.60 — M01 `dsh8ezbz` («Budowa w tle a aktywacja»): the activation's steps
 * run by the background context build write nothing into the project
 * directory (the missing root directories of a project with a config file
 * aside). The outcome is «ready», «needs activation» (no config, a database to
 * move, a config migration with a write, a migration to text) or an error; a
 * directory that does not exist is refused and not created. The activation
 * WITH writes stays the registration's and the first request's.
 */
describe('M01 — the activation steps of the background build (2.1.60)', () => {
  let tmp: string;
  let registry: WorkspaceRegistry;
  let ws: WorkspaceRecord;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-background-build-'));
    registry = new WorkspaceRegistry(path.join(tmp, 'registry'));
    ws = registry.selectOrCreate({ name: 'default' });
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const BASE_ROOT = { id: 'pages', name: 'Pages', dir: 'pages', builtin: true };
  const view = () => registry.getWorkspace('default')!;
  const dirOf = (name: string) => {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const writeRawConfig = (cwd: string, text: string) => {
    fs.mkdirSync(path.dirname(configPath(cwd)), { recursive: true });
    fs.writeFileSync(configPath(cwd), text);
  };
  const project = (name: string): ProjectRecord => registry.registerProject(ws, dirOf(name));

  /** Every file under `dir` with its bytes and mtime, plus every directory — what "nothing written" compares. */
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
    if (fs.existsSync(dir)) walk(dir);
    return { files, dirs: dirs.sort() };
  };

  /** A build double that records the mode it was handed. */
  const recordingBuild = () => {
    const calls: Array<{ id: string; projectWrites: string }> = [];
    const build = async (p: ProjectRecord, mode: { projectWrites: 'none' }) => {
      calls.push({ id: p.id, projectWrites: mode.projectWrites });
      return { projectId: p.id };
    };
    return { calls, build };
  };

  it('[ac:ac-budowa-projektu-ktorego-katalog-nie-i] the background build of a project whose directory does not exist fails and does not create the directory', async () => {
    const cwd = path.join(tmp, 'gone', 'project');
    const gone = registry.registerProject(ws, cwd);
    const { calls, build } = recordingBuild();

    await expect(backgroundBuild(registry, build)(gone)).rejects.toBeInstanceOf(ProjectDirMissingError);
    await expect(backgroundBuild(registry, build)(gone)).rejects.toThrow(/does not exist/);
    // The context build never ran, and neither the directory nor its parent was created.
    expect(calls).toEqual([]);
    expect(fs.existsSync(cwd)).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'gone'))).toBe(false);
  });

  it('[ac:ac-budowa-projektu-ktorego-katalog-nie-i] the build on a request to such a project (the activation with writes) is that project\'s 500 PROJECT_BUILD_FAILED and does not create the directory either', async () => {
    const cwd = path.join(tmp, 'removed');
    const removed = registry.registerProject(ws, cwd);
    const built: string[] = [];
    const cache = new ProjectContextCache(
      activatingBuild(registry, view(), async (p) => {
        built.push(p.id);
        return { projectId: p.id, router: Router(), hasInFlightTurn: () => false, dispose: async () => {} } as unknown as ProjectContext;
      }),
    );
    const app = express().use('/api/projects/:id', projectDispatchMiddleware(registry, view(), cache));

    const res = await request(app).get(`/api/projects/${removed.id}/anything`);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('PROJECT_BUILD_FAILED');
    expect(res.body.error.message).toContain('does not exist');
    expect(built).toEqual([]);
    expect(fs.existsSync(cwd)).toBe(false);
  });

  it('[section:dsh8ezbz] a project without config.json ends in «needs activation» (config-missing) and nothing is written — no .claude4spec/, no config, no root directory', async () => {
    const p = project('no-config');
    const { calls, build } = recordingBuild();

    const result = await backgroundBuild(registry, build)(p);
    expect(result).toEqual({ state: 'needs-activation', needs: ['config-missing'] });
    expect(calls).toEqual([]);
    expect(fs.readdirSync(p.cwd)).toEqual([]);
  });

  it('[section:dsh8ezbz] a config migration with a write (a v2 file carrying port/mode, an interrupted root rename) ends in «needs activation» (config-migration) — the file stays byte for byte', async () => {
    const legacy = project('legacy-config');
    const text = JSON.stringify({ $schemaVersion: 2, name: 'Legacy', port: 4123, mode: 'prod', roots: [BASE_ROOT] }, null, 2);
    writeRawConfig(legacy.cwd, text);
    const before = snapshot(legacy.cwd);
    const { calls, build } = recordingBuild();

    expect(await backgroundBuild(registry, build)(legacy)).toEqual({ state: 'needs-activation', needs: ['config-migration'] });
    expect(snapshot(legacy.cwd)).toEqual(before);
    expect(fs.readFileSync(configPath(legacy.cwd), 'utf8')).toBe(text);

    const renamed = project('rename-journal');
    writeRawConfig(renamed.cwd, JSON.stringify({ $schemaVersion: 4, name: 'R', roots: [BASE_ROOT] }));
    fs.writeFileSync(
      path.join(renamed.cwd, '.claude4spec', 'root-rename.journal.json'),
      JSON.stringify({ from: 'pages', to: 'docs' }),
    );
    const renamedBefore = snapshot(renamed.cwd);
    expect(await backgroundBuild(registry, build)(renamed)).toEqual({ state: 'needs-activation', needs: ['config-migration'] });
    expect(snapshot(renamed.cwd)).toEqual(renamedBefore);
    expect(calls).toEqual([]);
  });

  it('[section:dsh8ezbz] a database found in the project directory ends in «needs activation» (legacy-db) — it is not moved to the slot', async () => {
    const p = project('legacy-db');
    writeRawConfig(p.cwd, JSON.stringify({ $schemaVersion: 4, name: 'L', roots: [BASE_ROOT] }));
    fs.writeFileSync(path.join(p.cwd, '.claude4spec', 'db.sqlite'), 'legacy bytes');
    const before = snapshot(p.cwd);
    const { calls, build } = recordingBuild();

    expect(await backgroundBuild(registry, build)(p)).toEqual({ state: 'needs-activation', needs: ['legacy-db'] });
    expect(snapshot(p.cwd)).toEqual(before);
    expect(fs.existsSync(path.join(registry.slotDir(ws, p.id), 'db.sqlite'))).toBe(false);
    expect(calls).toEqual([]);
  });

  it('[section:dsh8ezbz] a build that meets a migration to text ends in «needs activation» (text-migration); any other build failure is the error state', async () => {
    const p = project('text-migration');
    writeRawConfig(p.cwd, JSON.stringify({ $schemaVersion: 4, name: 'T', roots: [BASE_ROOT] }));

    const needs = backgroundBuild(registry, async () => {
      throw new ProjectNeedsActivationError(['text-migration']);
    });
    expect(await needs(p)).toEqual({ state: 'needs-activation', needs: ['text-migration'] });

    const broken = backgroundBuild(registry, async () => {
      throw new Error('writing style "nope" is not selectable');
    });
    await expect(broken(p)).rejects.toThrow('writing style "nope" is not selectable');
  });

  it('[section:dsh8ezbz] a broken project is the error state, not «needs activation»: a malformed config.json and a workspace home are refused untouched', async () => {
    const malformed = project('malformed');
    writeRawConfig(malformed.cwd, '{ "name": ');
    const { calls, build } = recordingBuild();
    await expect(backgroundBuild(registry, build)(malformed)).rejects.toThrow(/config\.json: invalid JSON/);
    expect(fs.readFileSync(configPath(malformed.cwd), 'utf8')).toBe('{ "name": ');

    const home = project('home');
    fs.mkdirSync(path.join(home.cwd, '.claude4spec'), { recursive: true });
    fs.writeFileSync(workspaceFilePath(home.cwd), JSON.stringify({ projects: [], plugins: [] }));
    const before = snapshot(home.cwd);
    await expect(backgroundBuild(registry, build)(home)).rejects.toBeInstanceOf(WorkspaceHomeNotProjectError);
    expect(snapshot(home.cwd)).toEqual(before);
    expect(calls).toEqual([]);
  });

  it('[section:dsh8ezbz] a project with a config file is ready: only the missing root directories are created — no file is written (no .gitignore, no welcome page) — and the build runs with projectWrites none', async () => {
    const p = project('ready');
    const text = JSON.stringify({ $schemaVersion: 4, name: 'Ready', roots: [BASE_ROOT], onboardingCompleted: true });
    writeRawConfig(p.cwd, text);
    const before = snapshot(p.cwd);
    const { calls, build } = recordingBuild();

    const result = await backgroundBuild(registry, build)(p);
    expect(result).toEqual({ state: 'ready', context: { projectId: p.id } });
    expect(calls).toEqual([{ id: p.id, projectWrites: 'none' }]);

    const after = snapshot(p.cwd);
    // Files: exactly the ones that were there, unchanged.
    expect(after.files).toEqual(before.files);
    expect(fs.existsSync(path.join(p.cwd, '.gitignore'))).toBe(false);
    // The base space is empty and onboarding has closed, yet no welcome page: that is the activation's write.
    expect(fs.readdirSync(path.join(p.cwd, 'pages'))).toEqual([]);
    // Directories: only those of the registry roots were added.
    const added = after.dirs.filter((d) => !before.dirs.includes(d));
    expect(added).toContain('pages');
    expect(added).toContain(path.join('.claude4spec', 'entities'));
    expect(added.every((d) => d === 'pages' || d.startsWith('.claude4spec'))).toBe(true);
  });

  it('[section:dsh8ezbz] the steps read no flag: for a ready project they take the registry and the project, and the config comes from the file', () => {
    const p = project('steps-only');
    writeRawConfig(p.cwd, JSON.stringify({ $schemaVersion: 4, name: 'From File', roots: [BASE_ROOT] }));
    const steps = backgroundActivationSteps(registry, p);
    expect(steps.state).toBe('ready');
    if (steps.state === 'ready') expect(steps.config.name).toBe('From File');
    expect(backgroundActivationSteps.length).toBe(2);
  });

  it('[section:dsh8ezbz] the activation with writes runs at the first request to a project whose background build ended in «needs activation» — after it, the background build is ready', async () => {
    const p = project('activate-on-request');
    const { build } = recordingBuild();
    expect(await backgroundBuild(registry, build)(p)).toEqual({ state: 'needs-activation', needs: ['config-missing'] });
    expect(fs.readdirSync(p.cwd)).toEqual([]);

    // The first request: the server's cache builds through the activation with writes.
    const built: string[] = [];
    const cache = new ProjectContextCache(
      activatingBuild(registry, view(), async (rec) => {
        built.push(rec.id);
        const router = Router();
        router.get('/ping', (_req, res) => {
          res.json({ project: rec.id });
        });
        return { projectId: rec.id, router, hasInFlightTurn: () => false, dispose: async () => {} } as unknown as ProjectContext;
      }),
    );
    const app = express().use('/api/projects/:id', projectDispatchMiddleware(registry, view(), cache));
    const res = await request(app).get(`/api/projects/${p.id}/ping`);
    expect(res.status).toBe(200);
    expect(built).toEqual([p.id]);
    // The activation wrote the fresh config (onboarding open) and the managed .gitignore.
    expect(JSON.parse(fs.readFileSync(configPath(p.cwd), 'utf8')).onboardingCompleted).toBe(false);
    expect(fs.existsSync(path.join(p.cwd, '.gitignore'))).toBe(true);

    // From now on the background build of this project is ready, and writes nothing.
    const before = snapshot(p.cwd);
    expect((await backgroundBuild(registry, build)(p)).state).toBe('ready');
    expect(snapshot(p.cwd)).toEqual(before);
  });
});
