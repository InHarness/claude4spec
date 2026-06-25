import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  WorkspaceRegistry,
  WORKSPACES_SCHEMA_VERSION,
  PREDEFINED_PLUGINS,
  resolvePluginPackages,
} from './registry.js';

describe('resolvePluginPackages', () => {
  it('returns predefined ∪ user-added, deduped, predefined first', () => {
    // No user-added plugins ⇒ exactly the predefined set (e.g. the preinstalled
    // `c4s-plugin-simple-database-tables` plugin).
    expect(resolvePluginPackages({ plugins: undefined })).toEqual([...PREDEFINED_PLUGINS]);
    expect(resolvePluginPackages({ plugins: ['@acme/a', '@acme/b', '@acme/a'] })).toEqual([
      ...PREDEFINED_PLUGINS,
      '@acme/a',
      '@acme/b',
    ]);
  });
});

describe('workspaces.json schema migration (v1 → v2)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-ws-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads a legacy v1 record (no plugins[]) and rewrites it as v2 on mutation', () => {
    const file = path.join(dir, 'workspaces.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        $schemaVersion: 1,
        workspaces: [
          { name: 'default', mode: 'prod', defaultPort: 4500, lastOpened: '2026-01-01T00:00:00Z', projects: [] },
        ],
      }),
    );

    const registry = new WorkspaceRegistry(dir);
    const ws = registry.getWorkspace('default');
    expect(ws).not.toBeNull();
    expect(ws?.plugins).toBeUndefined(); // legacy → predefined-only
    expect(resolvePluginPackages(ws!)).toEqual([...PREDEFINED_PLUGINS]);

    // Any mutation rewrites $schemaVersion to the current version.
    registry.touchLastOpened('default');
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(after.$schemaVersion).toBe(WORKSPACES_SCHEMA_VERSION);
    expect(WORKSPACES_SCHEMA_VERSION).toBe(2);
  });

  it('rejects a workspaces.json written by a newer schema', () => {
    fs.writeFileSync(
      path.join(dir, 'workspaces.json'),
      JSON.stringify({ $schemaVersion: 999, workspaces: [] }),
    );
    const registry = new WorkspaceRegistry(dir);
    expect(() => registry.listWorkspaces()).toThrow(/schema version 999/);
  });
});
