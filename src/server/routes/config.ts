import { Router } from 'express';
import path from 'node:path';
import { readConfig, writeConfig, parseRootsArray, validateRootDirs, type Config } from '../config.js';
import type { Root } from '../../shared/types.js';
import { SUPPORTED_LANGUAGES, isSupportedLanguage } from '../../shared/languages.js';
import { C4S_VERSION } from '../services/release-bundle.js';
import type { SkillRegistry } from '../services/skill-registry.js';
import type { PluginSettingsSection } from '../../shared/plugin-host/manifest.js';
import { resolveAgentPathScope } from '../services/agent-path-scope.js';
import { probePathScope, type PathScopeStrength } from '@inharness-ai/agent-adapters';
import { ensureGitignore } from '../../bin/gitignore.js';

export interface ConfigRouterDeps {
  cwd: string;
  skillRegistry: SkillRegistry;
  /**
   * M31: PATCH touching a context-defining field (pagesDir/briefsDir/
   * patchesDir/entitiesDir/entities) invalidates the project context — the
   * next request rebuilds it. No restart, no banner.
   */
  onContextConfigChanged?: () => void;
  /**
   * 0.1.56: fired after a PATCH persists `onboardingCompleted: true` (Continue
   * or Skip), with the effective post-write pages-root dir. Wires the deferred,
   * idempotent welcome `pages/index.md` step so changing the pages root's dir in
   * onboarding can't leave an orphan index on the old path.
   */
  onOnboardingCompleted?: (effectivePagesDir: string) => void;
  /**
   * M33 phase 3: current plugin Settings sections (host.listSettings()). Used to
   * classify a `plugins` PATCH per field `kind` — if any written field is
   * `executive`, the context is invalidated (rebuild); `hot-reload` fields are
   * not (parity with writingStyle/language).
   */
  pluginSettingsSections?: () => PluginSettingsSection[];
}

const CONTEXT_DEFINING_FIELDS = ['roots', 'briefsDir', 'patchesDir', 'entitiesDir', 'releasesDir', 'entities'] as const;

/**
 * Single source of the GET/PATCH /config response shape (was duplicated
 * inline in startServer before the M31 carve). M31 drops port/mode (workspace
 * settings now) and serverStartedAt (nothing requires a restart anymore).
 */
