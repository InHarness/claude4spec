import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry } from './registry.js';
import { resolveSpaRoute, spaDocument, WORKSPACE_ROUTE_PATHS } from './spa-route.js';
import { legacyHashId } from './project-id.js';

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

  it('[section:eb95ery1] serves the workspace route /welcome outside the project prefix and sends any other non-asset path that is not a workspace route to `/`', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    registry.registerProject(ws, path.join(dir, 'repo-a'));
    const fresh = registry.getWorkspace('default')!;

    expect(WORKSPACE_ROUTE_PATHS).toContain('/welcome');
    expect(resolveSpaRoute(registry, fresh, '/welcome')).toEqual({ kind: 'workspace' });
    // A project route without its prefix is not a workspace route.
    expect(resolveSpaRoute(registry, fresh, '/settings')).toEqual({ kind: 'redirect', to: '/' });
    expect(resolveSpaRoute(registry, fresh, '/space/pages/index.md')).toEqual({ kind: 'redirect', to: '/' });
  });

  it('[section:m26route] serves the workspace settings page /workspace/settings as a workspace route — no project identity, outside the prefix', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    const project = registry.registerProject(ws, path.join(dir, 'repo-a'));
    const fresh = registry.getWorkspace('default')!;

    expect(WORKSPACE_ROUTE_PATHS).toEqual(['/welcome', '/workspace/settings']);
    expect(resolveSpaRoute(registry, fresh, '/workspace/settings')).toEqual({ kind: 'workspace' });
    // The document of a workspace route carries no project global.
    expect(spaDocument('<html><head></head></html>', null)).not.toContain('__C4S_PROJECT__');
    // Under a project prefix the path is the project's document (whose client
    // mounts no workspace route), never a project-less one.
    expect(resolveSpaRoute(registry, fresh, `/p/${project.id}/workspace/settings`)).toEqual({ kind: 'project', project });
  });

  it('[ac:ac-po-migracji-rejestru-stara-zakladka-p] after the registry migration an old /p/<hash id>/ bookmark ends on /welcome', () => {
    // A pre-2.1.0 registry: the project is stored under its hash id.
    const cwd = path.join(dir, 'repos', 'app-spec');
    const hash = legacyHashId(cwd);
    fs.writeFileSync(
      path.join(dir, 'workspaces.json'),
      JSON.stringify({
        $schemaVersion: 2,
        workspaces: [
          {
            name: 'default',
            mode: 'prod',
            defaultPort: 4500,
            projects: [{ cwd, id: hash, name: 'app-spec', addedAt: '2026-01-01T00:00:00.000Z' }],
          },
        ],
      }),
    );
    const registry = new WorkspaceRegistry(dir);
    expect(registry.migrateIfNeeded().map((r) => r.to)).toEqual(['app-spec']);
    const ws = registry.getWorkspace('default')!;

    // Follow the redirect chain the browser follows, from the old bookmark.
    let url = `/p/${hash}/space/pages/index.md`;
    const hops: string[] = [url];
    let resolution = resolveSpaRoute(registry, ws, url);
    while (resolution.kind === 'redirect' && hops.length < 5) {
      url = resolution.to;
      hops.push(url);
      resolution = resolveSpaRoute(registry, ws, url);
    }
    expect(resolution).toEqual({ kind: 'workspace' });
    expect(hops[hops.length - 1]).toBe('/welcome');
    // The migrated id is the address that still opens the project.
    expect(resolveSpaRoute(registry, ws, '/p/app-spec/')).toMatchObject({
      kind: 'project',
      project: { id: 'app-spec', cwd },
    });
  });
});

describe('spaDocument — the application document (M50 k4fhsrkz)', () => {
  const html =
    '<!doctype html><html><head><meta charset="utf-8" /><script>/* theme */document.documentElement.dataset.t="1";</script></head><body><div id="root"></div></body></html>';

  it('[section:k4fhsrkz] a route with a project gets ONE identity global, first in <head>, before the inline theme script', () => {
    const doc = spaDocument(html, { id: 'app-spec', name: 'App </script> spec' });
    expect(doc.match(/window\.__C4S_PROJECT__=/g)).toHaveLength(1);
    expect(doc.startsWith('<!doctype html><html><head><script>window.__C4S_PROJECT__={"id":"app-spec","name":"App \\u003c/script> spec"};</script><meta')).toBe(true);
    expect(doc.indexOf('__C4S_PROJECT__')).toBeLessThan(doc.indexOf('/* theme */'));
  });

  it('[section:k4fhsrkz] a workspace route has no project: nothing is injected and the inline scripts stay as they are', () => {
    const doc = spaDocument(html, null);
    expect(doc).not.toContain('__C4S_PROJECT__');
    expect(doc).toBe(html);
    expect(doc).toContain('<script>/* theme */document.documentElement.dataset.t="1";</script>');
  });
});
