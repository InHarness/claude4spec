// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry } from '../../server/workspace/registry.js';
import { resolveSpaRoute } from '../../server/workspace/spa-route.js';

/**
 * 2.1.12 — M31 edge case: project-scoped browser storage is keyed by the STORED
 * project id the server injects as `window.__C4S_PROJECT__.id`, never by the
 * project directory. Hand-editing `cwd` in `workspaces.json` (a moved repo)
 * keeps the id, so the page the browser loads afterwards reads the same keys.
 */
describe('project-scoped localStorage survives a cwd edit', () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-ls-cwd-'));
    window.localStorage.clear();
  });
  afterEach(() => {
    delete window.__C4S_PROJECT__;
    window.localStorage.clear();
    fs.rmSync(home, { recursive: true, force: true });
  });

  /** The id the server would inject for `/p/<id>/` — the route resolution it serves. */
  function injectedIdFor(registry: WorkspaceRegistry, id: string): string {
    const ws = registry.getWorkspace('default')!;
    const r = resolveSpaRoute(registry, ws, `/p/${id}/`);
    if (r.kind !== 'project') throw new Error(`expected /p/${id}/ to serve the project, got ${r.kind}`);
    return r.project.id;
  }

  /** Load `persisted.ts` the way a fresh page load does: global first, then module. */
  async function freshPage(id: string) {
    window.__C4S_PROJECT__ = { id };
    vi.resetModules();
    return import('./persisted.js');
  }

  it('[ac:ac-po-edycji-pola-cwd-projektu-w-workspa-3] after editing the project cwd in workspaces.json the browser storage saved for the project stays available', async () => {
    const registry = new WorkspaceRegistry(home);
    const ws = registry.selectOrCreate({ name: 'default' });
    const oldCwd = path.join(home, 'repos', 'app-spec');
    const project = registry.registerProject(ws, oldCwd);

    // Page load #1: the user's state is persisted under the project scope.
    const before = await freshPage(injectedIdFor(registry, project.id));
    const key = before.projectKey('c4s:m05:chat-store');
    window.localStorage.setItem(key, JSON.stringify({ v: 1, data: { open: true } }));

    // The repo moved; the user edits `cwd` by hand, leaving the id alone.
    const file = registry.filePath;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.workspaces[0].projects[0].cwd = path.join(home, 'moved', 'app-spec');
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    expect(registry.getWorkspace('default')!.projects[0]!.cwd).toBe(path.join(home, 'moved', 'app-spec'));

    // Page load #2 after the edit: same injected id → same key → same value.
    const after = await freshPage(injectedIdFor(registry, project.id));
    expect(after.PROJECT_SCOPE).toBe(project.id);
    expect(after.projectKey('c4s:m05:chat-store')).toBe(key);
    expect(JSON.parse(window.localStorage.getItem(after.projectKey('c4s:m05:chat-store'))!)).toEqual({
      v: 1,
      data: { open: true },
    });
  });
});
