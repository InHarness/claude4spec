import { Router } from 'express';
import path from 'node:path';
import { readConfig, writeConfig, type Config } from '../config.js';
import { SUPPORTED_LANGUAGES, isSupportedLanguage } from '../../shared/languages.js';
import { C4S_VERSION } from '../services/release-bundle.js';
import type { SkillRegistry } from '../services/skill-registry.js';

export interface ConfigRouterDeps {
  cwd: string;
  skillRegistry: SkillRegistry;
  /**
   * M31: PATCH touching a context-defining field (pagesDir/briefsDir/
   * patchesDir/entitiesDir/entities) invalidates the project context — the
   * next request rebuilds it. No restart, no banner.
   */
  onContextConfigChanged?: () => void;
}

const CONTEXT_DEFINING_FIELDS = ['pagesDir', 'briefsDir', 'patchesDir', 'entitiesDir', 'entities'] as const;

/**
 * Single source of the GET/PATCH /config response shape (was duplicated
 * inline in startServer before the M31 carve). M31 drops port/mode (workspace
 * settings now) and serverStartedAt (nothing requires a restart anymore).
 */
function configResponse(c: Config) {
  return {
    name: c.name,
    pagesDir: c.pagesDir,
    writingStyle: c.writingStyle,
    language: c.language ?? null,
    onboarding: { completed: c.onboardingCompleted },
    briefsDir: c.briefsDir,
    patchesDir: c.patchesDir,
    entitiesDir: c.entitiesDir,
    entities: c.entities,
    agent: {
      claudeUsePreset: c.agent?.claudeUsePreset ?? true,
      conversationalLanguage: c.agent?.conversationalLanguage ?? null,
    },
    git: {
      syncCommitOnRelease: c.git?.syncCommitOnRelease ?? false,
      syncPushOnPush: c.git?.syncPushOnPush ?? false,
    },
    remoteProjectId: c.remoteProjectId ?? null,
    remoteApiUrl: c.remoteApiUrl ?? null,
    $schemaVersion: c.$schemaVersion,
  };
}

/**
 * Per-context config/meta/writing-styles routes (carved out of startServer,
 * M31). Mounted relative — the project router lives under /api/projects/:id.
 */
