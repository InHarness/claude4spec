import fs from 'node:fs';
import path from 'node:path';
import { homeConfigDir, workspaceFilePath } from './home-workspace.js';
import { writeJsonAtomic } from './advisory-lock.js';

/**
 * 2.1.58 (M31 `m31wsel01`, `qglsgonq`): the inputs and the refusals of the
 * start's workspace selection rule. The rule itself runs under the registry
 * lock in `WorkspaceRegistry.selectOrCreateEntry`; this module holds the parts
 * that need no registry: the walk-up to a workspace description, the default
 * port and name of a new entry, the refusal type.
 */

/** What the start selects its workspace by — the start flags, plus the launch directory. */
export interface WorkspaceSelection {
  /** `--workspace <name>`. */
  name?: string;
  /** `--cwd <dir>` (absolute): the workspace HOME directory, never a project directory. */
  cwd?: string;
  /** `--port <n>`: a selector alone, an override of the selected entry with `--workspace` / `--cwd`. */
  port?: number;
  /** `--mode`: seeds `mode` of a NEW entry only; an existing entry keeps its own. */
  mode?: 'dev' | 'prod';
  /** The directory the command was run in — the start of the walk-up (bare command only). */
  launchDir?: string;
  /** `$HOME` (default `os.homedir()`): `--cwd $HOME` selects workspace `default`. */
  userHome?: string;
}

export type WorkspaceSelectionErrorCode =
  | 'CWD_IS_PROJECT'
  | 'CWD_INSIDE_HOME'
  | 'WORKSPACE_HOME_MISMATCH'
  | 'PORT_TAKEN_BY_WORKSPACE';

/**
 * A refusal of the flag combination table (M31 `qglsgonq`). Raised before the
 * registry, the home directory or `workspace.json` is written, so a refused
 * start leaves everything as it was. `hint` names the directory or flag that
 * would be accepted.
 */
export class WorkspaceSelectionError extends Error {
  readonly code: WorkspaceSelectionErrorCode;
  readonly hint: string;

  constructor(code: WorkspaceSelectionErrorCode, message: string, hint: string) {
    super(message);
    this.name = 'WorkspaceSelectionError';
    this.code = code;
    this.hint = hint;
  }
}

/**
 * Step 4 of the rule: from `dir` upwards to the first directory whose
 * `.claude4spec/` carries `workspace.json`. Existence probes only — the file is
 * read once, by the view (`openView`), after the selection.
 */
export function findWorkspaceHomeUp(dir: string): string | null {
  let cur = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(workspaceFilePath(cur))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

/** True when the directory is a project: its `.claude4spec/` carries `config.json`. */
export function isProjectDirectory(dir: string): boolean {
  return fs.existsSync(path.join(homeConfigDir(dir), 'config.json'));
}

/**
 * The directory a `CWD_IS_PROJECT` refusal suggests instead — the repository
 * the project lies in: the registered home enclosing it, else the nearest
 * ancestor carrying `.git`, else the parent directory.
 * ASSUMPTION:dev-0501 — how "the parent repository directory" is found.
 */
export function repositoryHintFor(projectDir: string, enclosingHome: string | undefined): string {
  if (enclosingHome !== undefined) return enclosingHome;
  let cur = path.dirname(path.resolve(projectDir));
  for (;;) {
    if (fs.existsSync(path.join(cur, '.git'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return path.dirname(path.resolve(projectDir));
    cur = parent;
  }
}

/**
 * The default port of a new entry created without `--port`: the first free
 * from `from` (the registry's 4500) among the entries' `defaultPort`.
 */
export function firstFreePort(entries: ReadonlyArray<{ defaultPort: number }>, from: number): number {
  const taken = new Set(entries.map((e) => e.defaultPort));
  let port = from;
  while (taken.has(port)) port++;
  return port;
}

/**
 * The name of a new entry created from `--cwd` without `--workspace`: the
 * directory name, `-2`, `-3`… on a collision. ASSUMPTION:dev-0502 — characters
 * a workspace name cannot carry become `-`, the name is cut to 36 characters
 * (room for the suffix), and a name left empty is `workspace`.
 */
export function homeEntryName(dir: string, taken: ReadonlySet<string>): string {
  const base =
    path
      .basename(path.resolve(dir))
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^[.-]+|-+$/g, '')
      .slice(0, 36) || 'workspace';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * A new entry with a home: the directory is created when absent, and so is its
 * description — `workspace.json` with no projects and no plugins — so the view
 * opens and a later bare command finds it by the walk-up. An existing file (a
 * cloned team repository) is kept as it is. ASSUMPTION:dev-0503.
 */
export function ensureHomeDescription(home: string): void {
  fs.mkdirSync(homeConfigDir(home), { recursive: true });
  if (!fs.existsSync(workspaceFilePath(home))) {
    writeJsonAtomic(workspaceFilePath(home), { projects: [], plugins: [] });
  }
}
