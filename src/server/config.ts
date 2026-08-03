import fs from 'node:fs';
import path from 'node:path';
import { type Root, type RootSidebar, DEFAULT_PAGES_ROOT_PROPS, DEFAULT_USER_ROOT_PROPS } from '../shared/types.js';
import { hasDotSegment } from '../shared/page-files.js';

export interface Config {
  $schemaVersion: number;
  name: string;
  /**
   * 0.1.96 multiroot: ordered list of named page roots. The built-in `'pages'`
   * root (`builtin: true`) is always present. Replaces the single `pagesDir`
   * scalar. Briefs/patches are NOT roots — they stay as `briefsDir`/`patchesDir`
   * scalars below.
   */
  roots: Root[];
  /**
   * M21: catalog of brief files (relative to cwd, default `.claude4spec/briefs`).
   * Same validation as `pagesDir` (must be relative, must not escape cwd).
   * Forward-compat: missing in pre-M21 configs = treated as default.
   */
  briefsDir: string;
  /**
   * M23: catalog of patch files (relative to cwd, default `.claude4spec/patches`).
   * Same validation as `pagesDir`/`briefsDir` (must be relative, must not
   * escape cwd). Forward-compat: missing in pre-M23 configs = treated as default.
   */
  patchesDir: string;
  /**
   * 0.1.127 M10/M36: catalog of plan files (relative to cwd, default
   * `.claude4spec/plans`). Same validation as `briefsDir`/`patchesDir` (must be
   * relative, must not escape cwd). Active once the plan → filesystem migration
   * lands (see brief 0-1-126-to-0-1-127). Forward-compat: missing = treated as
   * default. Additive — no `$schemaVersion` bump.
   */
  plansDir: string;
  /**
   * M29: directory of committed entity JSON files + tags.json (relative to cwd,
   * default `.claude4spec/entities`). Source of truth for entities; SQLite is a
   * derived index rebuilt from these files at boot. Same validation as
   * `briefsDir`/`patchesDir` (must be relative, must not escape cwd) — but,
   * unlike them, this directory is COMMITTED to git. Forward-compat: missing in
   * pre-M29 configs = treated as default. Additive — no `$schemaVersion` bump.
   */
  entitiesDir: string;
  /**
   * 0.1.118: directory of on-disk release identity files (relative to cwd,
   * default `.claude4spec/releases`). One `<slug>.json` per release (name,
   * slug, description, createdAt, createdBy, roots) — identity only, no
   * version content. `spec_release` (SQLite) is a derived cache rebuilt from
   * these files, analogous to how entities are rebuilt from `entitiesDir`.
   * Same validation as `entitiesDir` (must be relative, must not escape cwd,
   * included in the D4 no-overlap check). Committed to git when `git.enabled`,
   * local-only otherwise. Forward-compat: missing = treated as default.
   * Additive — no `$schemaVersion` bump.
   */
  releasesDir: string;
  writingStyle: string | null;
  /**
   * 0.1.58: one-line "elevator pitch" (0–200 chars) describing this specification.
   * Surfaced to chat agents of OTHER workspace projects via the
   * `<workspace_projects>` prompt block, so a peer agent knows what this spec is
   * before consulting it through `c4s-tools.ask`. Local-only — distinct from the
   * remote `project.description` (peer-spec, different endpoint, no sync).
   * Additive — no `$schemaVersion` bump; missing/`null` = no description.
   */
  description?: string | null;
  /**
   * 0.1.51: language the agent writes SPEC CONTENT in (pages, entity descriptions,
   * briefs). Display name from `SUPPORTED_LANGUAGES` (src/shared/languages.ts) or
   * `null` = no language directive (pre-0.1.51 behaviour). Top-level because it
   * governs the produced artifact, not the conversation. Additive — no
   * `$schemaVersion` bump; missing field = `null`.
   */
  language: string | null;
  onboardingCompleted: boolean;
  /**
   * Whitelist of active entity-plugin types (M13). Absent (undefined) =
   * all registered plugins are active — backward compat with $schemaVersion: 1
   * projects. Empty array [] = no plugins active (markdown-only project).
   */
  entities?: string[];
  consistency?: ConsistencyConfig;
  agent?: AgentConfig;
  /**
   * M24: base URL of the remote claude4spec-API (dev/staging override).
   * `null`/absent = the hardcoded production constant in M24. Additive — no
   * `$schemaVersion` bump; projects from before M24 keep production behaviour.
   */
  remoteApiUrl?: string | null;
  /**
   * M25: UUID of this project on the remote (set after the first successful
   * push). `null`/absent = no remote project yet ⇒ the next push is a first push
   * (creates a new project from `name`). Additive — no `$schemaVersion` bump; not
   * a secret (the secret is `access_token` in `remote_session`).
   */
  remoteProjectId?: string | null;
  /**
   * M28: optional Git Sync toggles. Absent/missing ⇒ both `false` (opt-in,
   * forward-compatible with configs written before M28). Additive — no
   * `$schemaVersion` bump. Read per-action (hot-reload).
   */
  git?: GitSyncConfig;
  /**
   * M33 phase 3: namespace for settings contributed by plugins
   * (`contributes.settings`). Each loaded plugin with settings gets its own
   * sub-object keyed by `manifest.name` (e.g. `"@c4s/plugin-foo"`), isolated
   * from core fields (`entities` / `agent` / `git` / paths). Absent/missing ⇒
   * `{}`. Additive — no `$schemaVersion` bump; projects without
   * settings-bearing plugins keep prior behaviour. PATCH deep-merges per
   * `plugins[<name>]` (precedent: `agent` / `git`), so writing one field
   * preserves the plugin's other fields and other namespaces. Values persist
   * even when the plugin is absent/inactive (user data preserved).
   */
  plugins?: Record<string, Record<string, unknown>>;
}

export interface GitSyncConfig {
  /**
   * 0.1.118: master switch for the entire git layer. Absent/missing ⇒ `false`
   * (opt-in — existing projects with `syncPushOnPush` already `true` lose
   * push-on-release after upgrading; the Settings UI surfaces an amber banner
   * for that case). When `false`, ALL git operations no-op and return
   * `status: 'skipped'`; `detect()` may still run.
   *
   * 0.1.124: `enabled` alone now also gates commit-on-release/commit-on-pull —
   * the separate `syncCommitOnRelease` sub-toggle was removed (there is no
   * longer a "git on, but doesn't commit" state). 0.2.8: a `config.json` still
   * carrying `syncCommitOnRelease` is no longer silently dropped — the v4
   * migration maps `true` onto `enabled` (see {@link migrateConfigToV4}), so a
   * project that had commit-on-release keeps it after upgrading.
   */
  enabled?: boolean;
  /** When on, a successful remote push best-effort `git push`es the current branch. */
  syncPushOnPush?: boolean;
  /**
   * 0.1.125: where a release commit lands. Absent/missing ⇒
   * `{ mode: 'current', branch: null, template: null, base: null }` (prior
   * behavior — commit on current HEAD). Additive — no `$schemaVersion` bump.
   */
  commitTarget?: GitCommitTargetConfig;
  /**
   * 0.1.125: after a `named`/`new` commit-target commit succeeds, switch
   * HEAD/working tree to the target branch. Absent/missing ⇒ `false`. Has no
   * effect when `commitTarget.mode === 'current'`.
   */
  switchAfterRelease?: boolean;
}

