import { Router } from 'express';
import path from 'node:path';
import {
  readConfig,
  writeConfig,
  builtinRoot,
  configHash,
  type Config,
  type NormalizedConfig,
} from '../config.js';
import { buildFieldRegistry } from '../settings/registry.js';
import {
  checkFieldType,
  fieldPath,
  getPath,
  hasPath,
  setPath,
  type FieldValidationContext,
} from '../settings/field-registry.js';
import { indexStatusRouter } from './index-status.js';
import type { ProjectionStatusRegistry } from '../services/projection-status.js';
import type { Root } from '../../shared/types.js';
import { C4S_VERSION } from '../services/release-bundle.js';
import type { SkillRegistry } from '../services/skill-registry.js';
import type { PluginSettingsSection } from '../../shared/plugin-host/manifest.js';
import { resolveAgentPathScope } from '../services/agent-path-scope.js';
import {
  probePathScope,
  probeToolGating,
  type PathScopeStrength,
  type ToolGatingStrength,
  type ToolGroup,
} from '@inharness-ai/agent-adapters';
import { DIRECT_FILESYSTEM_DENY_GROUPS } from '../services/agent-tool-posture.js';
import { ensureGitignore } from '../../bin/gitignore.js';

export interface ConfigRouterDeps {
  cwd: string;
  skillRegistry: SkillRegistry;
  /**
   * The roots the RUNNING context was built from — `config.roots[]` with the built-in
   * `pages` dir replaced by the `--pages` CLI override, when one was given. Overlap
   * validation must use these, not the raw config: under `c4s --pages docs` the config
   * may still say 'pages', so validating against the file would bless an `entitiesDir`
   * that the next boot then rejects, leaving the project unopenable. Optional so tests
   * and any other caller can fall back to the on-disk roots.
   */
  effectiveRoots?: Root[];
  /**
   * M31: PATCH touching a context-defining field invalidates the project
   * context — the next request rebuilds it. No restart, no banner.
   *
   * 0.2.113: the set is no longer a list here — it is every field whose declarant
   * gave it the `context-rebuild` effect class (see `settings/registry.ts`),
   * plugin `executive` fields included. (`pagesDir` was named here until config
   * v4 replaced the scalar with `roots[]`.)
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
   * M33 phase 3: current plugin Settings sections (host.listSettings()). 0.2.113:
   * each field becomes a declared `plugins.<name>.<key>` leaf of the registry —
   * type-checked, and `executive` ⇒ `context-rebuild`. A plugin that declares
   * nothing (inactive, uninstalled) gets its PATCH dropped; its values stay.
   */
  pluginSettingsSections?: () => PluginSettingsSection[];
  /** 0.2.113: entity types the host knows — feeds the `entities` unknown-slug warning. */
  knownEntityTypes?: () => string[];
  /**
   * 0.2.113: the projection registry behind `/_meta/index-status` — the settings
   * module mounts that route together with `/config`. Absent ⇒ not mounted.
   */
  projectionStatus?: ProjectionStatusRegistry;
}


/**
 * Single source of the GET/PATCH /config response shape (was duplicated
 * inline in startServer before the M31 carve). M31 drops port/mode (workspace
 * settings now) and serverStartedAt (nothing requires a restart anymore).
 */
