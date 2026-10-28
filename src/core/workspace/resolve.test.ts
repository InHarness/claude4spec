import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry } from '../../server/workspace/registry.js';
import { legacyHashId } from '../../server/workspace/project-id.js';
import { resolveWorkspaceProject, WorkspaceResolveError } from './resolve.js';
import { resolveServer } from '../agent/http.js';
import { resolveWorkspaceProjectOrThrow } from '../../bin/c4s/project-selector.js';

function expectResolveError(fn: () => unknown): WorkspaceResolveError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(WorkspaceResolveError);
    return err as WorkspaceResolveError;
  }
  return expect.unreachable('expected resolveWorkspaceProject to throw');
}

/** The project marker `.claude4spec/config.json` — what makes a directory a project for the walk-up. */
function writeMarker(projectDir: string, name?: string): void {
  fs.mkdirSync(path.join(projectDir, '.claude4spec'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.claude4spec', 'config.json'), JSON.stringify(name ? { name } : {}));
}

function inDir<T>(d: string, fn: () => T): T {
  const prev = process.cwd();
  process.chdir(d);
  try {
    return fn();
  } finally {
    process.chdir(prev);
  }
}

describe('resolveWorkspaceProject — 2.1.0: --project <id> is the only selector', () => {
  let dir: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-resolve-')));
    prevHome = process.env.C4S_HOME;
    // resolveWorkspaceProject constructs `new WorkspaceRegistry()` with no
    // override — it reads C4S_HOME itself, so setup must target the SAME dir.
    process.env.C4S_HOME = dir;
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('resolves a registered id, returning the local address of its workspace', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default', port: 4611 });
    const project = registry.registerProject(ws, path.join(dir, 'App Spec'));
    expect(project.id).toBe('app-spec');

    const result = resolveWorkspaceProject({ project: 'app-spec' });
    expect(result.workspaceName).toBe('default');
    expect(result.projectId).toBe('app-spec');
    expect(result.localUrl).toBe('http://localhost:4611');
  });

  it('never resolves a path or a display name — only the id', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    const cwd = path.join(dir, 'spec');
    registry.registerProject(ws, cwd);

    expect(expectResolveError(() => resolveWorkspaceProject({ project: cwd })).code).toBe('PROJECT_ID_NOT_FOUND');
    expect(expectResolveError(() => resolveWorkspaceProject({ project: 'Spec' })).code).toBe('PROJECT_ID_NOT_FOUND');
  });

  it('PROJECT_ID_NOT_FOUND lists the available ids and no directory', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    registry.registerProject(ws, path.join(dir, 'alpha'));
    registry.registerProject(ws, path.join(dir, 'beta'));

    const err = expectResolveError(() => resolveWorkspaceProject({ project: 'gamma' }));
    expect(err.code).toBe('PROJECT_ID_NOT_FOUND');
    expect(err.message).toContain('alpha');
    expect(err.message).toContain('beta');
    expect(err.message).not.toContain(dir);
  });

  it('AMBIGUOUS_PROJECT across workspaces carries { id, workspace } candidates, never a directory', () => {
    const registry = new WorkspaceRegistry(dir);
    const wsA = registry.selectOrCreate({ name: 'ws-a', port: 4501 });
    const wsB = registry.selectOrCreate({ name: 'ws-b', port: 4502 });
    registry.registerProject(wsA, path.join(dir, 'repo-a', 'shared'));
    registry.registerProject(wsB, path.join(dir, 'repo-b', 'shared'));

    const err = expectResolveError(() => resolveWorkspaceProject({ project: 'shared' }));
    expect(err.code).toBe('AMBIGUOUS_PROJECT');
    expect(err.message).toContain('{"id":"shared","workspace":"ws-a"}');
    expect(err.message).toContain('{"id":"shared","workspace":"ws-b"}');
    expect(err.message).not.toContain(dir);
    expect(err.hint).toContain('--workspace');

    expect(resolveWorkspaceProject({ project: 'shared', workspace: 'ws-b' }).workspaceName).toBe('ws-b');
  });

  it('two projects sharing a directory name in ONE workspace get distinct ids (-2), both addressable', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    const a = registry.registerProject(ws, path.join(dir, 'repo-a', 'spec'));
    const b = registry.registerProject(ws, path.join(dir, 'repo-b', 'spec'));
    expect([a.id, b.id]).toEqual(['spec', 'spec-2']);

    expect(resolveWorkspaceProject({ project: 'spec' }).projectDir).toBe(a.cwd);
    expect(resolveWorkspaceProject({ project: 'spec-2' }).projectDir).toBe(b.cwd);
  });

  it('does not widen an explicit --workspace scope to find an id registered elsewhere', () => {
    const registry = new WorkspaceRegistry(dir);
    const wsA = registry.selectOrCreate({ name: 'ws-a', port: 4501 });
    registry.selectOrCreate({ name: 'ws-b', port: 4502 });
    registry.registerProject(wsA, path.join(dir, 'only-in-a'));

    expect(expectResolveError(() => resolveWorkspaceProject({ project: 'only-in-a', workspace: 'ws-b' })).code).toBe(
      'PROJECT_ID_NOT_FOUND',
    );
  });

  /**
   * 2.1.53 — the 0/1/N rule belongs to `cli`. An `mcp`/`internal` caller runs in
   * a server process of exactly one workspace and resolves the id there; the
   * codes PROJECT_NOT_FOUND and AMBIGUOUS_* do not arise on that path.
   */
  it('[section:m11dcore] mcp: an id present in the serving workspace and another resolves to the serving one, no AMBIGUOUS_*', () => {
    const registry = new WorkspaceRegistry(dir);
    const wsA = registry.selectOrCreate({ name: 'ws-a', port: 4501 });
    const wsB = registry.selectOrCreate({ name: 'ws-b', port: 4502 });
    registry.registerProject(wsA, path.join(dir, 'repo-a', 'shared'));
    registry.registerProject(wsB, path.join(dir, 'repo-b', 'shared'));

    for (const channel of ['mcp', 'internal'] as const) {
      const resolved = resolveWorkspaceProject({ project: 'shared', workspace: 'ws-b', channel });
      expect(resolved.workspaceName).toBe('ws-b');
      expect(resolved.localUrl).toBe('http://localhost:4502');
    }
    // The cli channel keeps the rule.
    expect(expectResolveError(() => resolveWorkspaceProject({ project: 'shared', channel: 'cli' })).code).toBe(
      'AMBIGUOUS_PROJECT',
    );
  });

  it('[section:m11dcore] mcp: a miss is PROJECT_ID_NOT_FOUND — never PROJECT_NOT_FOUND, even for an unregistered workspace', () => {
    const registry = new WorkspaceRegistry(dir);
    const wsA = registry.selectOrCreate({ name: 'ws-a', port: 4501 });
    registry.selectOrCreate({ name: 'ws-b', port: 4502 });
    registry.registerProject(wsA, path.join(dir, 'only-in-a'));

    const elsewhere = expectResolveError(() =>
      resolveWorkspaceProject({ project: 'only-in-a', workspace: 'ws-b', channel: 'mcp' }),
    );
    expect(elsewhere.code).toBe('PROJECT_ID_NOT_FOUND');
    const unknownWs = expectResolveError(() =>
      resolveWorkspaceProject({ project: 'only-in-a', workspace: 'nope', channel: 'mcp' }),
    );
    expect(unknownWs.code).toBe('PROJECT_ID_NOT_FOUND');
    expect(unknownWs.message).toContain("workspace 'nope' is not registered");
    // A named workspace reaches a peer outside the serving one.
    expect(resolveWorkspaceProject({ project: 'only-in-a', workspace: 'ws-a', channel: 'mcp' }).workspaceName).toBe('ws-a');
  });

  it('reports an unrecognized --workspace distinctly from PROJECT_ID_NOT_FOUND', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    registry.registerProject(ws, path.join(dir, 'app-spec-real'));

    const err = expectResolveError(() =>
      resolveWorkspaceProject({ project: 'app-spec-real', workspace: 'no-such-workspace' }),
    );
    expect(err.code).toBe('PROJECT_NOT_FOUND');
    expect(err.message).toContain("workspace 'no-such-workspace' is not registered");
    expect(err.hint).toContain('default');
  });

  it('without --project walks up from cwd to the nearest registered project', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    const cwd = path.join(dir, 'walk');
    fs.mkdirSync(path.join(cwd, 'deep', 'er'), { recursive: true });
    writeMarker(cwd);
    registry.registerProject(ws, cwd);

    const prev = process.cwd();
    process.chdir(path.join(cwd, 'deep', 'er'));
    try {
      expect(resolveWorkspaceProject().projectId).toBe('walk');
    } finally {
      process.chdir(prev);
    }
  });

  it('a hand-edited cwd keeps the stored id (walk-up finds it under the new path)', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    registry.registerProject(ws, path.join(dir, 'old-place'));
    const moved = path.join(dir, 'new-place');
    fs.mkdirSync(moved, { recursive: true });
    writeMarker(moved);
    const file = path.join(dir, 'workspaces.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.workspaces[0].projects[0].cwd = moved;
    fs.writeFileSync(file, JSON.stringify(data));

    const prev = process.cwd();
    process.chdir(moved);
    try {
      expect(resolveWorkspaceProject().projectId).toBe('old-place');
    } finally {
      process.chdir(prev);
    }
    expect(resolveWorkspaceProject({ project: 'old-place' }).projectDir).toBe(moved);
  });

  it('reads a pre-2.1.0 (hash-id) registry with the migrated ids IN MEMORY, never rewriting it', () => {
    const cwd = path.join(dir, 'legacy-spec');
    const file = path.join(dir, 'workspaces.json');
    const legacy = {
      $schemaVersion: 2,
      workspaces: [
        {
          name: 'default',
          mode: 'prod',
          defaultPort: 4500,
          projects: [{ cwd, id: legacyHashId(cwd), name: 'legacy-spec', addedAt: '2026-01-01T00:00:00.000Z' }],
        },
      ],
    };
    fs.writeFileSync(file, JSON.stringify(legacy));

    expect(resolveWorkspaceProject({ project: 'legacy-spec' }).projectId).toBe('legacy-spec');
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(legacy);
  });
});

