import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from '../args.js';
import { CliError } from '../errors.js';
import { runInstallSkills } from './install-skills.js';
import { WorkspaceRegistry } from '../../../server/workspace/registry.js';

describe('runInstallSkills', () => {
  let registryDir: string;
  let projectDir: string;
  let projectId: string;
  let targetDir: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-install-skills-registry-'));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-install-skills-project-'));
    targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-install-skills-target-'));
    prevHome = process.env.C4S_HOME;
    process.env.C4S_HOME = registryDir;

    const registry = new WorkspaceRegistry(registryDir);
    const ws = registry.selectOrCreate({ name: 'default' });
    projectId = registry.registerProject(ws, projectDir).id;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(registryDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  const projectName = () => projectId;

  it('writes all three skills by default', async () => {
    const args = parseArgs([
      'install-skills',
      '--project', projectName(),
      '--workspace', 'default',
      '--dir', targetDir,
    ]);
    await runInstallSkills(args);
    expect(fs.existsSync(path.join(targetDir, 'c4s-spec-reader', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'c4s-brief-implementer', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'c4s-refactor', 'SKILL.md'))).toBe(true);
  });

  // 0.1.104 regression: a comma/whitespace-only --skills value parsed to a
  // truthy-but-empty array, which silently fell through to "select all"
  // instead of erroring — a user explicitly narrowing the selection to
  // nothing valid should get INVALID_ARGS, not all three skills.
  it('rejects a comma/whitespace-only --skills value instead of silently installing everything', async () => {
    const args = parseArgs([
      'install-skills',
      '--project', projectName(),
      '--workspace', 'default',
      '--dir', targetDir,
      '--skills', ',,',
    ]);
    await expect(runInstallSkills(args)).rejects.toThrow(CliError);
    await expect(runInstallSkills(args)).rejects.toMatchObject({ code: 'INVALID_ARGS' });
    expect(fs.existsSync(path.join(targetDir, 'c4s-spec-reader'))).toBe(false);
  });

  it('rejects an unknown --skills slug', async () => {
    const args = parseArgs([
      'install-skills',
      '--project', projectName(),
      '--workspace', 'default',
      '--dir', targetDir,
      '--skills', 'bogus',
    ]);
    await expect(runInstallSkills(args)).rejects.toMatchObject({ code: 'INVALID_ARGS' });
  });

  it('offline mode bakes --server <publicUrl> --project <id> from the local registry, without a request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      await runInstallSkills(parseArgs(['install-skills', '--project', projectId, '--dir', targetDir]));
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    const body = fs.readFileSync(path.join(targetDir, 'c4s-spec-reader', 'SKILL.md'), 'utf8');
    expect(body).toContain(`--server 'http://localhost:4500' --project '${projectId}'`);
    expect(body).not.toContain(projectDir);
  });

  describe('--server <url> --project <id>', () => {
    afterEach(() => vi.unstubAllGlobals());

    const serverAnswers = (body: unknown, status = 200) =>
      vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

    it('confirms the id with ONE read on that server, then writes skills addressed to it', async () => {
      const fetchSpy = serverAnswers({ name: 'team', projects: [{ id: 'remote-spec' }] });
      vi.stubGlobal('fetch', fetchSpy);
      await runInstallSkills(
        parseArgs(['install-skills', '--server', 'https://c4s.firma.dev/', '--project', 'remote-spec', '--dir', targetDir]),
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(String(fetchSpy.mock.calls[0]![0])).toBe('https://c4s.firma.dev/api/workspace');
      const body = fs.readFileSync(path.join(targetDir, 'c4s-brief-implementer', 'SKILL.md'), 'utf8');
      expect(body).toContain(`--server 'https://c4s.firma.dev' --project 'remote-spec'`);
    });

    it('--server without --project → INVALID_ARGS before any request', async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      await expect(
        runInstallSkills(parseArgs(['install-skills', '--server', 'https://c4s.firma.dev', '--dir', targetDir])),
      ).rejects.toMatchObject({ code: 'INVALID_ARGS' });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('an id the server does not serve → PROJECT_NOT_IN_WORKSPACE, nothing written', async () => {
      vi.stubGlobal('fetch', serverAnswers({ name: 'team', projects: [{ id: 'other' }] }));
      await expect(
        runInstallSkills(parseArgs(['install-skills', '--server', 'https://c4s.firma.dev', '--project', 'nope', '--dir', targetDir])),
      ).rejects.toMatchObject({ code: 'PROJECT_NOT_IN_WORKSPACE' });
      expect(fs.existsSync(path.join(targetDir, 'c4s-spec-reader'))).toBe(false);
    });

    it('an unreachable server → SERVER_NOT_RUNNING', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
      await expect(
        runInstallSkills(parseArgs(['install-skills', '--server', 'http://127.0.0.1:1', '--project', 'x', '--dir', targetDir])),
      ).rejects.toMatchObject({ code: 'SERVER_NOT_RUNNING' });
    });
  });

  it('an unknown --project id → PROJECT_ID_NOT_FOUND listing the available ids', async () => {
    const err = await runInstallSkills(parseArgs(['install-skills', '--project', 'ghost', '--dir', targetDir])).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('PROJECT_ID_NOT_FOUND');
    expect((err as CliError).message).toContain(projectId);
  });
});
