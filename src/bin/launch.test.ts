import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry } from '../server/workspace/registry.js';
import { applyNetworkFlags } from '../server/workspace/network-flags.js';
import { bootstrapProject } from '../server/workspace/bootstrap.js';
import { configPath } from '../server/config.js';
import { openDb } from '../server/db/index.js';
import { WorkspaceFileError, workspaceFilePath } from '../server/workspace/home-workspace.js';
import { openStartWorkspace, parseLaunchArgs, prepareStart, printStartWarnings, projectStartUrl } from './launch.js';

/**
 * 2.1.12 — M31 edge cases of the launcher (`npx claude4spec`): the bare command
 * and the start warnings of a listen address beyond loopback.
 */
describe('claude4spec launcher — M31 edge cases', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-launch-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('[ac:ac-gola-komenda-uruchomiona-w-katalogu-z] the bare command in a directory with an existing .claude4spec/config.json does not register it', () => {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repo, '.claude4spec'), { recursive: true });
    const configPath = path.join(repo, '.claude4spec', 'config.json');
    const config = JSON.stringify({ $schemaVersion: 4, name: 'Already Here' });
    fs.writeFileSync(configPath, config);
    const registry = new WorkspaceRegistry(path.join(tmp, 'home'));

    // Bare: no flag at all, run from inside the repo.
    const args = parseLaunchArgs([], repo);
    expect(args.cwd).toBe(repo);
    expect(args.createProject).toBe(false);

    const prepared = prepareStart(registry, args);
    expect(prepared.boot).toBeNull();
    expect(prepared.options.initialProject).toBeNull();
    const ws = prepared.workspace;
    const stored = registry.getWorkspace(ws.name)!;
    expect(stored.projects).toEqual([]);
    expect(stored.projects.some((p) => p.cwd === repo)).toBe(false);
    // Nothing is written into the CWD either.
    expect(fs.readFileSync(configPath, 'utf8')).toBe(config);
    expect(fs.readdirSync(path.join(repo, '.claude4spec'))).toEqual(['config.json']);

    // Contrast: an explicit opt-in is what registers a directory.
    expect(parseLaunchArgs(['--create-project'], repo).createProject).toBe(true);
    expect(parseLaunchArgs(['--cwd', '.'], repo).createProject).toBe(true);
  });

  it('[ac:ac-start-z-nasluchem-poza-loopbackiem-i] a start listening beyond loopback with no publicUrl warns that handed-out addresses will point at localhost', () => {
    const registry = new WorkspaceRegistry(path.join(tmp, 'home'));
    const base = openStartWorkspace(registry, { port: 4590 });
    const ws = applyNetworkFlags(registry, base, { host: '0.0.0.0' });
    expect(ws.publicUrl).toBeUndefined();

    const printed: string[] = [];
    const warnings = printStartWarnings(ws, (line) => printed.push(line));
    const localhostWarning = printed.find((l) => l.includes('no public URL is set'));
    expect(localhostWarning).toBeDefined();
    expect(localhostWarning).toContain('http://localhost:4590');
    expect(localhostWarning).toContain('MCP connection snippets');
    expect(warnings).toHaveLength(2); // + the no-authentication warning

    // The attribute persists, so the NEXT start (fresh read, no flags) warns again.
    const next = registry.getWorkspace(ws.name)!;
    expect(printStartWarnings(next, () => {}).some((w) => w.includes('localhost:4590'))).toBe(true);

    // An explicit publicUrl silences it; loopback never raises it.
    const withUrl = applyNetworkFlags(registry, next, { publicUrl: 'https://spec.example.com' });
    expect(printStartWarnings(withUrl, () => {}).some((w) => w.includes('no public URL'))).toBe(false);
    expect(printStartWarnings({ defaultPort: 4590 }, () => {})).toEqual([]);
  });
});

/**
 * 2.1.55 (M27 removed) — the M01 CLI flags: `--clone <slug>` is gone from the
 * parser and from the flags that imply `--create-project`; the remaining
 * per-project flags still register the CWD and open its project page.
 */