/**
 * 2.1.58 (M11 `m11pjres`, `m11wsres`, `euyb84yv`, `m11dserv`; carried finding
 * rev-0005): the resolver reads, beyond the registry, the committed
 * `workspace.json` of every registered home — and the walk-up recognises the
 * description of a home this machine never registered, and the home itself.
 */
describe('resolveWorkspaceProject — workspaces with a home directory (2.1.58)', () => {
  let dir: string;
  let prevHome: string | undefined;
  let registryFile: string;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-resolve-home-')));
    prevHome = process.env.C4S_HOME;
    process.env.C4S_HOME = path.join(dir, 'registry');
    registryFile = path.join(dir, 'registry', 'workspaces.json');
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A team repo: `<home>/.claude4spec/workspace.json` + one marker per listed project. */
  function makeHome(name: string, projects: Array<{ id: string; path: string }>): string {
    const home = path.join(dir, name);
    fs.mkdirSync(path.join(home, '.claude4spec'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude4spec', 'workspace.json'), JSON.stringify({ projects, plugins: [] }));
    for (const p of projects) writeMarker(path.join(home, p.path));
    return home;
  }

  /** Registers a workspace with a home by hand: the entry carries only machine-local attributes. */
  function registerHome(name: string, home: string, extra: Record<string, unknown> = {}): void {
    const data = fs.existsSync(registryFile)
      ? (JSON.parse(fs.readFileSync(registryFile, 'utf8')) as { workspaces: unknown[] })
      : { $schemaVersion: 3, workspaces: [] as unknown[] };
    data.workspaces.push({ name, mode: 'prod', defaultPort: 4700, home, ...extra });
    fs.mkdirSync(path.dirname(registryFile), { recursive: true });
    fs.writeFileSync(registryFile, JSON.stringify(data));
  }

  it('[ac:ac-walk-up-w-projekcie-workspace-u-z-kat] [section:m11pjres] a walk-up inside a project of a workspace with a home resolves it without --workspace, with the id workspace.json gives it', () => {
    const home = makeHome('team-repo', [
      { id: 'app', path: 'specs/app' },
      { id: 'api', path: 'specs/api' },
    ]);
    registerHome('team', home);
    fs.mkdirSync(path.join(home, 'specs', 'app', 'pages', 'deep'), { recursive: true });

    const resolved = inDir(path.join(home, 'specs', 'app', 'pages', 'deep'), () => resolveWorkspaceProject());
    expect(resolved.workspaceName).toBe('team');
    expect(resolved.projectId).toBe('app');
    expect(resolved.projectDir).toBe(path.join(home, 'specs', 'app'));
    // `--project` looks the id up in the same view.
    expect(resolveWorkspaceProject({ project: 'api' }).projectDir).toBe(path.join(home, 'specs', 'api'));
  });

  it('[section:euyb84yv] the server address of a workspace with a home comes from its registry entry, as for a registry workspace', async () => {
    const home = makeHome('team-repo', [{ id: 'app', path: 'app' }]);
    registerHome('team', home, { defaultPort: 4733, bindHost: '10.1.2.3', publicUrl: 'https://specs.example.com' });
    const resolved = await inDir(path.join(home, 'app'), () => resolveServer({}));
    // The LOCAL address (a concrete bindHost), never the publicUrl.
    expect(resolved.baseUrl).toBe('http://10.1.2.3:4733');
    expect(resolved.apiBase).toBe('http://10.1.2.3:4733/api/projects/app');
    expect(resolved.workspaceName).toBe('team');
  });

  it('[ac:ac-walk-up-ktory-trafia-na-workspace-jso] [section:m11pkg00] a walk-up that meets the workspace.json of an unregistered home ends WORKSPACE_NOT_REGISTERED, the hint naming `--cwd <home>`', () => {
    // A freshly cloned team repo: the description is committed, this machine's
    // registry has never heard of it.
    const home = makeHome('cloned-repo', [{ id: 'app', path: 'specs/app' }]);
    const other = new WorkspaceRegistry(path.join(dir, 'registry'));
    other.selectOrCreate({ name: 'default' });

    for (const where of [path.join(home, 'specs', 'app'), home]) {
      const err = inDir(where, () => expectResolveError(() => resolveWorkspaceProject()));
      expect(err.code, where).toBe('WORKSPACE_NOT_REGISTERED');
      expect(err.message).toContain(path.join(home, '.claude4spec', 'workspace.json'));
      // `claude4spec --cwd` names the workspace HOME, not the project.
      expect(err.hint).toContain(`--cwd ${home}`);
      expect(err.hint).toContain('npx @inharness-ai/claude4spec');
      expect(err.hint).not.toContain(path.join(home, 'specs'));
    }
  });

  it('[ac:ac-c4s-uruchomione-w-samym-katalogu-domo] c4s run in the home directory itself ends PROJECT_NOT_FOUND listing the workspace\'s project ids, without their paths', () => {
    const home = makeHome('team-repo', [
      { id: 'app', path: 'specs/app' },
      { id: 'api', path: 'services/api-spec' },
    ]);
    registerHome('team', home);

    const err = inDir(home, () => expectResolveError(() => resolveWorkspaceProject()));
    expect(err.code).toBe('PROJECT_NOT_FOUND');
    expect(err.message).toContain("workspace 'team'");
    expect(err.message).toContain('app');
    expect(err.message).toContain('api');
    expect(err.message).not.toContain('specs/app');
    expect(err.message).not.toContain('services');
    expect(err.message).not.toContain(dir);
  });

  it('[ac:ac-nieczytelny-albo-niezgodny-z-ksztalte-2] an unreadable or off-the-shape workspace.json of a registered home read by c4s ends WORKSPACE_FILE_INVALID', () => {
    const home = makeHome('team-repo', [{ id: 'app', path: 'specs/app' }]);
    registerHome('team', home);
    const file = path.join(home, '.claude4spec', 'workspace.json');

    for (const [label, content] of [
      ['unreadable (invalid JSON)', '{ "projects": [ '],
      ['off the shape', JSON.stringify({ projects: 'specs/app', plugins: [] })],
    ] as const) {
      fs.writeFileSync(file, content);
      // rev-0005: a bare `c4s` inside a project of the broken home names the
      // file instead of a misleading PROJECT_NOT_FOUND.
      const walk = inDir(path.join(home, 'specs', 'app'), () => expectResolveError(() => resolveWorkspaceProject()));
      expect(walk.code, label).toBe('WORKSPACE_FILE_INVALID');
      expect(walk.message, label).toContain(file);
      expect(walk.message, label).toContain("workspace 'team'");
      expect(walk.hint, label).toContain('fix the file by hand');
      // `--project` would look the id up in that file: same refusal, not a miss.
      const byId = expectResolveError(() => resolveWorkspaceProject({ project: 'app' }));
      expect(byId.code, label).toBe('WORKSPACE_FILE_INVALID');
      expect(byId.message, label).toContain(file);
    }
    // Nothing repaired it.
    expect(fs.readFileSync(file, 'utf8')).toBe(JSON.stringify({ projects: 'specs/app', plugins: [] }));
  });

  it('[section:m11pjres] a broken home does not take down resolution that cannot depend on it: walk-up outside it, --workspace naming another workspace, a deleted home', () => {
    const broken = makeHome('broken-repo', [{ id: 'app', path: 'app' }]);
    registerHome('team', broken);
    fs.writeFileSync(path.join(broken, '.claude4spec', 'workspace.json'), 'not json');
    registerHome('gone', path.join(dir, 'deleted-checkout'));
    const registry = new WorkspaceRegistry(path.join(dir, 'registry'));
    const solo = registry.selectOrCreate({ name: 'solo', port: 4501 });
    const elsewhere = path.join(dir, 'solo-spec');
    writeMarker(elsewhere);
    registry.registerProject(solo, elsewhere);

    expect(inDir(elsewhere, () => resolveWorkspaceProject()).projectId).toBe('solo-spec');
    expect(resolveWorkspaceProject({ project: 'solo-spec', workspace: 'solo' }).workspaceName).toBe('solo');
    // Without --workspace the broken file could also list the id.
    const err = expectResolveError(() => resolveWorkspaceProject({ project: 'solo-spec' }));
    expect(err.code).toBe('WORKSPACE_FILE_INVALID');
    expect(err.hint).toContain('--workspace');
    // A home that no longer exists is no file to repair: it holds no project.
    expect(err.message).not.toContain('deleted-checkout');
  });

  it('[ac:ac-c4s-w-katalogu-bez-projektu-walk-up-n] without a project marker on the way up, nor a registered workspace.json above it, or with a path outside every workspace → PROJECT_NOT_FOUND with a hint; the marker is .claude4spec/config.json', () => {
    const registry = new WorkspaceRegistry(path.join(dir, 'registry'));
    const ws = registry.selectOrCreate({ name: 'default' });

    // 1. No marker anywhere up the tree.
    const bare = path.join(dir, 'plain', 'dir');
    fs.mkdirSync(bare, { recursive: true });
    const none = inDir(bare, () => expectResolveError(() => resolveWorkspaceProject()));
    expect(none.code).toBe('PROJECT_NOT_FOUND');
    expect(none.hint).toContain('npx @inharness-ai/claude4spec');

    // 2. A marker, but no workspace holds the project.
    const stray = path.join(dir, 'stray-spec');
    writeMarker(stray);
    const outside = inDir(stray, () => expectResolveError(() => resolveWorkspaceProject()));
    expect(outside.code).toBe('PROJECT_NOT_FOUND');
    expect(outside.hint).toBeTruthy();

    // 3. A registered directory WITHOUT the marker is no project for the walk-up.
    const unmarked = path.join(dir, 'unmarked');
    fs.mkdirSync(unmarked, { recursive: true });
    registry.registerProject(ws, unmarked);
    expect(inDir(unmarked, () => expectResolveError(() => resolveWorkspaceProject())).code).toBe('PROJECT_NOT_FOUND');
    writeMarker(unmarked);
    expect(inDir(unmarked, () => resolveWorkspaceProject()).projectId).toBe('unmarked');
  });

  it('[ac:ac-resolver-projektu-jest-wspolny-dla-wszys] [section:m11wsres] one resolver for every command: --project or the walk-up, then 0/1/N over the views of both kinds — N>1 is AMBIGUOUS_WORKSPACE, never a last-opened guess', async () => {
    const home = makeHome('team-repo', [{ id: 'app', path: 'app' }]);
    registerHome('team', home, { lastOpened: '2026-10-01T00:00:00.000Z' });
    const registry = new WorkspaceRegistry(path.join(dir, 'registry'));
    const solo = registry.selectOrCreate({ name: 'solo', port: 4501 });
    // The same directory is also a project of a registry workspace.
    registry.registerProject(solo, path.join(home, 'app'));
    registry.touchLastOpened('solo');

    const projectDir = path.join(home, 'app');
    const amb = inDir(projectDir, () => expectResolveError(() => resolveWorkspaceProject()));
    expect(amb.code).toBe('AMBIGUOUS_WORKSPACE');
    expect(amb.message).toContain("'team'");
    expect(amb.message).toContain("'solo'");
    expect(amb.hint).toContain('--workspace');
    // The ambiguous id the same way (both views list `app`).
    expect(expectResolveError(() => resolveWorkspaceProject({ project: 'app' })).code).toBe('AMBIGUOUS_PROJECT');

    expect(inDir(projectDir, () => resolveWorkspaceProject({ workspace: 'team' })).workspaceName).toBe('team');
    expect(inDir(projectDir, () => resolveWorkspaceProject({ workspace: 'solo' })).workspaceName).toBe('solo');

    // Every server-delegating command resolves through the same function
    // (`resolveServer`), and so does the server-free `install-skills`
    // (`resolveWorkspaceProjectOrThrow`): the same answer, the same refusal.
    await expect(inDir(projectDir, () => resolveServer({}))).rejects.toMatchObject({ code: 'AMBIGUOUS_WORKSPACE' });
    expect(inDir(projectDir, () => expectCliCode(() => resolveWorkspaceProjectOrThrow({})))).toBe('AMBIGUOUS_WORKSPACE');
    const viaServer = await inDir(projectDir, () => resolveServer({ workspace: 'team' }));
    const viaSelector = inDir(projectDir, () => resolveWorkspaceProjectOrThrow({ workspace: 'team' }));
    expect(viaServer.projectId).toBe(viaSelector.projectId);
    expect(viaServer.baseUrl).toBe(viaSelector.localUrl);
  });

  it('[ac:ac-jedyne-pliki-czytane-lokalnie-przez-b] [section:m11dserv] the only files c4s reads to find the server are the project marker, the registry and the workspace.json of registered homes', async () => {
    const home = makeHome('team-repo', [{ id: 'app', path: 'specs/app' }]);
    registerHome('team', home);
    const registry = new WorkspaceRegistry(path.join(dir, 'registry'));
    const solo = registry.selectOrCreate({ name: 'solo', port: 4501 });
    const soloSpec = path.join(dir, 'solo-spec');
    writeMarker(soloSpec);
    registry.registerProject(solo, soloSpec);
    fs.mkdirSync(path.join(home, 'specs', 'app', 'pages'), { recursive: true });
    fs.writeFileSync(path.join(home, 'specs', 'app', 'pages', 'index.md'), '# spec content');

    const read = vi.spyOn(fs, 'readFileSync');
    const exists = vi.spyOn(fs, 'existsSync');
    try {
        await inDir(path.join(home, 'specs', 'app', 'pages'), () => resolveServer({}));
      await resolveServer({ project: 'solo-spec' });

      const readPaths = read.mock.calls.map(([f]) => String(f));
      expect(readPaths.length).toBeGreaterThan(0);
      for (const f of readPaths) {
        expect(
          f === registryFile || f.endsWith(path.join('.claude4spec', 'workspace.json')),
          `read ${f}`,
        ).toBe(true);
      }
      expect(readPaths).toContain(registryFile);
      expect(readPaths).toContain(path.join(home, '.claude4spec', 'workspace.json'));
      // The marker is a proof of existence, never read for content; no
      // specification file is touched at all.
      for (const [f] of exists.mock.calls) {
        expect(
          String(f).endsWith(path.join('.claude4spec', 'config.json')) ||
            String(f).endsWith(path.join('.claude4spec', 'workspace.json')),
          `probed ${String(f)}`,
        ).toBe(true);
      }
      expect(readPaths.some((f) => f.endsWith('index.md') || f.endsWith('config.json'))).toBe(false);
    } finally {
      read.mockRestore();
      exists.mockRestore();
    }
  });
});

function expectCliCode(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return (err as { code: string }).code;
  }
  return expect.unreachable('expected a refusal');
}