function configResponse(c: NormalizedConfig, cwd: string, skillRegistry: SkillRegistry) {
  // 0.2.8 (C23): `readConfig` normalizes every branch below — no `??` here.
  const agentAllowedPaths = c.agent.allowedPaths;
  const agentDisallowedPaths = c.agent.disallowedPaths;
  // 0.1.103: mirrors agent-turn.ts's exact pathScopeRequested gate — a pure
  // host-capability + current-config probe (what a turn run right now WOULD
  // get), not a specific past turn's actual adapter_ready event.
  const pathScopeRequested = agentAllowedPaths.length > 0 || agentDisallowedPaths.length > 0;
  // 0.1.130: the resolver now also folds in the implicit artifact deny-set (it requires the
  // 5 dir params). The strength badge deliberately still reflects only the USER's configured
  // scope (`pathScopeRequested`) — the always-on artifact deny is a separate, unshowable
  // hard-lock, so 'none' here means "no user scope", not "no enforcement".
  const pathScopeStrength: PathScopeStrength = pathScopeRequested
    ? probePathScope('claude-code', {
        cwd,
        ...resolveAgentPathScope({
          cwd,
          roots: c.roots,
          allowedPaths: agentAllowedPaths,
          disallowedPaths: agentDisallowedPaths,
          plansDir: c.plansDir,
          briefsDir: c.briefsDir,
          patchesDir: c.patchesDir,
          entitiesDir: c.entitiesDir,
          releasesDir: c.releasesDir,
        }),
        architectureConfig: { claude_sandbox: { enabled: true } },
      }).strength
    : 'none';

  /**
   * 0.2.53: one report for the whole project-constant posture. The groups are
   * probed together and reduced to the WEAKEST outcome across them, because the
   * badge makes a single claim about a single checkbox — a posture is only as
   * enforceable as its weakest group.
   */
  const gatingReports = c.agent.disableDirectFilesystemAccess
    ? probeToolGating('claude-code', DIRECT_FILESYSTEM_DENY_GROUPS as ToolGroup[])
    : [];
  const agentToolGating = {
    enforceable: gatingReports.every((r) => r.enforceable),
    // No reports means the flag is OFF and nothing is gated at all — which is
    // `none`, not the `hard` the `every`/`some` chain would otherwise fall
    // through to on an empty array. A consumer reading `strength` must never see
    // a hardness claim for a project with no gating.
    strength: (gatingReports.length === 0
      ? 'none'
      : gatingReports.some((r) => !r.enforceable || r.strength === 'none')
        ? 'none'
        : gatingReports.some((r) => r.strength === 'soft')
          ? 'soft'
          : 'hard') as ToolGatingStrength,
    escapeSurfaces: [...new Set(gatingReports.flatMap((r) => r.escapeSurfaces))],
  };

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
    language: c.language,
    description: c.description,
    onboarding: { completed: c.onboardingCompleted },
    briefsDir: c.briefsDir,
    patchesDir: c.patchesDir,
    plansDir: c.plansDir,
    entitiesDir: c.entitiesDir,
    releasesDir: c.releasesDir,
    entities: c.entities,
    agent: {
      claudeUsePreset: c.agent.claudeUsePreset,
      conversationalLanguage: c.agent.conversationalLanguage,
      allowedPaths: agentAllowedPaths,
      disallowedPaths: agentDisallowedPaths,
      // 0.1.103: real probed runtime enforcement strength for the current
      // config + host. 'none' when no scope is configured.
      pathScopeStrength,
      disableDirectFilesystemAccess: c.agent.disableDirectFilesystemAccess,
      /**
       * 0.2.53: what the deny-groups will ACTUALLY buy on this host, probed here
       * for the same reason `pathScopeStrength` is — the package's main entry
       * pulls the agent runtime and is not browser-safe, so the client cannot ask
       * for itself.
       *
       * The badge this feeds must never say "hard": on `claude-code` the strength
       * is `soft` (the tools are removed from the model's catalog — a
       * model-behaviour gate, not a sandbox) and `escapeSurfaces` names the
       * documented bypass, the native Agent/Task subagent, which does not inherit
       * the deny-groups.
       */
      toolGating: agentToolGating,
    },
    git: {
      enabled: c.git.enabled,
      syncPushOnPush: c.git.syncPushOnPush,
      commitTarget: {
        mode: c.git.commitTarget.mode,
        branch: c.git.commitTarget.branch,
        template: c.git.commitTarget.template,
        base: c.git.commitTarget.base,
      },
      switchAfterRelease: c.git.switchAfterRelease,
    },
    // M33 phase 3: persisted plugin settings namespace (absent ⇒ {}).
    plugins: c.plugins,
    remoteProjectId: c.remoteProjectId ?? null,
    remoteApiUrl: c.remoteApiUrl ?? null,
    $schemaVersion: c.$schemaVersion,
    /** 0.2.113: the running app's version, for the About card beside `$schemaVersion`. */
    appVersion: C4S_VERSION,
    /**
     * 0.2.101: optimistic-concurrency token — sha256 of `config.json` as read.
     * A client hands it back as `expectedConfigHash` when renaming a root, the
     * same way a page write hands back `expectedHash`. Response-only: it is
     * never accepted in a PATCH body.
     */
    configHash: configHash(cwd),
  };
}

/**
 * Per-context config/meta/writing-styles routes (carved out of startServer,
 * M31). Mounted relative — the project router lives under /api/projects/:id.
 *
 * 0.2.113: this is the settings module's router — `/config` (GET/PATCH) and
 * `/_meta/index-status`. The configuration is a project singleton, so the paths
 * are not collections.
 */