/**
 * 0.1.125: `config.git.commitTarget` — see `GitSyncConfig.commitTarget`.
 * Conditional-required fields (`branch` for `named`, `template` for `new`)
 * are typed loosely here (`string | null`) — semantic "non-empty when this
 * mode is active" validation lives in the PATCH /api/config route, not here
 * (this shape must also tolerate a config.json where the inactive mode's
 * field was never set, e.g. `mode: 'current'` with `branch: null`).
 */
export interface GitCommitTargetConfig {
  mode?: 'current' | 'named' | 'new';
  /** Used only when `mode === 'named'`. */
  branch?: string | null;
  /** Used only when `mode === 'new'`. Supports `{release_slug}`/`{release_name}`/`{date}`. */
  template?: string | null;
  /** Used only when `mode === 'new'`. `null` = auto-detect via `resolveDefaultBranch()`. */
  base?: string | null;
}

export type ConsistencySeverity = 'off' | 'warn' | 'error';

export interface ConsistencyConfig {
  requireAcCoverage?: ConsistencySeverity;
  requireModuleAc?: ConsistencySeverity;
}

export interface AgentConfig {
  // 0.1.62: the agent's own ANTHROPIC API key is intentionally NOT a config field.
  // It is a per-user secret (precedent: `remote_session.access_token`) kept in the
  // gitignored `agent_credential` table (M05), encrypted at-rest — never in this
  // team-shared / committed `config.json`. No `anthropicApiKey` field, no `$schemaVersion` bump.
  //
  // Brak pola = effective true. 0.2.8: default stosuje `normalizeConfig` przy
  // wczytaniu (konsumenci czytaja `config.agent.claudeUsePreset` wprost).
  // Additive — bez bumpu `$schemaVersion`.
  claudeUsePreset?: boolean;
  /**
   * 0.1.51: language the agent REPLIES TO THE USER in (chat), regardless of the
   * question's language. Display name from `SUPPORTED_LANGUAGES` or `null`/absent =
   * no directive. Nested under `agent` because it governs chat behaviour, not the
   * artifact. Additive — no `$schemaVersion` bump.
   */
  conversationalLanguage?: string | null;
  /**
   * 0.1.90: filesystem path scope for the chat agent. The implicit base (`cwd`
   * ∪ `pagesDir` when outside `cwd`) is added by the agent-adapters library;
   * these widen/narrow it. `allowedPaths` extends scope beyond the base;
   * `disallowedPaths` carves out (precedence: deny > allow > base). Absolute
   * recommended; relative entries resolve vs `cwd` in the runtime resolver
   * (M05). Read+write combined. Additive — no `$schemaVersion` bump.
   */
  allowedPaths?: string[];
  disallowedPaths?: string[];
}

export interface NormalizedGitCommitTargetConfig {
  mode: 'current' | 'named' | 'new';
  branch: string | null;
  template: string | null;
  base: string | null;
}

export interface NormalizedGitSyncConfig {
  enabled: boolean;
  syncPushOnPush: boolean;
  commitTarget: NormalizedGitCommitTargetConfig;
  switchAfterRelease: boolean;
}

export interface NormalizedConsistencyConfig {
  requireAcCoverage: ConsistencySeverity;
  requireModuleAc: ConsistencySeverity;
}

export interface NormalizedAgentConfig {
  claudeUsePreset: boolean;
  conversationalLanguage: string | null;
  allowedPaths: string[];
  disallowedPaths: string[];
}

/**
 * 0.2.8 (C23): the shape `readConfig` GUARANTEES. Every nested branch that
 * `defaults()` covers is present with a real value, so consumers read
 * `config.git.enabled` / `config.agent.claudeUsePreset` directly — never
 * `?? false` / `?? true` at the point of use. Applying those defaults is the
 * job of exactly one function ({@link normalizeConfig}); `defaults()` remains
 * the only source of the VALUES.
 *
 * `entities` is deliberately NOT part of the guarantee: `undefined` carries
 * meaning there ("all registered entity types active", see
 * plugin-host/types.ts) and is not interchangeable with `[]` ("no types").
 * Normalizing it would destroy that three-valued semantic — as it would for any
 * future field whose absent state is not equivalent to a default.
 *
 * Assignable to `Config`, so every consumer typed against `Config` keeps
 * compiling; only consumers that WANT the guarantee widen their param type to
 * `NormalizedConfig` and drop their `??`.
 */
export type NormalizedConfig = Config & {
  agent: NormalizedAgentConfig;
  git: NormalizedGitSyncConfig;
  consistency: NormalizedConsistencyConfig;
  plugins: Record<string, Record<string, unknown>>;
  description: string | null;
};

export interface ConfigCliArgs {
  name?: string;
  pagesDir?: string;
  /**
   * M01 (0.1.36): `--remote-url <url>` maps here. Sticky like `name` —
   * persisted to `config.json` on first bootstrap, then drives M24/M27 base URL.
   */
  remoteApiUrl?: string | null;
}

/**
 * v3 (M31): `port`/`mode` left the project config — they are workspace
 * settings now (`~/.claude4spec/workspaces.json`).
 * v4 (0.1.96): `pagesDir` scalar replaced by `roots[]` (a list of named page
 * roots). Migrated by `migrateConfigToV4` at project activation.
 */
export const CURRENT_SCHEMA_VERSION = 4;

/**
 * Directories the app WRITES to; a root's `dir` overlapping one is a hard
 * error. 0.1.104: `.claude4spec/skills` dropped — nothing writes there
 * anymore (external skills are on-demand now, see `buildExternalSkillsBundle`).
 */
export const RESERVED_WRITE_TARGETS = ['.claude4spec/plugins'] as const;

export function configPath(cwd: string): string {
  return path.join(cwd, '.claude4spec', 'config.json');
}

/** The built-in `pages` root with full behaviour, dir defaulting to 'pages'. */
export function builtinPagesRoot(dir: string = 'pages'): Root {
  return {
    id: 'pages',
    name: 'Pages',
    dir,
    builtin: true,
    ...DEFAULT_PAGES_ROOT_PROPS,
    linkTargets: [...DEFAULT_PAGES_ROOT_PROPS.linkTargets],
  };
}

/**
 * The single source of DEFAULT VALUES — including the nested branches
 * (`agent`/`git`/`consistency`/`plugins`), which before 0.2.8 had no defaults
 * anywhere and were re-invented with `??` at every point of use.
 * {@link normalizeConfig} is the single MECHANISM that applies them; adding a
 * new nested field means editing this function and nothing else.
 *
 * Not everything here is persisted: a fresh `config.json` is seeded from
 * {@link bootstrapDefaults}, so the nested branches stay out of the file and
 * keep tracking future default changes instead of freezing today's values.
 */
