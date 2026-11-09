import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from '../args.js';
import { runInstallSkills } from './install-skills.js';
import { WorkspaceRegistry } from '../../../server/workspace/registry.js';
import { dirEntries } from '../../../../tests/helpers/dir-snapshot.js';

/**
 * 2.1.77 (M22 `8tvwx2ry`): the `--skills` selection of `c4s install-skills`
 * follows the project's capabilities — in a project without `briefs` (type
 * `skill`) the slug of `c4s-brief-implementer` is an unknown slug and the
 * command ends with `INVALID_ARGS`, writing nothing. The type comes from the
 * copy in the workspace record (offline) or from the server's project list
 * (`--server`). Against a `spec` control.
 *
 * The criterion's `verifies` names a cli-command `install-skills` the spec does
 * not hold at 2.1.77 (dev-0804); the title is the contract.
 */
describe('c4s install-skills in a `skill` project (2.1.77)', () => {
  let registryDir: string;
  let skillDir: string;
  let specDir: string;
  let targetDir: string;
  let skillId: string;
  let specId: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-install-skills-skill-registry-'));
    skillDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-install-skills-skill-project-'));
    specDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-install-skills-spec-project-'));
    targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-install-skills-skill-target-'));
    prevHome = process.env.C4S_HOME;
    process.env.C4S_HOME = registryDir;
    const registry = new WorkspaceRegistry(registryDir);
    const ws = registry.selectOrCreate({ name: 'default' });
    skillId = registry.registerProject(ws, skillDir, 'skill').id;
    specId = registry.registerProject(registry.getWorkspace('default') ?? ws, specDir).id;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    for (const d of [registryDir, skillDir, specDir, targetDir]) fs.rmSync(d, { recursive: true, force: true });
  });

  const run = (project: string, skills: string, extra: string[] = []) =>
    runInstallSkills(
      parseArgs(['install-skills', '--project', project, '--workspace', 'default', '--dir', targetDir, '--skills', skills, ...extra]),
    );

  it('[ac:ac-w-projekcie-typu-skill-c4s-install-sk] in a `skill` project `c4s install-skills --skills c4s-brief-implementer` ends with the refusal `INVALID_ARGS`', async () => {
    // The skill's name as the criterion spells it, and its selection slug.
    await expect(run(skillId, 'c4s-brief-implementer')).rejects.toMatchObject({ code: 'INVALID_ARGS' });
    await expect(run(skillId, 'brief-implementer')).rejects.toMatchObject({ code: 'INVALID_ARGS' });
    expect(dirEntries(targetDir)).toEqual([]);

    // The `--server` path reads the type from the server's project list.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ name: 'team', projects: [{ id: 'remote-skill', projectType: 'skill' }] }), { status: 200 })),
    );
    await expect(
      runInstallSkills(
        parseArgs(['install-skills', '--server', 'https://c4s.example.test', '--project', 'remote-skill', '--dir', targetDir, '--skills', 'brief-implementer']),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGS' });
    vi.unstubAllGlobals();
    expect(dirEntries(targetDir)).toEqual([]);

    // The project's own skills still install: no brief implementer among them.
    await run(skillId, 'spec-reader,refactor');
    expect(dirEntries(targetDir).sort()).toEqual(['c4s-refactor', 'c4s-spec-reader']);

    // Control: a `spec` project accepts the slug.
    await run(specId, 'brief-implementer');
    expect(fs.existsSync(path.join(targetDir, 'c4s-brief-implementer', 'SKILL.md'))).toBe(true);
  });
});
