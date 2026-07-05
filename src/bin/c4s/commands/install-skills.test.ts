import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
    registry.registerProject(ws, projectDir);
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(registryDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  const projectName = () => path.basename(projectDir);

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
});
