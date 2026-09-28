import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry } from './registry.js';
import { legacyHashId, mintProjectId, normalizeProjectId, PROJECT_ID_MAX } from './project-id.js';
import { readSlotMarker } from './slot-marker.js';

/** Hand-edit a project's stored `cwd` in workspaces.json, id untouched — the
 * scenario the spec documents as supported ("moved directory"). */
function editProjectCwd(registry: WorkspaceRegistry, id: string, newCwd: string): void {
  const file = registry.filePath;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.workspaces[0].projects.find((p: { id: string }) => p.id === id).cwd = newCwd;
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function writeConfigName(cwd: string, name: string): void {
  fs.mkdirSync(path.join(cwd, '.claude4spec'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.claude4spec', 'config.json'), JSON.stringify({ name }));
}

describe('project id — normalization and minting (M31 #13)', () => {
  it('transliterates to [a-z0-9-], collapsing everything else to single dashes', () => {
    expect(normalizeProjectId('C4S - App Spec')).toBe('c4s-app-spec');
    expect(normalizeProjectId('Zażółć gęślą jaźń')).toBe('zazolc-gesla-jazn');
    expect(normalizeProjectId('  --Łódź.v2__beta--  ')).toBe('lodz-v2-beta');
    expect(normalizeProjectId('app-spec')).toBe('app-spec');
  });

  it('an empty result becomes `project`', () => {
    expect(normalizeProjectId('')).toBe('project');
    expect(normalizeProjectId('💥 !!! 🌀')).toBe('project');
  });

  it('caps the id at 48 chars, suffix included', () => {
    const long = 'a'.repeat(80);
    expect(normalizeProjectId(long)).toHaveLength(PROJECT_ID_MAX);
    const taken = new Set([normalizeProjectId(long)]);
    const second = mintProjectId(long, taken);
    expect(second).toHaveLength(PROJECT_ID_MAX);
    expect(second.endsWith('-2')).toBe(true);
  });

  it('collisions take -2, -3, … in order', () => {
    expect(mintProjectId('spec', new Set())).toBe('spec');
    expect(mintProjectId('spec', new Set(['spec']))).toBe('spec-2');
    expect(mintProjectId('Spec', new Set(['spec', 'spec-2']))).toBe('spec-3');
  });
});

describe('WorkspaceRegistry.registerProject — readable, immutable id', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-project-id-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('mints from config.json `name`, falling back to the directory name', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    const named = path.join(dir, 'repo-x');
    writeConfigName(named, 'Billing API');
    expect(registry.registerProject(ws, named).id).toBe('billing-api');
    expect(registry.registerProject(ws, path.join(dir, 'No Config Here')).id).toBe('no-config-here');
  });

  it('a second project with the same name in the workspace gets -2', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    const a = registry.registerProject(ws, path.join(dir, 'a', 'spec'));
    const b = registry.registerProject(registry.getWorkspace('default')!, path.join(dir, 'b', 'spec'));
    expect([a.id, b.id]).toEqual(['spec', 'spec-2']);
  });

  it('is idempotent per directory and never recomputes the id', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    const cwd = path.join(dir, 'stable');
    writeConfigName(cwd, 'First Name');
    const first = registry.registerProject(ws, cwd);
    writeConfigName(cwd, 'Renamed Completely');
    const again = registry.registerProject(registry.getWorkspace('default')!, cwd);
    expect(again.id).toBe(first.id);
    expect(first.id).toBe('first-name');
    expect(registry.getWorkspace('default')!.projects).toHaveLength(1);
  });

  it('a hand-edited cwd keeps the id, the /api/projects/<id> address and the db slot', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    const project = registry.registerProject(ws, path.join(dir, 'repo-old'));
    const slot = registry.slotDir(ws, project.id);
    const moved = path.join(dir, 'repo-new');
    editProjectCwd(registry, project.id, moved);

    expect(registry.resolveWorkspacesForCwd(moved).map((w) => w.name)).toEqual(['default']);
    expect(registry.getProject(ws, project.id)?.cwd).toBe(moved);
    expect(registry.slotDir(ws, project.id)).toBe(slot);
  });

  it('a new project at a moved project\'s vacated path never gets its id or slot', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    const oldPath = path.join(dir, 'repo-old');
    const a = registry.registerProject(ws, oldPath);
    editProjectCwd(registry, a.id, path.join(dir, 'repo-new'));

    const b = registry.registerProject(registry.getWorkspace('default')!, oldPath);
    expect(b.id).not.toBe(a.id);
    expect(new Set(registry.getWorkspace('default')!.projects.map((p) => p.id)).size).toBe(2);
  });

  it('writes a slot marker naming the directory the slot serves', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    const cwd = path.join(dir, 'marked');
    const project = registry.registerProject(ws, cwd);
    expect(readSlotMarker(registry.slotDir(ws, project.id))).toEqual({ cwd });
  });
});

describe('WorkspaceRegistry — detach, purge and re-registration', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-project-slot-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('re-registering a DETACHED directory recovers its id and its slot (index included)', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    const cwd = path.join(dir, 'detach-me');
    writeConfigName(cwd, 'Original');
    const first = registry.registerProject(ws, cwd);
    fs.writeFileSync(path.join(registry.slotDir(ws, first.id), 'db.sqlite'), 'index');

    registry.removeProject(ws, first.id); // detach: the slot stays
    writeConfigName(cwd, 'Renamed Meanwhile');
    const again = registry.registerProject(registry.getWorkspace('default')!, cwd);

    expect(again.id).toBe(first.id);
    expect(fs.readFileSync(path.join(registry.slotDir(ws, again.id), 'db.sqlite'), 'utf8')).toBe('index');
  });

  it('a NEW project named like a detached one gets a suffix, never the detached slot', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    const detached = registry.registerProject(ws, path.join(dir, 'one', 'spec'));
    registry.removeProject(ws, detached.id);

    const newcomer = registry.registerProject(registry.getWorkspace('default')!, path.join(dir, 'two', 'spec'));
    expect(newcomer.id).toBe('spec-2');
    expect(readSlotMarker(registry.slotDir(ws, 'spec'))?.cwd).toBe(path.join(dir, 'one', 'spec'));
  });

  it('purge (slot deleted) frees the id: re-registration starts from a fresh, empty slot', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    const cwd = path.join(dir, 'purge-me');
    const first = registry.registerProject(ws, cwd);
    fs.writeFileSync(path.join(registry.slotDir(ws, first.id), 'db.sqlite'), 'old runtime');
    registry.removeProject(ws, first.id);
    fs.rmSync(registry.slotDir(ws, first.id), { recursive: true, force: true });

    const again = registry.registerProject(registry.getWorkspace('default')!, cwd);
    expect(again.id).toBe(first.id);
    expect(fs.existsSync(path.join(registry.slotDir(ws, again.id), 'db.sqlite'))).toBe(false);
  });

  it('a legacy (pre-2.1.0, marker-less) hash slot of a detached project is recovered by its directory', () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    const cwd = path.join(dir, 'legacy-detached');
    const legacySlot = registry.slotDir(ws, legacyHashId(cwd));
    fs.mkdirSync(legacySlot, { recursive: true });
    fs.writeFileSync(path.join(legacySlot, 'db.sqlite'), 'legacy index');

    const project = registry.registerProject(ws, cwd);
    expect(project.id).toBe(legacyHashId(cwd));
    expect(fs.readFileSync(path.join(registry.slotDir(ws, project.id), 'db.sqlite'), 'utf8')).toBe('legacy index');
  });
});