export function defaults(cwd: string): NormalizedConfig {
  return {
    ...bootstrapDefaults(cwd),
    // 0.1.58: no elevator pitch.
    description: null,
    // M26/0.1.51/0.1.90: agent flags. `claudeUsePreset` true = prior behaviour.
    agent: {
      claudeUsePreset: true,
      conversationalLanguage: null,
      allowedPaths: [],
      disallowedPaths: [],
    },
    // M28/0.1.118/0.1.125: git layer off unless opted in; commits land on HEAD.
    git: {
      enabled: false,
      syncPushOnPush: false,
      commitTarget: { mode: 'current', branch: null, template: null, base: null },
      switchAfterRelease: false,
    },
    // Consistency gates report only when explicitly turned on.
    consistency: { requireAcCoverage: 'off', requireModuleAc: 'off' },
    // M33 phase 3: no plugin settings until a plugin writes some.
    plugins: {},
  };
}

/**
 * The subset of {@link defaults} that a fresh bootstrap SERIALIZES into
 * `config.json`. Deliberately the pre-0.2.8 key set: writing the nested
 * branches would freeze their values per project, so a later change to a
 * default would never reach existing projects. Absent keys are filled in on
 * every read by {@link normalizeConfig}.
 */
export function bootstrapDefaults(cwd: string): Config {
  return {
    $schemaVersion: CURRENT_SCHEMA_VERSION,
    name: path.basename(cwd),
    roots: [builtinPagesRoot()],
    briefsDir: '.claude4spec/briefs',
    patchesDir: '.claude4spec/patches',
    plansDir: '.claude4spec/plans',
    entitiesDir: '.claude4spec/entities',
    releasesDir: '.claude4spec/releases',
    writingStyle: null,
    // 0.1.51: brak dyrektywy jezykowej dla tresci spec (dotychczasowe zachowanie).
    language: null,
    // Forward compat: brak pola w istniejacym configu = projekt sprzed M16,
    // traktowany jako ukonczony onboarding (zaden retroaktywny redirect).
    // Swiezy bootstrap nadpisuje to na false w loadOrCreateConfig.
    onboardingCompleted: true,
    // M24: null = use the hardcoded production remote in M24.
    remoteApiUrl: null,
    // M25: null = no remote project yet ⇒ next push creates one.
    remoteProjectId: null,
  };
}

/** Plain JSON object (not an array, not null) — the only shape we recurse into. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 0.2.8 (C23): the ONE place that applies default values, deeply, once per
 * config read. Rules (each one load-bearing):
 *
 * - key absent / `undefined` → the value from `base`;
 * - key present with `null` → **stays `null`**. `null` carries meaning for
 *   `writingStyle` (no style), `remoteApiUrl` (default remote) and
 *   `commitTarget.branch`; substituting a default there would erase a
 *   deliberate choice;
 * - array in `loaded` → **replaces** the base array wholesale (`roots`,
 *   `agent.allowedPaths`, `agent.disallowedPaths`) — never element-wise;
 * - plain object in `loaded` → recursive merge (`agent`, `git`,
 *   `git.commitTarget`, `consistency`, `plugins`).
 *
 * `plugins` merges one level deep (per plugin name); a plugin's own settings
 * blob is opaque user data and is replaced, not descended into — same contract
 * as the deep-merge in {@link writeConfig}.
 */
export function normalizeConfig(loaded: Partial<Config>, base: NormalizedConfig): NormalizedConfig {
  return deepMerge(base as unknown as Record<string, unknown>, loaded as Record<string, unknown>, 0) as unknown as NormalizedConfig;
}

/**
 * Recursion is bounded: objects are merged at the top level, at branch level
 * (`git`, `agent`, `plugins`) and one level below it (`git.commitTarget`,
 * `plugins[<name>]`). Deeper than that — inside a plugin's own settings blob —
 * values replace wholesale, because that is opaque user data we must not
 * reinterpret.
 */
function deepMerge(
  base: Record<string, unknown>,
  loaded: Record<string, unknown>,
  depth: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(loaded)) {
    if (value === undefined) continue; // absent ⇒ keep the default
    const baseValue = out[key];
    if (depth < 2 && isPlainObject(value) && isPlainObject(baseValue)) {
      out[key] = deepMerge(baseValue, value, depth + 1);
    } else if (depth < 2 && isPlainObject(value) && baseValue === undefined) {
      // Branch with no default at all (e.g. `plugins[<name>]` on a bare base) —
      // take it as-is; there is nothing to merge with.
      out[key] = value;
    } else {
      // Scalars (incl. an explicit `null`) and arrays replace wholesale.
      out[key] = value;
    }
  }
  return out;
}

function pickDefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function typeError(field: string, expected: string, got: unknown): Error {
  return new Error(`config.json: field '${field}' expected ${expected}, got ${got === null ? 'null' : typeof got}`);
}

/** A cwd-relative dir must not be absolute nor escape cwd via `..`. */
function isPathSafeRelative(dir: string): boolean {
  if (typeof dir !== 'string' || dir.trim() === '') return false;
  if (path.isAbsolute(dir)) return false;
  const norm = path.normalize(dir);
  if (norm === '..' || norm.startsWith('..' + path.sep) || norm.includes(path.sep + '..' + path.sep)) return false;
  return true;
}

/** Normalize a cwd-relative dir for overlap comparison (trailing slash stripped). */
function normDir(dir: string): string {
  const n = path.normalize(dir).replace(/[\\/]+$/, '');
  return n === '.' ? '' : n;
}

/** True when `child` equals or is nested under `parent` (both normalized). */
function isInsideDir(parent: string, child: string): boolean {
  if (parent === child) return true;
  if (parent === '') return true; // cwd root contains everything
  return child.startsWith(parent + path.sep);
}

/**
 * True when a page root at `rootDir` genuinely conflicts with `otherDir`:
 *  - equal dirs, or
 *  - the root sits inside `otherDir` (its own files would live under a write-target), or
 *  - `otherDir` sits inside the root AND is reachable by the pages walker (no dot-dir
 *    segment on the way — the walker skips `.`-prefixed directories, so a root at '.'
 *    does NOT actually index `.claude4spec/*`).
 */
export function dirsOverlap(rootDir: string, otherDir: string): boolean {
  const na = normDir(rootDir);
  const nb = normDir(otherDir);
  if (na === nb) return true;
  if (isInsideDir(nb, na)) return true; // root nested under other
  if (isInsideDir(na, nb)) {
    const rel = na === '' ? nb : path.relative(na, nb);
    return !hasDotSegment(rel); // other under root — a hazard only if the walker reaches it
  }
  return false;
}