export function configRouter(deps: ConfigRouterDeps): Router {
  const { cwd, skillRegistry } = deps;
  const router = Router();

  // 0.2.113: the settings module's own diagnostics route, mounted beside
  // `/config`. (The root rename under `/config/roots` belongs to the project
  // module and is mounted by it — see `project-context.ts`.)
  if (deps.projectionStatus) {
    router.use('/_meta/index-status', indexStatusRouter(deps.projectionStatus));
  }

  router.get('/meta', (_req, res) => {
    res.json({ cwd, cwdName: path.basename(cwd), c4sVersion: C4S_VERSION });
  });

  router.get('/config', (_req, res) => {
    // readConfig per-request: PATCH /config musi byc widoczny w GET bez restartu.
    // Spojne z istniejacym wzorcem SkillResolver (per-query disk read).
    const c = readConfig(cwd);
    res.json(configResponse(c, cwd, skillRegistry));
  });

  router.patch('/config', async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const currentConfig = readConfig(cwd);
      const registry = buildFieldRegistry({
        pluginSections: deps.pluginSettingsSections?.() ?? [],
        ...(deps.knownEntityTypes ? { knownEntityTypes: deps.knownEntityTypes } : {}),
      });
      const reject = (key: string, message: string) =>
        res.status(400).json({ error: { code: 'VALIDATION', message, details: { field: key } } });

      /**
       * 0.2.113: the whitelist IS the registry — the handler reads only the keys a
       * declarant marked `apiWritable`, and drops everything else without an error
       * (`port`/`mode` included: their dedicated 400 is gone, they are just unknown
       * keys now). A container the body carries in the wrong shape (`agent: 42`) is
       * still a type error, pinned to the container.
       */
      const writable = registry.list().filter((d) => d.apiWritable);
      // Kept as SEGMENTS, not a dotted string: a plugin's package name may itself
      // contain a dot, and re-splitting `plugins.@x/y.z` would miss the container.
      const containers = new Map<string, readonly string[]>();
      for (const d of writable) {
        const segs = fieldPath(d);
        for (let i = 1; i < segs.length; i++) containers.set(segs.slice(0, i).join('.'), segs.slice(0, i));
      }
      for (const [c, segs] of containers) {
        if (!hasPath(body, segs)) continue;
        const v = getPath(body, segs);
        if (v === null || typeof v !== 'object' || Array.isArray(v)) return reject(c, `${c} must be an object`);
      }
      const present = writable.filter((d) => hasPath(body, fieldPath(d)));
      const touched = new Set(present.map((d) => d.key));
      const vctx: FieldValidationContext = {
        cwd,
        current: currentConfig,
        skillRegistry,
        effectiveRoots: deps.effectiveRoots ?? currentConfig.roots,
        touched,
      };

      // Stage 1 — the wire type of every present key.
      for (const d of present) {
        const typeError = checkFieldType(d.key, d.type, getPath(body, fieldPath(d)));
        if (typeError) return reject(d.key, typeError);
      }

      // Stage 2 — each field's own rule. A rule may normalize what it accepts.
      const values = new Map<string, unknown>();
      const warnings: string[] = [];
      for (const d of present) {
        let value = getPath(body, fieldPath(d));
        if (d.validate) {
          const r = await d.validate(value, vctx);
          if (!r.ok) return reject(d.key, r.error);
          if ('value' in r) value = r.value;
          if (r.warning) warnings.push(r.warning);
        }
        values.set(d.key, value);
      }

      // Stage 3 — rules across fields, evaluated on the EFFECTIVE post-write config and
      // only when the request touches one of the rule's fields.
      const effective = (key: string): unknown =>
        values.has(key) ? values.get(key) : getPath(currentConfig, registry.get(key) ? fieldPath(registry.get(key)!) : key);
      for (const rule of registry.crossFieldRules()) {
        if (!rule.touches.some((k) => touched.has(k))) continue;
        const r = await rule.check(effective, vctx);
        if (!r.ok) return reject(r.key, r.error);
        warnings.push(...(r.warnings ?? []));
      }
      // A warning never blocks the save — it is surfaced on the channel boot uses and
      // handed back to whoever caused it.
      for (const w of warnings) console.warn(`[config] ${w}`);

      const patch: Record<string, unknown> = {};
      for (const d of present) setPath(patch, fieldPath(d), values.get(d.key));

      const updated = writeConfig(cwd, patch as Partial<Config>);
      // 0.1.118: re-sync .gitignore whenever a field it depends on changes —
      // best-effort (never fail the PATCH over a gitignore write hiccup).
      if ('git' in patch || 'briefsDir' in patch || 'patchesDir' in patch || 'plansDir' in patch || 'releasesDir' in patch) {
        try {
          ensureGitignore(cwd, {
            briefsDir: updated.briefsDir,
            patchesDir: updated.patchesDir,
            plansDir: updated.plansDir,
            releasesDir: updated.releasesDir,
            gitEnabled: updated.git.enabled,
          });
        } catch (err) {
          console.error('[config] ensureGitignore re-sync failed:', err);
        }
      }
      // 0.1.56: create the deferred welcome page BEFORE invalidating the context,
      // so the lazy rebuild's indexAll() picks it up. Runs on the effective
      // post-write pages root (a roots change in the same atomic body is already
      // persisted in `updated`).
      if (patch.onboardingCompleted === true) {
        const pagesDir = builtinRoot(updated.roots).dir;
        deps.onOnboardingCompleted?.(pagesDir);
      }
      // M31 + 0.2.113: a save of any `context-rebuild` field — core or a plugin's
      // `executive` one — invalidates the context; the next request rebuilds it.
      const rebuild = present.some((d) => d.effect === 'context-rebuild');
      if (rebuild) deps.onContextConfigChanged?.();
      res.json({
        ...configResponse(updated, cwd, skillRegistry),
        ...(warnings.length > 0 ? { warnings } : {}),
      });
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