describe('claude4spec launcher — create-project flags (M01)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-launch-flags-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const IMPLYING: Array<[string, string[]]> = [
    ['--cwd', ['--cwd', 'proj']],
    ['--name', ['--name', 'Spec']],
    ['--pages', ['--pages', 'docs']],
    ['--remote-url', ['--remote-url', 'http://localhost:3001']],
  ];

  it('[entity:flagi-cli-m01#--clone <slug>] the parser no longer accepts --clone: neither form is read, and the argument carries no clone', () => {
    for (const argv of [['--clone', 'some-project'], ['--clone=some-project']]) {
      const args = parseLaunchArgs(argv, tmp);
      expect(Object.keys(args)).not.toContain('clone');
      expect(Object.values(args)).not.toContain('some-project');
      // Not a project flag any more: a start with only --clone is a workspace-only start.
      expect(args.createProject).toBe(false);
      expect(args.cwd).toBe(tmp);
    }
  });

  it('[entity:flagi-cli-m01#--create-project] --create-project is implied by --cwd/--name/--pages/--remote-url, and by --clone no longer', () => {
    expect(parseLaunchArgs([], tmp).createProject).toBe(false);
    expect(parseLaunchArgs(['--create-project'], tmp).createProject).toBe(true);
    for (const [flag, argv] of IMPLYING) {
      expect(parseLaunchArgs(argv, tmp).createProject, flag).toBe(true);
      // The `=` form implies it too.
      expect(parseLaunchArgs([`${argv[0]}=${argv[1]}`], tmp).createProject, `${flag}=`).toBe(true);
    }
    expect(parseLaunchArgs(['--clone', 'some-project'], tmp).createProject).toBe(false);
    expect(parseLaunchArgs(['--clone=some-project'], tmp).createProject).toBe(false);
    // Non-project flags never imply it.
    expect(parseLaunchArgs(['--port', '4599', '--no-open', '--mode', 'dev'], tmp).createProject).toBe(false);
  });

  it('[ac:ac-start-z-create-project-lub-flaga-impl] a start with --create-project or an implying flag registers the CWD as a workspace project and opens /p/<project-id>/', () => {
    const cases: string[][] = [['--create-project'], ...IMPLYING.map(([, argv]) => argv)];
    for (const [i, argv] of cases.entries()) {
      const base = path.join(tmp, `case-${i}`);
      fs.mkdirSync(base, { recursive: true });
      const registry = new WorkspaceRegistry(path.join(tmp, `home-${i}`));
      const args = parseLaunchArgs(argv, base);
      expect(args.createProject, argv.join(' ')).toBe(true);

      const ws = registry.selectOrCreate({ name: 'default' });
      const boot = bootstrapProject(registry, ws, args.cwd, { name: args.name, pagesDir: args.pagesDir, remoteApiUrl: args.remoteUrl });
      const stored = registry.getWorkspace('default')!;
      expect(stored.projects.map((p) => p.cwd), argv.join(' ')).toEqual([path.resolve(args.cwd)]);
      expect(stored.projects[0]!.id).toBe(boot.project.id);
      expect(projectStartUrl('http://127.0.0.1:4500', boot.project.id)).toBe(`http://127.0.0.1:4500/p/${boot.project.id}/`);
    }
  });

  it('[ac:ac-npx-inharness-ai-claude4spec-create] --create-project (or an implying flag) in an empty directory creates .claude4spec/config.json with defaults and the db slot <home>/<workspace>/<project-id>/db.sqlite, and the start opens /p/<project-id>/', () => {
    const home = path.join(tmp, 'home');
    const cwd = path.join(tmp, 'empty-project');
    fs.mkdirSync(cwd);
    expect(fs.readdirSync(cwd)).toEqual([]);

    const args = parseLaunchArgs(['--create-project'], cwd);
    expect(args.createProject).toBe(true);
    const registry = new WorkspaceRegistry(home);
    const ws = registry.selectOrCreate({ name: 'default' });
    const boot = bootstrapProject(registry, ws, args.cwd, { name: args.name, pagesDir: args.pagesDir, remoteApiUrl: args.remoteUrl });

    // config.json with the bootstrap defaults (name = folder, built-in pages root, onboarding open).
    expect(boot.configCreated).toBe(true);
    expect(boot.configPath).toBe(configPath(cwd));
    const onDisk = JSON.parse(fs.readFileSync(configPath(cwd), 'utf8')) as Record<string, unknown>;
    expect(onDisk.name).toBe('empty-project');
    expect(onDisk.roots).toEqual([{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true }]);
    expect(onDisk.onboardingCompleted).toBe(false);

    // The db slot lives in the workspace home, keyed by workspace and project id — never in the CWD.
    const slot = registry.slotDir(ws, boot.project.id);
    expect(slot).toBe(path.join(home, 'default', boot.project.id));
    const db = openDb(slot);
    try {
      expect(fs.existsSync(path.join(slot, 'db.sqlite'))).toBe(true);
    } finally {
      db.close();
    }
    expect(fs.existsSync(path.join(cwd, '.claude4spec', 'db.sqlite'))).toBe(false);

    expect(projectStartUrl('http://127.0.0.1:4500', boot.project.id)).toBe(`http://127.0.0.1:4500/p/${boot.project.id}/`);

    // The implying flags take the same path in an empty directory.
    const viaName = path.join(tmp, 'empty-named');
    fs.mkdirSync(viaName);
    const named = parseLaunchArgs(['--name', 'Named'], viaName);
    expect(named.createProject).toBe(true);
    const namedBoot = bootstrapProject(registry, ws, named.cwd, { name: named.name });
    expect(namedBoot.configCreated).toBe(true);
    expect((JSON.parse(fs.readFileSync(configPath(viaName), 'utf8')) as { name: string }).name).toBe('Named');
  });
});

