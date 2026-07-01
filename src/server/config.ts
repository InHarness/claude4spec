import fs from 'node:fs';
import path from 'node:path';
import { type Root, type RootSidebar, DEFAULT_PAGES_ROOT_PROPS } from '../shared/types.js';

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
   * M29: directory of committed entity JSON files + tags.json (relative to cwd,
   * default `.claude4spec/entities`). Source of truth for entities; SQLite is a
   * derived index rebuilt from these files at boot. Same validation as
   * `briefsDir`/`patchesDir` (must be relative, must not escape cwd) — but,
   * unlike them, this directory is COMMITTED to git. Forward-compat: missing in
   * pre-M29 configs = treated as default. Additive — no `$schemaVersion` bump.
   */
  entitiesDir: string;
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
  /** When on, creating a release best-effort `git commit`s pagesDir + config.json. */
  syncCommitOnRelease?: boolean;
  /** When on, a successful remote push best-effort `git push`es the current branch. */
  syncPushOnPush?: boolean;
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
  // Brak pola = effective true (handler `POST /api/chat` resolveuje przez `?? true`).
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

/** Directories the app WRITES to; a root's `dir` overlapping one is a hard error. */
export const RESERVED_WRITE_TARGETS = ['.claude4spec/skills', '.claude4spec/plugins'] as const;

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

