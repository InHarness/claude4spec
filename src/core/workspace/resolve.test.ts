import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry } from '../../server/workspace/registry.js';
import { resolveWorkspaceProject, WorkspaceResolveError } from './resolve.js';

describe('resolveWorkspaceProject — --project <name> fallback', () => {
  let dir: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-resolve-'));
    prevHome = process.env.C4S_HOME;
    // resolveWorkspaceProject always constructs `new WorkspaceRegistry()` with
    // no override — it reads C4S_HOME itself, so setup must target the SAME dir.
    process.env.C4S_HOME = dir;
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('resolves a unique name match within an explicit --workspace', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    const projectCwd = path.join(dir, 'app-spec-real');
    registry.registerProject(ws, projectCwd);

    const result = resolveWorkspaceProject({ project: 'app-spec-real', workspace: 'default' });

    expect(result.workspaceName).toBe('default');
    expect(result.projectDir).toBe(projectCwd);
  });

  it('resolves a unique name match across all workspaces when --workspace is omitted', () => {
    const registry = new WorkspaceRegistry(dir);
    const wsA = registry.selectOrCreate({ name: 'ws-a', port: 4501 });
    const projectCwd = path.join(dir, 'only-here');
    registry.registerProject(wsA, projectCwd);
    registry.selectOrCreate({ name: 'ws-b', port: 4502 }); // no matching project

    const result = resolveWorkspaceProject({ project: 'only-here' });

    expect(result.workspaceName).toBe('ws-a');
    expect(result.projectDir).toBe(projectCwd);
  });

  it('throws AMBIGUOUS_WORKSPACE when a name matches 2+ projects and --workspace is omitted', () => {
    const registry = new WorkspaceRegistry(dir);
    const wsA = registry.selectOrCreate({ name: 'ws-a', port: 4501 });
    const wsB = registry.selectOrCreate({ name: 'ws-b', port: 4502 });
    registry.registerProject(wsA, path.join(dir, 'repo-a', 'shared-name'));
    registry.registerProject(wsB, path.join(dir, 'repo-b', 'shared-name'));

    try {
      resolveWorkspaceProject({ project: 'shared-name' });
      expect.unreachable('expected resolveWorkspaceProject to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkspaceResolveError);
      expect((err as WorkspaceResolveError).code).toBe('AMBIGUOUS_WORKSPACE');
      expect((err as WorkspaceResolveError).message).toContain('shared-name');
    }
  });

  it('prefers a resolving path over a DIFFERENT project sharing that same name (precedence)', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    const realPath = path.join(dir, 'actual-project');
    const decoyPath = path.join(dir, 'decoy-project');
    registry.registerProject(ws, realPath); // name defaults to 'actual-project'
    registry.registerProject(ws, decoyPath);
    // Hand-edit the decoy's name to collide with the real project's — if name
    // fallback ran unconditionally (instead of only after path resolution
    // fails), this could resolve to the WRONG project.
    const workspacesFile = JSON.parse(fs.readFileSync(path.join(dir, 'workspaces.json'), 'utf8'));
    workspacesFile.workspaces[0].projects.find((p: { cwd: string }) => p.cwd === decoyPath).name =
      'actual-project';
    fs.writeFileSync(path.join(dir, 'workspaces.json'), JSON.stringify(workspacesFile));

    // `--project actual-project` as a RELATIVE path from `dir` resolves
    // exactly to `realPath` — this must win over the name-collision with decoy.
    const prevCwd = process.cwd();
    process.chdir(dir);
    try {
      const result = resolveWorkspaceProject({ project: 'actual-project' });
      expect(result.projectDir).toBe(realPath);
    } finally {
      process.chdir(prevCwd);
    }
  });

  it('reports PROJECT_NOT_FOUND mentioning both the path and name attempts when neither matches', () => {
    const registry = new WorkspaceRegistry(dir);
    registry.selectOrCreate({ name: 'default' });

    try {
      resolveWorkspaceProject({ project: 'nonexistent-anything' });
      expect.unreachable('expected resolveWorkspaceProject to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkspaceResolveError);
      expect((err as WorkspaceResolveError).code).toBe('PROJECT_NOT_FOUND');
      expect((err as WorkspaceResolveError).message).toContain('nonexistent-anything');
    }
  });

  it('does not widen an explicit --workspace scope to find a name registered elsewhere', () => {
    const registry = new WorkspaceRegistry(dir);
    const wsA = registry.selectOrCreate({ name: 'ws-a', port: 4501 });
    registry.selectOrCreate({ name: 'ws-b', port: 4502 });
    registry.registerProject(wsA, path.join(dir, 'only-in-a'));

    expect(() => resolveWorkspaceProject({ project: 'only-in-a', workspace: 'ws-b' })).toThrow(
      WorkspaceResolveError,
    );
  });
});
