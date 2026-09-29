import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry, RegistryMigrationPendingError } from './registry.js';
import { legacyHashId } from './project-id.js';
import { readSlotMarker, writeSlotMarker } from './slot-marker.js';
import { runTrustPlugins } from '../../bin/c4s/commands/trust-plugins.js';
import { parseArgs } from '../../bin/c4s/args.js';
import { CliError } from '../../bin/c4s/errors.js';

/**
 * 2.1.0 — one-way registry migration: hash ids (`sha1(cwd).slice(0,12)`, schema
 * ≤ 2) → readable ids (schema 3), run by the server at start. Each step is
 * detectable from disk, so an interrupted run completes on the next start.
 */
describe('registry migration: hash ids → readable ids', () => {
  let dir: string;
  let file: string;

  function legacyRegistry(projects: Array<{ cwd: string; name: string }>, extra: Record<string, unknown> = {}) {
    const data = {
      $schemaVersion: 2,
      workspaces: [
        {
          name: 'default',
          mode: 'prod',
          defaultPort: 4500,
          projects: projects.map((p) => ({
            cwd: p.cwd,
            id: legacyHashId(p.cwd),
            name: p.name,
            addedAt: '2026-01-01T00:00:00.000Z',
            ...extra,
          })),
        },
      ],
    };
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    for (const p of projects) {
      const slot = path.join(dir, 'default', legacyHashId(p.cwd));
      fs.mkdirSync(slot, { recursive: true });
      fs.writeFileSync(path.join(slot, 'db.sqlite'), `index of ${p.name}`);
    }
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-migrate-'));
    file = path.join(dir, 'workspaces.json');
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rewrites ids from the old slug, renames the slot dirs and stamps schema 3', () => {
    const a = path.join(dir, 'repos', 'app-spec');
    const b = path.join(dir, 'repos', 'Marketing Site');
    legacyRegistry([
      { cwd: a, name: 'app-spec' },
      { cwd: b, name: 'Marketing Site' },
    ], { trustProjectPlugins: true });

    const registry = new WorkspaceRegistry(dir);
    expect(registry.isMigrationPending()).toBe(true);
    const renames = registry.migrateIfNeeded();
    expect(renames.map((r) => r.to)).toEqual(['app-spec', 'marketing-site']);

    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(after.$schemaVersion).toBe(3);
    expect(after.workspaces[0].projects.map((p: { id: string }) => p.id)).toEqual(['app-spec', 'marketing-site']);
    // The retired slug field is gone; other fields survive.
    expect(after.workspaces[0].projects[0]).not.toHaveProperty('name');
    expect(after.workspaces[0].projects[0].trustProjectPlugins).toBe(true);

    expect(fs.existsSync(path.join(dir, 'default', legacyHashId(a)))).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'default', 'app-spec', 'db.sqlite'), 'utf8')).toBe('index of app-spec');
    expect(readSlotMarker(path.join(dir, 'default', 'marketing-site'))).toEqual({ cwd: b });
    expect(registry.isMigrationPending()).toBe(false);
  });

  it('is idempotent — a second run is a no-op', () => {
    legacyRegistry([{ cwd: path.join(dir, 'p'), name: 'p' }]);
    const registry = new WorkspaceRegistry(dir);
    registry.migrateIfNeeded();
    const once = fs.readFileSync(file, 'utf8');
    expect(registry.migrateIfNeeded()).toEqual([]);
    expect(fs.readFileSync(file, 'utf8')).toBe(once);
  });

  it('completes a run interrupted after the slot rename (registry still carries the hash id)', () => {
    const cwd = path.join(dir, 'repos', 'half-done');
    legacyRegistry([{ cwd, name: 'half-done' }]);
    // Simulate the crash window: marker written, slot renamed, registry NOT written.
    const hashSlot = path.join(dir, 'default', legacyHashId(cwd));
    writeSlotMarker(hashSlot, cwd);
    fs.renameSync(hashSlot, path.join(dir, 'default', 'half-done'));

    const registry = new WorkspaceRegistry(dir);
    expect(registry.isMigrationPending()).toBe(true);
    registry.migrateIfNeeded();

    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Adopts the already-renamed slot — does NOT mint `half-done-2` beside it.
    expect(after.workspaces[0].projects[0].id).toBe('half-done');
    expect(fs.readFileSync(path.join(dir, 'default', 'half-done', 'db.sqlite'), 'utf8')).toBe('index of half-done');
  });

  it('keeps a readable id clear of a detached project\'s leftover slot', () => {
    const live = path.join(dir, 'repos', 'live', 'spec');
    legacyRegistry([{ cwd: live, name: 'spec' }]);
    // A readable-id slot belonging to another directory already exists.
    writeSlotMarker(path.join(dir, 'default', 'spec'), path.join(dir, 'repos', 'gone', 'spec'));

    new WorkspaceRegistry(dir).migrateIfNeeded();
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(after.workspaces[0].projects[0].id).toBe('spec-2');
  });

  it('reads see migrated ids in memory, writes refuse until the server migrates', () => {
    legacyRegistry([{ cwd: path.join(dir, 'repos', 'app-spec'), name: 'app-spec' }]);
    const before = fs.readFileSync(file, 'utf8');
    const registry = new WorkspaceRegistry(dir);

    expect(registry.getWorkspace('default')!.projects[0]!.id).toBe('app-spec');
    expect(() => registry.touchLastOpened('default')).toThrow(RegistryMigrationPendingError);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  it('a v2 registry with no projects needs no migration', () => {
    fs.writeFileSync(
      file,
      JSON.stringify({ $schemaVersion: 2, workspaces: [{ name: 'default', mode: 'prod', defaultPort: 4500, projects: [] }] }),
    );
    const registry = new WorkspaceRegistry(dir);
    expect(registry.isMigrationPending()).toBe(false);
    registry.touchLastOpened('default');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).$schemaVersion).toBe(3);
  });

  describe('c4s trust-plugins', () => {
    let prevHome: string | undefined;
    beforeEach(() => {
      prevHome = process.env.C4S_HOME;
      process.env.C4S_HOME = dir;
    });
    afterEach(() => {
      if (prevHome === undefined) delete process.env.C4S_HOME;
      else process.env.C4S_HOME = prevHome;
    });

    it('refuses REGISTRY_MIGRATION_PENDING on a hash-id registry, with a structured repair step', async () => {
      const cwd = path.join(dir, 'repos', 'app-spec');
      legacyRegistry([{ cwd, name: 'app-spec' }]);
      const err = await runTrustPlugins(parseArgs(['trust-plugins', '--cwd', cwd, 'true'])).catch((e) => e);
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).code).toBe('REGISTRY_MIGRATION_PENDING');
      expect((err as CliError).hint).toContain('start the claude4spec server once');
      expect((err as CliError).details?.steps).toEqual([
        { action: 'start-server', command: 'npx @inharness-ai/claude4spec' },
        { action: 'rerun' },
      ]);
    });

    it('mints the record by the registry rule and stays idempotent per --cwd', async () => {
      const cwd = path.join(dir, 'repos', 'fresh');
      writeConfig(cwd, 'Fresh Spec');
      const stdout: string[] = [];
      const write = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: string) => (stdout.push(String(chunk)), true)) as typeof process.stdout.write;
      try {
        await runTrustPlugins(parseArgs(['trust-plugins', '--cwd', cwd, 'true']));
        await runTrustPlugins(parseArgs(['trust-plugins', '--cwd', cwd, 'false']));
      } finally {
        process.stdout.write = write;
      }
      const projects = new WorkspaceRegistry(dir).getWorkspace('default')!.projects;
      expect(projects).toHaveLength(1);
      expect(projects[0]).toMatchObject({ id: 'fresh-spec', trustProjectPlugins: false });
    });
  });
});

function writeConfig(cwd: string, name: string): void {
  fs.mkdirSync(path.join(cwd, '.claude4spec'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.claude4spec', 'config.json'), JSON.stringify({ name }));
}
