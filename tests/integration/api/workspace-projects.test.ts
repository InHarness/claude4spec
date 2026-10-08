import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workspaceRouter } from '../../../src/server/workspace/routes.js';
import { errorHandler } from '../../../src/server/routes/errors.js';
import type { ProjectContextCache } from '../../../src/server/workspace/context-cache.js';
import type { WorkspaceRegistry } from '../../../src/server/workspace/registry.js';
import type { ProjectRecord, WorkspaceRecord } from '../../../src/server/workspace/types.js';

/**
 * 0.2.106 (M49 / M31) — the workspace registry routes, outside `/api/projects/:id`.
 *
 * `POST /api/workspace/projects` answers `AddProjectResponse = { projectId }`,
 * and a directory that cannot become a project is the caller's typo — a
 * `400 VALIDATION` rendered inline in the modal, never created on their behalf
 * and never a 500. `DELETE` failures leave as the `{ error }` envelope instead of
 * an unhandled rejection.
 */
describe('workspace project registration routes', () => {
  let tmp: string;
  let activated: string[];
  let activate: (cwd: string) => Promise<ProjectRecord>;
  let retire: (id: string) => Promise<void>;

  const workspace = { name: 'default', projects: [] as ProjectRecord[] } as unknown as WorkspaceRecord;

  function app(): express.Express {
    const registry = {
      getWorkspace: () => workspace,
      getProject: (_ws: WorkspaceRecord, id: string) => workspace.projects.find((p) => p.id === id) ?? null,
      removeProject: (_ws: WorkspaceRecord, id: string) => {
        workspace.projects = workspace.projects.filter((p) => p.id !== id);
        return true;
      },
      slotDir: () => path.join(tmp, 'slot'),
    } as unknown as WorkspaceRegistry;
    const cache = {
      isLive: () => false,
      getLive: () => null,
      retire: (id: string) => retire(id),
      invalidate: () => {},
    } as unknown as ProjectContextCache;
    const a = express();
    a.use(express.json());
    a.use('/api', workspaceRouter({ registry, workspace, cache, mode: 'prod', activateProject: (cwd) => activate(cwd) }));
    // Mounted by `startServer` after every `/api` router (M49 owns the envelope).
    a.use('/api', errorHandler);
    return a;
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-ws-routes-'));
    activated = [];
    activate = async (cwd) => {
      activated.push(cwd);
      return { id: 'proj-1', cwd, name: path.basename(cwd) } as ProjectRecord;
    };
    retire = async () => {};
    workspace.projects = [];
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('answers 201 with `{ projectId }` for an existing directory', async () => {
    const res = await request(app()).post('/api/workspace/projects').send({ cwd: tmp });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ projectId: 'proj-1' });
    expect(activated).toEqual([tmp]);
  });

  it('refuses a directory that does not exist with 400 VALIDATION — and does not create it', async () => {
    const missing = path.join(tmp, 'nope', 'deeper');
    const res = await request(app()).post('/api/workspace/projects').send({ cwd: missing });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(fs.existsSync(missing)).toBe(false);
    expect(activated).toEqual([]);
  });

  it('refuses a path that is a file, not a directory', async () => {
    const file = path.join(tmp, 'a-file.txt');
    fs.writeFileSync(file, 'x');
    const res = await request(app()).post('/api/workspace/projects').send({ cwd: file });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('maps a permission failure during activation to 400 VALIDATION, not 500', async () => {
    activate = async () => {
      throw Object.assign(new Error(`EACCES: permission denied, mkdir '${tmp}/.claude4spec'`), { code: 'EACCES' });
    };
    const res = await request(app()).post('/api/workspace/projects').send({ cwd: tmp });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('an unexpected activation failure leaves as the 500 envelope', async () => {
    activate = async () => {
      throw new Error('boom');
    };
    const res = await request(app()).post('/api/workspace/projects').send({ cwd: tmp });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL', message: 'boom' } });
  });

  it('purge (M31 `7fgfpqzf`) deletes the db slot and leaves config.json and every registry root dir in cwd untouched', async () => {
    const cwd = path.join(tmp, 'project');
    const slot = path.join(tmp, 'slot');
    // A user root (`kind: pages`) and the code-declared system roots.
    const rootDirs = ['pages', 'docs', ...['plans', 'briefs', 'patches', 'entities', 'releases'].map((k) => `.claude4spec/${k}`)];
    for (const d of rootDirs) {
      fs.mkdirSync(path.join(cwd, d), { recursive: true });
      fs.writeFileSync(path.join(cwd, d, 'keep.md'), '# keep');
    }
    fs.writeFileSync(path.join(cwd, '.claude4spec', 'config.json'), '{}');
    fs.mkdirSync(slot, { recursive: true });
    fs.writeFileSync(path.join(slot, 'c4s.db'), 'db');
    workspace.projects = [{ id: 'proj-1', cwd, name: 'p' } as ProjectRecord];

    const res = await request(app()).delete('/api/workspace/projects/proj-1?purgeData=true');
    expect(res.status).toBe(200);
    expect(fs.existsSync(slot)).toBe(false);
    expect(fs.existsSync(path.join(cwd, '.claude4spec', 'config.json'))).toBe(true);
    for (const d of rootDirs) expect(fs.existsSync(path.join(cwd, d, 'keep.md'))).toBe(true);
  });

  it('a DELETE whose dispose throws answers the envelope instead of hanging', async () => {
    workspace.projects = [{ id: 'proj-1', cwd: tmp, name: 'p' } as ProjectRecord];
    retire = async () => {
      throw new Error('dispose failed');
    };
    const res = await request(app()).delete('/api/workspace/projects/proj-1?purgeData=true');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');
  });
});