/**
 * Does this pair of write targets collide?
 *
 * `dirsOverlap` is asymmetric ON PURPOSE: its third clause asks whether the PAGES WALKER
 * starting at the first dir would actually reach the second, and the walker skips
 * `.`-prefixed directories. So a root at '.' does NOT conflict with `.claude4spec/entities`
 * — the walker never descends there. That exemption is only meaningful when the containing
 * side really is a page root, which is why this cannot be a blind OR of both directions:
 * reading `.claude4spec/entities` as the container would flag every root at '.'.
 *
 *  - root vs root      → either direction counts (both sides walk), so the verdict no
 *                        longer depends on the order of `roots[]`.
 *  - root vs target    → the root is the walker; ask it that way round.
 *  - target vs target  → neither walks. Plain equality-or-containment, no dot-dir
 *                        exemption: two things WRITING into nested dirs clobber each
 *                        other whether or not a walker would have found them.
 */
function targetsOverlap(
  a: { dir: string; isRoot: boolean },
  b: { dir: string; isRoot: boolean },
): boolean {
  if (a.isRoot && b.isRoot) return dirsOverlap(a.dir, b.dir) || dirsOverlap(b.dir, a.dir);
  if (a.isRoot) return dirsOverlap(a.dir, b.dir);
  if (b.isRoot) return dirsOverlap(b.dir, a.dir);
  const na = normDir(a.dir);
  const nb = normDir(b.dir);
  return na === nb || isInsideDir(na, nb) || isInsideDir(nb, na);
}

/**
 * 0.1.96: cross-field validation of `roots[]` dirs against each other and the
 * other write/read targets. Returns hard `errors` (→ 400 / boot throw) and
 * `warnings` (log-only). Kept separate from `validate()` because it needs the
 * fully-merged config (entitiesDir/briefsDir/patchesDir), not a partial.
 */
export function validateRootDirs(
  roots: Root[],
  opts: { entitiesDir: string; releasesDir: string; briefsDir: string; patchesDir: string; plansDir: string },
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  // D4: every "smudging" write target is checked against every other one, PAIRWISE and
  // BIDIRECTIONALLY — a page root is no longer privileged as the only left-hand side.
  // Before this, `entitiesDir` vs `releasesDir` (and either vs `.claude4spec/plugins`)
  // was never compared at all: two write targets could be pointed at the same directory
  // and nothing complained until something clobbered something else at runtime.
  const writeTargets: Array<{ id: string; dir: string; isRoot: boolean }> = [
    ...roots.map((r) => ({ id: r.id, dir: r.dir, isRoot: true })),
    { id: 'entitiesDir', dir: opts.entitiesDir, isRoot: false },
    { id: 'releasesDir', dir: opts.releasesDir, isRoot: false },
    ...RESERVED_WRITE_TARGETS.map((d) => ({ id: d, dir: d, isRoot: false })),
  ];
  for (let i = 0; i < writeTargets.length; i++) {
    for (let j = i + 1; j < writeTargets.length; j++) {
      const a = writeTargets[i]!;
      const b = writeTargets[j]!;
      if (targetsOverlap(a, b)) {
        errors.push(`config.json: '${a.id}' overlaps write-target '${b.id}'`);
      }
    }
  }

  // Rule 3a: briefs/patches/plans overlapping a Page Root stays a WARNING, not a hard
  // error — the files are readable as pages, which is untidy rather than destructive.
  // Evaluated over all roots × all three dirs regardless of which side of the pair the
  // caller happened to send, so a diff-only PATCH carrying just `briefsDir` still warns.
  // '.claude/skills' overlap is allowed and intentionally absent here.
  const softTargets: Array<{ id: string; dir: string }> = [
    { id: 'briefsDir', dir: opts.briefsDir },
    { id: 'patchesDir', dir: opts.patchesDir },
    { id: 'plansDir', dir: opts.plansDir },
  ];
  for (const r of roots) {
    for (const t of softTargets) {
      // The root is the walker here, so the one-directional reading is the right one —
      // same reason as in `targetsOverlap`.
      if (dirsOverlap(r.dir, t.dir)) {
        warnings.push(`config.json: root '${r.id}' dir overlaps ${t.id} — pages may appear in both`);
      }
    }
  }

  return { errors, warnings };
}

/**
 * Structural validation of a raw `roots[]` value: each element well-typed +
 * path-safe, ids unique, linkTargets reference existing roots, and the built-in
 * `pages` root present with sidebar 'accordion'. Throws on any violation. Shared
 * by `validate()` (boot/read) and the PATCH /api/config route (→ 400).
 */
export function parseRootsArray(raw: unknown): Root[] {
  if (!Array.isArray(raw)) throw typeError('roots', 'Root[]', raw);
  const roots = raw.map((r, i) => validateRoot(r, i));
  const seen = new Set<string>();
  for (const root of roots) {
    if (seen.has(root.id)) throw new Error(`config.json: duplicate root id '${root.id}'`);
    seen.add(root.id);
  }
  // linkTargets must reference existing root ids ("dangling link scope").
  for (const root of roots) {
    for (const t of root.linkTargets) {
      if (!seen.has(t)) {
        throw new Error(`config.json: root '${root.id}' has dangling link scope '${t}'`);
      }
    }
  }
  const pagesRoot = roots.find((x) => x.id === 'pages');
  if (!pagesRoot) throw new Error(`config.json: built-in 'pages' root is required`);
  if (pagesRoot.sidebar !== 'accordion') {
    throw new Error(`config.json: built-in 'pages' root must have sidebar 'accordion'`);
  }
  return roots;
}

const VALID_SIDEBAR = new Set<RootSidebar>(['accordion', 'hidden']);

/** Structural validation of one raw `roots[]` element. Throws on any violation. */
function validateRoot(raw: unknown, index: number): Root {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw typeError(`roots[${index}]`, 'object', raw);
  }
  const r = raw as Record<string, unknown>;
  const str = (k: string): string => {
    if (typeof r[k] !== 'string' || (r[k] as string).trim() === '') {
      throw typeError(`roots[${index}].${k}`, 'non-empty string', r[k]);
    }
    return r[k] as string;
  };
  const bool = (k: string): boolean => {
    if (typeof r[k] !== 'boolean') throw typeError(`roots[${index}].${k}`, 'boolean', r[k]);
    return r[k] as boolean;
  };
  const id = str('id');
  const name = str('name');
  const dir = str('dir');
  if (!isPathSafeRelative(dir)) {
    throw new Error(`config.json: root '${id}' dir '${dir}' must be a relative path inside cwd`);
  }
  const sidebar = r.sidebar;
  if (typeof sidebar !== 'string' || !VALID_SIDEBAR.has(sidebar as RootSidebar)) {
    throw new Error(`config.json: root '${id}' sidebar expected 'accordion' | 'hidden', got ${JSON.stringify(sidebar)}`);
  }
  if (!Array.isArray(r.linkTargets) || !r.linkTargets.every((x) => typeof x === 'string')) {
    throw typeError(`roots[${index}].linkTargets`, 'string[]', r.linkTargets);
  }
  return {
    id,
    name,
    dir,
    builtin: bool('builtin'),
    releasable: bool('releasable'),
    sectionIndexed: bool('sectionIndexed'),
    referenceValidated: bool('referenceValidated'),
    linkTargets: r.linkTargets as string[],
    sidebar: sidebar as RootSidebar,
    briefTarget: bool('briefTarget'),
  };
}

