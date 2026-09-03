import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listWorkspaces, WorkspaceRegistryReadError } from './list-workspaces.js';
import { WorkspaceRegistry } from './registry.js';

describe('listWorkspaces (M31 registry-read core)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-list-ws-core-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const registry = () => new WorkspaceRegistry(dir);

  it('returns an empty array for a registry that does not exist yet, without creating one', () => {
    const missing = path.join(dir, 'absent');
    expect(listWorkspaces(new WorkspaceRegistry(missing))).toEqual([]);
    expect(fs.existsSync(missing)).toBe(false);
  });

  it('collapses projects to a count and drops the plugin list', () => {
    const r = registry();
    const ws = r.selectOrCreate({ name: 'default', port: 4500, mode: 'prod' });
    r.registerProject(ws, path.join(dir, 'proj-a'));
    r.registerProject(ws, path.join(dir, 'proj-b'));

    const [row] = listWorkspaces(r);
    expect(row).toMatchObject({ name: 'default', mode: 'prod', defaultPort: 4500, projectCount: 2 });
    expect(row!.lastOpened).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Object.keys(row!).sort()).toEqual(
      ['defaultPort', 'lastOpened', 'mode', 'name', 'projectCount'].sort(),
    );
  });

  it('does not take the advisory lock a write would take', () => {
    const r = registry();
    r.selectOrCreate({ name: 'default' });
    // A held lock stalls `withLock` for ~10s and then throws. A pure read has
    // nothing to lose to a race, so it must sail straight past a stale-fresh one.
    fs.writeFileSync(path.join(dir, 'workspaces.json.lock'), String(process.pid), 'utf8');
    try {
      const started = Date.now();
      expect(listWorkspaces(r)).toHaveLength(1);
      expect(Date.now() - started).toBeLessThan(1_000);
    } finally {
      fs.rmSync(path.join(dir, 'workspaces.json.lock'), { force: true });
    }
  });

  it('throws WorkspaceRegistryReadError on invalid JSON', () => {
    fs.writeFileSync(path.join(dir, 'workspaces.json'), 'not json at all', 'utf8');
    expect(() => listWorkspaces(registry())).toThrow(WorkspaceRegistryReadError);
  });

  it('throws WorkspaceRegistryReadError on a shape that is not a registry', () => {
    fs.writeFileSync(path.join(dir, 'workspaces.json'), '{"workspaces":"nope"}', 'utf8');
    expect(() => listWorkspaces(registry())).toThrow(WorkspaceRegistryReadError);
  });

  // 0.2.65 review finding: an unreadable registry DIRECTORY used to read as
  // "no registry" — `existsSync` cannot tell "absent" from "not allowed to
  // look", so the command answered `[]` with exit 0 on a machine that has
  // workspaces. Only ENOENT is an empty registry.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'fails loudly when the registry directory cannot be traversed',
    () => {
      const walled = path.join(dir, 'walled');
      fs.mkdirSync(walled);
      fs.writeFileSync(
        path.join(walled, 'workspaces.json'),
        JSON.stringify({ $schemaVersion: 2, workspaces: [] }),
        'utf8',
      );
      fs.chmodSync(walled, 0o000);
      try {
        expect(() => listWorkspaces(new WorkspaceRegistry(walled))).toThrow(WorkspaceRegistryReadError);
      } finally {
        fs.chmodSync(walled, 0o700);
      }
    },
  );

  it('throws WorkspaceRegistryReadError on a schema version this binary cannot read', () => {
    fs.writeFileSync(
      path.join(dir, 'workspaces.json'),
      JSON.stringify({ $schemaVersion: 999, workspaces: [] }),
      'utf8',
    );
    expect(() => listWorkspaces(registry())).toThrow(WorkspaceRegistryReadError);
  });
});