/**
 * 2.1.58 (M31 `ssn335r8`) — the start of a workspace with a home, through the
 * launcher's own pre-listen sequence (`prepareStart`, which `claude4spec.ts`
 * runs before `startServer(prepared.options)`): `workspace.json` is read once,
 * strictly, after `.claude4spec/.gitignore` is ensured, and the server gets the
 * launcher's registry and view, so it reads nothing again.
 */
describe('claude4spec launcher — the start of a workspace with a home (M31 ssn335r8)', () => {
  let tmp: string;
  let registryHome: string;
  let home: string;
  let file: string;
  let gitignore: string;
  let gitignoreAtRead: boolean[];
  let read: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-launch-home-'));
    registryHome = path.join(tmp, 'registry');
    home = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(home, '.claude4spec'), { recursive: true });
    fs.mkdirSync(registryHome, { recursive: true });
    fs.writeFileSync(
      path.join(registryHome, 'workspaces.json'),
      JSON.stringify({ $schemaVersion: 3, workspaces: [{ name: 'team', mode: 'prod', defaultPort: 4611, home }] }),
    );
    file = workspaceFilePath(home);
    fs.writeFileSync(file, JSON.stringify({ projects: [{ id: 'app', path: 'specs/app' }], plugins: [] }));
    gitignore = path.join(home, '.claude4spec', '.gitignore');
    // Whether .gitignore was already in place at each read of workspace.json.
    gitignoreAtRead = [];
    const origRead = fs.readFileSync.bind(fs);
    read = vi.spyOn(fs, 'readFileSync').mockImplementation(((...a: Parameters<typeof fs.readFileSync>) => {
      if (a[0] === file) gitignoreAtRead.push(fs.existsSync(gitignore));
      return origRead(...a);
    }) as typeof fs.readFileSync);
  });
  afterEach(() => {
    read.mockRestore();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('[section:ssn335r8] a workspace-only start reads workspace.json once, after .gitignore, and hands its registry and view to startServer', () => {
    const registry = new WorkspaceRegistry(registryHome);
    const args = parseLaunchArgs(['--workspace', 'team', '--host', '0.0.0.0'], tmp);
    expect(args.createProject).toBe(false);

    const prepared = prepareStart(registry, args, (entry) => applyNetworkFlags(registry, entry, { host: args.host }));

    expect(gitignoreAtRead).toEqual([true]);
    expect(fs.readFileSync(gitignore, 'utf8')).toBe('local/\n');
    // The server serves through the launcher's registry and the opened view.
    expect(prepared.options.registry).toBe(registry);
    expect(prepared.options.workspace).toBe(prepared.workspace);
    expect(prepared.workspace.projects.map((p) => p.id)).toEqual(['app']);
    // The network flag landed on the entry before the view was opened.
    expect(prepared.workspace.bindHost).toBe('0.0.0.0');
    expect(prepared.options.host).toBe('0.0.0.0');
    expect(prepared.options.initialProject).toBeNull();
    expect(prepared.boot).toBeNull();

    // What startServer reads of the workspace afterwards reuses the view.
    registry.getWorkspace('team');
    registry.getProject(prepared.workspace, 'app');
    registry.listWorkspaces();
    expect(gitignoreAtRead).toEqual([true]);
  });

  it('[section:ssn335r8] a create-project start of a listed project reads workspace.json once, after .gitignore — the bootstrap and startServer read it no more', () => {
    const registry = new WorkspaceRegistry(registryHome);
    const cwd = path.join(home, 'specs', 'app');
    const args = parseLaunchArgs(['--workspace', 'team', '--cwd', cwd], tmp);
    expect(args.createProject).toBe(true);

    const prepared = prepareStart(registry, args);

    expect(gitignoreAtRead).toEqual([true]);
    expect(prepared.boot?.project.id).toBe('app');
    expect(prepared.options.initialProject?.id).toBe('app');
    expect(prepared.options.registry).toBe(registry);
    expect(prepared.options.workspace.projects.map((p) => p.id)).toEqual(['app']);
    // The slot under local/ exists — created after local/ was ignored.
    expect(fs.existsSync(path.join(home, '.claude4spec', 'local', 'app'))).toBe(true);
    // The committed file is untouched.
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ projects: [{ id: 'app', path: 'specs/app' }], plugins: [] });
    registry.getWorkspace('team');
    expect(gitignoreAtRead).toEqual([true]);
  });

  it('[section:ssn335r8] a create-project start of a new project validates the file once before its registration — every read comes after .gitignore', () => {
    const registry = new WorkspaceRegistry(registryHome);
    const cwd = path.join(home, 'services', 'billing');
    const prepared = prepareStart(registry, parseLaunchArgs(['--workspace', 'team', '--cwd', cwd], tmp));

    // The view's strict read, then the registration's read-modify-write under
    // the file's lock — no further read by the bootstrap or the server.
    expect(gitignoreAtRead).toEqual([true, true]);
    expect(prepared.options.initialProject?.id).toBe('billing');
    expect(prepared.options.workspace.projects.map((p) => p.id)).toEqual(['app', 'billing']);
    registry.getWorkspace('team');
    expect(gitignoreAtRead).toEqual([true, true]);
  });

  it('[section:ssn335r8] a broken workspace.json refuses the start before anything is created under local/', () => {
    fs.writeFileSync(file, '{ "projects": [ ');
    const registry = new WorkspaceRegistry(registryHome);
    const cwd = path.join(home, 'specs', 'app');
    expect(() => prepareStart(registry, parseLaunchArgs(['--workspace', 'team', '--cwd', cwd], tmp))).toThrow(
      WorkspaceFileError,
    );
    expect(gitignoreAtRead).toEqual([true]);
    expect(fs.existsSync(path.join(home, '.claude4spec', 'local'))).toBe(false);
    expect(fs.existsSync(path.join(cwd, '.claude4spec', 'config.json'))).toBe(false);
  });
});
