import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry } from './registry.js';
import { resolveSpaRoute } from './spa-route.js';

/**
 * 0.1.137: the root `/` is an UNCONDITIONAL 302 to `/welcome`. These tests pin
 * that it no longer consults `lastOpened` / the project list at all — the
 * regression guard for the old "last-opened → first registered → /welcome"
 * chain that used to auto-jump into `/p/<id>/`.
 */
describe('resolveSpaRoute — root always lands on /welcome', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-spa-route-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('redirects `/` to /welcome even with registered projects and a recent lastOpened', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    registry.registerProject(ws, path.join(dir, 'repo-a'));
    const projectB = registry.registerProject(registry.getWorkspace('default')!, path.join(dir, 'repo-b'));
    // B is the last-opened one — under the old rule `/` would 302 to /p/<B>/.
    registry.touchLastOpened('default', projectB.id);

    const fresh = registry.getWorkspace('default')!;
    expect(fresh.projects).toHaveLength(2);
    expect(resolveSpaRoute(registry, fresh, '/')).toEqual({ kind: 'redirect', to: '/welcome' });
    expect(resolveSpaRoute(registry, fresh, '')).toEqual({ kind: 'redirect', to: '/welcome' });
  });

  it('redirects `/` to /welcome on an empty workspace', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });

    expect(ws.projects).toHaveLength(0);
    expect(resolveSpaRoute(registry, ws, '/')).toEqual({ kind: 'redirect', to: '/welcome' });
  });

  it('serves the project SPA for a known /p/<id>/ and bounces an unknown id to `/`', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    const project = registry.registerProject(ws, path.join(dir, 'repo-a'));
    const fresh = registry.getWorkspace('default')!;

    expect(resolveSpaRoute(registry, fresh, `/p/${project.id}/`)).toEqual({ kind: 'project', project });
    expect(resolveSpaRoute(registry, fresh, `/p/${project.id}/settings`)).toEqual({
      kind: 'project',
      project,
    });
    // Unknown id → `/`, which the case above resolves onward to /welcome.
    expect(resolveSpaRoute(registry, fresh, '/p/000000000000/')).toEqual({
      kind: 'redirect',
      to: '/',
    });
  });

  it('serves /welcome project-less and sends any other non-asset path to `/`', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    registry.registerProject(ws, path.join(dir, 'repo-a'));
    const fresh = registry.getWorkspace('default')!;

    expect(resolveSpaRoute(registry, fresh, '/welcome')).toEqual({ kind: 'welcome' });
    expect(resolveSpaRoute(registry, fresh, '/settings')).toEqual({ kind: 'redirect', to: '/' });
  });
});
