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
});
