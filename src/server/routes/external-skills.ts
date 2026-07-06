import { Router } from 'express';
import archiver from 'archiver';
import {
  ALL_SKILL_SLUGS,
  buildExternalSkillContext,
  buildExternalSkillsBundle,
  externalSkillsMetadata,
  isSkillSlug,
  type SkillSlug,
} from '../external-skills/external-skills-service.js';
import type { ExternalSkillsListResponse } from '../external-skills/types.js';
import type { WorkspaceRegistry } from '../workspace/registry.js';
import type { WorkspaceRecord } from '../workspace/types.js';
import { errorHandler } from './errors.js';

export interface ExternalSkillsRouterDeps {
  registry: WorkspaceRegistry;
  workspace: WorkspaceRecord;
  projectId: string;
}

/**
 * Parses `?skills=a,b,c` into a validated `SkillSlug[]`; empty/absent → [] (all).
 * Also accepts a repeated key (`?skills=a&skills=b`), which Express's query
 * parser turns into a string[] rather than a comma-joined string — every
 * value (and every comma-split token within it) is still validated, so an
 * invalid slug can't slip through via that shape.
 */
function parseSelection(raw: unknown): SkillSlug[] | { error: string } {
  if (raw === undefined) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  const tokens: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') {
      return { error: '?skills= must be a comma-separated string' };
    }
    tokens.push(...value.split(',').map((s) => s.trim()).filter(Boolean));
  }
  for (const t of tokens) {
    if (!isSkillSlug(t)) {
      return { error: `unknown skill '${t}' in ?skills= — expected one of ${ALL_SKILL_SLUGS.join(', ')}` };
    }
  }
  return tokens as SkillSlug[];
}

/**
 * 0.1.104 M22 — on-demand external skills, replacing the removed
 * `ensureExternalSkills` bootstrap hook. `GET /` is static metadata (no
 * SKILL.md content); `GET /bundle` streams a ZIP built in memory via
 * `buildExternalSkillsBundle` — no server-side FS write.
 */
export function externalSkillsRouter(deps: ExternalSkillsRouterDeps): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const body: ExternalSkillsListResponse = { skills: externalSkillsMetadata() };
    res.json(body);
  });

  router.get('/bundle', (req, res, next) => {
    try {
      const selection = parseSelection(req.query.skills);
      if (!Array.isArray(selection)) {
        return res.status(400).json({ error: { code: 'VALIDATION', message: selection.error } });
      }

      // `deps.workspace` is a snapshot captured at server-start time (before
      // this project may have been registered) — `registry.getProject` re-reads
      // fresh from disk by id instead of trusting that stale `.projects` array.
      const project = deps.registry.getProject(deps.workspace, deps.projectId);
      if (!project) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'project not registered' } });
      }
      const ctx = buildExternalSkillContext(project, deps.workspace.name);
      const files = buildExternalSkillsBundle(ctx, selection.length > 0 ? selection : undefined);

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="external-skills.zip"');
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', (err) => next(err));
      archive.pipe(res);
      for (const [relPath, content] of files) {
        archive.append(content, { name: relPath });
      }
      void archive.finalize();
    } catch (err) {
      next(err);
    }
  });

  router.use(errorHandler);
  return router;
}
