import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry } from './registry.js';

/** Hand-edit a project's stored `cwd` in workspaces.json, id untouched — the
 * exact scenario the brief documents as supported ("moved directory"). */
function renameProjectCwd(registry: WorkspaceRegistry, newCwd: string): void {
  const file = registry.filePath;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.workspaces[0].projects[0].cwd = newCwd;
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

describe('WorkspaceRegistry — project id stability vs. collision', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-project-id-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('registerProject never mints an id already held by a different record in the workspace', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    const oldPath = path.join(dir, 'repo-old');
    const newPath = path.join(dir, 'repo-new');

    const projectA = registry.registerProject(ws, oldPath);
    // Simulate the documented "moved directory" flow: A's cwd changes, id stays.
    renameProjectCwd(registry, newPath);

    // A brand-new, unrelated project is later started at the now-vacated path.
    const freshWs = registry.getWorkspace('default')!;
    const projectB = registry.registerProject(freshWs, oldPath);

    expect(projectB.id).not.toBe(projectA.id);
    const allProjects = registry.getWorkspace('default')!.projects;
    expect(allProjects).toHaveLength(2);
    expect(new Set(allProjects.map((p) => p.id)).size).toBe(2);
  });

  it('resolves a moved project by its stored cwd, not a re-hash of the path', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    const oldPath = path.join(dir, 'repo-old');
    const newPath = path.join(dir, 'repo-new');

    const project = registry.registerProject(ws, oldPath);
    renameProjectCwd(registry, newPath);

    const owners = registry.resolveWorkspacesForCwd(newPath);
    expect(owners.map((w) => w.name)).toEqual(['default']);
    expect(registry.getWorkspace('default')!.projects[0]!.id).toBe(project.id);
  });
});