export function configRouter(deps: ConfigRouterDeps): Router {
  const { cwd, skillRegistry } = deps;
  const router = Router();

  router.get('/meta', (_req, res) => {
    res.json({ cwd, cwdName: path.basename(cwd), c4sVersion: C4S_VERSION });
  });

  router.get('/config', (_req, res) => {
    // readConfig per-request: PATCH /config musi byc widoczny w GET bez restartu.
    // Spojne z istniejacym wzorcem SkillResolver (per-query disk read).
    const c = readConfig(cwd);
    res.json(configResponse(c));
  });

  router.patch('/config', (req, res, next) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      // All fields hot-reload now (M31 killed "Restart required") and share one
      // atomic disk write. `writeConfig` re-runs the full validation in
      // `config.ts`; this handler only enforces semantic checks the validator
      // cannot do (writingStyle selectability, name regex, path safety).
      const patch: Partial<{
        name: string;
        pagesDir: string;
        briefsDir: string;
        patchesDir: string;
        entitiesDir: string;
        writingStyle: string | null;
        language: string | null;
        onboardingCompleted: boolean;
        entities: string[];
        agent: { claudeUsePreset?: boolean; conversationalLanguage?: string | null };
        git: { syncCommitOnRelease?: boolean; syncPushOnPush?: boolean };
        remoteProjectId: string | null;
      }> = {};

      // M31 (config v3): port/mode are workspace settings now — explicit 400
      // so an outdated client gets a readable reason instead of a silent drop.
      if ('port' in body || 'mode' in body) {
        return res.status(400).json({
          error: { code: 'VALIDATION', message: 'port/mode moved to workspace settings' },
        });
      }

      if ('name' in body) {
        if (typeof body.name !== 'string') {
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'name must be a string' } });
        }
        const trimmed = body.name.trim();
        if (trimmed.length < 1 || trimmed.length > 80 || !/^[a-zA-Z0-9._\- ]+$/.test(trimmed)) {
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'name: 1-80 chars, allowed [a-zA-Z0-9._- ]' } });
        }
        patch.name = trimmed;
      }

      // Dir fields share the same path-safety contract as boot: must be
      // relative, must not escape cwd.
      const validateDir = (field: string, value: unknown): string | { error: string } => {
        if (typeof value !== 'string' || value.trim() === '') {
          return { error: `${field} must be a non-empty string` };
        }
        if (path.isAbsolute(value)) {
          return { error: `${field} must be relative to cwd` };
        }
        const abs = path.resolve(cwd, value);
        const rel = path.relative(cwd, abs);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          return { error: `${field} must not escape project root` };
        }
        return value;
      };

      for (const field of ['pagesDir', 'briefsDir', 'patchesDir', 'entitiesDir'] as const) {
        if (field in body) {
          const result = validateDir(field, body[field]);
          if (typeof result === 'object') {
            return res.status(400).json({ error: { code: 'VALIDATION', message: result.error } });
          }
          patch[field] = result;
        }
      }

      if ('writingStyle' in body) {
        if (body.writingStyle !== null && typeof body.writingStyle !== 'string') {
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'writingStyle must be string | null' } });
        }
        if (typeof body.writingStyle === 'string' && !skillRegistry.isSelectable(body.writingStyle)) {
          const available = skillRegistry.listSelectable().map((s) => s.slug).join(', ') || '(none)';
          return res.status(400).json({ error: { code: 'VALIDATION', message: `writingStyle "${body.writingStyle}" not a selectable writing-style skill. Available: ${available}` } });
        }
        patch.writingStyle = body.writingStyle;
      }

      if ('language' in body) {
        if (body.language !== null && !isSupportedLanguage(body.language)) {
          return res.status(400).json({ error: { code: 'VALIDATION', message: `language "${String(body.language)}" not supported. Available: ${SUPPORTED_LANGUAGES.join(', ')}` } });
        }
        patch.language = body.language;
      }

      if ('onboardingCompleted' in body) {
        if (typeof body.onboardingCompleted !== 'boolean') {
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'onboardingCompleted must be boolean' } });
        }
        patch.onboardingCompleted = body.onboardingCompleted;
      }

      if ('entities' in body) {
        if (!Array.isArray(body.entities) || !body.entities.every((e) => typeof e === 'string')) {
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'entities must be string[]' } });
        }
        patch.entities = body.entities as string[];
      }

      if ('agent' in body) {
        const a = body.agent;
        if (a === null || typeof a !== 'object' || Array.isArray(a)) {
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'agent must be an object' } });
        }
        const ar = a as Record<string, unknown>;
        const next: { claudeUsePreset?: boolean; conversationalLanguage?: string | null } = {};
        if ('claudeUsePreset' in ar) {
          if (typeof ar.claudeUsePreset !== 'boolean') {
            return res.status(400).json({ error: { code: 'VALIDATION', message: 'agent.claudeUsePreset must be boolean' } });
          }
          next.claudeUsePreset = ar.claudeUsePreset;
        }
        if ('conversationalLanguage' in ar) {
          if (ar.conversationalLanguage !== null && !isSupportedLanguage(ar.conversationalLanguage)) {
            return res.status(400).json({ error: { code: 'VALIDATION', message: `agent.conversationalLanguage "${String(ar.conversationalLanguage)}" not supported. Available: ${SUPPORTED_LANGUAGES.join(', ')}` } });
          }
          next.conversationalLanguage = ar.conversationalLanguage;
        }
        // Only present subfields are forwarded; writeConfig deep-merges `agent`
        // so the untouched field (e.g. claudeUsePreset) is preserved.
        patch.agent = next;
      }

      // M28: hot-reload git-sync toggles. Only present subfields are forwarded;
      // writeConfig deep-merges `git` so the untouched toggle is preserved.
      if ('git' in body) {
        const g = body.git;
        if (g === null || typeof g !== 'object' || Array.isArray(g)) {
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'git must be an object' } });
        }
        const gr = g as Record<string, unknown>;
        const next: { syncCommitOnRelease?: boolean; syncPushOnPush?: boolean } = {};
        if ('syncCommitOnRelease' in gr) {
          if (typeof gr.syncCommitOnRelease !== 'boolean') {
            return res.status(400).json({ error: { code: 'VALIDATION', message: 'git.syncCommitOnRelease must be boolean' } });
          }
          next.syncCommitOnRelease = gr.syncCommitOnRelease;
        }
        if ('syncPushOnPush' in gr) {
          if (typeof gr.syncPushOnPush !== 'boolean') {
            return res.status(400).json({ error: { code: 'VALIDATION', message: 'git.syncPushOnPush must be boolean' } });
          }
          next.syncPushOnPush = gr.syncPushOnPush;
        }
        patch.git = next;
      }

      // M25: allow manual clear/override of remoteProjectId (e.g. UI "clear" after
      // a stale UUID). null ⇒ next push is a first push again.
      if ('remoteProjectId' in body) {
        if (body.remoteProjectId !== null && typeof body.remoteProjectId !== 'string') {
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'remoteProjectId must be string | null' } });
        }
        patch.remoteProjectId = body.remoteProjectId;
      }

      const updated = writeConfig(cwd, patch);
      if (deps.onContextConfigChanged && CONTEXT_DEFINING_FIELDS.some((f) => f in patch)) {
        deps.onContextConfigChanged();
      }
      res.json(configResponse(updated));
    } catch (err) {
      next(err);
    }
  });

  router.get('/writing-styles', (_req, res) => {
    const c = readConfig(cwd);
    res.json({
      active: c.writingStyle,
      available: skillRegistry.listSelectable().map((s) => ({
        slug: s.slug,
        title: s.title,
        description: s.description,
        version: s.version,
        language: s.language,
        source: s.source,
      })),
    });
  });

  return router;
}
