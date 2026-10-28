import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from '../args.js';
import { CliError, codeToExit } from '../errors.js';
import { listWorkspacesCommand, runListWorkspaces } from './list-workspaces.js';
import type { WorkspacesFile } from '../../../server/workspace/types.js';
import { dirEntries } from '../../../../tests/helpers/dir-snapshot.js';

/**
 * M31 `c4s list-workspaces` — the one command whose whole point is answering
 * BEFORE a server exists. Nothing here starts one, and nothing here mocks the
 * registry: the assertions are against a real `workspaces.json` under a
 * throwaway `C4S_HOME`, because "reads the file with no server" is the claim.
 */
describe('c4s list-workspaces', () => {
  let home: string;
  let prevHome: string | undefined;
  let write: ReturnType<typeof vi.spyOn>;
  let stdout: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-list-workspaces-'));
    prevHome = process.env.C4S_HOME;
    process.env.C4S_HOME = home;
    stdout = '';
    write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    write.mockRestore();
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  /** Hand-writes the registry, so a record can lack `lastOpened` — which the
   *  mutating API never produces, and which is exactly the ordering edge case. */
  function seed(file: WorkspacesFile): void {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'workspaces.json'), JSON.stringify(file, null, 2), 'utf8');
  }

  function seedThree(): void {
    seed({
      $schemaVersion: 2,
      workspaces: [
        {
          name: 'never-opened',
          mode: 'prod',
          defaultPort: 4700,
          projects: [],
          plugins: ['@c4s/plugin-x'],
        },
        {
          name: 'older',
          mode: 'dev',
          defaultPort: 4600,
          lastOpened: '2026-01-01T00:00:00.000Z',
          projects: [{ cwd: '/a', id: 'a', addedAt: '2026-01-01T00:00:00.000Z' }],
        },
        {
          name: 'newer',
          mode: 'prod',
          defaultPort: 4500,
          lastOpened: '2026-06-01T00:00:00.000Z',
          projects: [
            { cwd: '/b', id: 'b', addedAt: '2026-01-01T00:00:00.000Z' },
            { cwd: '/c', id: 'c', addedAt: '2026-01-01T00:00:00.000Z' },
          ],
        },
      ],
    });
  }

  const printed = () => JSON.parse(stdout) as Array<Record<string, unknown>>;

  /**
   * 2.1.58 — a workspace with a home directory: the registry entry keeps only
   * the machine-local attributes, its composition lives in the committed
   * `<home>/.claude4spec/workspace.json`.
   */
  function makeHome(name: string, workspaceFile: unknown): string {
    const dir = path.join(home, 'repos', name);
    fs.mkdirSync(path.join(dir, '.claude4spec'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.claude4spec', 'workspace.json'),
      typeof workspaceFile === 'string' ? workspaceFile : JSON.stringify(workspaceFile),
      'utf8',
    );
    return dir;
  }

  it('[entity:list-workspaces] registry-read, no flags of its own, REGISTRY_READ_FAILED, rows { name, kind, home, mode, defaultPort, bindHost, publicUrl, projectCount, lastOpened, state }', async () => {
    expect(listWorkspacesCommand.executionMode).toBe('registry-read');
    expect(listWorkspacesCommand.flags).toEqual([]);
    expect(listWorkspacesCommand.errorCodes).toEqual(['REGISTRY_READ_FAILED']);
    expect(listWorkspacesCommand.output).toEqual({
      unit: 'workspace',
      fields: ['name', 'kind', 'home', 'mode', 'defaultPort', 'bindHost', 'publicUrl', 'projectCount', 'lastOpened', 'state'],
    });
    // It renders no catalog operation — that is the half of the item-26
    // invariant a server-free mode has to satisfy.
    expect(listWorkspacesCommand.operation).toBeUndefined();

    const team = makeHome('team', { projects: [{ id: 'app', path: 'specs/app' }, { id: 'api', path: 'api' }], plugins: [] });
    seed({
      $schemaVersion: 3,
      workspaces: [
        {
          name: 'solo',
          mode: 'prod',
          defaultPort: 4500,
          bindHost: '0.0.0.0',
          lastOpened: '2026-06-01T00:00:00.000Z',
          projects: [{ cwd: '/b', id: 'b', addedAt: '2026-01-01T00:00:00.000Z' }],
        },
        {
          name: 'team',
          mode: 'dev',
          defaultPort: 4800,
          publicUrl: 'https://specs.example.com',
          lastOpened: '2026-05-01T00:00:00.000Z',
          home: team,
        },
      ],
    });
    await runListWorkspaces(parseArgs(['list-workspaces']));
    expect(printed()).toEqual([
      {
        name: 'solo',
        kind: 'registry',
        mode: 'prod',
        defaultPort: 4500,
        bindHost: '0.0.0.0',
        // effective: no stored publicUrl reads as the loopback default
        publicUrl: 'http://localhost:4500',
        projectCount: 1,
        lastOpened: '2026-06-01T00:00:00.000Z',
        state: 'ok',
      },
      {
        name: 'team',
        kind: 'home',
        home: team,
        mode: 'dev',
        defaultPort: 4800,
        publicUrl: 'https://specs.example.com',
        // the entries of workspace.json, not a projects[] of the entry
        projectCount: 2,
        lastOpened: '2026-05-01T00:00:00.000Z',
        state: 'ok',
      },
    ]);
    for (const row of printed()) {
      expect(row).not.toHaveProperty('projects');
      expect(row).not.toHaveProperty('plugins');
    }
  });

  it('[ac:ac-c4s-list-workspaces-wypisuje-wszystki] prints every workspace in the registry, of both kinds, with no server running', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const team = makeHome('team', { projects: [{ id: 'app', path: 'app' }], plugins: [] });
      seed({
        $schemaVersion: 3,
        workspaces: [
          { name: 'solo', mode: 'prod', defaultPort: 4500, projects: [] },
          { name: 'team', mode: 'prod', defaultPort: 4800, home: team },
        ],
      });
      await runListWorkspaces(parseArgs(['list-workspaces']));
      expect(printed().map((r) => [r.name, r.kind])).toEqual([
        ['solo', 'registry'],
        ['team', 'home'],
      ]);
      // No server is asked anything — the answer comes from the files alone.
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }

    stdout = '';
    seedThree();
    await runListWorkspaces(parseArgs(['list-workspaces']));
    expect(printed().map((r) => r.name)).toEqual(
      expect.arrayContaining(['newer', 'older', 'never-opened']),
    );
    expect(printed()).toHaveLength(3);
  });

  it('[ac:ac-kazdy-wiersz-wyjscia-c4s-list-workspa] every row carries name, kind, mode, defaultPort, projectCount, lastOpened and state', async () => {
    const team = makeHome('team', { projects: [], plugins: [] });
    seed({
      $schemaVersion: 3,
      workspaces: [
        { name: 'solo', mode: 'prod', defaultPort: 4500, lastOpened: '2026-06-01T00:00:00.000Z', projects: [] },
        { name: 'team', mode: 'dev', defaultPort: 4800, lastOpened: '2026-05-01T00:00:00.000Z', home: team },
      ],
    });
    await runListWorkspaces(parseArgs(['list-workspaces']));
    expect(printed()).toHaveLength(2);
    for (const row of printed()) {
      for (const key of ['name', 'kind', 'mode', 'defaultPort', 'projectCount', 'lastOpened', 'state']) {
        expect(row, `${String(row.name)}.${key}`).toHaveProperty(key);
      }
      expect(row.state).toBe('ok');
      expect(typeof row.projectCount).toBe('number');
    }
    // `home` only on the row of a workspace with a home.
    expect(printed().find((r) => r.name === 'team')).toMatchObject({ kind: 'home', home: team, projectCount: 0 });
    expect(printed().find((r) => r.name === 'solo')).not.toHaveProperty('home');

    // A workspace never opened has no timestamp to carry — the key is absent, not empty.
    stdout = '';
    seedThree();
    await runListWorkspaces(parseArgs(['list-workspaces']));
    const never = printed().find((r) => r.name === 'never-opened')!;
    expect(never.projectCount).toBe(0);
    expect(never.lastOpened).toBeUndefined();
  });

  it('[ac:ac-c4s-list-workspaces-oznacza-wpis-ktor] marks an entry whose home directory does not exist as home-missing, projectCount null', async () => {
    const gone = path.join(home, 'repos', 'deleted-checkout');
    seed({
      $schemaVersion: 3,
      workspaces: [
        { name: 'solo', mode: 'prod', defaultPort: 4500, projects: [] },
        { name: 'gone', mode: 'prod', defaultPort: 4800, home: gone },
      ],
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(runListWorkspaces(parseArgs(['list-workspaces']))).resolves.toBeUndefined();
      expect(printed().find((r) => r.name === 'gone')).toMatchObject({
        kind: 'home',
        home: gone,
        state: 'home-missing',
        projectCount: null,
      });
      expect(printed().find((r) => r.name === 'solo')).toMatchObject({ state: 'ok', projectCount: 0 });
      // A moved checkout is not a broken file: nothing to repair is reported.
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
    expect(fs.existsSync(gone)).toBe(false);
  });

  it('[section:459ucmfg] an entry whose workspace.json does not validate is listed as workspace-file-invalid, projectCount null, the refusal on stderr; the file is only read', async () => {
    const team = makeHome('team', '{ "projects": [ ');
    const file = path.join(team, '.claude4spec', 'workspace.json');
    const before = fs.readFileSync(file, 'utf8');
    seed({
      $schemaVersion: 3,
      workspaces: [{ name: 'team', mode: 'prod', defaultPort: 4800, home: team }],
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await runListWorkspaces(parseArgs(['list-workspaces']));
      expect(printed()).toEqual([
        expect.objectContaining({ name: 'team', kind: 'home', state: 'workspace-file-invalid', projectCount: null }),
      ]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('WORKSPACE_FILE_INVALID'));
    } finally {
      warn.mockRestore();
    }
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(dirEntries(path.join(team, '.claude4spec'))).toEqual(['workspace.json']);
  });

  it('[ac:ac-wyjscie-c4s-list-workspaces-jest-poso] sorts descending by lastOpened, never-opened workspaces last', async () => {
    seedThree();
    await runListWorkspaces(parseArgs(['list-workspaces']));
    // Registry order is never-opened, older, newer — so a pass-through would
    // fail this, and so would a comparator that sorts a missing timestamp as ''.
    expect(printed().map((r) => r.name)).toEqual(['newer', 'older', 'never-opened']);
  });

  it('[ac:ac-brak-pliku-claude4spec-workspaces-jso] answers an empty array on a machine with no registry file, and creates none', async () => {
    const fresh = path.join(home, 'nothing-here');
    process.env.C4S_HOME = fresh;
    // Resolving (rather than throwing) is what exit 0 means for a handler: the
    // bin only exits non-zero from the top-level catch.
    await expect(runListWorkspaces(parseArgs(['list-workspaces']))).resolves.toBeUndefined();
    expect(printed()).toEqual([]);
    expect(fs.existsSync(fresh)).toBe(false);
  });

  it('[ac:ac-uszkodzony-json-rejestru-c4s-list-wor] refuses a corrupt registry with REGISTRY_READ_FAILED and no partial result', async () => {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'workspaces.json'), '{ "workspaces": [ {', 'utf8');
    await expect(runListWorkspaces(parseArgs(['list-workspaces']))).rejects.toMatchObject({
      code: 'REGISTRY_READ_FAILED',
    });
    await expect(runListWorkspaces(parseArgs(['list-workspaces']))).rejects.toBeInstanceOf(CliError);
    // Half a registry would be a worse answer than none: nothing reaches stdout.
    expect(stdout).toBe('');
  });

  it('[ac:ac-c4s-list-workspaces-na-maszynie-bez-c] creates neither the registry file nor the registry directory on a machine without one', async () => {
    // `home` itself exists (mkdtemp); the registry root C4S_HOME points at does
    // not — the state of a machine where claude4spec never ran.
    const fresh = path.join(home, 'never-ran', '.claude4spec');
    process.env.C4S_HOME = fresh;
    await runListWorkspaces(parseArgs(['list-workspaces']));
    await runListWorkspaces(parseArgs(['list-workspaces', '--format', 'text']));
    expect(fs.existsSync(path.join(fresh, 'workspaces.json'))).toBe(false);
    expect(fs.existsSync(fresh)).toBe(false);
    // Not even the parent is created on the way.
    expect(fs.existsSync(path.join(home, 'never-ran'))).toBe(false);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    '[ac:ac-plik-rejestru-bez-uprawnien-do-odczyt] answers REGISTRY_READ_FAILED with a non-zero exit when the registry file cannot be read',
    async () => {
      seedThree();
      const file = path.join(home, 'workspaces.json');
      fs.chmodSync(file, 0o000);
      try {
        const err = await runListWorkspaces(parseArgs(['list-workspaces'])).then(
          () => null,
          (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(CliError);
        expect((err as CliError).code).toBe('REGISTRY_READ_FAILED');
        // The bin exits with `codeToExit(err.code)` for every CliError.
        expect(codeToExit((err as CliError).code)).toBeGreaterThan(0);
        // An unreadable file is a failure, never "no workspaces".
        expect(stdout).toBe('');
      } finally {
        fs.chmodSync(file, 0o600);
      }
    },
  );

  it('[ac:ac-przy-uszkodzonym-rejestrze-c4s-list-w] prints no partial list of workspaces when the registry is damaged', async () => {
    // The first workspace record is intact; the second is not a workspace at
    // all. A reader that salvaged what it could would print `intact`.
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(
      path.join(home, 'workspaces.json'),
      JSON.stringify({
        $schemaVersion: 2,
        workspaces: [
          { name: 'intact', mode: 'prod', defaultPort: 4500, projects: [] },
          { name: 'broken', mode: 'prod', defaultPort: 'not-a-port', projects: 'nope' },
        ],
      }),
      'utf8',
    );
    await expect(runListWorkspaces(parseArgs(['list-workspaces']))).rejects.toMatchObject({
      code: 'REGISTRY_READ_FAILED',
    });
    // Truncated mid-record: the intact first workspace is still not printed.
    fs.writeFileSync(
      path.join(home, 'workspaces.json'),
      '{ "$schemaVersion": 2, "workspaces": [ { "name": "intact", "mode": "prod", "defaultPort": 4500, "projects": [] }, { "name": "bro',
      'utf8',
    );
    await expect(
      runListWorkspaces(parseArgs(['list-workspaces', '--format', 'text'])),
    ).rejects.toMatchObject({ code: 'REGISTRY_READ_FAILED' });
    expect(stdout).toBe('');
    expect(stdout).not.toContain('intact');
  });

  it('[ac:ac-zaden-ze-wspolnych-selektorow-projekt] ignores the shared project and workspace selectors — no resolver, no narrowing', async () => {
    seedThree();
    await runListWorkspaces(parseArgs(['list-workspaces']));
    const bare = stdout;
    stdout = '';
    // `--workspace newer` names a REAL workspace, so a command that resolved
    // would narrow to it; `--project` names one that does not exist anywhere,
    // so a command that resolved would fail outright. Neither happens.
    await runListWorkspaces(
      parseArgs(['list-workspaces', '--project', 'no-such-project', '--workspace', 'newer']),
    );
    expect(stdout).toBe(bare);
  });
});
