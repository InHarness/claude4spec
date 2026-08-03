import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry } from './registry.js';
import { bootstrapProject } from './bootstrap.js';
import { configPath } from '../config.js';

/**
 * 0.2.8 — the repair must survive the REAL boot order.
 *
 * `migrateConfigToV4` is well covered in config.test.ts, but every case there
 * calls it directly. That is exactly the blind spot this file exists for:
 * `bootstrapProject` used to call the VALIDATING `loadOrCreateConfig` first, so
 * on the incomplete-`roots[]` configs the repair is for, the load threw and the
 * repair never ran — green unit tests over a function nothing could reach.
 */
describe('bootstrapProject — config migrations run before the validating load', () => {
  let dir: string;
  let cwd: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-boot-order-'));
    cwd = path.join(dir, 'project');
    fs.mkdirSync(path.join(cwd, '.claude4spec'), { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const boot = () => {
    const registry = new WorkspaceRegistry(dir);
    const ws = registry.selectOrCreate({ name: 'default' });
    return bootstrapProject(registry, ws, cwd);
  };

  const writeConfigFile = (cfg: Record<string, unknown>) =>
    fs.writeFileSync(configPath(cwd), JSON.stringify(cfg, null, 2));

  const readConfigFile = () => JSON.parse(fs.readFileSync(configPath(cwd), 'utf8'));

  it('opens a project whose roots[] predates briefTarget/linkTargets', () => {
    writeConfigFile({
      $schemaVersion: 4,
      name: 'Legacy',
      roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true, releasable: true, sectionIndexed: true, referenceValidated: true, sidebar: 'accordion' }],
    });

    expect(() => boot()).not.toThrow();

    const root = readConfigFile().roots[0];
    expect(root.briefTarget).toBe(true);
    expect(root.linkTargets).toEqual([]);
    // The fields it DID carry are preserved, not reset to defaults.
    expect(root.dir).toBe('pages');
  });

  it('carries a legacy git.syncCommitOnRelease through a real bootstrap', () => {
    writeConfigFile({
      $schemaVersion: 4,
      name: 'Legacy',
      roots: [{ id: 'pages', name: 'Pages', dir: 'pages', builtin: true, releasable: true, sectionIndexed: true, referenceValidated: true, linkTargets: [], sidebar: 'accordion', briefTarget: true }],
      git: { syncCommitOnRelease: true },
    });

    boot();

    const git = readConfigFile().git;
    expect(git.enabled).toBe(true);
    expect('syncCommitOnRelease' in git).toBe(false);
  });

  it('still bootstraps a fresh project (no config.json) unchanged', () => {
    fs.rmSync(path.join(cwd, '.claude4spec'), { recursive: true, force: true });
    const result = boot();
    expect(result.configCreated).toBe(true);
    expect(readConfigFile().roots.find((r: { id: string }) => r.id === 'pages')).toBeTruthy();
  });
});
