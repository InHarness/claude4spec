import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { Router } from 'express';
import request from 'supertest';
import { configPath } from '../config.js';
import { configRouter } from '../routes/config.js';
import { errorHandler } from '../routes/errors.js';
import type { SkillRegistry } from '../services/skill-registry.js';
import { projectDispatchMiddleware } from './middleware.js';
import type { ProjectContextCache } from './context-cache.js';
import type { ProjectContext } from './project-context.js';
import type { WorkspaceRegistry } from './registry.js';
import type { ProjectRecord, WorkspaceRecord } from './types.js';

/**
 * 2.1.67 — M31 `l4txpfx0`, "Składanie adresu": the path of an `endpoint` entity
 * of a project route starts with `/api/`; the client's URL replaces that `/api/`
 * with the project prefix `/api/projects/:id/` (`/api/X` → `/api/projects/:id/X`),
 * and the dispatch middleware reverses the composition. The prefix is never
 * glued IN FRONT of the entity path, so `/api/projects/:id/api/X` is no route.
 *
 * The composition below mirrors `startServer` (src/server/index.ts): the
 * dispatch mounted at `/api/projects/:id`, the `/api` error envelope after it,
 * and the project's router carrying the real `configRouter` — mounted
 * `/api`-less, as `buildProjectContext` mounts it.
 */

/** The client-side composition rule: replace the leading `/api/` of the endpoint path with the project prefix. */
function composeProjectUrl(endpointPath: string, projectId: string): string {
  if (!endpointPath.startsWith('/api/')) throw new Error(`not an /api path: ${endpointPath}`);
  return `/api/projects/${encodeURIComponent(projectId)}/${endpointPath.slice('/api/'.length)}`;
}

describe('M31 l4txpfx0 — the client composes the address by replacing /api/ with the project prefix (2.1.67)', () => {
  let dir: string;
  const projectId = 'alpha';

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-addr-'));
    const file = configPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ $schemaVersion: 3, name: 'Alpha' }));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function app() {
    const project: ProjectRecord = { id: projectId, cwd: dir, addedAt: '2026-11-03T00:00:00.000Z' };
    const ws = { name: 'default', mode: 'prod', defaultPort: 4500, projects: [project] } as unknown as WorkspaceRecord;
    const registry = {
      getProject: (_ws: WorkspaceRecord, id: string) => (id === projectId ? project : null),
      getWorkspace: () => ws,
    } as unknown as WorkspaceRegistry;
    // The project's router, `/api`-less — the config routes as the real context mounts them.
    const router = Router();
    router.use(configRouter({ cwd: dir, skillRegistry: {} as unknown as SkillRegistry }));
    const ctx = { projectId, router } as unknown as ProjectContext;
    const cache = { get: async () => ctx } as unknown as ProjectContextCache;
    return express()
      .use(express.json())
      .use('/api/projects/:id', projectDispatchMiddleware(registry, ws, cache))
      .use('/api', errorHandler);
  }

  it('[ac:ac-odczyt-konfiguracji-projektu-id-pod-a] GET /api/projects/<id>/config — the composed address of `get-api-config` (/api/config) — answers 200 with the project config', async () => {
    const url = composeProjectUrl('/api/config', projectId);
    expect(url).toBe('/api/projects/alpha/config');
    const res = await request(app()).get(url);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Alpha');
  });

  it('[ac:ac-zadanie-pod-api-projects-id-api-confi] GET /api/projects/<id>/api/config — the prefix glued in front of the entity path — answers 404', async () => {
    const res = await request(app()).get('/api/projects/alpha/api/config');
    expect(res.status).toBe(404);
    // Not the config payload: no route behind the prefix answered.
    expect(res.body?.name).toBeUndefined();
  });
});
