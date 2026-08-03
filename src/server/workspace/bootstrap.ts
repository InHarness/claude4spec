import fs from 'node:fs';
import path from 'node:path';
import { loadOrCreateConfig, migrateConfigToV3, migrateConfigToV4, readConfig, type Config } from '../config.js';
import { ensureMcpJson } from '../mcp/ensure-mcp-json.js';
import { ensureGitignore } from '../../bin/gitignore.js';
import { BOOTSTRAP_TEMPLATE } from '../../bin/bootstrap-template.js';
import { migrateLegacyDbIfNeeded } from './db-migration.js';
import type { WorkspaceRegistry } from './registry.js';
import type { ProjectRecord, WorkspaceRecord } from './types.js';

export interface BootstrapOptions {
  /** CLI `--name` (sticky config.name on first bootstrap; also M27 clone override). */
  name?: string;
  /** CLI `--pages` (sticky config.pagesDir on first bootstrap). */
  pagesDir?: string;
  /** CLI `--remote-url` (sticky config.remoteApiUrl on first bootstrap). */
  remoteApiUrl?: string | null;
}

export interface BootstrapResult {
  project: ProjectRecord;
  config: Config;
  configPath: string;
  /** M27 clone-rollback flags: did THIS run create the artifacts? */
  configCreated: boolean;
  claudeDirCreated: boolean;
  gitignoreCreated: boolean;
}

/**
 * 0.1.56: welcome `pages/index.md` is no longer written at fresh bootstrap — it
 * is deferred to onboarding close (confirm or skip) so a `pagesDir` change in
 * onboarding can't orphan an index at the old path. The PATCH /api/config
 * handler calls this after persisting `onboardingCompleted: true`, on the
 * effective pagesDir. Idempotent: skips if `index.md` exists or pagesDir is
 * non-empty (don't clobber restored/cloned pages).
 */
export function ensureWelcomePage(cwd: string, pagesDir: string | undefined): void {
  const pagesPath = path.join(cwd, pagesDir ?? 'pages');
  fs.mkdirSync(pagesPath, { recursive: true });
  const indexPath = path.join(pagesPath, 'index.md');
  if (fs.existsSync(indexPath)) return;
  const existing = fs.readdirSync(pagesPath).filter((name) => !name.startsWith('.'));
  if (existing.length > 0) return;
  fs.writeFileSync(indexPath, BOOTSTRAP_TEMPLATE, 'utf8');
}

/**
 * M31: per-project activation hook (absorbed from src/bin/claude4spec.ts) —
 * runs for the CLI-started `--cwd` project AND for every
 * `POST /api/workspace/projects`. Idempotent end-to-end: re-activating an
 * existing project changes nothing.
 *
 * Sequence: mkdir cwd → config (create or load) → config v3 migration (carry
 * port/mode to the registry, first-wins) → .gitignore → entitiesDir →
 * .claude4spec/mcp.json (M12) → registry registration (creates the DB slot) →
 * legacy DB relocation. (0.1.56: welcome page no longer created here —
 * deferred to onboarding close. 0.1.104: external skills generation moved
 * off this bootstrap hook entirely — see `c4s install-skills` / M22's
 * `buildExternalSkillsBundle`, both on-demand.)
 */
export function bootstrapProject(
  registry: WorkspaceRegistry,
  workspace: WorkspaceRecord,
  cwd: string,
  opts: BootstrapOptions = {},
): BootstrapResult {
  fs.mkdirSync(cwd, { recursive: true });
  // M27: capture pre-bootstrap state for clone rollback — `.claude4spec/` is
  // created lazily by loadOrCreateConfig, so check existence BEFORE it.
  const claudeDirExisted = fs.existsSync(path.join(cwd, '.claude4spec'));
  // 0.2.8: migrations run BEFORE `loadOrCreateConfig`, not after. That function
  // validates the file it reads, so on exactly the outdated shapes a migration
  // exists to repair it threw first and the repair never ran — the project
  // stayed unloadable with the fix sitting one line below the throw. Both
  // migrations no-op on a missing file, so a fresh bootstrap is unaffected.
  //
  // v4 BEFORE v3, deliberately. Both end by reading the config back, so
  // whichever runs first must leave the file loadable — and v4 is the one that
  // repairs the shapes the loader rejects (incomplete `roots[]`). Running v3
  // first meant its own read threw on exactly those files. v3 still harvests
  // `port`/`mode` correctly afterwards: its already-v3 check requires their
  // absence, not just a version number.
  //
  // 0.1.96 config v4: map the legacy `pagesDir` scalar to the built-in `pages`
  // root (config.roots[]); 0.2.8 also materializes absent root fields and
  // carries a legacy `git.syncCommitOnRelease`. Idempotent.
  migrateConfigToV4(cwd);
  // M31 config v3: physically remove pre-v3 port/mode; harvested values seed
  // the workspace registry (first-wins — an existing defaultPort stays).
  const { carried } = migrateConfigToV3(cwd);
  registry.carryDefaults(workspace.name, carried);
  const { created: configCreated, path: configFilePath } = loadOrCreateConfig(cwd, {
    name: opts.name,
    pagesDir: opts.pagesDir,
    remoteApiUrl: opts.remoteApiUrl,
  });
  // Re-read AFTER loadOrCreateConfig so a freshly seeded file (and any CLI
  // overrides it applied) is reflected — the migration's own return value
  // predates that write.
  const config = readConfig(cwd);

  const gitignoreExisted = fs.existsSync(path.join(cwd, '.gitignore'));
  ensureGitignore(cwd, {
    briefsDir: config.briefsDir,
    patchesDir: config.patchesDir,
    plansDir: config.plansDir,
    releasesDir: config.releasesDir,
    gitEnabled: config.git.enabled,
  });
  // 0.1.56: welcome page deferred to onboarding close — see ensureWelcomePage.
  fs.mkdirSync(path.resolve(cwd, config.entitiesDir), {
    recursive: true,
  });
  // 0.1.118: releasesDir — same forward-compat default as entitiesDir, so a
  // fresh project has the dir before the ReleasesWatcher roots there.
  fs.mkdirSync(path.resolve(cwd, config.releasesDir), {
    recursive: true,
  });
  ensureMcpJson({ projectAbsPath: cwd, workspace: workspace.name });

  const project = registry.registerProject(workspace, cwd);
  migrateLegacyDbIfNeeded(registry, workspace, cwd, project.id);

  return {
    project,
    config,
    configPath: configFilePath,
    configCreated,
    claudeDirCreated: !claudeDirExisted,
    gitignoreCreated: !gitignoreExisted,
  };
}
