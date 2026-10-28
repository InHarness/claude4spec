import fs from 'node:fs';
import path from 'node:path';
import { withAdvisoryLock, writeJsonAtomic } from './advisory-lock.js';
import { PROJECT_ID_RE } from './project-id.js';

/**
 * 2.1.58 (M31 `vaa83o17`, `t97gncju`, `4y64rsxf`): the committed description of
 * a workspace with a home directory.
 *
 * `<home>/.claude4spec/workspace.json` carries the composition only —
 * `projects[]` (`id` + `path` relative to the home) and `plugins[]`. Every
 * machine-local attribute (address attributes, `lastOpened`,
 * `lastOpenedProject`, project trust) stays in the registry entry: the writer
 * below serializes exactly these two keys, so nothing else can reach the file.
 * `<home>/.claude4spec/local/` (git-ignored) holds the workspace's slots
 * directory and the lock file of `workspace.json`.
 */

export interface WorkspaceFileProject {
  id: string;
  /** Relative to the home, inside it: never absolute, no `..`, never the home itself. */
  path: string;
}

export interface WorkspaceFile {
  projects: WorkspaceFileProject[];
  plugins: string[];
}

export type WorkspaceFileErrorCode =
  | 'WORKSPACE_FILE_INVALID'
  | 'WORKSPACE_PROJECT_ID_MISSING'
  | 'WORKSPACE_PROJECT_ID_DUPLICATE';

/**
 * A `workspace.json` the process refuses to start on. The server never repairs
 * the file — a human fixes it and commits the fix — so each code names what to
 * fix: the file (`INVALID`), the entry (`ID_MISSING`), or the id and both
 * paths carrying it (`ID_DUPLICATE`).
 */
export class WorkspaceFileError extends Error {
  readonly code: WorkspaceFileErrorCode;
  readonly file: string;
  /** `WORKSPACE_PROJECT_ID_MISSING`: index of the entry in `projects[]`. */
  readonly entry?: number;
  /** `WORKSPACE_PROJECT_ID_DUPLICATE`: the repeated id … */
  readonly id?: string;
  /** … and the two paths carrying it, in file order. */
  readonly paths?: [string, string];

  constructor(
    code: WorkspaceFileErrorCode,
    file: string,
    detail: string,
    extra: { entry?: number; id?: string; paths?: [string, string] } = {},
  ) {
    super(`${code} — ${file}: ${detail}`);
    this.name = 'WorkspaceFileError';
    this.code = code;
    this.file = file;
    if (extra.entry !== undefined) this.entry = extra.entry;
    if (extra.id !== undefined) this.id = extra.id;
    if (extra.paths !== undefined) this.paths = extra.paths;
  }
}

export function homeConfigDir(home: string): string {
  return path.join(home, '.claude4spec');
}

export function workspaceFilePath(home: string): string {
  return path.join(homeConfigDir(home), 'workspace.json');
}

/** The git-ignored part: the workspace's slots directory and the lock file. */
export function homeLocalDir(home: string): string {
  return path.join(homeConfigDir(home), 'local');
}

function lockPath(home: string): string {
  return path.join(homeLocalDir(home), 'workspace.json.lock');
}

/** True when `rel` is a valid project path: relative, inside the home, not the home. */
export function isValidProjectPath(rel: string): boolean {
  if (rel.trim() === '') return false;
  if (path.isAbsolute(rel) || path.win32.isAbsolute(rel)) return false;
  const segments = rel.split(/[\\/]+/);
  if (segments.includes('..')) return false;
  return segments.some((s) => s !== '' && s !== '.');
}

export type ProjectPathErrorCode = 'PROJECT_PATH_OUTSIDE_HOME' | 'PROJECT_PATH_IS_HOME';

/**
 * 2.1.58 (M31 `m31boot01`): the two refusals of adding a project to a
 * workspace with a home — a directory outside the home, and the home itself.
 * Both are raised before anything is written.
 */
export class ProjectPathError extends Error {
  constructor(
    readonly code: ProjectPathErrorCode,
    readonly dir: string,
    readonly home: string,
  ) {
    super(
      code === 'PROJECT_PATH_IS_HOME'
        ? `${dir} is the home directory of the workspace, which cannot be a project of it`
        : `${dir} lies outside the home directory of the workspace (${home}); a project of a workspace with a home lies inside it`,
    );
    this.name = 'ProjectPathError';
  }
}

/**
 * The `workspace.json` path of an absolute project directory: relative to the
 * home, `/`-separated. A directory that is not strictly inside the home is
 * refused with {@link ProjectPathError}.
 */
export function toProjectPath(home: string, absDir: string): string {
  const rel = path.relative(path.resolve(home), path.resolve(absDir));
  if (rel === '') throw new ProjectPathError('PROJECT_PATH_IS_HOME', absDir, home);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new ProjectPathError('PROJECT_PATH_OUTSIDE_HOME', absDir, home);
  }
  return rel.split(path.sep).join('/');
}

function canonicalProjectPath(rel: string): string {
  return rel
    .split(/[\\/]+/)
    .filter((s) => s !== '' && s !== '.')
    .join('/');
}

/** `a/b`, `./a/b` and `a//b/` name the same project directory. */
export function sameProjectPath(a: string, b: string): boolean {
  return canonicalProjectPath(a) === canonicalProjectPath(b);
}