function configResponse(c: Config, cwd: string, skillRegistry: SkillRegistry) {
  const agentAllowedPaths = c.agent?.allowedPaths ?? [];
  const agentDisallowedPaths = c.agent?.disallowedPaths ?? [];
  // 0.1.103: mirrors agent-turn.ts's exact pathScopeRequested gate — a pure
  // host-capability + current-config probe (what a turn run right now WOULD
  // get), not a specific past turn's actual adapter_ready event.
  const pathScopeRequested = agentAllowedPaths.length > 0 || agentDisallowedPaths.length > 0;
  const pathScopeStrength: PathScopeStrength = pathScopeRequested
    ? probePathScope('claude-code', {
        cwd,
        ...resolveAgentPathScope({
          cwd,
          roots: c.roots,
          allowedPaths: agentAllowedPaths,
          disallowedPaths: agentDisallowedPaths,
        }),
        architectureConfig: { claude_sandbox: { enabled: true } },
      }).strength
    : 'none';

  return {
    name: c.name,
    roots: c.roots,
    writingStyle: c.writingStyle,
    // Non-fatal degraded-state signal: the configured style was skipped this
    // session (see the soft-fail in project-context.ts buildInner) because it
    // no longer resolves. Live check, not a boot-time snapshot.
    writingStyleUnavailable: c.writingStyle !== null && !skillRegistry.isSelectable(c.writingStyle)
      ? { reason: skillRegistry.unselectableReason(c.writingStyle) }
      : null,
    language: c.language ?? null,
    description: c.description ?? null,
    onboarding: { completed: c.onboardingCompleted },
    briefsDir: c.briefsDir,
    patchesDir: c.patchesDir,
    entitiesDir: c.entitiesDir,
    releasesDir: c.releasesDir,
    entities: c.entities,
    agent: {
      claudeUsePreset: c.agent?.claudeUsePreset ?? true,
      conversationalLanguage: c.agent?.conversationalLanguage ?? null,
      allowedPaths: agentAllowedPaths,
      disallowedPaths: agentDisallowedPaths,
      // 0.1.103: real probed runtime enforcement strength for the current
      // config + host. 'none' when no scope is configured.
      pathScopeStrength,
    },
    git: {
      enabled: c.git?.enabled ?? false,
      syncCommitOnRelease: c.git?.syncCommitOnRelease ?? false,
      syncPushOnPush: c.git?.syncPushOnPush ?? false,
    },
    // M33 phase 3: persisted plugin settings namespace (absent ⇒ {}).
    plugins: c.plugins ?? {},
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
    res.json(configResponse(c, cwd, skillRegistry));
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
        roots: Root[];
        briefsDir: string;
        patchesDir: string;
        entitiesDir: string;
        releasesDir: string;
        writingStyle: string | null;
        language: string | null;
        description: string | null;
        onboardingCompleted: boolean;
        entities: string[];
        agent: { claudeUsePreset?: boolean; conversationalLanguage?: string | null };
        git: { enabled?: boolean; syncCommitOnRelease?: boolean; syncPushOnPush?: boolean };
        plugins: Record<string, Record<string, unknown>>;
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
        // 0.1.91 — name is display-only (folder identity is sha1(cwd), not the name),
        // so full Unicode is allowed; reject only C0/DEL/C1 control chars + newline/tab.
        if (trimmed.length < 1 || trimmed.length > 80 || /[\u0000-\u001F\u007F-\u009F]/.test(trimmed)) {
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'name: 1-80 chars, no line breaks or control characters' } });
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

      for (const field of ['briefsDir', 'patchesDir', 'entitiesDir', 'releasesDir'] as const) {
        if (field in body) {
          const result = validateDir(field, body[field]);
          if (typeof result === 'object') {
            return res.status(400).json({ error: { code: 'VALIDATION', message: result.error } });
          }
          patch[field] = result;
        }
      }

      // 0.1.96: full-array replace of roots[]. Structural validation (types,
      // path-safety, unique ids, dangling linkTargets, built-in pages present)
      // via parseRootsArray; cross-field overlap via validateRootDirs against the
      // effective (merged) briefs/patches/entities dirs. Any hard violation → 400.
      if ('roots' in body) {
        let roots: Root[];
        try {
          roots = parseRootsArray(body.roots);
        } catch (err) {
          return res.status(400).json({ error: { code: 'VALIDATION', message: (err as Error).message } });
        }
        const current = readConfig(cwd);
        const effective = {
          entitiesDir: (patch.entitiesDir ?? current.entitiesDir),
          releasesDir: (patch.releasesDir ?? current.releasesDir),
          briefsDir: (patch.briefsDir ?? current.briefsDir),
          patchesDir: (patch.patchesDir ?? current.patchesDir),
        };
        if (effective.briefsDir === effective.patchesDir) {
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'briefsDir and patchesDir must differ' } });
        }
        const { errors } = validateRootDirs(roots, effective);
        if (errors.length > 0) {
          return res.status(400).json({ error: { code: 'VALIDATION', message: errors[0] } });
        }
        patch.roots = roots;
      }

      if ('writingStyle' in body) {
        if (body.writingStyle !== null && typeof body.writingStyle !== 'string') {
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'writingStyle must be string | null' } });
        }
        if (typeof body.writingStyle === 'string' && !skillRegistry.isSelectable(body.writingStyle)) {
          return res.status(400).json({ error: { code: 'VALIDATION', message: `writingStyle "${body.writingStyle}" ${skillRegistry.unselectableReason(body.writingStyle)}` } });
        }
        patch.writingStyle = body.writingStyle;
      }

      if ('language' in body) {
        if (body.language !== null && !isSupportedLanguage(body.language)) {
          return res.status(400).json({ error: { code: 'VALIDATION', message: `language "${String(body.language)}" not supported. Available: ${SUPPORTED_LANGUAGES.join(', ')}` } });
        }
        patch.language = body.language;
      }

      // 0.1.58: local "elevator pitch" (0–200). `null` or an empty/whitespace
      // string clears it; >200 → 400 inline. Distinct from the remote
      // project.description (different endpoint, no sync).
      if ('description' in body) {
        if (body.description !== null && typeof body.description !== 'string') {
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'description must be string | null' } });
        }
        if (typeof body.description === 'string' && body.description.length > 200) {
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'description must be at most 200 characters' } });
        }
        const trimmed = typeof body.description === 'string' ? body.description.trim() : null;
        patch.description = trimmed ? body.description : null;
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
        const next: {
          claudeUsePreset?: boolean;
          conversationalLanguage?: string | null;
          allowedPaths?: string[];
          disallowedPaths?: string[];
        } = {};
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
        // 0.1.90: agent FS path scope — each must be string[] (membership/normalization
        // happens later in the M05 resolver; here we only enforce the wire type).
        for (const field of ['allowedPaths', 'disallowedPaths'] as const) {
          if (field in ar) {
            if (!Array.isArray(ar[field]) || !(ar[field] as unknown[]).every((e) => typeof e === 'string')) {
              return res.status(400).json({ error: { code: 'VALIDATION', message: `agent.${field} must be string[]` } });
            }
            next[field] = ar[field] as string[];
          }
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
        const next: { enabled?: boolean; syncCommitOnRelease?: boolean; syncPushOnPush?: boolean } = {};
        if ('enabled' in gr) {
          if (typeof gr.enabled !== 'boolean') {
            return res.status(400).json({ error: { code: 'VALIDATION', message: 'git.enabled must be boolean' } });
          }
          next.enabled = gr.enabled;
        }
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

      // M33 phase 3: plugin settings namespace. Validate shape only (object of
      // per-plugin objects); writeConfig deep-merges each `plugins[<name>]` so a
      // single-field write preserves the plugin's other fields and other
      // namespaces. Field semantics live in each plugin's settings descriptor.
      if ('plugins' in body) {
        const p = body.plugins;
        if (p === null || typeof p !== 'object' || Array.isArray(p)) {
          return res.status(400).json({ error: { code: 'VALIDATION', message: 'plugins must be an object' } });
        }
        const next: Record<string, Record<string, unknown>> = {};
        for (const [name, sub] of Object.entries(p as Record<string, unknown>)) {
          if (sub === null || typeof sub !== 'object' || Array.isArray(sub)) {
            return res.status(400).json({ error: { code: 'VALIDATION', message: `plugins.${name} must be an object` } });
          }
          next[name] = sub as Record<string, unknown>;
        }
        patch.plugins = next;
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
      // 0.1.118: re-sync .gitignore whenever a field it depends on changes —
      // best-effort (never fail the PATCH over a gitignore write hiccup).
      if ('git' in patch || 'briefsDir' in patch || 'patchesDir' in patch || 'releasesDir' in patch) {
        try {
          ensureGitignore(cwd, {
            briefsDir: updated.briefsDir,
            patchesDir: updated.patchesDir,
            releasesDir: updated.releasesDir,
            gitEnabled: updated.git?.enabled ?? false,
          });
        } catch (err) {
          console.error('[config] ensureGitignore re-sync failed:', err);
        }
      }
      // 0.1.56: create the deferred welcome page BEFORE invalidating the context,
      // so the lazy rebuild's indexAll() picks it up. Runs on the effective
      // post-write pagesDir (a pagesDir change in the same atomic body is already
      // persisted in `updated`).
      if (patch.onboardingCompleted === true) {
        const pagesDir = updated.roots.find((r) => r.id === 'pages')?.dir ?? 'pages';
        deps.onOnboardingCompleted?.(pagesDir);
      }
      // M33 phase 3: a `plugins` write invalidates the context only when at
      // least one written field is `executive`; `hot-reload`-only writes take
      // effect on the next turn/thread without a rebuild.
      const pluginsPatchIsExecutive = (): boolean => {
        if (!patch.plugins || !deps.pluginSettingsSections) return false;
        const sections = deps.pluginSettingsSections();
        for (const [name, fields] of Object.entries(patch.plugins)) {
          const section = sections.find((s) => s.name === name);
          if (!section) continue;
          for (const key of Object.keys(fields)) {
            if (section.fields.find((f) => f.key === key)?.kind === 'executive') return true;
          }
        }
        return false;
      };
      if (
        deps.onContextConfigChanged &&
        (CONTEXT_DEFINING_FIELDS.some((f) => f in patch) || pluginsPatchIsExecutive())
      ) {
        deps.onContextConfigChanged();
      }
      res.json(configResponse(updated, cwd, skillRegistry));
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