function validate(raw: unknown): Partial<Config> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`config.json: expected JSON object at root, got ${Array.isArray(raw) ? 'array' : raw === null ? 'null' : typeof raw}`);
  }
  const r = raw as Record<string, unknown>;
  const out: Partial<Config> = {};

  if ('$schemaVersion' in r) {
    if (typeof r.$schemaVersion !== 'number') throw typeError('$schemaVersion', 'number', r.$schemaVersion);
    if (r.$schemaVersion > CURRENT_SCHEMA_VERSION) {
      throw new Error(`config.json: schema version ${r.$schemaVersion} not supported by this claude4spec version`);
    }
    // Starsze wersje (<CURRENT) obsługiwane tu w przyszłości (migracje). V1: tylko 1 istnieje.
    out.$schemaVersion = r.$schemaVersion;
  }
  if ('name' in r) {
    if (typeof r.name !== 'string') throw typeError('name', 'string', r.name);
    out.name = r.name;
  }
  // 'port' / 'mode' (pre-v3) are intentionally NOT validated nor copied —
  // stale keys are silently ignored, physically removed by migrateConfigToV3.
  if ('roots' in r) {
    out.roots = parseRootsArray(r.roots);
  }
  if ('briefsDir' in r) {
    if (typeof r.briefsDir !== 'string') throw typeError('briefsDir', 'string', r.briefsDir);
    out.briefsDir = r.briefsDir;
  }
  if ('patchesDir' in r) {
    if (typeof r.patchesDir !== 'string') throw typeError('patchesDir', 'string', r.patchesDir);
    out.patchesDir = r.patchesDir;
  }
  if ('plansDir' in r) {
    if (typeof r.plansDir !== 'string') throw typeError('plansDir', 'string', r.plansDir);
    out.plansDir = r.plansDir;
  }
  if ('entitiesDir' in r) {
    if (typeof r.entitiesDir !== 'string') throw typeError('entitiesDir', 'string', r.entitiesDir);
    out.entitiesDir = r.entitiesDir;
  }
  if ('releasesDir' in r) {
    if (typeof r.releasesDir !== 'string') throw typeError('releasesDir', 'string', r.releasesDir);
    out.releasesDir = r.releasesDir;
  }
  if ('writingStyle' in r) {
    if (r.writingStyle !== null && typeof r.writingStyle !== 'string') {
      throw typeError('writingStyle', 'string | null', r.writingStyle);
    }
    out.writingStyle = r.writingStyle;
  }
  if ('language' in r) {
    // Type-only here (mirror writingStyle). Membership in SUPPORTED_LANGUAGES is
    // enforced at the PATCH /api/config route (returns 400 inline).
    if (r.language !== null && typeof r.language !== 'string') {
      throw typeError('language', 'string | null', r.language);
    }
    out.language = r.language;
  }
  if ('description' in r) {
    // 0.1.58 type-only here (mirror language). The 0–200 length cap is enforced
    // at the PATCH /api/config route (returns 400 inline).
    if (r.description !== null && typeof r.description !== 'string') {
      throw typeError('description', 'string | null', r.description);
    }
    out.description = r.description;
  }
  if ('onboardingCompleted' in r) {
    if (typeof r.onboardingCompleted !== 'boolean') throw typeError('onboardingCompleted', 'boolean', r.onboardingCompleted);
    out.onboardingCompleted = r.onboardingCompleted;
  }
  if ('entities' in r) {
    if (!Array.isArray(r.entities)) throw typeError('entities', 'string[]', r.entities);
    if (!r.entities.every((e) => typeof e === 'string')) {
      throw new Error("config.json: field 'entities' expected string[], got non-string element");
    }
    out.entities = r.entities as string[];
  }
  if ('consistency' in r) {
    const c = r.consistency;
    if (c === null || typeof c !== 'object' || Array.isArray(c)) {
      throw typeError('consistency', 'object', c);
    }
    const consistency: ConsistencyConfig = {};
    const validSev = new Set(['off', 'warn', 'error']);
    const cr = c as Record<string, unknown>;
    if ('requireAcCoverage' in cr) {
      if (typeof cr.requireAcCoverage !== 'string' || !validSev.has(cr.requireAcCoverage)) {
        throw new Error(
          `config.json: field 'consistency.requireAcCoverage' expected 'off' | 'warn' | 'error', got ${JSON.stringify(cr.requireAcCoverage)}`,
        );
      }
      consistency.requireAcCoverage = cr.requireAcCoverage as ConsistencySeverity;
    }
    if ('requireModuleAc' in cr) {
      if (typeof cr.requireModuleAc !== 'string' || !validSev.has(cr.requireModuleAc)) {
        throw new Error(
          `config.json: field 'consistency.requireModuleAc' expected 'off' | 'warn' | 'error', got ${JSON.stringify(cr.requireModuleAc)}`,
        );
      }
      consistency.requireModuleAc = cr.requireModuleAc as ConsistencySeverity;
    }
    out.consistency = consistency;
  }
  if ('agent' in r) {
    const a = r.agent;
    if (a === null || typeof a !== 'object' || Array.isArray(a)) {
      throw typeError('agent', 'object', a);
    }
    const agent: AgentConfig = {};
    const ar = a as Record<string, unknown>;
    if ('claudeUsePreset' in ar) {
      if (typeof ar.claudeUsePreset !== 'boolean') {
        throw typeError('agent.claudeUsePreset', 'boolean', ar.claudeUsePreset);
      }
      agent.claudeUsePreset = ar.claudeUsePreset;
    }
    if ('conversationalLanguage' in ar) {
      // Type-only here; membership enforced at PATCH /api/config route.
      if (ar.conversationalLanguage !== null && typeof ar.conversationalLanguage !== 'string') {
        throw typeError('agent.conversationalLanguage', 'string | null', ar.conversationalLanguage);
      }
      agent.conversationalLanguage = ar.conversationalLanguage;
    }
    // 0.1.90: agent FS path scope — both string[] (same shape check as `entities`).
    for (const field of ['allowedPaths', 'disallowedPaths'] as const) {
      if (field in ar) {
        if (!Array.isArray(ar[field])) throw typeError(`agent.${field}`, 'string[]', ar[field]);
        if (!(ar[field] as unknown[]).every((e) => typeof e === 'string')) {
          throw new Error(`config.json: field 'agent.${field}' expected string[], got non-string element`);
        }
        agent[field] = ar[field] as string[];
      }
    }
    out.agent = agent;
  }
  if ('remoteApiUrl' in r) {
    if (r.remoteApiUrl !== null && typeof r.remoteApiUrl !== 'string') {
      throw typeError('remoteApiUrl', 'string | null', r.remoteApiUrl);
    }
    // Syntactic-only check here (sync): parsable via `new URL()` + an `http(s)://`
    // scheme. Reachability is NOT probed at boot (0.1.65) — the client bootstrap is
    // cold; an unreachable-but-syntactically-valid host lets the process start, and
    // the reachability error surfaces only at the first remote action (login M24,
    // push M25, clone M27) as a graceful per-action failure.
    if (typeof r.remoteApiUrl === 'string' && r.remoteApiUrl.trim() !== '') {
      let parsed: URL;
      try {
        parsed = new URL(r.remoteApiUrl);
      } catch {
        throw new Error(`config.json: field 'remoteApiUrl': invalid URL`);
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`config.json: field 'remoteApiUrl': invalid URL`);
      }
    }
    out.remoteApiUrl = r.remoteApiUrl;
  }
  if ('remoteProjectId' in r) {
    if (r.remoteProjectId !== null && typeof r.remoteProjectId !== 'string') {
      throw typeError('remoteProjectId', 'string | null', r.remoteProjectId);
    }
    out.remoteProjectId = r.remoteProjectId;
  }
  if ('git' in r) {
    const g = r.git;
    if (g === null || typeof g !== 'object' || Array.isArray(g)) {
      throw typeError('git', 'object', g);
    }
    const git: GitSyncConfig = {};
    const gr = g as Record<string, unknown>;
    if ('enabled' in gr) {
      if (typeof gr.enabled !== 'boolean') {
        throw typeError('git.enabled', 'boolean', gr.enabled);
      }
      git.enabled = gr.enabled;
    }
    // 0.1.124: `syncCommitOnRelease` is no longer a field — it is not copied
    // into `git` here, and not an error either. Carrying it over to `enabled`
    // is the v4 migration's job (`migrateConfigToV4`), which runs at project
    // activation; this function must stay tolerant since it also runs on every
    // boot, including on files the migration has not reached yet.
    if ('syncPushOnPush' in gr) {
      if (typeof gr.syncPushOnPush !== 'boolean') {
        throw typeError('git.syncPushOnPush', 'boolean', gr.syncPushOnPush);
      }
      git.syncPushOnPush = gr.syncPushOnPush;
    }
    // 0.1.125: shape-only validation — semantic checks (non-empty branch/template
    // for the active mode, ref-format) live in the PATCH /api/config route, since
    // this function is also reused by readConfig() on every boot, which must
    // tolerate a config.json where the inactive mode's field was never set.
    if ('commitTarget' in gr) {
      const ct = gr.commitTarget;
      if (ct === null || typeof ct !== 'object' || Array.isArray(ct)) {
        throw typeError('git.commitTarget', 'object', ct);
      }
      const ctr = ct as Record<string, unknown>;
      const commitTarget: GitCommitTargetConfig = {};
      if ('mode' in ctr) {
        if (ctr.mode !== 'current' && ctr.mode !== 'named' && ctr.mode !== 'new') {
          throw typeError('git.commitTarget.mode', "'current' | 'named' | 'new'", ctr.mode);
        }
        commitTarget.mode = ctr.mode;
      }
      for (const field of ['branch', 'template', 'base'] as const) {
        if (field in ctr) {
          const v = ctr[field];
          if (v !== null && typeof v !== 'string') {
            throw typeError(`git.commitTarget.${field}`, 'string | null', v);
          }
          commitTarget[field] = v;
        }
      }
      git.commitTarget = commitTarget;
    }
    if ('switchAfterRelease' in gr) {
      if (typeof gr.switchAfterRelease !== 'boolean') {
        throw typeError('git.switchAfterRelease', 'boolean', gr.switchAfterRelease);
      }
      git.switchAfterRelease = gr.switchAfterRelease;
    }
    out.git = git;
  }
  // M33 phase 3: `plugins` is a namespace of opaque per-plugin sub-objects. We
  // validate only the shape (object-of-objects); the field semantics belong to
  // each plugin's `contributes.settings` descriptor, not core config.
  if ('plugins' in r) {
    const p = r.plugins;
    if (p === null || typeof p !== 'object' || Array.isArray(p)) {
      throw typeError('plugins', 'object', p);
    }
    const plugins: Record<string, Record<string, unknown>> = {};
    for (const [name, sub] of Object.entries(p as Record<string, unknown>)) {
      if (sub === null || typeof sub !== 'object' || Array.isArray(sub)) {
        throw typeError(`plugins.${name}`, 'object', sub);
      }
      plugins[name] = sub as Record<string, unknown>;
    }
    out.plugins = plugins;
  }
  return out;
}