export function defaults(cwd: string): Config {
  return {
    $schemaVersion: CURRENT_SCHEMA_VERSION,
    name: path.basename(cwd),
    roots: [builtinPagesRoot()],
    briefsDir: '.claude4spec/briefs',
    patchesDir: '.claude4spec/patches',
    entitiesDir: '.claude4spec/entities',
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

/** True when dir `a` equals, contains, or is contained by dir `b`. */
export function dirsOverlap(a: string, b: string): boolean {
  const na = normDir(a);
  const nb = normDir(b);
  if (na === nb) return true;
  const aSlash = na === '' ? '' : na + path.sep;
  const bSlash = nb === '' ? '' : nb + path.sep;
  // '' (cwd root) contains everything.
  if (na === '') return true;
  if (nb === '') return true;
  return na.startsWith(bSlash) || nb.startsWith(aSlash);
}

/**
 * 0.1.96: cross-field validation of `roots[]` dirs against each other and the
 * other write/read targets. Returns hard `errors` (→ 400 / boot throw) and
 * `warnings` (log-only). Kept separate from `validate()` because it needs the
 * fully-merged config (entitiesDir/briefsDir/patchesDir), not a partial.
 */
export function validateRootDirs(
  roots: Root[],
  opts: { entitiesDir: string; briefsDir: string; patchesDir: string },
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const hardTargets: Array<{ id: string; dir: string }> = [
    { id: 'entitiesDir', dir: opts.entitiesDir },
    ...RESERVED_WRITE_TARGETS.map((d) => ({ id: d, dir: d })),
  ];
  for (let i = 0; i < roots.length; i++) {
    const r = roots[i];
    // overlap vs other roots (hard)
    for (let j = i + 1; j < roots.length; j++) {
      if (dirsOverlap(r.dir, roots[j].dir)) {
        errors.push(`config.json: root '${r.id}' dir overlaps write-target '${roots[j].id}'`);
      }
    }
    // overlap vs entitiesDir / skills / plugins (hard)
    for (const t of hardTargets) {
      if (dirsOverlap(r.dir, t.dir)) {
        errors.push(`config.json: root '${r.id}' dir overlaps write-target '${t.id}'`);
      }
    }
    // overlap vs briefsDir / patchesDir (warning). '.claude/skills' overlap is allowed.
    if (dirsOverlap(r.dir, opts.briefsDir)) {
      warnings.push(`config.json: root '${r.id}' dir overlaps briefsDir — pages may appear in both`);
    }
    if (dirsOverlap(r.dir, opts.patchesDir)) {
      warnings.push(`config.json: root '${r.id}' dir overlaps patchesDir — pages may appear in both`);
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
  if ('entitiesDir' in r) {
    if (typeof r.entitiesDir !== 'string') throw typeError('entitiesDir', 'string', r.entitiesDir);
    out.entitiesDir = r.entitiesDir;
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
    if ('syncCommitOnRelease' in gr) {
      if (typeof gr.syncCommitOnRelease !== 'boolean') {
        throw typeError('git.syncCommitOnRelease', 'boolean', gr.syncCommitOnRelease);
      }
      git.syncCommitOnRelease = gr.syncCommitOnRelease;
    }
    if ('syncPushOnPush' in gr) {
      if (typeof gr.syncPushOnPush !== 'boolean') {
        throw typeError('git.syncPushOnPush', 'boolean', gr.syncPushOnPush);
      }
      git.syncPushOnPush = gr.syncPushOnPush;
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
  config: Config;
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
function applyPagesDirOverride(config: Config, pagesDir: string | undefined): Config {
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
export function readConfig(cwd: string): Config {
  const file = configPath(cwd);
  const base = defaults(cwd);
  if (!fs.existsSync(file)) return base;
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
  return { ...base, ...loaded };
}

export function loadOrCreateConfig(cwd: string, cli: ConfigCliArgs): LoadResult {
  const dir = path.join(cwd, '.claude4spec');
  fs.mkdirSync(dir, { recursive: true });
  const file = configPath(cwd);
  const base = defaults(cwd);
  const { patch: cliDefined, pagesDir: cliPagesDir } = splitCli(cli);

  if (!fs.existsSync(file)) {
    // Swiezy bootstrap: wymusza onboardingCompleted=false zeby AppShell pokazal
    // /onboarding po pierwszym starcie (M16). Defaults() ma true (forward compat
    // dla projektow sprzed M16); nadpisanie tylko w tym miejscu. `--pages` seeds
    // the built-in pages root's dir.
    const effective: Config = applyPagesDirOverride(
      { ...base, ...cliDefined, onboardingCompleted: false },
      cliPagesDir,
    );
    atomicWrite(file, JSON.stringify(effective, null, 2) + '\n');
    return { config: effective, created: true, path: file };
  }

  const text = fs.readFileSync(file, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`config.json: invalid JSON — ${(err as Error).message}`);
  }
  const loaded = validate(parsed);
  // Auto-bump older schemas in memory — same logic as readConfig.
  if (loaded.$schemaVersion != null && loaded.$schemaVersion < CURRENT_SCHEMA_VERSION) {
    loaded.$schemaVersion = CURRENT_SCHEMA_VERSION;
  }
  if (!loaded.roots) {
    const legacy = legacyRootsFromRaw(parsed as Record<string, unknown>);
    if (legacy) loaded.roots = legacy;
  }
  const effective: Config = applyPagesDirOverride({ ...base, ...loaded, ...cliDefined }, cliPagesDir);
  return { config: effective, created: false, path: file };
}

export interface MigrateV3Result {
  config: Config;
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
 * 0.1.96 config v4 migration — runs from the project activation hook right after
 * `migrateConfigToV3`. Maps the legacy `pagesDir` scalar to the built-in `pages`
 * root (with default props), deletes `pagesDir`, and bumps `$schemaVersion` to 4.
 * Does NOT touch `briefsDir`/`patchesDir`/`entitiesDir` (they stay scalars).
 * Atomic write; no-op when already v4-shaped (`roots[]` present, no `pagesDir`).
 */
export function migrateConfigToV4(cwd: string): { config: Config; migrated: boolean } {
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

  const alreadyV4 =
    typeof raw.$schemaVersion === 'number' &&
    raw.$schemaVersion >= 4 &&
    Array.isArray(raw.roots) &&
    !('pagesDir' in raw);
  if (alreadyV4) {
    return { config: readConfig(cwd), migrated: false };
  }

  // Map legacy pagesDir → built-in pages root. Preserve an existing `roots[]` if
  // one is somehow already present (defensive); otherwise synthesize from pagesDir.
  if (!Array.isArray(raw.roots)) {
    const legacyDir = typeof raw.pagesDir === 'string' && raw.pagesDir.trim() !== '' ? raw.pagesDir : 'pages';
    raw.roots = [builtinPagesRoot(legacyDir)] as unknown as Root[];
  }
  delete raw.pagesDir;
  raw.$schemaVersion = 4;
  atomicWrite(file, JSON.stringify(raw, null, 2) + '\n');
  return { config: readConfig(cwd), migrated: true };
}

/**
 * Atomic patch — czyta biezacy config, merguje partial, waliduje pole-po-polu,
 * zapisuje atomic. Uzywany przez PATCH /api/config (M01 + M16).
 * Throws na malformed input lub blad I/O.
 */
export function writeConfig(cwd: string, partial: Partial<Config>): Config {
  const file = configPath(cwd);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const current = readConfig(cwd);
  // Walidacja typow przez ponowne uzycie validate() na zmergowanym obiekcie.
  // validate() zignoruje brakujace pola — dlatego najpierw merge, potem walidacja.
  const validated = validate(partial);
  const merged: Config = { ...current, ...validated };
  // M28: deep-merge the `git` object so toggling one flag preserves the other
  // (shallow spread would replace the whole object and drop the untouched flag).
  if (validated.git) {
    merged.git = { ...current.git, ...validated.git };
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
  return merged;
}
