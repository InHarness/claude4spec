import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from '../args.js';
import { CliError, codeToExit } from '../errors.js';
import { registerHomeCommand, runRegisterHome } from './register-home.js';
import { WorkspaceRegistry } from '../../../server/workspace/registry.js';
import { parseLaunchArgs, prepareStart } from '../../launch.js';
import { snapshotDir } from '../../../../tests/helpers/dir-snapshot.js';

/**
 * M31 `c4s register-home` (2.1.67, mode `registry-write`): registers an
 * EXISTING workspace home in the global registry without a server. Everything
 * runs against a throwaway `C4S_HOME` and throwaway repos; "exit code 0" is the
 * handler resolving (the bin's `main()` then returns normally), a refusal is a
 * `CliError` whose code `codeToExit` maps to a status > 0.
 */
describe('c4s register-home', () => {
  let tmp: string;
  let registryHome: string;
  let registryFile: string;
  let prevHome: string | undefined;
  let stdout: string;
  let write: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-register-home-')));
    registryHome = path.join(tmp, 'registry');
    registryFile = path.join(registryHome, 'workspaces.json');
    prevHome = process.env.C4S_HOME;
    process.env.C4S_HOME = registryHome;
    stdout = '';
    write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    write.mockRestore();
    vi.unstubAllGlobals();
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  /** A cloned team repo: its committed description and one project, no registry entry. */
  function teamRepo(name = 'team-repo', projects: Array<{ id: string; path: string }> = [{ id: 'app', path: 'specs/app' }]): string {
    const home = path.join(tmp, name);
    for (const p of projects) {
      fs.mkdirSync(path.join(home, p.path, '.claude4spec'), { recursive: true });
      fs.writeFileSync(path.join(home, p.path, '.claude4spec', 'config.json'), '{}');
    }
    fs.mkdirSync(path.join(home, '.claude4spec'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude4spec', 'workspace.json'), JSON.stringify({ projects, plugins: [] }, null, 2));
    return home;
  }

  const registryText = (): string | null => (fs.existsSync(registryFile) ? fs.readFileSync(registryFile, 'utf8') : null);
  const entries = (): Array<Record<string, unknown>> =>
    (JSON.parse(fs.readFileSync(registryFile, 'utf8')) as { workspaces: Array<Record<string, unknown>> }).workspaces;

  const run = async (argv: string[]): Promise<Record<string, unknown>> => {
    stdout = '';
    await runRegisterHome(parseArgs(argv));
    return JSON.parse(stdout) as Record<string, unknown>;
  };

  const refusal = async (argv: string[]): Promise<CliError> => {
    const err = await runRegisterHome(parseArgs(argv)).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CliError);
    return err as CliError;
  };

  it('[entity:register-home] registry-write; --cwd, --workspace, --port; returns { workspace, home, defaultPort, created }; every error code refused before mutation on a generic exit > 0', async () => {
    expect(registerHomeCommand.name).toBe('register-home');
    expect(registerHomeCommand.executionMode).toBe('registry-write');
    expect(registerHomeCommand.operation).toBeUndefined();
    expect(registerHomeCommand.flags).toEqual(['cwd', 'workspace', 'port']);
    expect(registerHomeCommand.errorCodes).toEqual([
      'INVALID_ARGS',
      'REGISTRY_MIGRATION_PENDING',
      'WORKSPACE_FILE_MISSING',
      'WORKSPACE_FILE_INVALID',
      'CWD_IS_PROJECT',
      'CWD_INSIDE_HOME',
      'WORKSPACE_HOME_MISMATCH',
      'PORT_TAKEN_BY_WORKSPACE',
    ]);
    expect(registerHomeCommand.output?.fields).toEqual(['workspace', 'home', 'defaultPort', 'created']);

    const home = teamRepo();
    const expectRefused = async (argv: string[], code: string): Promise<CliError> => {
      const before = registryText();
      const err = await refusal(argv);
      expect(err.code, argv.join(' ')).toBe(code);
      expect(codeToExit(err.code), code).toBeGreaterThan(0);
      expect(registryText(), `${code} changed the registry`).toBe(before);
      return err;
    };

    // INVALID_ARGS: no --cwd, a --port that is no number.
    await expectRefused(['register-home'], 'INVALID_ARGS');
    await expectRefused(['register-home', '--cwd', home, '--port', 'abc'], 'INVALID_ARGS');
    // WORKSPACE_FILE_MISSING, with the structured repair steps.
    const bare = path.join(tmp, 'bare');
    fs.mkdirSync(bare);
    const missing = await expectRefused(['register-home', '--cwd', bare], 'WORKSPACE_FILE_MISSING');
    expect(missing.details?.steps).toBeDefined();
    // WORKSPACE_FILE_INVALID.
    const broken = path.join(tmp, 'broken');
    fs.mkdirSync(path.join(broken, '.claude4spec'), { recursive: true });
    fs.writeFileSync(path.join(broken, '.claude4spec', 'workspace.json'), '{ "projects": [ ');
    await expectRefused(['register-home', '--cwd', broken], 'WORKSPACE_FILE_INVALID');
    // CWD_IS_PROJECT: the directory is a project (config.json), even with a description.
    const projectDir = teamRepo('project-dir', []);
    fs.writeFileSync(path.join(projectDir, '.claude4spec', 'config.json'), '{}');
    await expectRefused(['register-home', '--cwd', projectDir], 'CWD_IS_PROJECT');

    // The happy path, payload shape.
    const out = await run(['register-home', '--cwd', home, '--port', '4700']);
    expect(out).toEqual({ workspace: 'team-repo', home, defaultPort: 4700, created: true });

    // CWD_INSIDE_HOME: a described directory inside the registered home.
    const nested = teamRepo(path.join('team-repo', 'nested'), []);
    await expectRefused(['register-home', '--cwd', nested], 'CWD_INSIDE_HOME');
    // WORKSPACE_HOME_MISMATCH: --workspace names the entry of another home.
    const other = teamRepo('other-repo', []);
    await expectRefused(['register-home', '--cwd', other, '--workspace', 'team-repo'], 'WORKSPACE_HOME_MISMATCH');
    // PORT_TAKEN_BY_WORKSPACE: --port is the defaultPort of another entry.
    await expectRefused(['register-home', '--cwd', other, '--port', '4700'], 'PORT_TAKEN_BY_WORKSPACE');
    // REGISTRY_MIGRATION_PENDING: pre-2.1.0 hash ids — only the server migrates.
    fs.writeFileSync(
      registryFile,
      JSON.stringify({
        $schemaVersion: 2,
        workspaces: [
          {
            name: 'default',
            mode: 'prod',
            defaultPort: 4500,
            projects: [{ cwd: path.join(tmp, 'old'), id: '0123abcd', name: 'old', addedAt: '2026-01-01T00:00:00.000Z' }],
          },
        ],
      }),
    );
    const pending = await expectRefused(['register-home', '--cwd', other], 'REGISTRY_MIGRATION_PENDING');
    expect(pending.details?.steps).toEqual([
      { action: 'start-server', command: 'npx @inharness-ai/claude4spec' },
      { action: 'rerun' },
    ]);
  });

  it('[ac:ac-c4s-register-home-cwd-dir-w-pustym-ho] [section:m31cli01] in an empty HOME creates the registry entry with home <dir>, without a running server', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const home = teamRepo();
    expect(fs.existsSync(registryFile)).toBe(false);

    const out = await run(['register-home', '--cwd', home]);

    expect(out).toEqual({ workspace: 'team-repo', home, defaultPort: 4500, created: true });
    expect(entries()).toEqual([{ name: 'team-repo', home, mode: 'prod', defaultPort: 4500 }]);
    expect(new WorkspaceRegistry(registryHome).getWorkspace('team-repo')).toMatchObject({ home });
    // No server was addressed.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('[ac:ac-c4s-register-home-cwd-dir-na-katalogu] a directory without .claude4spec/workspace.json → WORKSPACE_FILE_MISSING, the registry unchanged', async () => {
    const dir = path.join(tmp, 'no-description');
    fs.mkdirSync(dir);
    // Empty HOME: the registry file must not even be created.
    let err = await refusal(['register-home', '--cwd', dir]);
    expect(err.code).toBe('WORKSPACE_FILE_MISSING');
    expect(codeToExit(err.code)).toBeGreaterThan(0);
    expect(fs.existsSync(registryFile)).toBe(false);

    // With an existing registry: byte-identical afterwards.
    await run(['register-home', '--cwd', teamRepo()]);
    const before = fs.readFileSync(registryFile, 'utf8');
    err = await refusal(['register-home', '--cwd', dir]);
    expect(err.code).toBe('WORKSPACE_FILE_MISSING');
    expect(fs.readFileSync(registryFile, 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(dir, '.claude4spec'))).toBe(false);
  });

  it('[ac:ac-c4s-register-home-cwd-home-konczy-sie] --cwd $HOME → INVALID_ARGS', async () => {
    const err = await refusal(['register-home', '--cwd', os.homedir()]);
    expect(err.code).toBe('INVALID_ARGS');
    expect(err.message).toContain('home directory');
    expect(codeToExit(err.code)).toBeGreaterThan(0);
    expect(fs.existsSync(registryFile)).toBe(false);
  });

  it('[ac:ac-c4s-register-home-nie-tworzy-ani-nie] creates and changes no file in <dir>', async () => {
    const home = teamRepo();
    const before = snapshotDir(home);

    await run(['register-home', '--cwd', home]);
    await run(['register-home', '--cwd', home, '--port', '4610']);

    expect(snapshotDir(home)).toEqual(before);
    // Not even the machine-local parts a server start would add.
    expect(fs.existsSync(path.join(home, '.claude4spec', 'local'))).toBe(false);
    expect(fs.existsSync(path.join(home, '.gitignore'))).toBe(false);
  });

  it('[ac:ac-powtorzone-c4s-register-home-cwd-dir] a repeated register-home returns created: false with exit code 0', async () => {
    const home = teamRepo();
    expect(await run(['register-home', '--cwd', home])).toMatchObject({ created: true });
    const registryAfterFirst = fs.readFileSync(registryFile, 'utf8');

    // Resolves (exit 0) and reports the entry as already there.
    stdout = '';
    await expect(runRegisterHome(parseArgs(['register-home', '--cwd', home]))).resolves.toBeUndefined();
    expect(JSON.parse(stdout)).toEqual({ workspace: 'team-repo', home, defaultPort: 4500, created: false });
    expect(fs.readFileSync(registryFile, 'utf8')).toBe(registryAfterFirst);
    expect(entries()).toHaveLength(1);
  });

  it('[ac:ac-start-serwera-z-cwd-home-port-n-po-c4] a server start with --cwd <home> --port <n> after register-home --port <n> selects the entry register-home created', async () => {
    const home = teamRepo();
    await run(['register-home', '--cwd', home, '--port', '4650']);
    const registered = entries();

    const prepared = prepareStart(new WorkspaceRegistry(registryHome), parseLaunchArgs(['--cwd', home, '--port', '4650'], tmp));

    expect(prepared.workspace.name).toBe('team-repo');
    expect(prepared.workspace.home).toBe(home);
    expect(prepared.workspace.defaultPort).toBe(4650);
    expect(prepared.workspace.projects.map((p) => p.id)).toEqual(['app']);
    // No second entry, no refusal: the same entry was selected.
    expect(entries().map((w) => w.name)).toEqual(registered.map((w) => w.name));
    expect(entries()).toHaveLength(1);
  });
});
