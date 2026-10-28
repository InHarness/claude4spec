import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from '../args.js';
import { CliError, codeToExit } from '../errors.js';
import { runTrustPlugins, trustPluginsCommand } from './trust-plugins.js';
import { WorkspaceRegistry } from '../../../server/workspace/registry.js';

/**
 * M31 `c4s trust-plugins` (mode `registry-write`), 2.1.58: a project of a
 * workspace with a home directory is trusted in the REGISTRY entry only; the
 * committed `workspace.json` and the project directory are never written.
 * Everything runs against a throwaway `C4S_HOME` and throwaway repos.
 */
describe('c4s trust-plugins', () => {
  let tmp: string;
  let registryHome: string;
  let registryFile: string;
  let prevHome: string | undefined;
  let stdout: string;
  let write: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-trust-plugins-')));
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

  /** A team repo with its committed description, registered as a workspace with a home. */
  function teamHome(projects: Array<{ id: string; path: string }>): { home: string; file: string } {
    const home = path.join(tmp, 'team-repo');
    for (const p of projects) {
      fs.mkdirSync(path.join(home, p.path, '.claude4spec'), { recursive: true });
      fs.writeFileSync(path.join(home, p.path, '.claude4spec', 'config.json'), '{}');
    }
    fs.mkdirSync(path.join(home, '.claude4spec'), { recursive: true });
    const file = path.join(home, '.claude4spec', 'workspace.json');
    fs.writeFileSync(file, JSON.stringify({ projects, plugins: [] }, null, 2));
    fs.mkdirSync(registryHome, { recursive: true });
    fs.writeFileSync(
      registryFile,
      JSON.stringify({ $schemaVersion: 3, workspaces: [{ name: 'team', mode: 'prod', defaultPort: 4700, home }] }),
    );
    return { home, file };
  }

  /** Every file under `dir`, with its bytes — to prove nothing was written there. */
  function snapshot(dir: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const entry of fs.readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isFile()) out[entry] = fs.readFileSync(full, 'utf8');
    }
    return out;
  }

  const registryEntry = (name: string): Record<string, unknown> =>
    (JSON.parse(fs.readFileSync(registryFile, 'utf8')) as { workspaces: Array<Record<string, unknown>> }).workspaces.find(
      (w) => w.name === name,
    )!;

  const refusal = async (argv: string[]): Promise<CliError> => {
    const err = await runTrustPlugins(parseArgs(argv)).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CliError);
    return err as CliError;
  };

  it('[entity:trust-plugins] registry-write; --cwd, --port, --mode; value true|false; codes INVALID_ARGS, REGISTRY_MIGRATION_PENDING, PROJECT_NOT_IN_WORKSPACE_FILE, WORKSPACE_FILE_INVALID; returns { workspace, projectId, cwd, trustProjectPlugins }', async () => {
    expect(trustPluginsCommand.executionMode).toBe('registry-write');
    expect(trustPluginsCommand.flags).toEqual(['cwd', 'port', 'mode']);
    expect(trustPluginsCommand.errorCodes).toEqual([
      'INVALID_ARGS',
      'REGISTRY_MIGRATION_PENDING',
      'PROJECT_NOT_IN_WORKSPACE_FILE',
      'WORKSPACE_FILE_INVALID',
    ]);
    expect(trustPluginsCommand.operation).toBeUndefined();

    // INVALID_ARGS: no --cwd; a value outside {true,false}; --mode outside {dev,prod}.
    expect((await refusal(['trust-plugins', 'true'])).code).toBe('INVALID_ARGS');
    expect((await refusal(['trust-plugins', '--cwd', tmp, 'yes'])).code).toBe('INVALID_ARGS');
    expect((await refusal(['trust-plugins', '--cwd', tmp, '--mode', 'staging', 'true'])).code).toBe('INVALID_ARGS');
    expect(fs.existsSync(registryFile)).toBe(false);

    // A registry workspace chosen by --port, created with it when none has it;
    // --mode seeds only the workspace it creates.
    const cwd = path.join(tmp, 'solo-spec');
    await runTrustPlugins(parseArgs(['trust-plugins', '--cwd', cwd, '--port', '4612', '--mode', 'dev', 'true']));
    expect(JSON.parse(stdout)).toEqual({ workspace: 'default', projectId: 'solo-spec', cwd, trustProjectPlugins: true });
    expect(registryEntry('default')).toMatchObject({ defaultPort: 4612, mode: 'dev' });
    stdout = '';
    await runTrustPlugins(parseArgs(['trust-plugins', '--cwd', cwd, '--port', '4612', '--mode', 'prod', 'false']));
    expect(JSON.parse(stdout)).toEqual({ workspace: 'default', projectId: 'solo-spec', cwd, trustProjectPlugins: false });
    expect(registryEntry('default')).toMatchObject({ defaultPort: 4612, mode: 'dev' });

    // Without --port the default 4500 selects (here: creates) the workspace.
    stdout = '';
    await runTrustPlugins(parseArgs(['trust-plugins', '--cwd', path.join(tmp, 'other'), 'true']));
    expect(JSON.parse(stdout)).toMatchObject({ projectId: 'other', trustProjectPlugins: true });
    const created = new WorkspaceRegistry(registryHome).findByPort(4500)!;
    expect(created.projects.map((p) => p.id)).toEqual(['other']);
  });

  it('[ac:ac-c4s-trust-plugins-cwd-dir-true-fal] [section:m31cli01] sets the machine-local trust in the global registry server-free — no server, no db slot, no write to the cwd files nor to workspace.json', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { home, file } = teamHome([{ id: 'app', path: 'specs/app' }]);
    const before = snapshot(home);

    await runTrustPlugins(parseArgs(['trust-plugins', '--cwd', path.join(home, 'specs', 'app'), 'true']));
    expect(JSON.parse(stdout)).toEqual({
      workspace: 'team',
      projectId: 'app',
      cwd: path.join(home, 'specs', 'app'),
      trustProjectPlugins: true,
    });
    // The consent lives in the registry entry, keyed by id with the relative path.
    expect(registryEntry('team').projectTrust).toEqual({ app: { path: 'specs/app', trustProjectPlugins: true } });
    expect(new WorkspaceRegistry(registryHome).getWorkspace('team')!.projects[0]).toMatchObject({
      id: 'app',
      trustProjectPlugins: true,
    });
    stdout = '';
    await runTrustPlugins(parseArgs(['trust-plugins', '--cwd', path.join(home, 'specs', 'app'), 'false']));
    expect(registryEntry('team').projectTrust).toEqual({ app: { path: 'specs/app', trustProjectPlugins: false } });

    // Nothing in the home — workspace.json, the project's own files, a slot
    // under local/ — was written; no server was asked.
    expect(snapshot(home)).toEqual(before);
    expect(fs.existsSync(path.join(home, '.claude4spec', 'local'))).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe(before['.claude4spec/workspace.json']);
    expect(fetchSpy).not.toHaveBeenCalled();

    // A registry workspace: the project directory gets no file either.
    const solo = path.join(tmp, 'solo-spec');
    fs.mkdirSync(solo, { recursive: true });
    await runTrustPlugins(parseArgs(['trust-plugins', '--cwd', solo, '--port', '4612', 'true']));
    expect(fs.readdirSync(solo)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('[ac:ac-c4s-trust-plugins-cwd-dir-dla-katalog] a --cwd inside a home that workspace.json does not list → PROJECT_NOT_IN_WORKSPACE_FILE before any mutation', async () => {
    const { home } = teamHome([{ id: 'app', path: 'specs/app' }]);
    const homeBefore = snapshot(home);
    const registryBefore = fs.readFileSync(registryFile, 'utf8');
    const stray = path.join(home, 'specs', 'not-listed');
    fs.mkdirSync(stray, { recursive: true });

    for (const dir of [stray, home]) {
      const err = await refusal(['trust-plugins', '--cwd', dir, 'true']);
      expect(err.code, dir).toBe('PROJECT_NOT_IN_WORKSPACE_FILE');
      expect(err.message).toContain("workspace 'team'");
      expect(err.hint).toContain('workspace.json');
      expect(err.details?.steps).toEqual([
        { action: 'add-project', where: 'server UI or workspace.json' },
        { action: 'rerun' },
      ]);
      expect(codeToExit(err.code)).toBeGreaterThan(0);
    }
    // Before any mutation: neither the registry (not even lastOpened) nor the home changed.
    expect(fs.readFileSync(registryFile, 'utf8')).toBe(registryBefore);
    expect(snapshot(home)).toEqual({ ...homeBefore });
    expect(stdout).toBe('');
  });

  it('[section:m31cli01] an unreadable workspace.json of the home --cwd lies in → WORKSPACE_FILE_INVALID before any mutation', async () => {
    const { home, file } = teamHome([{ id: 'app', path: 'specs/app' }]);
    fs.writeFileSync(file, '{ "projects": [ ');
    const registryBefore = fs.readFileSync(registryFile, 'utf8');

    const err = await refusal(['trust-plugins', '--cwd', path.join(home, 'specs', 'app'), 'true']);
    expect(err.code).toBe('WORKSPACE_FILE_INVALID');
    expect(err.message).toContain(file);
    expect(fs.readFileSync(registryFile, 'utf8')).toBe(registryBefore);
    expect(fs.readFileSync(file, 'utf8')).toBe('{ "projects": [ ');
  });

  it('[section:m31cli01] a --port naming the workspace with a home, for a directory outside that home, is refused instead of writing workspace.json', async () => {
    const { home } = teamHome([{ id: 'app', path: 'specs/app' }]);
    const homeBefore = snapshot(home);
    const err = await refusal(['trust-plugins', '--cwd', path.join(tmp, 'elsewhere'), '--port', '4700', 'true']);
    expect(err.code).toBe('INVALID_ARGS');
    expect(err.message).toContain("workspace 'team'");
    expect(snapshot(home)).toEqual(homeBefore);
  });
});