function atomicWrite(filePath: string, data: string): void {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, filePath);
}

export interface LoadResult {
  config: NormalizedConfig;
  created: boolean;
  path: string;
}

/**
 * v3→v4 forward-compat (in-memory): if a raw config predates `roots[]` but has a
 * legacy string `pagesDir`, synthesize the built-in `pages` root from it so
 * readers see the configured dir before the physical `migrateConfigToV4` runs.
 */
function legacyRootsFromRaw(raw: Record<string, unknown>): Root[] | undefined {
  if (Array.isArray(raw.roots)) return undefined;
  if (typeof raw.pagesDir === 'string' && raw.pagesDir.trim() !== '') {
    return [builtinPagesRoot(raw.pagesDir)];
  }
  return undefined;
}

/** Apply the CLI `--pages` override to the built-in `pages` root's dir (in place, returns a copy). */
function applyPagesDirOverride<T extends Config>(config: T, pagesDir: string | undefined): T {
  if (pagesDir == null) return config;
  return {
    ...config,
    roots: config.roots.map((r) => (r.id === 'pages' ? { ...r, dir: pagesDir } : r)),
  };
}

/** Split ConfigCliArgs into the Config patch (name/remoteApiUrl) and the special `--pages` override. */
function splitCli(cli: ConfigCliArgs): { patch: Partial<Config>; pagesDir?: string } {
  const { pagesDir, ...rest } = cli;
  return { patch: pickDefined(rest) as Partial<Config>, pagesDir };
}

/**
 * Pure disk read configu — bez side-effectow (mkdir/atomic write/CLI merge).
 * Uzywany przez SkillResolver per query, zeby edycja config.json miedzy turami
 * threadu byla efektywna od nastepnego POST /api/chat.
 * Throws na malformed JSON / type mismatch — ta sama walidacja co loadOrCreateConfig.
 */
export function readConfig(cwd: string): NormalizedConfig {
  const loaded = readValidatedFile(cwd);
  if (loaded === null) return defaults(cwd);
  return normalizeConfig(loaded, defaults(cwd));
}

