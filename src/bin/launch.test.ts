import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry } from '../server/workspace/registry.js';
import { applyNetworkFlags } from '../server/workspace/network-flags.js';
import { WorkspaceFileError, workspaceFilePath } from '../server/workspace/home-workspace.js';
import { WorkspaceSelectionError, type WorkspaceSelectionErrorCode } from '../server/workspace/start-selection.js';
import { effectivePublicUrl, localServerUrl } from '../core/workspace/network.js';
import type { StoredWorkspaceRecord, WorkspacesFile } from '../server/workspace/types.js';
import { openStartWorkspace, parseLaunchArgs, prepareStart, printStartWarnings, type CliArgs } from './launch.js';

/** The refusal a start gets, with its code. */
function refusal(fn: () => unknown): WorkspaceSelectionError {
  try {
    fn();
  } catch (err) {
    if (err instanceof WorkspaceSelectionError) return err;
    throw err;
  }
  throw new Error('expected a WorkspaceSelectionError');
}

function expectRefused(fn: () => unknown, code: WorkspaceSelectionErrorCode): WorkspaceSelectionError {
  const err = refusal(fn);
  expect(err.code).toBe(code);
  return err;
}

/** The registry file as stored on disk (not the composed view). */
function storedEntries(registryHome: string): StoredWorkspaceRecord[] {
  const file = path.join(registryHome, 'workspaces.json');
  if (!fs.existsSync(file)) return [];
  return (JSON.parse(fs.readFileSync(file, 'utf8')) as WorkspacesFile).workspaces;
}

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

  it('[ac:ac-gola-komenda-uruchomiona-w-katalogu-z] the bare command run in a project directory that is in no workspace does not register it', () => {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repo, '.claude4spec'), { recursive: true });
    const configPath = path.join(repo, '.claude4spec', 'config.json');
    const config = JSON.stringify({ $schemaVersion: 4, name: 'Already Here' });
    fs.writeFileSync(configPath, config);
    const registryHome = path.join(tmp, 'home');
    const registry = new WorkspaceRegistry(registryHome);

    // Bare: no flag at all, run from inside the project.
    const prepared = prepareStart(registry, parseLaunchArgs([], repo));
    expect(prepared.workspace.projects).toEqual([]);
    // In no workspace — neither as a project nor as a home.
    for (const ws of registry.listWorkspaces()) {
      expect(ws.projects.some((p) => path.resolve(p.cwd) === repo)).toBe(false);
      expect(ws.home).toBeUndefined();
    }
    // Nothing is written into the directory either.
    expect(fs.readFileSync(configPath, 'utf8')).toBe(config);
    expect(fs.readdirSync(path.join(repo, '.claude4spec'))).toEqual(['config.json']);
    expect(fs.readdirSync(repo)).toEqual(['.claude4spec']);
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
 * 2.1.58 (M01 `r7ozfsa9`, sheet `flagi-cli-m01`) — the start flags concern the
 * workspace and the process, never a project: each row's default and where
 * its value goes. No flag carries project configuration or registers a
 * directory as a project.
 */
