import fs from 'node:fs';
import path from 'node:path';

export interface Config {
  $schemaVersion: number;
  name: string;
  port: number;
  pagesDir: string;
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
  mode: 'dev' | 'prod';
  writingStyle: string | null;
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
}

export type ConsistencySeverity = 'off' | 'warn' | 'error';

export interface ConsistencyConfig {
  requireAcCoverage?: ConsistencySeverity;
  requireModuleAc?: ConsistencySeverity;
}

export interface AgentConfig {
  // Brak pola = effective true (handler `POST /api/chat` resolveuje przez `?? true`).
  // Additive — bez bumpu `$schemaVersion`.
  claudeUsePreset?: boolean;
}

export interface ConfigCliArgs {
  name?: string;
  port?: number;
  pagesDir?: string;
  mode?: 'dev' | 'prod';
}

export const CURRENT_SCHEMA_VERSION = 2;

export function configPath(cwd: string): string {
  return path.join(cwd, '.claude4spec', 'config.json');
}

export function defaults(cwd: string): Config {
  return {
    $schemaVersion: CURRENT_SCHEMA_VERSION,
    name: path.basename(cwd),
    port: 4500,
    pagesDir: 'pages',
    briefsDir: '.claude4spec/briefs',
    patchesDir: '.claude4spec/patches',
    mode: 'prod',
    writingStyle: null,
    // Forward compat: brak pola w istniejacym configu = projekt sprzed M16,
    // traktowany jako ukonczony onboarding (zaden retroaktywny redirect).
    // Swiezy bootstrap nadpisuje to na false w loadOrCreateConfig.
    onboardingCompleted: true,
    // M24: null = use the hardcoded production remote in M24.
    remoteApiUrl: null,
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
  if ('port' in r) {
    if (typeof r.port !== 'number') throw typeError('port', 'number', r.port);
    out.port = r.port;
  }
  if ('pagesDir' in r) {
    if (typeof r.pagesDir !== 'string') throw typeError('pagesDir', 'string', r.pagesDir);
    out.pagesDir = r.pagesDir;
  }
  if ('briefsDir' in r) {
    if (typeof r.briefsDir !== 'string') throw typeError('briefsDir', 'string', r.briefsDir);
    out.briefsDir = r.briefsDir;
  }
  if ('patchesDir' in r) {
    if (typeof r.patchesDir !== 'string') throw typeError('patchesDir', 'string', r.patchesDir);
    out.patchesDir = r.patchesDir;
  }
  if ('mode' in r) {
    if (r.mode !== 'dev' && r.mode !== 'prod') {
      throw new Error(`config.json: field 'mode' expected 'dev' | 'prod', got ${JSON.stringify(r.mode)}`);
    }
    out.mode = r.mode;
  }
  if ('writingStyle' in r) {
    if (r.writingStyle !== null && typeof r.writingStyle !== 'string') {
      throw typeError('writingStyle', 'string | null', r.writingStyle);
    }
    out.writingStyle = r.writingStyle;
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
    out.agent = agent;
  }
  if ('remoteApiUrl' in r) {
    if (r.remoteApiUrl !== null && typeof r.remoteApiUrl !== 'string') {
      throw typeError('remoteApiUrl', 'string | null', r.remoteApiUrl);
    }
    // Syntactic URL check here (sync). Reachability (HEAD ping) is enforced at
    // server boot in startServer() — both failures share the same message:
    // `config.json: field 'remoteApiUrl': invalid URL or unreachable host`.
    if (typeof r.remoteApiUrl === 'string' && r.remoteApiUrl.trim() !== '') {
      try {
        void new URL(r.remoteApiUrl);
      } catch {
        throw new Error(`config.json: field 'remoteApiUrl': invalid URL or unreachable host`);
      }
    }
    out.remoteApiUrl = r.remoteApiUrl;
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
  // Auto-bump v1 → v2 in memory (M13 spec): projects from before plugin host
  // load with `entities` undefined which means "all plugins active" — same
  // behaviour, new schema. Persisted on next PATCH /api/config.
  if (loaded.$schemaVersion === 1) {
    loaded.$schemaVersion = CURRENT_SCHEMA_VERSION;
  }
  return { ...base, ...loaded };
}

export function loadOrCreateConfig(cwd: string, cli: ConfigCliArgs): LoadResult {
  const dir = path.join(cwd, '.claude4spec');
  fs.mkdirSync(dir, { recursive: true });
  const file = configPath(cwd);
  const base = defaults(cwd);
  const cliDefined = pickDefined(cli);

  if (!fs.existsSync(file)) {
    // Swiezy bootstrap: wymusza onboardingCompleted=false zeby AppShell pokazal
    // /onboarding po pierwszym starcie (M16). Defaults() ma true (forward compat
    // dla projektow sprzed M16); nadpisanie tylko w tym miejscu.
    const effective: Config = { ...base, ...cliDefined, onboardingCompleted: false };
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
  // Auto-bump v1 → v2 in memory — same logic as readConfig.
  if (loaded.$schemaVersion === 1) {
    loaded.$schemaVersion = CURRENT_SCHEMA_VERSION;
  }
  const effective: Config = { ...base, ...loaded, ...cliDefined };
  return { config: effective, created: false, path: file };
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
  const merged: Config = { ...current, ...validate(partial) };
  atomicWrite(file, JSON.stringify(merged, null, 2) + '\n');
  return merged;
}
