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

  it('throws AMBIGUOUS_PROJECT when a name matches 2+ projects and --workspace is omitted', () => {
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
      expect((err as WorkspaceResolveError).code).toBe('AMBIGUOUS_PROJECT');
      expect((err as WorkspaceResolveError).message).toContain('shared-name');
    }
  });

  it('prefers a resolving path over a DIFFERENT project sharing that same name (precedence)', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    // realpath: on macOS the tmp dir is reached through a symlink (/var →
    // /private/var) and `process.cwd()` after `chdir` reports the resolved form.
    // Registered under the unresolved one, the path attempt missed, and this test
    // passed only because the name fallback used to take the FIRST same-named
    // project — which is exactly the silent choice 0.2.97 removed.
    const realDir = fs.realpathSync(dir);
    const realPath = path.join(realDir, 'actual-project');
    const decoyPath = path.join(realDir, 'decoy-project');
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
    process.chdir(realDir);
    try {
      const result = resolveWorkspaceProject({ project: 'actual-project' });
      expect(result.projectDir).toBe(realPath);
    } finally {
      process.chdir(prevCwd);
    }
  });

  it('reports PROJECT_SLUG_NOT_FOUND mentioning both the path and name attempts when neither matches', () => {
    const registry = new WorkspaceRegistry(dir);
    registry.selectOrCreate({ name: 'default' });

    try {
      resolveWorkspaceProject({ project: 'nonexistent-anything' });
      expect.unreachable('expected resolveWorkspaceProject to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkspaceResolveError);
      expect((err as WorkspaceResolveError).code).toBe('PROJECT_SLUG_NOT_FOUND');
      expect((err as WorkspaceResolveError).message).toContain('nonexistent-anything');
      expect((err as WorkspaceResolveError).hint).toContain('regenerate the skill');
    }
  });

  it('throws AMBIGUOUS_PROJECT with a hint to pass --workspace when a name collides', () => {
    const registry = new WorkspaceRegistry(dir);
    const wsA = registry.selectOrCreate({ name: 'ws-a', port: 4511 });
    const wsB = registry.selectOrCreate({ name: 'ws-b', port: 4512 });
    registry.registerProject(wsA, path.join(dir, 'repo-a', 'twin-name'));
    registry.registerProject(wsB, path.join(dir, 'repo-b', 'twin-name'));

    try {
      resolveWorkspaceProject({ project: 'twin-name' });
      expect.unreachable('expected resolveWorkspaceProject to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkspaceResolveError);
      expect((err as WorkspaceResolveError).code).toBe('AMBIGUOUS_PROJECT');
      expect((err as WorkspaceResolveError).hint).toContain('--workspace');
    }
  });

  /**
   * 0.2.97 (M31) — a project name is not unique even INSIDE a workspace: two
   * projects whose directories share a basename share the name. The search used
   * to take the first match per workspace, so the second was unaddressable by
   * name and the first answered for both, silently. `--workspace` cannot tell
   * them apart, so the hint names the one thing that can.
   */
  it('throws AMBIGUOUS_PROJECT for two same-named projects inside ONE workspace', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    registry.registerProject(ws, path.join(dir, 'repo-a', 'spec'));
    registry.registerProject(ws, path.join(dir, 'repo-b', 'spec'));

    for (const opts of [{ project: 'spec' }, { project: 'spec', workspace: 'default' }]) {
      try {
        resolveWorkspaceProject(opts);
        expect.unreachable('expected resolveWorkspaceProject to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(WorkspaceResolveError);
        expect((err as WorkspaceResolveError).code).toBe('AMBIGUOUS_PROJECT');
        expect((err as WorkspaceResolveError).message).toContain(path.join(dir, 'repo-a', 'spec'));
        expect((err as WorkspaceResolveError).message).toContain(path.join(dir, 'repo-b', 'spec'));
        expect((err as WorkspaceResolveError).hint).toContain('--project <path>');
        expect((err as WorkspaceResolveError).hint).not.toContain('--workspace');
      }
    }
  });

  it('still resolves either of two same-named projects by its path', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    const b = path.join(dir, 'repo-b', 'spec');
    registry.registerProject(ws, path.join(dir, 'repo-a', 'spec'));
    registry.registerProject(ws, b);

    expect(resolveWorkspaceProject({ project: b, workspace: 'default' }).projectDir).toBe(b);
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

  it('reports an unrecognized --workspace distinctly from PROJECT_SLUG_NOT_FOUND', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    registry.registerProject(ws, path.join(dir, 'app-spec-real'));

    try {
      // A valid, registered slug — but paired with a --workspace typo that
      // doesn't exist at all. The bug this guards: this used to fall through
      // to the name-fallback with an empty candidate list, mislabeling a
      // workspace typo as a stale/ambiguous slug.
      resolveWorkspaceProject({ project: 'app-spec-real', workspace: 'no-such-workspace' });
      expect.unreachable('expected resolveWorkspaceProject to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkspaceResolveError);
      expect((err as WorkspaceResolveError).code).toBe('PROJECT_NOT_FOUND');
      expect((err as WorkspaceResolveError).message).toContain("workspace 'no-such-workspace' is not registered");
      expect((err as WorkspaceResolveError).hint).toContain('default');
    }
  });
});