/**
 * Read and validate the file, in the order the refusals are listed
 * (M31 `4y64rsxf`): an unreadable file or one off the shape →
 * `WORKSPACE_FILE_INVALID`; then an entry without `id` →
 * `WORKSPACE_PROJECT_ID_MISSING`; then an `id` repeated →
 * `WORKSPACE_PROJECT_ID_DUPLICATE`. Nothing is repaired or written.
 *
 * ASSUMPTION:dev-0101 — "off the shape" also covers an `id` that is not a
 * minted id (`[a-z0-9-]`, ≤ 48): the id names a slot directory and a URL
 * segment, so `..` or `My Project` cannot be accepted. An empty `id` counts as
 * a missing one. `plugins` is required like `projects`. Unknown keys are
 * ignored on read and not carried over by a server write (the writer emits
 * only the two keys it owns, so nothing machine-local can slip in).
 */
export function readWorkspaceFile(home: string): WorkspaceFile {
  const file = workspaceFilePath(home);
  const invalid = (detail: string) => new WorkspaceFileError('WORKSPACE_FILE_INVALID', file, detail);
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw invalid(`cannot be read (${(err as NodeJS.ErrnoException).code ?? (err as Error).message})`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw invalid(`invalid JSON — ${(err as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw invalid('expected an object { projects: [], plugins: [] }');
  }
  const raw = parsed as Record<string, unknown>;
  if (!Array.isArray(raw.projects)) throw invalid('"projects" must be an array');
  if (!Array.isArray(raw.plugins) || !raw.plugins.every((p) => typeof p === 'string' && p !== '')) {
    throw invalid('"plugins" must be an array of package names');
  }
  raw.projects.forEach((entry, i) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw invalid(`projects[${i}] must be an object { id, path }`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.path !== 'string' || !isValidProjectPath(e.path)) {
      throw invalid(
        `projects[${i}].path must be a path relative to the workspace home, inside it (not absolute, no "..", not the home itself)`,
      );
    }
    if (e.id !== undefined && e.id !== '' && (typeof e.id !== 'string' || !PROJECT_ID_RE.test(e.id))) {
      throw invalid(`projects[${i}].id must be a project id ([a-z0-9-], at most 48 characters)`);
    }
  });
  const entries = raw.projects as Array<{ id?: string; path: string }>;
  entries.forEach((e, i) => {
    if (e.id === undefined || e.id === '') {
      throw new WorkspaceFileError(
        'WORKSPACE_PROJECT_ID_MISSING',
        file,
        `projects[${i}] (path "${e.path}") has no id — ids are assigned only by adding a project`,
        { entry: i },
      );
    }
  });
  const seen = new Map<string, string>();
  for (const e of entries) {
    const first = seen.get(e.id!);
    if (first !== undefined) {
      throw new WorkspaceFileError(
        'WORKSPACE_PROJECT_ID_DUPLICATE',
        file,
        `id "${e.id}" is used by "${first}" and "${e.path}"`,
        { id: e.id!, paths: [first, e.path] },
      );
    }
    seen.set(e.id!, e.path);
  }
  return {
    projects: entries.map((e) => ({ id: e.id!, path: e.path })),
    plugins: [...(raw.plugins as string[])],
  };
}

/** Composition only — never a machine-local attribute (M31 `t97gncju`). */
function serialize(data: WorkspaceFile): WorkspaceFile {
  return {
    projects: data.projects.map((p) => ({ id: p.id, path: p.path })),
    plugins: [...data.plugins],
  };
}

/**
 * Read-modify-write of `workspace.json` under the advisory lock of that file
 * (lock in `local/`, M31 `fzno8pd4` atomicity). The mutator returns the next
 * content, or `null` to leave the file untouched; the content written (or the
 * fresh read) is returned so the caller updates its in-memory view at once.
 */
export function mutateWorkspaceFile<T>(
  home: string,
  mutate: (data: WorkspaceFile) => { next: WorkspaceFile | null; result: T },
): { file: WorkspaceFile; result: T } {
  return withAdvisoryLock(lockPath(home), () => {
    const current = readWorkspaceFile(home);
    const { next, result } = mutate(current);
    if (next === null) return { file: current, result };
    const out = serialize(next);
    writeJsonAtomic(workspaceFilePath(home), out);
    return { file: out, result };
  });
}

const GITIGNORE_ENTRY = 'local/';

/**
 * M31 `t97gncju`: `<home>/.claude4spec/.gitignore` carries `local/`. Created
 * with that single entry when absent; an existing file lacking the entry gets
 * it appended (other lines are the team's and stay). Run at every start of a
 * home workspace. Returns whether the file was written.
 */
export function ensureHomeGitignore(home: string): boolean {
  const dir = homeConfigDir(home);
  const file = path.join(dir, '.gitignore');
  let text: string | null = null;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  if (text === null) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, `${GITIGNORE_ENTRY}\n`, 'utf8');
    return true;
  }
  const covered = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .some((l) => l === 'local/' || l === 'local' || l === '/local/' || l === '/local');
  if (covered) return false;
  const sep = text === '' || text.endsWith('\n') ? '' : '\n';
  fs.writeFileSync(file, `${text}${sep}${GITIGNORE_ENTRY}\n`, 'utf8');
  return true;
}
