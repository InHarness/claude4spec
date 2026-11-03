import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from '../args.js';
import { CliError, codeToExit } from '../errors.js';
import { confirmSkillUsesCommand, runConfirmSkillUses } from './confirm-skill-uses.js';
import { runRegisterHome } from './register-home.js';
import { WorkspaceRegistry } from '../../../server/workspace/registry.js';
import { snapshotDir } from '../../../../tests/helpers/dir-snapshot.js';

/**
 * M31 `c4s confirm-skill-uses` (2.1.67, mode `registry-write`): the
 * machine-local confirmation of a project's skill attachments, written into the
 * global registry server-free. The project resolves from `--cwd` as in
 * `trust-plugins`. Runs against a throwaway `C4S_HOME` and throwaway repos.
 */
describe('c4s confirm-skill-uses', () => {
  let tmp: string;
  let registryHome: string;
  let registryFile: string;
  let prevHome: string | undefined;
  let stdout: string;
  let write: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-confirm-skill-uses-')));
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

  /** A cloned team repo whose project lists `uses` in its `skill.uses`, registered with `register-home`. */
  async function registeredTeamRepo(uses: string[]): Promise<{ home: string; projectDir: string }> {
    const home = path.join(tmp, 'team-repo');
    const projectDir = path.join(home, 'specs', 'app');
    fs.mkdirSync(path.join(projectDir, '.claude4spec'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.claude4spec', 'config.json'), JSON.stringify({ name: 'app', skill: { uses } }));
    fs.mkdirSync(path.join(home, '.claude4spec'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.claude4spec', 'workspace.json'),
      JSON.stringify({ projects: [{ id: 'app', path: 'specs/app' }], plugins: [] }, null, 2),
    );
    await runRegisterHome(parseArgs(['register-home', '--cwd', home, '--port', '4700']));
    stdout = '';
    return { home, projectDir };
  }

  const registryText = (): string | null => (fs.existsSync(registryFile) ? fs.readFileSync(registryFile, 'utf8') : null);
  const entry = (name: string): Record<string, unknown> =>
    (JSON.parse(fs.readFileSync(registryFile, 'utf8')) as { workspaces: Array<Record<string, unknown>> }).workspaces.find(
      (w) => w.name === name,
    )!;

  const run = async (argv: string[]): Promise<Record<string, unknown>> => {
    stdout = '';
    await runConfirmSkillUses(parseArgs(argv));
    return JSON.parse(stdout) as Record<string, unknown>;
  };

  const refusal = async (argv: string[]): Promise<CliError> => {
    const err = await runConfirmSkillUses(parseArgs(argv)).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CliError);
    return err as CliError;
  };

  it('[entity:confirm-skill-uses] registry-write; names (repeatable) | --clear, --cwd, --port; returns { workspace, projectId, cwd, confirmedSkillUses, notInSkillUses }; every error code before mutation on a generic exit > 0', async () => {
    expect(confirmSkillUsesCommand.name).toBe('confirm-skill-uses');
    expect(confirmSkillUsesCommand.executionMode).toBe('registry-write');
    expect(confirmSkillUsesCommand.operation).toBeUndefined();
    expect(confirmSkillUsesCommand.flags).toEqual(['cwd', 'port', 'clear']);
    expect(confirmSkillUsesCommand.errorCodes).toEqual([
      'INVALID_ARGS',
      'REGISTRY_MIGRATION_PENDING',
      'PROJECT_NOT_IN_WORKSPACE_FILE',
      'WORKSPACE_FILE_INVALID',
    ]);
    expect(confirmSkillUsesCommand.output?.fields).toEqual([
      'workspace',
      'projectId',
      'cwd',
      'confirmedSkillUses',
      'notInSkillUses',
    ]);

    const { home, projectDir } = await registeredTeamRepo(['spec-style', 'shared-glossary']);
    const expectRefused = async (argv: string[], code: string): Promise<CliError> => {
      const before = registryText();
      const err = await refusal(argv);
      expect(err.code, argv.join(' ')).toBe(code);
      expect(codeToExit(err.code), code).toBeGreaterThan(0);
      expect(registryText(), `${code} changed the registry`).toBe(before);
      return err;
    };

    // INVALID_ARGS: no --cwd; neither names nor --clear; both at once.
    await expectRefused(['confirm-skill-uses', 'spec-style'], 'INVALID_ARGS');
    await expectRefused(['confirm-skill-uses', '--cwd', projectDir], 'INVALID_ARGS');
    await expectRefused(['confirm-skill-uses', '--cwd', projectDir, '--clear', 'spec-style'], 'INVALID_ARGS');
    // PROJECT_NOT_IN_WORKSPACE_FILE: inside the home, not listed.
    const stray = path.join(home, 'specs', 'stray');
    fs.mkdirSync(stray, { recursive: true });
    const notListed = await expectRefused(['confirm-skill-uses', '--cwd', stray, 'spec-style'], 'PROJECT_NOT_IN_WORKSPACE_FILE');
    expect(notListed.details?.steps).toEqual([{ action: 'add-project', where: 'server UI or workspace.json' }, { action: 'rerun' }]);

    // The payload: repeated names, the list stored whole.
    expect(await run(['confirm-skill-uses', '--cwd', projectDir, 'spec-style', 'shared-glossary'])).toEqual({
      workspace: 'team-repo',
      projectId: 'app',
      cwd: projectDir,
      confirmedSkillUses: ['spec-style', 'shared-glossary'],
      notInSkillUses: [],
    });
    // --clear stores the list empty.
    expect(await run(['confirm-skill-uses', '--cwd', projectDir, '--clear'])).toMatchObject({ confirmedSkillUses: [] });
    expect((entry('team-repo').projectTrust as Record<string, { confirmedSkillUses: string[] }>).app!.confirmedSkillUses).toEqual([]);

    // WORKSPACE_FILE_INVALID: the home's description no longer reads.
    const file = path.join(home, '.claude4spec', 'workspace.json');
    fs.writeFileSync(file, '{ "projects": [ ');
    await expectRefused(['confirm-skill-uses', '--cwd', projectDir, 'spec-style'], 'WORKSPACE_FILE_INVALID');

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
    await expectRefused(['confirm-skill-uses', '--cwd', path.join(tmp, 'solo'), 'spec-style'], 'REGISTRY_MIGRATION_PENDING');
  });

  it('[ac:ac-c4s-confirm-skill-uses-cwd-dir-name-z] confirm-skill-uses --cwd <dir> <name> writes the confirmation of <name> into the registry without a running server', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { home, projectDir } = await registeredTeamRepo(['spec-style']);
    const homeBefore = snapshotDir(home);

    const out = await run(['confirm-skill-uses', '--cwd', projectDir, 'spec-style']);

    expect(out).toMatchObject({ workspace: 'team-repo', projectId: 'app', confirmedSkillUses: ['spec-style'] });
    // In the registry entry, keyed by id with the relative path…
    expect(entry('team-repo').projectTrust).toEqual({ app: { path: 'specs/app', confirmedSkillUses: ['spec-style'] } });
    expect(new WorkspaceRegistry(registryHome).getWorkspace('team-repo')!.projects[0]).toMatchObject({
      id: 'app',
      confirmedSkillUses: ['spec-style'],
    });
    // …not in the repo, and no server was asked.
    expect(snapshotDir(home)).toEqual(homeBefore);
    expect(fetchSpy).not.toHaveBeenCalled();

    // A registry workspace project too (default --port 4500, created on demand).
    const solo = path.join(tmp, 'solo-spec');
    fs.mkdirSync(path.join(solo, '.claude4spec'), { recursive: true });
    fs.writeFileSync(path.join(solo, '.claude4spec', 'config.json'), JSON.stringify({ name: 'solo-spec' }));
    expect(await run(['confirm-skill-uses', '--cwd', solo, 'spec-style'])).toMatchObject({
      projectId: 'solo-spec',
      confirmedSkillUses: ['spec-style'],
    });
    expect(new WorkspaceRegistry(registryHome).findByPort(4500)!.projects[0]).toMatchObject({
      id: 'solo-spec',
      confirmedSkillUses: ['spec-style'],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('[ac:ac-c4s-confirm-skill-uses-z-nazwa-spoza] a name outside the skill.name syntax → INVALID_ARGS, the registry unchanged', async () => {
    const { projectDir } = await registeredTeamRepo(['spec-style']);
    await run(['confirm-skill-uses', '--cwd', projectDir, 'spec-style']);
    const before = fs.readFileSync(registryFile, 'utf8');

    for (const bad of ['Spec_Style', 'spec--style', 'spec style', '-spec']) {
      const err = await refusal(['confirm-skill-uses', '--cwd', projectDir, 'shared-glossary', bad]);
      expect(err.code, bad).toBe('INVALID_ARGS');
      expect(err.message, bad).toContain(bad);
      expect(codeToExit(err.code)).toBeGreaterThan(0);
      expect(fs.readFileSync(registryFile, 'utf8'), bad).toBe(before);
    }
    expect(stdout).toBe('');
  });

  it('[ac:ac-c4s-confirm-skill-uses-zwraca-w-notin] returns in notInSkillUses a confirmed name the project skill.uses does not carry', async () => {
    const { projectDir } = await registeredTeamRepo(['spec-style']);

    const out = await run(['confirm-skill-uses', '--cwd', projectDir, 'spec-style', 'stranger']);

    expect(out.confirmedSkillUses).toEqual(['spec-style', 'stranger']);
    expect(out.notInSkillUses).toEqual(['stranger']);
    // Accepted all the same: the stranger is stored.
    expect(new WorkspaceRegistry(registryHome).getWorkspace('team-repo')!.projects[0]!.confirmedSkillUses).toEqual([
      'spec-style',
      'stranger',
    ]);
  });
});