describe('claude4spec launcher — start flags (M01 flagi-cli-m01)', () => {
  let tmp: string;
  let registryHome: string;
  let registry: WorkspaceRegistry;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-launch-flags-'));
    registryHome = path.join(tmp, 'registry');
    registry = new WorkspaceRegistry(registryHome);
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const start = (argv: string[], launchDir: string = tmp, network?: Parameters<typeof prepareStart>[2]) =>
    prepareStart(registry, parseLaunchArgs(argv, launchDir), network);
  const ARG_KEYS: Array<keyof CliArgs> = ['port', 'cwd', 'launchDir', 'mode', 'workspace', 'noOpen', 'remoteUrl', 'host', 'publicUrl'];

  it('[entity:flagi-cli-m01] the parser reads exactly the sheet\'s flags — --create-project, --name, --pages and --clone are not read, and a start with them registers nothing', () => {
    expect(Object.keys(parseLaunchArgs([], tmp)).sort()).toEqual([...ARG_KEYS].sort());
    const launchDir = path.join(tmp, 'launch');
    fs.mkdirSync(launchDir);
    for (const argv of [
      ['--create-project'],
      ['--name', 'Spec'],
      ['--name=Spec'],
      ['--pages', 'docs'],
      ['--pages=docs'],
      ['--clone', 'some-project'],
    ]) {
      const args = parseLaunchArgs(argv, launchDir);
      expect(Object.keys(args).sort(), argv.join(' ')).toEqual([...ARG_KEYS].sort());
      expect(Object.values(args), argv.join(' ')).not.toContain('Spec');
      expect(Object.values(args), argv.join(' ')).not.toContain('docs');
      expect(Object.values(args), argv.join(' ')).not.toContain('some-project');
      expect(args.cwd, argv.join(' ')).toBeUndefined();
      const prepared = prepareStart(registry, args);
      expect(prepared.workspace.projects, argv.join(' ')).toEqual([]);
    }
    expect(fs.readdirSync(launchDir)).toEqual([]);
  });

  it('[entity:flagi-cli-m01#--cwd] --cwd has no default (the selection rule decides) and goes nowhere by itself — only the registry entry it creates records it as the home', () => {
    expect(parseLaunchArgs([], tmp).cwd).toBeUndefined();
    expect(parseLaunchArgs(['--cwd', 'repo'], tmp).cwd).toBe(path.join(tmp, 'repo'));
    expect(parseLaunchArgs(['--cwd=repo'], tmp).cwd).toBe(path.join(tmp, 'repo'));

    const home = path.join(tmp, 'repo');
    const prepared = start(['--cwd', 'repo']);
    expect(prepared.workspace.home).toBe(home);
    expect(storedEntries(registryHome).find((w) => w.name === prepared.workspace.name)?.home).toBe(home);
    // The committed description names no path — the home is the registry entry's attribute.
    expect(JSON.parse(fs.readFileSync(workspaceFilePath(home), 'utf8'))).toEqual({ projects: [], plugins: [] });
    expect(prepared.options.cwd).toBe(tmp);
  });

  it('[entity:flagi-cli-m01#--workspace] --workspace has no default (the selection rule decides) and goes to the registry as the name of a new entry', () => {
    expect(parseLaunchArgs([], tmp).workspace).toBeUndefined();
    expect(parseLaunchArgs(['--workspace=team'], tmp).workspace).toBe('team');
    const prepared = start(['--workspace', 'team']);
    expect(prepared.workspace.name).toBe('team');
    expect(storedEntries(registryHome).map((w) => w.name)).toEqual(['team']);
    expect(prepared.workspace.home).toBeUndefined();
  });

  it('[entity:flagi-cli-m01#--port] --port defaults to the first free port from 4500 among the entries and goes to the registry entry as defaultPort', () => {
    expect(parseLaunchArgs([], tmp).port).toBeUndefined();
    expect(start(['--workspace', 'first']).options.port).toBe(4500);
    expect(start(['--workspace', 'second']).options.port).toBe(4501);
    expect(start(['--workspace', 'third', '--port', '4700']).workspace.defaultPort).toBe(4700);
    expect(storedEntries(registryHome).map((w) => [w.name, w.defaultPort])).toEqual([
      ['first', 4500],
      ['second', 4501],
      ['third', 4700],
    ]);
    // The next new entry fills the gap from 4500 up.
    expect(start(['--workspace', 'fourth']).options.port).toBe(4502);
  });

  it('[entity:flagi-cli-m01#--host] --host defaults to loopback and goes to the registry entry as bindHost', () => {
    const network = (args: CliArgs) => (entry: StoredWorkspaceRecord) =>
      applyNetworkFlags(registry, entry, { host: args.host, publicUrl: args.publicUrl });
    const bareArgs = parseLaunchArgs(['--workspace', 'w'], tmp);
    expect(bareArgs.host).toBeUndefined();
    expect(prepareStart(registry, bareArgs, network(bareArgs)).options.host).toBe('127.0.0.1');

    const args = parseLaunchArgs(['--workspace', 'w', '--host', '0.0.0.0'], tmp);
    const prepared = prepareStart(registry, args, network(args));
    expect(prepared.options.host).toBe('0.0.0.0');
    expect(storedEntries(registryHome)[0]!.bindHost).toBe('0.0.0.0');
    // `--host=` restores the default.
    const reset = parseLaunchArgs(['--workspace', 'w', '--host='], tmp);
    expect(prepareStart(registry, reset, network(reset)).options.host).toBe('127.0.0.1');
    expect(storedEntries(registryHome)[0]!.bindHost).toBeUndefined();
  });

  it('[entity:flagi-cli-m01#--public-url] --public-url defaults to http://localhost:<port> and goes to the registry entry as publicUrl', () => {
    const network = (args: CliArgs) => (entry: StoredWorkspaceRecord) =>
      applyNetworkFlags(registry, entry, { host: args.host, publicUrl: args.publicUrl });
    const bare = parseLaunchArgs(['--workspace', 'w'], tmp);
    expect(bare.publicUrl).toBeUndefined();
    const byDefault = prepareStart(registry, bare, network(bare));
    expect(storedEntries(registryHome)[0]!.publicUrl).toBeUndefined();
    expect(effectivePublicUrl(byDefault.workspace)).toBe('http://localhost:4500');

    const args = parseLaunchArgs(['--workspace', 'w', '--public-url', 'https://spec.example.com'], tmp);
    const prepared = prepareStart(registry, args, network(args));
    expect(prepared.workspace.publicUrl).toBe('https://spec.example.com');
    expect(storedEntries(registryHome)[0]!.publicUrl).toBe('https://spec.example.com');
  });

  it('[entity:flagi-cli-m01#--mode] --mode defaults to prod and goes to the registry entry as mode — of a new entry only', () => {
    expect(parseLaunchArgs([], tmp).mode).toBeUndefined();
    expect(start(['--workspace', 'p']).mode).toBe('prod');
    expect(start(['--workspace', 'd', '--mode', 'dev']).mode).toBe('dev');
    expect(storedEntries(registryHome).map((w) => [w.name, w.mode])).toEqual([
      ['p', 'prod'],
      ['d', 'dev'],
    ]);
    expect(() => parseLaunchArgs(['--mode', 'fast'], tmp)).toThrow(/--mode must be 'dev' or 'prod'/);
  });

  it('[entity:flagi-cli-m01#--no-open] --no-open defaults to false and goes nowhere — the stored entry is the same with and without it', () => {
    expect(parseLaunchArgs([], tmp).noOpen).toBe(false);
    expect(parseLaunchArgs(['--no-open'], tmp).noOpen).toBe(true);
    start(['--workspace', 'a']);
    start(['--workspace', 'b', '--no-open']);
    const [a, b] = storedEntries(registryHome);
    expect(Object.keys(b!).sort()).toEqual(Object.keys(a!).sort());
    expect(fs.readFileSync(path.join(registryHome, 'workspaces.json'), 'utf8')).not.toMatch(/open"\s*:\s*(true|false)/i);
  });

  it('[entity:flagi-cli-m01#--remote-url] --remote-url has no default and goes nowhere — the process gets it, no file records it', () => {
    expect(parseLaunchArgs([], tmp).remoteUrl).toBeUndefined();
    expect(start([]).options.remoteApiUrl).toBeUndefined();
    const launchDir = path.join(tmp, 'launch');
    fs.mkdirSync(launchDir);
    const prepared = start(['--remote-url', 'https://staging.example'], launchDir);
    expect(prepared.options.remoteApiUrl).toBe('https://staging.example');
    expect(fs.readFileSync(path.join(registryHome, 'workspaces.json'), 'utf8')).not.toContain('staging.example');
    expect(fs.readdirSync(launchDir)).toEqual([]);
  });

  it('[section:3ebblo1q] --remote-url is validated once at the start with the remoteApiUrl rule (http/https URL); an invalid value refuses, an empty one is absent', () => {
    for (const argv of [['--remote-url', 'https://staging.example'], ['--remote-url=http://localhost:3001']]) {
      const value = argv.length === 2 ? argv[1] : argv[0]!.slice('--remote-url='.length);
      expect(parseLaunchArgs(argv, tmp).remoteUrl, argv.join(' ')).toBe(value);
    }
    // Not an http(s) URL → the parse throws (the launcher prints INVALID_ARGS and exits 1).
    for (const argv of [['--remote-url', 'foo'], ['--remote-url=foo'], ['--remote-url', 'ftp://example.com']]) {
      expect(() => parseLaunchArgs(argv, tmp), argv.join(' ')).toThrow(/^--remote-url must be an http\(s\) URL, got '/);
    }
    // An address carrying userinfo is refused the same way (ASSUMPTION:dev-0802).
    for (const argv of [['--remote-url', 'https://user:secret@staging.example'], ['--remote-url=https://user@staging.example']]) {
      expect(() => parseLaunchArgs(argv, tmp), argv.join(' ')).toThrow(/^--remote-url must be an http\(s\) URL, got '/);
    }
    // An empty value is no override: config.remoteApiUrl still applies downstream (`??`).
    for (const argv of [['--remote-url='], ['--remote-url=  ']]) {
      const args = parseLaunchArgs(argv, tmp);
      expect(args.remoteUrl, argv.join(' ')).toBeUndefined();
    }
    // The validated value is what the server gets; an empty one reaches it as absent.
    expect(start(['--remote-url=https://staging.example']).options.remoteApiUrl).toBe('https://staging.example');
    expect(start(['--remote-url=']).options.remoteApiUrl).toBeUndefined();
  });
});

/**
 * 2.1.58 (M31 `m31wsel01`, flag combinations `qglsgonq`) — the start's
 * workspace selection rule, through the launcher's own pre-listen sequence.
 */
describe('claude4spec launcher — workspace selection at start (M31 m31wsel01)', () => {
  let tmp: string;
  let registryHome: string;
  let registry: WorkspaceRegistry;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-launch-select-'));
    registryHome = path.join(tmp, 'registry');
    registry = new WorkspaceRegistry(registryHome);
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const start = (argv: string[], launchDir: string = tmp) => prepareStart(registry, parseLaunchArgs(argv, launchDir));
  const dir = (...segments: string[]) => {
    const d = path.join(tmp, ...segments);
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  const names = () => storedEntries(registryHome).map((w) => w.name);

  it('[ac:ac-cwd-dir-na-katalogu-ktory-nie-jest-ho] --cwd on a directory that is no entry\'s home creates a registry entry with that home', () => {
    start(['--workspace', 'default']);
    const repo = dir('team-repo');
    const prepared = start(['--cwd', repo]);
    const entry = storedEntries(registryHome).find((w) => w.name === prepared.workspace.name)!;
    expect(entry.home).toBe(repo);
    expect(entry.projects).toBeUndefined();
    expect(names()).toEqual(['default', 'team-repo']);
    // Selected and served: the view of that home.
    expect(prepared.workspace.home).toBe(repo);
    expect(prepared.options.workspace).toBe(prepared.workspace);
  });

  it('[ac:ac-cwd-home-wybiera-workspace-default] --cwd $HOME selects workspace default', () => {
    const fakeHome = dir('user-home');
    const homedir = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    try {
      start(['--workspace', 'other']);
      const prepared = start(['--cwd', fakeHome]);
      expect(prepared.workspace.name).toBe('default');
      expect(prepared.workspace.home).toBeUndefined();
      // No entry got $HOME as its home.
      expect(storedEntries(registryHome).some((w) => w.home !== undefined)).toBe(false);
      expect(names()).toEqual(['other', 'default']);
      // The same with --workspace default; another name is refused.
      expect(start(['--workspace', 'default', '--cwd', fakeHome]).workspace.name).toBe('default');
      expectRefused(() => start(['--workspace', 'other', '--cwd', fakeHome]), 'WORKSPACE_HOME_MISMATCH');
    } finally {
      homedir.mockRestore();
    }
  });

  it('[ac:ac-cwd-wskazujace-istniejacy-wpis-urucho] --cwd naming an existing entry, run with another --port, persists that entry\'s new defaultPort', () => {
    const repo = dir('repo');
    const first = start(['--cwd', repo]);
    expect(first.options.port).toBe(4500);

    const again = start(['--cwd', repo, '--port', '4777']);
    expect(again.workspace.name).toBe(first.workspace.name);
    expect(again.options.port).toBe(4777);
    // Persisted: a fresh registry reads the new port, and no second entry appeared.
    expect(new WorkspaceRegistry(registryHome).getWorkspace(first.workspace.name)!.defaultPort).toBe(4777);
    expect(names()).toEqual([first.workspace.name]);
    // The next start without --port keeps it.
    expect(start(['--cwd', repo]).options.port).toBe(4777);
  });

  it('[ac:ac-cwd-wskazujace-katalog-projektu-z-cla] --cwd naming a project directory (with .claude4spec/config.json) is refused with CWD_IS_PROJECT', () => {
    const repo = dir('mono');
    fs.mkdirSync(path.join(repo, '.git'));
    const project = dir('mono', 'specs', 'app');
    fs.mkdirSync(path.join(project, '.claude4spec'));
    fs.writeFileSync(path.join(project, '.claude4spec', 'config.json'), '{}');

    const err = expectRefused(() => start(['--cwd', project]), 'CWD_IS_PROJECT');
    expect(err.message).toContain(project);
    // The hint names the repository directory above the project.
    expect(err.hint).toContain(`--cwd ${repo}`);
    // Nothing was written: no entry, no workspace description in the project.
    expect(names()).toEqual([]);
    expect(fs.readdirSync(path.join(project, '.claude4spec'))).toEqual(['config.json']);
  });

  it('[ac:ac-cwd-wskazujace-podkatalog-katalogu-do] --cwd naming a subdirectory of an existing entry\'s home is refused with CWD_INSIDE_HOME and the home as hint', () => {
    const home = dir('repo');
    start(['--cwd', home]);
    const sub = dir('repo', 'services');

    const err = expectRefused(() => start(['--cwd', sub]), 'CWD_INSIDE_HOME');
    expect(err.message).toContain(home);
    expect(err.hint).toBe(`pass --cwd ${home}`);
    expect(names()).toEqual(['repo']);
    expect(fs.existsSync(workspaceFilePath(sub))).toBe(false);
  });

  it('[ac:ac-cwd-wskazuje-na-nieistniejacy-katalo] --cwd naming a directory that does not exist creates it as the home of a new entry', () => {
    const home = path.join(tmp, 'not', 'yet');
    expect(fs.existsSync(home)).toBe(false);
    const prepared = start(['--cwd', home]);
    expect(fs.statSync(home).isDirectory()).toBe(true);
    expect(prepared.workspace.home).toBe(home);
    expect(storedEntries(registryHome).find((w) => w.name === prepared.workspace.name)!.home).toBe(home);
    // Its description exists from the start: the view opened on it, .gitignore covers local/.
    expect(JSON.parse(fs.readFileSync(workspaceFilePath(home), 'utf8'))).toEqual({ projects: [], plugins: [] });
    expect(fs.readFileSync(path.join(home, '.claude4spec', '.gitignore'), 'utf8')).toBe('local/\n');
  });

  it('[ac:ac-gola-komenda-npx-inharness-ai-claude4-2] the bare command run outside any home creates no file or directory in the CWD — no .claude4spec/, no config, no db slot', () => {
    start(['--workspace', 'default']);
    const plain = dir('plain');
    const prepared = start([], plain);
    expect(prepared.workspace.name).toBe('default');
    expect(fs.readdirSync(plain)).toEqual([]);
    // A fresh registry too: the bare start creates `default` in the registry, never in the CWD.
    const fresh = new WorkspaceRegistry(path.join(tmp, 'fresh-registry'));
    const other = dir('plain-2');
    prepareStart(fresh, parseLaunchArgs([], other));
    expect(fs.readdirSync(other)).toEqual([]);
  });

  it('[ac:ac-gola-komenda-npx-inharness-ai-claude4] the bare command run inside the home of a registered workspace selects that workspace', () => {
    start(['--workspace', 'default']);
    const home = dir('team-repo');
    const team = start(['--cwd', home, '--workspace', 'team']);
    expect(team.workspace.name).toBe('team');
    start(['--workspace', 'default']); // most recently opened is `default` again

    const deep = dir('team-repo', 'services', 'billing');
    expect(start([], deep).workspace.name).toBe('team');
    expect(start([], home).workspace.name).toBe('team');
    // Outside the home the bare command falls back to `default`.
    expect(start([], dir('elsewhere')).workspace.name).toBe('default');
  });

  it('[ac:ac-mode-dev-prod-seeduje-pole-mode-wy] --mode seeds mode only of a newly created workspace; for an existing one it is ignored', () => {
    const created = start(['--workspace', 'w', '--mode', 'dev']);
    expect(created.mode).toBe('dev');
    expect(created.options.mode).toBe('dev');

    const existing = start(['--workspace', 'w', '--mode', 'prod']);
    expect(existing.mode).toBe('dev');
    expect(existing.options.mode).toBe('dev');
    expect(storedEntries(registryHome)[0]!.mode).toBe('dev');
  });

  it('[ac:ac-nowy-wpis-tworzony-z-cwd-ktorego-nazw] a new entry created from --cwd whose name collides with an existing entry gets the suffix -2', () => {
    start(['--workspace', 'repo']);
    const repo = dir('elsewhere', 'repo');
    const prepared = start(['--cwd', repo]);
    expect(prepared.workspace.name).toBe('repo-2');
    expect(prepared.workspace.home).toBe(repo);
    // A third directory of the same name: -3.
    expect(start(['--cwd', dir('third', 'repo')]).workspace.name).toBe('repo-3');
  });

  it('[ac:ac-port-3000-uzywa-portu-3000-dla-insta] --port 3000 without --cwd and --workspace starts the process listening on 3000, the selected workspace\'s port', () => {
    const prepared = start(['--port', '3000']);
    expect(prepared.workspace.defaultPort).toBe(3000);
    expect(prepared.options.port).toBe(3000);
    // The next start with that port selects the same workspace.
    expect(start(['--port=3000']).workspace.name).toBe(prepared.workspace.name);
  });

  it('[ac:ac-port-n-podany-z-workspace-albo-cwd-gd] --port n with --workspace or --cwd, when n is another entry\'s defaultPort, is refused with PORT_TAKEN_BY_WORKSPACE', () => {
    start(['--workspace', 'a', '--port', '4600']);
    start(['--workspace', 'b', '--port', '4601']);
    const home = dir('repo');
    start(['--cwd', home, '--port', '4602']);
    const before = fs.readFileSync(path.join(registryHome, 'workspaces.json'), 'utf8');

    expect(expectRefused(() => start(['--workspace', 'a', '--port', '4601']), 'PORT_TAKEN_BY_WORKSPACE').message).toContain("'b'");
    expectRefused(() => start(['--cwd', home, '--port', '4601']), 'PORT_TAKEN_BY_WORKSPACE');
    // New entries too: neither is created on a taken port.
    expectRefused(() => start(['--workspace', 'c', '--port', '4600']), 'PORT_TAKEN_BY_WORKSPACE');
    expectRefused(() => start(['--cwd', dir('other-repo'), '--port', '4600']), 'PORT_TAKEN_BY_WORKSPACE');
    // Nothing changed.
    expect(fs.readFileSync(path.join(registryHome, 'workspaces.json'), 'utf8')).toBe(before);
    expect(fs.existsSync(workspaceFilePath(path.join(tmp, 'other-repo')))).toBe(false);
  });

  it('[ac:ac-port-n-wybiera-workspace-ktorego] --port n without --workspace and --cwd selects the workspace whose defaultPort is n, and with no match creates a registry workspace with defaultPort n', () => {
    start(['--workspace', 'default']);
    start(['--workspace', 'b', '--port', '4601']);
    expect(start(['--port', '4601']).workspace.name).toBe('b');
    expect(start(['--port', '4601']).options.port).toBe(4601);

    const created = start(['--port', '4700']);
    expect(created.workspace.defaultPort).toBe(4700);
    expect(created.workspace.name).toBe('ws-4700');
    const entry = storedEntries(registryHome).find((w) => w.name === 'ws-4700')!;
    expect(entry.home).toBeUndefined();
    expect(entry.projects).toEqual([]);
    // A bare --port never overrides: the existing port selects, the others keep theirs.
    expect(storedEntries(registryHome).map((w) => [w.name, w.defaultPort])).toEqual([
      ['default', 4500],
      ['b', 4601],
      ['ws-4700', 4700],
    ]);
  });

  it('[ac:ac-start-procesu-ktorego-lastopenedproje] a start whose lastOpenedProject names a project no longer in the workspace opens /welcome', () => {
    const ws = start(['--workspace', 'default']).workspace;
    const project = registry.registerProject(ws, dir('spec'));
    registry.touchLastOpened('default', project.id);
    expect(start(['--workspace', 'default']).openPath).toBe(`/p/${project.id}/`);

    registry.removeProject(registry.getWorkspace('default')!, project.id);
    const prepared = start(['--workspace', 'default']);
    expect(prepared.workspace.lastOpenedProject).toBe(project.id);
    expect(prepared.openPath).toBe('/welcome');
  });

  it('[ac:ac-start-procesu-otwiera-w-przegladarce] the start opens the local address of the workspace\'s last opened project', () => {
    const ws = start(['--workspace', 'default']).workspace;
    const a = registry.registerProject(ws, dir('a'));
    const b = registry.registerProject(registry.getWorkspace('default')!, dir('b'));
    registry.touchLastOpened('default', b.id);
    registry.touchLastOpened('default', a.id);
    applyNetworkFlags(registry, storedEntries(registryHome)[0]!, { publicUrl: 'https://spec.example.com' });

    const prepared = start(['--workspace', 'default']);
    expect(prepared.openPath).toBe(`/p/${a.id}/`);
    // The local address (loopback :defaultPort), never publicUrl — what `startServer` returns as `url`.
    const local = localServerUrl({ defaultPort: prepared.options.port, bindHost: prepared.options.host });
    expect(`${local}${prepared.openPath}`).toBe(`http://localhost:4500/p/${a.id}/`);
    expect(`${local}${prepared.openPath}`).not.toContain('spec.example.com');
  });

  it('[ac:ac-start-procesu-w-workspace-ie-bez-osta] a start in a workspace with no last opened project opens /welcome', () => {
    const prepared = start(['--workspace', 'default']);
    expect(prepared.workspace.lastOpenedProject).toBeUndefined();
    expect(prepared.openPath).toBe('/welcome');
    // Projects alone do not change it — only an opened one does.
    registry.registerProject(prepared.workspace, dir('spec'));
    expect(start(['--workspace', 'default']).openPath).toBe('/welcome');
  });

  it('[ac:ac-workspace-x-cwd-y-gdy-x-ma-inny-katal] --workspace X --cwd Y, when X has another home or is a registry workspace, is refused with WORKSPACE_HOME_MISMATCH', () => {
    start(['--workspace', 'reg']);
    const h1 = dir('repo-1');
    const h2 = dir('repo-2');
    start(['--workspace', 'team', '--cwd', h1]);
    const before = fs.readFileSync(path.join(registryHome, 'workspaces.json'), 'utf8');

    // X is a registry workspace.
    expect(expectRefused(() => start(['--workspace', 'reg', '--cwd', h2]), 'WORKSPACE_HOME_MISMATCH').message).toContain('registry workspace');
    // X has another home.
    expect(expectRefused(() => start(['--workspace', 'team', '--cwd', h2]), 'WORKSPACE_HOME_MISMATCH').hint).toContain(h1);
    // Y is the home of another entry.
    expectRefused(() => start(['--workspace', 'fresh', '--cwd', h1]), 'WORKSPACE_HOME_MISMATCH');
    expect(fs.readFileSync(path.join(registryHome, 'workspaces.json'), 'utf8')).toBe(before);
    expect(fs.existsSync(workspaceFilePath(h2))).toBe(false);
  });

  it('[ac:ac-workspace-x-uruchomione-wewnatrz-kata] --workspace X run inside the home of another workspace selects X', () => {
    const home = dir('team-repo');
    start(['--cwd', home, '--workspace', 'team']);
    const inside = dir('team-repo', 'specs');
    expect(start([], inside).workspace.name).toBe('team');
    expect(start(['--workspace', 'solo'], inside).workspace.name).toBe('solo');
    expect(start(['--workspace', 'solo'], home).workspace.name).toBe('solo');
  });

  it('[section:qglsgonq] the flag combination table: --workspace X --cwd Y creates X with home Y or selects X when its home is Y; --port with --workspace / --cwd creates with that port or overrides and persists it', () => {
    const y = dir('y');
    // --workspace X --cwd Y, no X → new X with home Y.
    const created = start(['--workspace', 'x', '--cwd', y]);
    expect([created.workspace.name, created.workspace.home]).toEqual(['x', y]);
    // --workspace X --cwd Y, X has home Y → X.
    expect(start(['--workspace', 'x', '--cwd', y]).workspace.name).toBe('x');
    // --workspace X --port n, no X → new registry X with defaultPort n.
    const reg = start(['--workspace', 'r', '--port', '4650']);
    expect([reg.workspace.home, reg.options.port]).toEqual([undefined, 4650]);
    // --workspace X --port n, X has another port → X, port overridden and persisted.
    expect(start(['--workspace', 'r', '--port', '4651']).options.port).toBe(4651);
    expect(new WorkspaceRegistry(registryHome).getWorkspace('r')!.defaultPort).toBe(4651);
    // --cwd Y --port n, no entry with home Y → new entry with home Y and defaultPort n.
    const z = dir('z');
    const withPort = start(['--cwd', z, '--port', '4660']);
    expect([withPort.workspace.home, withPort.options.port]).toEqual([z, 4660]);
    // --cwd Y --port n, the entry with home Y has another port → that entry, overridden.
    expect(start(['--cwd', z, '--port', '4661']).workspace.name).toBe(withPort.workspace.name);
    expect(new WorkspaceRegistry(registryHome).getWorkspace(withPort.workspace.name)!.defaultPort).toBe(4661);
  });

  it('[section:m31wsel01] the walk-up of a bare command registers an unregistered home as with --cwd, keeping its description; the bare pick skips a home whose directory is gone', () => {
    // A cloned team repository: workspace.json exists, no registry entry.
    const clone = dir('clone');
    fs.mkdirSync(path.join(clone, '.claude4spec'), { recursive: true });
    const description = JSON.stringify({ projects: [{ id: 'app', path: 'app' }], plugins: [] });
    fs.writeFileSync(workspaceFilePath(clone), description);
    const prepared = start([], dir('clone', 'app'));
    expect(prepared.workspace.name).toBe('clone');
    expect(prepared.workspace.home).toBe(clone);
    expect(prepared.workspace.projects.map((p) => p.id)).toEqual(['app']);
    expect(fs.readFileSync(workspaceFilePath(clone), 'utf8')).toBe(description);

    // Step 5: with the clone deleted, the sole remaining candidate is a new `default`.
    fs.rmSync(clone, { recursive: true, force: true });
    const bare = start([], dir('plain'));
    expect(bare.workspace.name).toBe('default');
    expect(bare.workspace.home).toBeUndefined();
    // The deleted home's entry stays (c4s list-workspaces marks it).
    expect(names()).toEqual(['clone', 'default']);
  });

  it('[section:m31wsel01] the bare pick with no candidate left never creates a second entry with a taken name — a skipped `default` leaves the new registry entry `ws-<port>`', () => {
    // The only entry is `default` with a home (`--workspace default --cwd X`), then X is deleted.
    const home = dir('x');
    const first = start(['--workspace', 'default', '--cwd', home]);
    expect([first.workspace.name, first.workspace.home, first.options.port]).toEqual(['default', home, 4500]);
    fs.rmSync(home, { recursive: true, force: true });

    const bare = start([], dir('plain'));
    expect(bare.workspace.name).toBe('ws-4501');
    expect(bare.workspace.home).toBeUndefined();
    expect(bare.options.port).toBe(4501);
    // Names stay unique: the skipped `default` keeps its home and port, untouched.
    const entries = storedEntries(registryHome);
    expect(entries.map((w) => [w.name, w.home, w.defaultPort])).toEqual([
      ['default', home, 4500],
      ['ws-4501', undefined, 4501],
    ]);
    expect(new Set(entries.map((w) => w.name)).size).toBe(entries.length);
    // The next bare start selects that entry again — no third one.
    expect(start([], dir('plain')).workspace.name).toBe('ws-4501');
    expect(names()).toEqual(['default', 'ws-4501']);
  });

  it('[section:m31wsel01] the bare pick with no candidate left skips a free port whose `ws-<port>` name an entry keeps after moving to another port', () => {
    // `default` and `ws-4501` both have homes, later deleted; `ws-4501` moved to port 4800, so 4501 is free while the name is taken.
    const x = dir('x');
    const y = dir('y');
    start(['--workspace', 'default', '--cwd', x]);
    start(['--workspace', 'ws-4501', '--cwd', y, '--port', '4800']);
    fs.rmSync(x, { recursive: true, force: true });
    fs.rmSync(y, { recursive: true, force: true });

    const bare = start([], dir('plain'));
    expect(bare.workspace.name).toBe('ws-4502');
    expect(bare.workspace.home).toBeUndefined();
    expect(bare.options.port).toBe(4502);
    const entries = storedEntries(registryHome);
    expect(entries.map((w) => [w.name, w.home, w.defaultPort])).toEqual([
      ['default', x, 4500],
      ['ws-4501', y, 4800],
      ['ws-4502', undefined, 4502],
    ]);
    expect(new Set(entries.map((w) => w.name)).size).toBe(entries.length);
    expect(new Set(entries.map((w) => w.defaultPort)).size).toBe(entries.length);
    // The next bare start selects that entry again.
    expect(start([], dir('plain')).workspace.name).toBe('ws-4502');
    expect(names()).toEqual(['default', 'ws-4501', 'ws-4502']);
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

  it('[section:ssn335r8] a start by name reads workspace.json once, after .gitignore, and hands its registry and view to startServer', () => {
    const registry = new WorkspaceRegistry(registryHome);
    const args = parseLaunchArgs(['--workspace', 'team', '--host', '0.0.0.0'], tmp);

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

    // What startServer reads of the workspace afterwards reuses the view.
    registry.getWorkspace('team');
    registry.getProject(prepared.workspace, 'app');
    registry.listWorkspaces();
    expect(gitignoreAtRead).toEqual([true]);
  });

  it('[section:ssn335r8] a start by the home (--cwd) or the walk-up reads workspace.json once, after .gitignore — the selection only probes for the file', () => {
    const registry = new WorkspaceRegistry(registryHome);
    const prepared = prepareStart(registry, parseLaunchArgs(['--cwd', home], tmp));
    expect(prepared.workspace.name).toBe('team');
    expect(gitignoreAtRead).toEqual([true]);
    expect(prepared.options.workspace.projects.map((p) => p.id)).toEqual(['app']);
    // The committed file is untouched.
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ projects: [{ id: 'app', path: 'specs/app' }], plugins: [] });
    registry.getWorkspace('team');
    expect(gitignoreAtRead).toEqual([true]);

    // A bare command inside the home (a fresh process): the walk-up selects, the view reads once.
    gitignoreAtRead.length = 0;
    const next = new WorkspaceRegistry(registryHome);
    fs.mkdirSync(path.join(home, 'specs', 'app'), { recursive: true });
    expect(prepareStart(next, parseLaunchArgs([], path.join(home, 'specs', 'app'))).workspace.name).toBe('team');
    expect(gitignoreAtRead).toEqual([true]);
  });

  it('[section:ssn335r8] a project added after the start is written under the file\'s lock — the view itself is not read again', () => {
    const registry = new WorkspaceRegistry(registryHome);
    const prepared = prepareStart(registry, parseLaunchArgs(['--workspace', 'team'], tmp));
    const billing = registry.registerProject(prepared.workspace, path.join(home, 'services', 'billing'));

    // The view's strict read, then the registration's read-modify-write under the lock.
    expect(gitignoreAtRead).toEqual([true, true]);
    expect(billing.id).toBe('billing');
    expect(registry.getWorkspace('team')!.projects.map((p) => p.id)).toEqual(['app', 'billing']);
    expect(gitignoreAtRead).toEqual([true, true]);
  });

  it('[section:ssn335r8] a broken workspace.json refuses the start before anything is created under local/', () => {
    fs.writeFileSync(file, '{ "projects": [ ');
    const registry = new WorkspaceRegistry(registryHome);
    expect(() => prepareStart(registry, parseLaunchArgs(['--cwd', home], tmp))).toThrow(WorkspaceFileError);
    expect(gitignoreAtRead).toEqual([true]);
    expect(fs.existsSync(path.join(home, '.claude4spec', 'local'))).toBe(false);
  });
});
