import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from '../args.js';
import { CliError } from '../errors.js';
import { listWorkspacesCommand, runListWorkspaces } from './list-workspaces.js';
import type { WorkspacesFile } from '../../../server/workspace/types.js';

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
          projects: [{ cwd: '/a', id: 'aaaaaaaaaaaa', name: 'a', addedAt: '2026-01-01T00:00:00.000Z' }],
        },
        {
          name: 'newer',
          mode: 'prod',
          defaultPort: 4500,
          lastOpened: '2026-06-01T00:00:00.000Z',
          projects: [
            { cwd: '/b', id: 'bbbbbbbbbbbb', name: 'b', addedAt: '2026-01-01T00:00:00.000Z' },
            { cwd: '/c', id: 'cccccccccccc', name: 'c', addedAt: '2026-01-01T00:00:00.000Z' },
          ],
        },
      ],
    });
  }

  const printed = () => JSON.parse(stdout) as Array<Record<string, unknown>>;

  it('declares registry-read, its one error code and its output shape', () => {
    expect(listWorkspacesCommand.executionMode).toBe('registry-read');
    expect(listWorkspacesCommand.errorCodes).toEqual(['REGISTRY_READ_FAILED']);
    expect(listWorkspacesCommand.output).toEqual({
      unit: 'workspace',
      fields: ['name', 'mode', 'defaultPort', 'projectCount', 'lastOpened'],
    });
    // It renders no catalog operation — that is the half of the item-26
    // invariant a server-free mode has to satisfy.
    expect(listWorkspacesCommand.operation).toBeUndefined();
  });

  it('[ac:ac-c4s-list-workspaces-wypisuje-wszystki] prints every workspace in the registry with no server running', async () => {
    seedThree();
    await runListWorkspaces(parseArgs(['list-workspaces']));
    expect(printed().map((r) => r.name)).toEqual(
      expect.arrayContaining(['newer', 'older', 'never-opened']),
    );
    expect(printed()).toHaveLength(3);
  });

  it('[ac:ac-kazdy-wiersz-wyjscia-c4s-list-workspa] carries name, mode, defaultPort, projectCount and lastOpened — and nothing else', async () => {
    seedThree();
    await runListWorkspaces(parseArgs(['list-workspaces']));
    const newer = printed().find((r) => r.name === 'newer')!;
    expect(newer).toEqual({
      name: 'newer',
      mode: 'prod',
      defaultPort: 4500,
      projectCount: 2,
      lastOpened: '2026-06-01T00:00:00.000Z',
    });
    // `projects[]` stays collapsed to its count (the expanded list is
    // `list_projects`), and `plugins[]` never travels at all — it is load
    // configuration, not workspace identity.
    for (const row of printed()) {
      expect(row).not.toHaveProperty('projects');
      expect(row).not.toHaveProperty('plugins');
    }
    const never = printed().find((r) => r.name === 'never-opened')!;
    expect(never.projectCount).toBe(0);
    expect(never.lastOpened).toBeUndefined();
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