/**
 * Disk read + type validation + in-memory schema forward-compat, with NO
 * defaults applied. `null` = no config.json. Shared by `readConfig` (which
 * normalizes on top), `loadOrCreateConfig` and `writeConfig` (which merges a
 * patch into the file's own keys, so persisted configs stay minimal).
 */
function readValidatedFile(cwd: string): Partial<Config> | null {
  const file = configPath(cwd);
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`config.json: invalid JSON — ${(err as Error).message}`);
  }
  const loaded = validate(parsed);
  // Auto-bump older schemas in memory (v1→v2: `entities` undefined = all
  // plugins active; v2→v3: stale port/mode ignored; v3→v4: legacy pagesDir →
  // pages root). Physical rewrite happens in migrateConfigToV3/V4 (activation
  // hook) or on the next PATCH /api/config.
  if (loaded.$schemaVersion != null && loaded.$schemaVersion < CURRENT_SCHEMA_VERSION) {
    loaded.$schemaVersion = CURRENT_SCHEMA_VERSION;
  }
  if (!loaded.roots) {
    const legacy = legacyRootsFromRaw(parsed as Record<string, unknown>);
    if (legacy) loaded.roots = legacy;
  }
  return loaded;
}

export function loadOrCreateConfig(cwd: string, cli: ConfigCliArgs): LoadResult {
  const dir = path.join(cwd, '.claude4spec');
  fs.mkdirSync(dir, { recursive: true });
  const file = configPath(cwd);
  const { patch: cliDefined, pagesDir: cliPagesDir } = splitCli(cli);

  const loaded = readValidatedFile(cwd);
  if (loaded === null) {
    // Swiezy bootstrap: wymusza onboardingCompleted=false zeby AppShell pokazal
    // /onboarding po pierwszym starcie (M16). Defaults() ma true (forward compat
    // dla projektow sprzed M16); nadpisanie tylko w tym miejscu. `--pages` seeds
    // the built-in pages root's dir. Only the bootstrap key set is serialized —
    // the nested branches come from `defaults()` on every read.
    const seed: Config = applyPagesDirOverride(
      { ...bootstrapDefaults(cwd), ...cliDefined, onboardingCompleted: false },
      cliPagesDir,
    );
    atomicWrite(file, JSON.stringify(seed, null, 2) + '\n');
    return {
      config: normalizeConfig(seed, defaults(cwd)),
      created: true,
      path: file,
    };
  }

  const effective = applyPagesDirOverride(
    normalizeConfig({ ...loaded, ...cliDefined }, defaults(cwd)),
    cliPagesDir,
  );
  return { config: effective, created: false, path: file };
}

export interface MigrateV3Result {
  config: NormalizedConfig;
  /** True iff this call rewrote config.json on disk. */
  migrated: boolean;
  /** Values harvested from the pre-v3 file — destined for the workspace registry (first-wins). */
  carried: { defaultPort?: number; mode?: 'dev' | 'prod' };
}

/**
 * M31 config v3 migration — runs from the project activation hook (NOT at
 * process start). Harvests `port`/`mode` from the raw JSON (they move to the
 * workspace registry), deletes them, bumps `$schemaVersion` to 3 and ensures
 * `entitiesDir` is materialized. Atomic write; no-op when already v3-shaped.
 */
export function migrateConfigToV3(cwd: string): MigrateV3Result {
  const file = configPath(cwd);
  const carried: MigrateV3Result['carried'] = {};
  if (!fs.existsSync(file)) {
    return { config: readConfig(cwd), migrated: false, carried };
  }
  const text = fs.readFileSync(file, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`config.json: invalid JSON — ${(err as Error).message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('config.json: expected JSON object at root');
  }
  const raw = parsed as Record<string, unknown>;

  const alreadyV3 =
    typeof raw.$schemaVersion === 'number' &&
    raw.$schemaVersion >= 3 &&
    !('port' in raw) &&
    !('mode' in raw) &&
    typeof raw.entitiesDir === 'string';
  if (alreadyV3) {
    return { config: readConfig(cwd), migrated: false, carried };
  }

  if (typeof raw.port === 'number' && Number.isInteger(raw.port)) carried.defaultPort = raw.port;
  if (raw.mode === 'dev' || raw.mode === 'prod') carried.mode = raw.mode;
  delete raw.port;
  delete raw.mode;
  // Bring the file to at least v3; the pagesDir→roots (v4) bump is owned by
  // migrateConfigToV4, called right after this at activation.
  if (typeof raw.$schemaVersion !== 'number' || raw.$schemaVersion < 3) raw.$schemaVersion = 3;
  if (typeof raw.entitiesDir !== 'string') raw.entitiesDir = '.claude4spec/entities';
  atomicWrite(file, JSON.stringify(raw, null, 2) + '\n');
  return { config: readConfig(cwd), migrated: true, carried };
}

/**
 * 0.2.8: fill in the fields a `roots[]` entry is MISSING. `validateRoot` rejects
 * an incomplete entry outright (it no longer defaults anything at load time), so
 * materializing starting values is the migration's job — a config written before
 * a field existed would otherwise be permanently unloadable. Only ABSENT keys are
 * filled; a present-but-malformed value stays for `validateRoot` to reject.
 * Returns true when anything was written into `entry`.
 */
function materializeRootFields(entry: Record<string, unknown>): boolean {
  const isBuiltinPages = entry.builtin === true || entry.id === 'pages';
  // IDENTITY (`id`, `name`, `dir`) is deliberately absent from both default sets.
  // A behaviour flag has a defensible starting value; an identity field does not
  // — inventing `dir: 'pages'` for an entry that never had one would point the
  // root at a directory nobody chose and hand back an empty sidebar instead of
  // the loud `roots[i].dir expected non-empty string` the user can act on.
  const { id: _id, name: _name, dir: _dir, ...builtinDefaults } = builtinPagesRoot();
  const defaults: Record<string, unknown> = isBuiltinPages
    ? builtinDefaults
    : { builtin: false, ...DEFAULT_USER_ROOT_PROPS };
  let changed = false;
  for (const [key, value] of Object.entries(defaults)) {
    if (key in entry) continue;
    entry[key] = Array.isArray(value) ? [...value] : value;
    changed = true;
  }
  return changed;
}

/**
 * 0.1.96 config v4 migration — runs from the project activation hook right after
 * `migrateConfigToV3`. Maps the legacy `pagesDir` scalar to the built-in `pages`
 * root (with default props), deletes `pagesDir`, and bumps `$schemaVersion` to 4.
 * Does NOT touch `briefsDir`/`patchesDir`/`entitiesDir` (they stay scalars).
 *
 * 0.2.8 adds two repairs that must run even on an ALREADY-v4 file, because both
 * fix shapes the current loader rejects (or silently drops) rather than tolerates:
 * `git.syncCommitOnRelease` → `git.enabled`, and materialization of every field
 * on every `roots[]` entry. Atomic write; no-op when nothing needed changing.
 */
export function migrateConfigToV4(cwd: string): { config: NormalizedConfig; migrated: boolean } {
  const file = configPath(cwd);
  if (!fs.existsSync(file)) {
    return { config: readConfig(cwd), migrated: false };
  }
  const text = fs.readFileSync(file, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`config.json: invalid JSON — ${(err as Error).message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('config.json: expected JSON object at root');
  }
  const raw = parsed as Record<string, unknown>;

  // A file from a NEWER claude4spec is not ours to touch. Repairing it would
  // mean re-adding fields that version deliberately dropped and stamping
  // `$schemaVersion` back down to 4 — a silent downgrade. Hand it to readConfig,
  // which refuses it with "schema version N not supported" and leaves it intact.
  if (typeof raw.$schemaVersion === 'number' && raw.$schemaVersion > CURRENT_SCHEMA_VERSION) {
    return { config: readConfig(cwd), migrated: false };
  }

  const alreadyV4 =
    typeof raw.$schemaVersion === 'number' &&
    raw.$schemaVersion >= 4 &&
    Array.isArray(raw.roots) &&
    !('pagesDir' in raw);

  let changed = false;

  // Map legacy pagesDir → built-in pages root. Preserve an existing `roots[]` if
  // one is somehow already present (defensive); otherwise synthesize from pagesDir.
  if (!Array.isArray(raw.roots)) {
    const legacyDir = typeof raw.pagesDir === 'string' && raw.pagesDir.trim() !== '' ? raw.pagesDir : 'pages';
    raw.roots = [builtinPagesRoot(legacyDir)] as unknown as Root[];
    changed = true;
  }
  if ('pagesDir' in raw) {
    delete raw.pagesDir;
    changed = true;
  }

  // Every roots[] entry must carry all ten fields — see materializeRootFields.
  for (const entry of raw.roots as unknown[]) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    if (materializeRootFields(entry as Record<string, unknown>)) changed = true;
  }

  // `git.syncCommitOnRelease` (removed in 0.1.124) becomes the `git.enabled`
  // master toggle, which alone activates commit-on-release. Only a config that
  // has not yet stated `enabled` is mapped — an explicit value always wins.
  if (raw.git !== null && typeof raw.git === 'object' && !Array.isArray(raw.git)) {
    const git = raw.git as Record<string, unknown>;
    if ('syncCommitOnRelease' in git) {
      if (!('enabled' in git) && git.syncCommitOnRelease === true) {
        git.enabled = true;
        // Say it out loud. `enabled` is the master switch, so restoring the
        // pre-0.1.118 intent also re-arms commit-on-pull and stops `.gitignore`
        // ignoring the artifact dirs. A user who has since come to rely on git
        // being off must be able to see WHY their repo started taking commits.
        console.log(
          `[config] ${cwd}: legacy git.syncCommitOnRelease carried onto git.enabled — git sync is ON for this project (set "git": { "enabled": false } to turn it back off)`,
        );
      }
      delete git.syncCommitOnRelease;
      changed = true;
    }
  }

  if (alreadyV4 && !changed) {
    return { config: readConfig(cwd), migrated: false };
  }
  raw.$schemaVersion = 4;
  // Validate BEFORE writing. A file this migration cannot fully repair (missing
  // `id`, dangling `linkTargets`, …) fails to load either way — but it must fail
  // with the user's file untouched, not half-rewritten. In a git-tracked spec
  // repo a partial rewrite is a dirty tree the next auto-commit would sweep up.
  validate(raw);
  atomicWrite(file, JSON.stringify(raw, null, 2) + '\n');
  return { config: readConfig(cwd), migrated: true };
}

