import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceEntryGoneError, WorkspaceRegistry } from './registry.js';

/**
 * M31 `zovs1ohc` — entry-write guarantee: every write of a registry entry, also
 * one made by another module, is a read-modify-write of the freshly read
 * `workspaces.json` under the registry lock, and keeps the entry's fields the
 * writing process does not know. Every test runs on a temp registry dir (never
 * the developer's `~/.claude4spec`).
 */
describe('WorkspaceRegistry — entry-write guarantee (M31 zovs1ohc)', () => {
  let dir: string;

  const registryFile = () => path.join(dir, 'workspaces.json');
  const readDisk = () => JSON.parse(fs.readFileSync(registryFile(), 'utf8'));
  /** What another process (a newer binary, M54) wrote into the entry after our view was taken. */
  const writeForeignFields = (name: string) => {
    const onDisk = readDisk();
    const entry = onDisk.workspaces.find((w: { name: string }) => w.name === name);
    entry.futureField = { nested: [1, 2, 3] };
    entry.runnerHosts = [{ id: 'h1', url: 'http://runner.local:7000', label: 'lab' }];
    fs.writeFileSync(registryFile(), JSON.stringify(onDisk, null, 2));
  };
  const expectForeignFieldsKept = (name: string) => {
    const entry = readDisk().workspaces.find((w: { name: string }) => w.name === name);
    expect(entry.futureField).toEqual({ nested: [1, 2, 3] });
    expect(entry.runnerHosts).toEqual([{ id: 'h1', url: 'http://runner.local:7000', label: 'lab' }]);
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-entry-write-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('[ac:ac-zapis-wpisu-rejestru-zachowuje-pola-w] every registry write keeps the entry fields the writing process does not know, and works on the freshly read file', () => {
    const registry = new WorkspaceRegistry(dir);
    // The view is taken BEFORE the foreign fields land on disk: a write built
    // from this view would lose them; a fresh read-modify-write keeps them.
    const ws = registry.selectOrCreate({ name: 'default' });
    const project = registry.registerProject(ws, path.join(dir, 'proj-a'));
    writeForeignFields('default');

    registry.touchLastOpened('default', project.id);
    expectForeignFieldsKept('default');

    registry.setNetwork('default', { bindHost: '0.0.0.0' });
    expectForeignFieldsKept('default');

    registry.setProjectTrust(ws, project.id, true);
    registry.setSpecSkillHooksTrust(ws, project.id, true);
    expectForeignFieldsKept('default');

    const second = registry.registerProject(ws, path.join(dir, 'proj-b'));
    expectForeignFieldsKept('default');

    expect(registry.removeProject(ws, second.id)).toBe(true);
    expectForeignFieldsKept('default');

    registry.carryDefaults('default', { defaultPort: 4600 });
    registry.selectOrCreate({ name: 'default' });
    expectForeignFieldsKept('default');

    // The writes themselves landed on the same entry.
    const entry = readDisk().workspaces[0];
    expect(entry.bindHost).toBe('0.0.0.0');
    expect(entry.lastOpenedProject).toBe(project.id);
    expect(entry.projects.map((p: { id: string }) => p.id)).toEqual([project.id]);
    expect(entry.projects[0].trustProjectPlugins).toBe(true);
  });

  it('[ac:ac-zapis-wpisu-rejestru-zachowuje-pola-w] a write from another module (updateEntry) re-reads the file under the lock: it sees and keeps fields written after its view, and an outside write is not lost', () => {
    const writer = new WorkspaceRegistry(dir);
    const ws = writer.selectOrCreate({ name: 'default' });
    // A second process registers a project after the writer took its view.
    const other = new WorkspaceRegistry(dir);
    const otherWs = other.getWorkspace('default')!;
    const project = other.registerProject(otherWs, path.join(dir, 'proj'));
    writeForeignFields('default');

    const seen = writer.updateEntry(ws, (entry) => {
      // Fresh file, not the writer's view: the outside project and fields are there.
      expect(entry.projects?.map((p) => p.id)).toEqual([project.id]);
      expect((entry as unknown as { futureField?: unknown }).futureField).toEqual({ nested: [1, 2, 3] });
      const hosts = entry.runnerHosts ?? [];
      entry.runnerHosts = [...hosts, { id: 'h2', url: 'http://second.local:7000' }];
      return hosts.length;
    });
    expect(seen).toBe(1);

    const stored = readDisk().workspaces[0];
    expect(stored.futureField).toEqual({ nested: [1, 2, 3] });
    expect(stored.runnerHosts).toEqual([
      { id: 'h1', url: 'http://runner.local:7000', label: 'lab' },
      { id: 'h2', url: 'http://second.local:7000' },
    ]);
    expect(stored.projects.map((p: { id: string }) => p.id)).toEqual([project.id]);
    // The registry lock is released after the write.
    expect(fs.existsSync(registryFile() + '.lock')).toBe(false);
  });

  it('[section:zovs1ohc] updateEntry refuses an entry that is gone (by name and home) and writes nothing', () => {
    const registry = new WorkspaceRegistry(dir);
    registry.selectOrCreate({ name: 'default' });
    const before = fs.readFileSync(registryFile(), 'utf8');

    expect(() => registry.updateEntry({ name: 'missing' }, () => null)).toThrow(WorkspaceEntryGoneError);
    expect(() => registry.updateEntry({ name: 'default', home: path.join(dir, 'elsewhere') }, () => null)).toThrow(
      WorkspaceEntryGoneError,
    );
    expect(fs.readFileSync(registryFile(), 'utf8')).toBe(before);
  });

  it('[section:t97gncju] runnerHosts of a workspace with a home stays in the registry entry — never in the committed workspace.json', () => {
    const home = path.join(dir, 'repo');
    const registry = new WorkspaceRegistry(path.join(dir, 'registry'));
    const ws = registry.selectOrCreate({ cwd: home, userHome: path.join(dir, 'user-home') });
    expect(ws.home).toBe(path.resolve(home));

    registry.updateEntry(ws, (entry) => {
      entry.runnerHosts = [{ id: 'h1', url: 'http://runner.local:7000' }];
    });
    // A write into workspace.json (registration) after the runner hosts were stored.
    const project = registry.registerProject(ws, path.join(home, 'proj'));

    const committed = JSON.parse(fs.readFileSync(path.join(home, '.claude4spec', 'workspace.json'), 'utf8'));
    expect(committed).toEqual({ projects: [{ id: project.id, path: 'proj' }], plugins: [] });
    expect(JSON.stringify(committed)).not.toContain('runnerHosts');

    const entry = JSON.parse(fs.readFileSync(path.join(dir, 'registry', 'workspaces.json'), 'utf8')).workspaces[0];
    expect(entry.runnerHosts).toEqual([{ id: 'h1', url: 'http://runner.local:7000' }]);
    expect(entry.projects).toBeUndefined();
    // The view carries the machine-local attribute of the entry.
    expect(new WorkspaceRegistry(path.join(dir, 'registry')).getWorkspace(ws.name)?.runnerHosts).toEqual([
      { id: 'h1', url: 'http://runner.local:7000' },
    ]);
  });
});
