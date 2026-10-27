import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry } from './registry.js';

describe('WorkspaceRegistry — project plugin trust (M33 phase 2)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-trust-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is undefined until a decision is recorded, then round-trips', () => {
    const registry = new WorkspaceRegistry(dir);
    const projectCwd = path.join(dir, 'proj');
    const ws = registry.selectOrCreate({ name: 'default' });
    const project = registry.registerProject(ws, projectCwd);

    expect(registry.getProjectTrust(ws, project.id)).toBeUndefined();

    registry.setProjectTrust(ws, project.id, true);
    expect(registry.getProjectTrust(ws, project.id)).toBe(true);

    registry.setProjectTrust(ws, project.id, false);
    expect(registry.getProjectTrust(ws, project.id)).toBe(false);
  });

  it('persists the decision to workspaces.json (machine-local, not the repo)', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    const project = registry.registerProject(ws, path.join(dir, 'proj'));
    registry.setProjectTrust(ws, project.id, true);

    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'workspaces.json'), 'utf8'));
    const stored = onDisk.workspaces[0].projects[0];
    expect(stored.trustProjectPlugins).toBe(true);
  });

  it('[section:44viw74p] the same machine-local project record carries the skill-attachment confirmation next to trustProjectPlugins — not confirmed until set, independent of the plugin gate, never written to the repo', () => {
    const registry = new WorkspaceRegistry(dir);
    const projectCwd = path.join(dir, 'proj');
    const ws = registry.selectOrCreate({ name: 'default' });
    const project = registry.registerProject(ws, projectCwd);

    // Absent = not confirmed (ASSUMPTION:dev-0002: one boolean for the whole list).
    expect(registry.getSpecSkillHooksTrust(ws, project.id)).toBe(false);

    registry.setSpecSkillHooksTrust(ws, project.id, true);
    expect(registry.getSpecSkillHooksTrust(ws, project.id)).toBe(true);
    // Independent of the plugin trust gate, in both directions.
    expect(registry.getProjectTrust(ws, project.id)).toBeUndefined();
    registry.setProjectTrust(ws, project.id, false);
    expect(registry.getSpecSkillHooksTrust(ws, project.id)).toBe(true);

    // Persisted in ~/.claude4spec/workspaces.json, in the project's record, next to trustProjectPlugins.
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'workspaces.json'), 'utf8'));
    const stored = onDisk.workspaces[0].projects[0];
    expect(stored).toMatchObject({ id: project.id, trustProjectPlugins: false, trustSpecSkillHooks: true });

    // Nothing of it lands in the repository: no file under the project's directory mentions it.
    const repoFiles: string[] = [];
    const walk = (abs: string) => {
      if (!fs.existsSync(abs)) return;
      for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        const full = path.join(abs, e.name);
        if (e.isDirectory()) walk(full);
        else repoFiles.push(full);
      }
    };
    walk(projectCwd);
    for (const f of repoFiles) expect(fs.readFileSync(f, 'utf8'), f).not.toContain('trustSpecSkillHooks');

    registry.setSpecSkillHooksTrust(ws, project.id, false);
    expect(registry.getSpecSkillHooksTrust(ws, project.id)).toBe(false);
  });
});