/**
 * Atomic patch — czyta biezacy config, merguje partial, waliduje pole-po-polu,
 * zapisuje atomic. Uzywany przez PATCH /api/config (M01 + M16).
 * Throws na malformed input lub blad I/O.
 */
export function writeConfig(cwd: string, partial: Partial<Config>): NormalizedConfig {
  const file = configPath(cwd);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  // 0.2.8: merge onto the FILE's own keys, not onto the normalized config —
  // persisting the normalized branches would freeze today's defaults in this
  // project forever (a later change to `defaults()` would never reach it).
  // A missing file is seeded from the bootstrap key set, as at first boot.
  const current: Partial<Config> = readValidatedFile(cwd) ?? bootstrapDefaults(cwd);
  // Walidacja typow przez ponowne uzycie validate() na zmergowanym obiekcie.
  // validate() zignoruje brakujace pola — dlatego najpierw merge, potem walidacja.
  const validated = validate(partial);
  const merged: Partial<Config> = { ...current, ...validated };
  // M28: deep-merge the `git` object so toggling one flag preserves the other
  // (shallow spread would replace the whole object and drop the untouched flag).
  if (validated.git) {
    merged.git = { ...current.git, ...validated.git };
    // 0.1.125: one level deeper for `commitTarget` — same nested precedent as
    // `plugins[<name>]` below — so patching e.g. just `mode` preserves the
    // previously-saved `branch`/`template`/`base`.
    if (validated.git.commitTarget) {
      merged.git.commitTarget = { ...current.git?.commitTarget, ...validated.git.commitTarget };
    }
  }
  // 0.1.51: same deep-merge precedent for `agent` — patching `conversationalLanguage`
  // alone must preserve `claudeUsePreset` (and vice versa).
  if (validated.agent) {
    merged.agent = { ...current.agent, ...validated.agent };
  }
  // M33 phase 3: nested deep-merge per `plugins[<name>]` — writing one field of
  // one plugin preserves that plugin's other fields AND other plugins'
  // namespaces (extends the agent/git deep-merge precedent one level deeper).
  if (validated.plugins) {
    merged.plugins = { ...current.plugins };
    for (const [name, fields] of Object.entries(validated.plugins)) {
      merged.plugins[name] = { ...current.plugins?.[name], ...fields };
    }
  }
  atomicWrite(file, JSON.stringify(merged, null, 2) + '\n');
  // Return the NORMALIZED view of what was just persisted — callers read
  // `updated.git.enabled` & co. directly (no `??` at the point of use).
  return normalizeConfig(merged, defaults(cwd));
}

/**
 * Resolves a `config.json` directory field (`briefsDir`/`patchesDir`/
 * `entitiesDir`/a root's `dir`) to an absolute path, guarding against an
 * absolute value or one that escapes `cwd` via `..`. Extracted from the
 * pattern duplicated 3x in `workspace/project-context.ts`'s `buildInner` —
 * also used by M22's `buildExternalSkillContext` to derive the abs-path
 * fallbacks baked into externally-copied SKILL.md files.
 */
export function resolveDirAbs(cwd: string, dir: string, fieldName: string): string {
  if (path.isAbsolute(dir)) {
    throw new Error(`config.json: ${fieldName} must be relative to cwd, got: ${dir}`);
  }
  const abs = path.resolve(cwd, dir);
  const rel = path.relative(cwd, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`config.json: ${fieldName} must not escape project root, got: ${dir}`);
  }
  return abs;
}
