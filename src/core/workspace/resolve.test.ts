import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry } from '../../server/workspace/registry.js';
import { legacyHashId } from '../../server/workspace/project-id.js';
import { resolveWorkspaceProject, WorkspaceResolveError } from './resolve.js';

function expectResolveError(fn: () => unknown): WorkspaceResolveError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(WorkspaceResolveError);
    return err as WorkspaceResolveError;
  }
  return expect.unreachable('expected resolveWorkspaceProject to throw');
}

describe('resolveWorkspaceProject — 2.1.0: --project <id> is the only selector', () => {
  let dir: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-resolve-')));
    prevHome = process.env.C4S_HOME;
    // resolveWorkspaceProject constructs `new WorkspaceRegistry()` with no
    // override — it reads C4S_HOME itself, so setup must target the SAME dir.
    process.env.C4S_HOME = dir;
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('resolves a registered id, returning the local address of its workspace', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default', port: 4611 });
    const project = registry.registerProject(ws, path.join(dir, 'App Spec'));
    expect(project.id).toBe('app-spec');

    const result = resolveWorkspaceProject({ project: 'app-spec' });
    expect(result.workspaceName).toBe('default');
    expect(result.projectId).toBe('app-spec');
    expect(result.localUrl).toBe('http://localhost:4611');
  });

  it('never resolves a path or a display name — only the id', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    const cwd = path.join(dir, 'spec');
    registry.registerProject(ws, cwd);

    expect(expectResolveError(() => resolveWorkspaceProject({ project: cwd })).code).toBe('PROJECT_ID_NOT_FOUND');
    expect(expectResolveError(() => resolveWorkspaceProject({ project: 'Spec' })).code).toBe('PROJECT_ID_NOT_FOUND');
  });

  it('PROJECT_ID_NOT_FOUND lists the available ids and no directory', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    registry.registerProject(ws, path.join(dir, 'alpha'));
    registry.registerProject(ws, path.join(dir, 'beta'));

    const err = expectResolveError(() => resolveWorkspaceProject({ project: 'gamma' }));
    expect(err.code).toBe('PROJECT_ID_NOT_FOUND');
    expect(err.message).toContain('alpha');
    expect(err.message).toContain('beta');
    expect(err.message).not.toContain(dir);
  });

  it('AMBIGUOUS_PROJECT across workspaces carries { id, workspace } candidates, never a directory', () => {
    const registry = new WorkspaceRegistry(dir);
    const wsA = registry.selectOrCreate({ name: 'ws-a', port: 4501 });
    const wsB = registry.selectOrCreate({ name: 'ws-b', port: 4502 });
    registry.registerProject(wsA, path.join(dir, 'repo-a', 'shared'));
    registry.registerProject(wsB, path.join(dir, 'repo-b', 'shared'));

    const err = expectResolveError(() => resolveWorkspaceProject({ project: 'shared' }));
    expect(err.code).toBe('AMBIGUOUS_PROJECT');
    expect(err.message).toContain('{"id":"shared","workspace":"ws-a"}');
    expect(err.message).toContain('{"id":"shared","workspace":"ws-b"}');
    expect(err.message).not.toContain(dir);
    expect(err.hint).toContain('--workspace');

    expect(resolveWorkspaceProject({ project: 'shared', workspace: 'ws-b' }).workspaceName).toBe('ws-b');
  });

  it('two projects sharing a directory name in ONE workspace get distinct ids (-2), both addressable', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    const a = registry.registerProject(ws, path.join(dir, 'repo-a', 'spec'));
    const b = registry.registerProject(ws, path.join(dir, 'repo-b', 'spec'));
    expect([a.id, b.id]).toEqual(['spec', 'spec-2']);

    expect(resolveWorkspaceProject({ project: 'spec' }).projectDir).toBe(a.cwd);
    expect(resolveWorkspaceProject({ project: 'spec-2' }).projectDir).toBe(b.cwd);
  });

  it('does not widen an explicit --workspace scope to find an id registered elsewhere', () => {
    const registry = new WorkspaceRegistry(dir);
    const wsA = registry.selectOrCreate({ name: 'ws-a', port: 4501 });
    registry.selectOrCreate({ name: 'ws-b', port: 4502 });
    registry.registerProject(wsA, path.join(dir, 'only-in-a'));

    expect(expectResolveError(() => resolveWorkspaceProject({ project: 'only-in-a', workspace: 'ws-b' })).code).toBe(
      'PROJECT_ID_NOT_FOUND',
    );
  });

  it('reports an unrecognized --workspace distinctly from PROJECT_ID_NOT_FOUND', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    registry.registerProject(ws, path.join(dir, 'app-spec-real'));

    const err = expectResolveError(() =>
      resolveWorkspaceProject({ project: 'app-spec-real', workspace: 'no-such-workspace' }),
    );
    expect(err.code).toBe('PROJECT_NOT_FOUND');
    expect(err.message).toContain("workspace 'no-such-workspace' is not registered");
    expect(err.hint).toContain('default');
  });

  it('without --project walks up from cwd to the nearest registered project', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    const cwd = path.join(dir, 'walk');
    fs.mkdirSync(path.join(cwd, 'deep', 'er'), { recursive: true });
    registry.registerProject(ws, cwd);

    const prev = process.cwd();
    process.chdir(path.join(cwd, 'deep', 'er'));
    try {
      expect(resolveWorkspaceProject().projectId).toBe('walk');
    } finally {
      process.chdir(prev);
    }
  });

  it('a hand-edited cwd keeps the stored id (walk-up finds it under the new path)', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    registry.registerProject(ws, path.join(dir, 'old-place'));
    const moved = path.join(dir, 'new-place');
    fs.mkdirSync(moved, { recursive: true });
    const file = path.join(dir, 'workspaces.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.workspaces[0].projects[0].cwd = moved;
    fs.writeFileSync(file, JSON.stringify(data));

    const prev = process.cwd();
    process.chdir(moved);
    try {
      expect(resolveWorkspaceProject().projectId).toBe('old-place');
    } finally {
      process.chdir(prev);
    }
    expect(resolveWorkspaceProject({ project: 'old-place' }).projectDir).toBe(moved);
  });

  it('reads a pre-2.1.0 (hash-id) registry with the migrated ids IN MEMORY, never rewriting it', () => {
    const cwd = path.join(dir, 'legacy-spec');
    const file = path.join(dir, 'workspaces.json');
    const legacy = {
      $schemaVersion: 2,
      workspaces: [
        {
          name: 'default',
          mode: 'prod',
          defaultPort: 4500,
          projects: [{ cwd, id: legacyHashId(cwd), name: 'legacy-spec', addedAt: '2026-01-01T00:00:00.000Z' }],
        },
      ],
    };
    fs.writeFileSync(file, JSON.stringify(legacy));

    expect(resolveWorkspaceProject({ project: 'legacy-spec' }).projectId).toBe('legacy-spec');
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(legacy);
  });
});
