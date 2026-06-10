import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readConfig } from '../config.js';

const pexec = promisify(execFile);
import type { ProjectContextCache } from './context-cache.js';
import type { WorkspaceRegistry } from './registry.js';
import type { ProjectRecord, WorkspaceRecord } from './types.js';

export interface WorkspaceRoutesDeps {
  registry: WorkspaceRegistry;
  workspace: WorkspaceRecord;
  cache: ProjectContextCache;
  mode: 'dev' | 'prod';
  /**
   * Full per-project activation hook (M01/M12/M22 bootstrap + registration +
   * legacy-db migration). Shared with the CLI start path.
   */
  activateProject: (cwd: string) => Promise<ProjectRecord>;
}

/**
 * M31 process-level routes (informal — no spec entities yet, per brief):
 * health, workspace introspection, project registration/removal. Mounted at
 * `/api` BEFORE the `/api/projects/:id` dispatch middleware.
 */
export function workspaceRouter(deps: WorkspaceRoutesDeps): Router {
  const { registry, workspace, cache, mode } = deps;
  const router = Router();

  // Registry stores `name` as basename(cwd) at registration; prefer the
  // project's own configured name so the switcher lists project names.
  const serializeProjects = (ws: WorkspaceRecord) =>
    ws.projects.map((p) => {
      let name = p.name;
      try {
        name = readConfig(p.cwd).name;
      } catch {
        /* fall back to the registry name */
      }
      return { ...p, name, live: cache.isLive(p.id) };
    });

  router.get('/health', (_req, res) => {
    res.json({ ok: true, mode, workspace: workspace.name });
  });

  router.get('/workspace', (_req, res) => {
    const fresh = registry.getWorkspace(workspace.name) ?? workspace;
    res.json({
      name: fresh.name,
      mode: fresh.mode,
      defaultPort: fresh.defaultPort,
      lastOpened: fresh.lastOpened,
      projects: serializeProjects(fresh),
    });
  });

  router.get('/workspaces', (_req, res) => {
    res.json({
      workspaces: registry.listWorkspaces().map((w) => ({
        name: w.name,
        mode: w.mode,
        defaultPort: w.defaultPort,
        lastOpened: w.lastOpened,
        projectCount: w.projects.length,
        current: w.name === workspace.name,
      })),
    });
  });

  router.post('/workspace/projects', async (req, res) => {
    const cwd = req.body?.cwd;
    if (typeof cwd !== 'string' || cwd.trim() === '' || !path.isAbsolute(cwd)) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'cwd must be an absolute path' },
      });
    }
    try {
      const project = await deps.activateProject(path.resolve(cwd));
      res.status(201).json({ project: { ...project, live: cache.isLive(project.id) } });
    } catch (err) {
      res.status(500).json({
        error: {
          code: 'PROJECT_BOOTSTRAP_FAILED',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  });

  // Detach (?purgeData=false, default) keeps the DB slot on disk so re-registering
  // the same cwd restores the index + runtime (chats/plans/releases). Purge
  // (?purgeData=true) additionally rm -rf's the slot dir AFTER the context is
  // disposed — the entity index AND runtime are gone, but nothing in `cwd`
  // (config.json/pages/entities) is ever touched.
  router.delete('/workspace/projects/:id', async (req, res) => {
    const id = req.params.id;
    const purge = req.query.purgeData === 'true';
    const project = registry.getProject(workspace, id);
    if (!project) {
      return res.status(404).json({
        error: { code: 'PROJECT_NOT_IN_WORKSPACE', message: `project '${id}' not in workspace '${workspace.name}'` },
      });
    }
    // Purge is an explicit destructive human action — a silent defer would be
    // misleading, so a busy project is rejected. Detach can defer safely (the
    // context parks in `retired` and disposes once idle).
    if (purge && cache.getLive(id)?.hasInFlightTurn()) {
      return res.status(409).json({
        error: { code: 'PROJECT_BUSY', message: 'project has an in-flight agent turn' },
      });
    }
    registry.removeProject(workspace, id);
    if (purge) {
      // Await dispose (closes the db handle) before removing the slot dir.
      await cache.retire(id);
      fs.rmSync(registry.slotDir(workspace, id), { recursive: true, force: true });
    } else {
      // Context retires/disposes; the DB slot stays on disk (re-register = same index).
      cache.invalidate(id);
    }
    const fresh = registry.getWorkspace(workspace.name) ?? workspace;
    // Most-recently-opened of the remainder → first → null (empty workspace).
    const redirectProjectId =
      [...fresh.projects].sort((a, b) => (b.lastOpened ?? '').localeCompare(a.lastOpened ?? ''))[0]?.id ??
      null;
    res.json({ projects: serializeProjects(fresh), redirectProjectId });
  });

  // Reveal a project directory in the OS file manager (Finder/Explorer/xdg).
  // Local-only tool; the path is validated against registered project cwds so
  // an arbitrary directory can't be opened via this endpoint.
  router.post('/workspace/reveal', async (req, res) => {
    const raw = req.body?.cwd;
    if (typeof raw !== 'string' || raw.trim() === '' || !path.isAbsolute(raw)) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'cwd must be an absolute path' },
      });
    }
    const target = path.resolve(raw);
    const allowed = (registry.getWorkspace(workspace.name) ?? workspace).projects.some(
      (p) => path.resolve(p.cwd) === target,
    );
    if (!allowed) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'path is not a registered project directory' },
      });
    }
    if (!fs.existsSync(target)) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'directory does not exist' },
      });
    }
    const cmd =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    try {
      await pexec(cmd, [target]);
      res.json({ ok: true });
    } catch (err) {
      // Windows `explorer` exits non-zero even on success — treat as ok there.
      if (process.platform === 'win32') return res.json({ ok: true });
      res.status(500).json({
        error: {
          code: 'REVEAL_FAILED',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  });

  return router;
}
