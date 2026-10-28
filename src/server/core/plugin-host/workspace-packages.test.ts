/**
 * M33 (2.1.58) — the base tier's workspace packages resolve in ONE directory:
 * `node_modules` of the workspace's slots directory (M31 `vzkw903j`). The
 * locator (`workspace-packages.ts`) answers load, watch and frontend discovery;
 * these tests build real packages on disk (mkdtemp + package.json + dist, the
 * repo convention) and import them for real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import request from 'supertest';
import { loadWorkspacePlugins, reloadPlugin, type PluginLoadRecord } from './loader.js';
import { PluginRegistryImpl } from './registry.js';
import { basePackageLocator, resolveEsmPackageEntry, workspaceNodeModulesDir } from './workspace-packages.js';
import { baseFrontendSources, basePool } from './frontend-assets.js';
import { WorkspaceRegistry } from '../../workspace/registry.js';
import { workspaceFilePath } from '../../workspace/home-workspace.js';
import { enumerateOverlayPackages, projectPluginsDir } from './overlay-loader.js';
import { pluginsRouter } from '../../routes/plugins.js';

function writeTree(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

/** A valid ESM manifest module (commands only — no entity type to set up). */
function manifestModule(name: string, version: string): string {
  return `export const manifest = {
  name: ${JSON.stringify(name)},
  version: ${JSON.stringify(version)},
  hostApiVersion: '^2.0.0',
  contributes: { commands: [{ name: ${JSON.stringify(`cmd-${name.replace(/[^a-z0-9]/gi, '-')}`)}, trigger: 'x', label: 'X', popoverKind: 'x' }] },
};
`;
}

let tmp: string;
/** The workspace's slots directory (a registry workspace: `~/.claude4spec/<ws>/`). */
let slots: string;
let nodeModules: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-ws-pkgs-'));
  slots = path.join(tmp, 'registry', 'default');
  nodeModules = workspaceNodeModulesDir(slots);
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Install `name` into the workspace `node_modules` as an ESM-only package with a built backend. */
function install(name: string, version = '1.0.0', extra: Record<string, string> = {}): string {
  const dir = path.join(nodeModules, ...name.split('/'));
  writeTree(dir, {
    'package.json': JSON.stringify({
      name,
      version,
      type: 'module',
      exports: { '.': { import: './dist/index.js' }, './frontend': './dist/frontend.js' },
    }),
    'dist/index.js': manifestModule(name, version),
    ...extra,
  });
  return dir;
}

describe('workspace node_modules — where the listed packages live', () => {
  it('[section:m33l2001] is `node_modules` of the slots directory, for a registry workspace and for one with a home', () => {
    const registry = new WorkspaceRegistry(path.join(tmp, 'registry'));
    expect(workspaceNodeModulesDir(registry.slotsDir({ name: 'default' }))).toBe(
      path.join(tmp, 'registry', 'default', 'node_modules'),
    );
    const home = path.join(tmp, 'team-home');
    expect(workspaceNodeModulesDir(registry.slotsDir({ name: 'team', home }))).toBe(
      path.join(home, '.claude4spec', 'local', 'node_modules'),
    );
  });
});

describe('loadWorkspacePlugins with the base locator', () => {
  it('[section:m33l2001] imports a listed package from the workspace node_modules — the very file the locator resolved', async () => {
    install('@acme/glossary', '1.2.0');
    const locator = basePackageLocator(nodeModules);
    const importer = vi.fn((spec: string) => import(spec));
    const { records } = await loadWorkspacePlugins(new PluginRegistryImpl(), ['@acme/glossary'], importer, locator);

    expect(records).toEqual([
      expect.objectContaining({ package: '@acme/glossary', status: 'loaded', manifestVersion: '1.2.0' }),
    ]);
    const entry = locator.resolveEntry('@acme/glossary')!;
    expect(entry).toBe(path.join(nodeModules, '@acme', 'glossary', 'dist', 'index.js'));
    expect(importer).toHaveBeenCalledWith(pathToFileURL(entry).href);
  });

  it('[ac:ac-pakiet-z-listy-pluginow-workspace-u-k] a listed package missing from the workspace node_modules is skipped with a diagnosis in plugins status, and the start goes on', async () => {
    install('present');
    const locator = basePackageLocator(nodeModules);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let records: PluginLoadRecord[];
    const pluginRegistry = new PluginRegistryImpl();
    try {
      // `semver` IS installed next to the host — it must not be found there.
      ({ records } = await loadWorkspacePlugins(
        pluginRegistry,
        ['@acme/missing', 'semver', 'present'],
        (spec) => import(spec),
        locator,
      ));
    } finally {
      warn.mockRestore();
    }

    for (const pkg of ['@acme/missing', 'semver']) {
      const rec = records.find((r) => r.package === pkg)!;
      expect(rec, pkg).toMatchObject({ status: 'skipped', code: 'PLUGIN_NOT_INSTALLED', layer: 'base' });
      expect(rec.reason, pkg).toContain(nodeModules);
    }
    // The start goes on: the package after the missing ones still loads.
    expect(records.find((r) => r.package === 'present')).toMatchObject({ status: 'loaded' });

    // The diagnosis is what `c4s plugins status` reads: GET /_meta/plugins.
    const app = express();
    app.use('/api', pluginsRouter({ pluginRegistry, pluginRecords: records, resolveWorkspaceRoot: locator.packageRoot }));
    const res = await request(app).get('/api/_meta/plugins').expect(200);
    const missing = (res.body.packages as PluginLoadRecord[]).find((p) => p.package === '@acme/missing');
    expect(missing).toMatchObject({ status: 'skipped', code: 'PLUGIN_NOT_INSTALLED', reason: expect.stringContaining(nodeModules) });
  });

  it('[section:m33l2001] the server never installs: a missing package stays absent from the workspace node_modules after the load', async () => {
    const locator = basePackageLocator(nodeModules);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await loadWorkspacePlugins(new PluginRegistryImpl(), ['@acme/missing'], (spec) => import(spec), locator);
    } finally {
      warn.mockRestore();
    }
    expect(fs.existsSync(path.join(nodeModules, '@acme', 'missing'))).toBe(false);
    expect(fs.existsSync(nodeModules)).toBe(false);
    // And the loader modules carry no package-manager call at all.
    for (const file of ['loader.ts', 'workspace-packages.ts']) {
      const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), file), 'utf8');
      expect(src, file).not.toMatch(/child_process|spawn\(|execFile|execSync/);
    }
  });

  it('[section:m33l2001] an installed package without an ESM entry fails, it is not looked up elsewhere', async () => {
    writeTree(path.join(nodeModules, 'cjs-only'), {
      'package.json': JSON.stringify({ name: 'cjs-only', exports: { '.': { require: './index.cjs' } } }),
      'index.cjs': 'module.exports = {};',
    });
    const importer = vi.fn((spec: string) => import(spec));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { records } = await loadWorkspacePlugins(
        new PluginRegistryImpl(),
        ['cjs-only'],
        importer,
        basePackageLocator(nodeModules),
      );
      expect(records[0]).toMatchObject({ package: 'cjs-only', status: 'failed', code: 'PLUGIN_IMPORT_FAILED' });
    } finally {
      warn.mockRestore();
    }
    expect(importer).not.toHaveBeenCalled();
  });
});

describe('resolveEsmPackageEntry — the ESM resolution of the `.` export', () => {
  const pkgDir = (): string => path.join(nodeModules, 'p');

  it('[section:m33l7wch] honours the import condition of an ESM-only package and never the require condition', () => {
    writeTree(pkgDir(), {
      'package.json': JSON.stringify({ exports: { '.': { require: './cjs.cjs', import: './esm.js' } } }),
      'cjs.cjs': '',
      'esm.js': '',
    });
    expect(resolveEsmPackageEntry(pkgDir())).toBe(path.join(pkgDir(), 'esm.js'));

    fs.writeFileSync(path.join(pkgDir(), 'package.json'), JSON.stringify({ exports: { require: './cjs.cjs' } }));
    expect(resolveEsmPackageEntry(pkgDir())).toBeNull();
  });

  it('[section:m33l7wch] takes the first matching condition in declaration order, string and array sugar, then main / index.js', () => {
    writeTree(pkgDir(), { 'a.js': '', 'b.js': '', 'lib/index.js': '', 'index.js': '' });
    const write = (pkg: unknown): void => fs.writeFileSync(path.join(pkgDir(), 'package.json'), JSON.stringify(pkg));

    write({ exports: { types: './x.d.ts', default: './b.js', import: './a.js' } });
    expect(resolveEsmPackageEntry(pkgDir())).toBe(path.join(pkgDir(), 'b.js'));
    write({ exports: './a.js' });
    expect(resolveEsmPackageEntry(pkgDir())).toBe(path.join(pkgDir(), 'a.js'));
    write({ exports: ['bad', { node: './b.js' }] });
    expect(resolveEsmPackageEntry(pkgDir())).toBe(path.join(pkgDir(), 'b.js'));
    write({ main: 'lib' });
    expect(resolveEsmPackageEntry(pkgDir())).toBe(path.join(pkgDir(), 'lib', 'index.js'));
    write({});
    expect(resolveEsmPackageEntry(pkgDir())).toBe(path.join(pkgDir(), 'index.js'));
  });

  it('[section:m33l7wch] never resolves outside the package, nor a package name that would escape the directory', () => {
    writeTree(path.join(nodeModules, 'escape'), { 'package.json': JSON.stringify({ exports: './../other/index.js' }) });
    writeTree(path.join(nodeModules, 'other'), { 'package.json': '{}', 'index.js': '' });
    expect(resolveEsmPackageEntry(path.join(nodeModules, 'escape'))).toBeNull();

    writeTree(path.join(tmp, 'outside'), { 'package.json': '{}', 'index.js': '' });
    const locator = basePackageLocator(nodeModules);
    expect(locator.isInstalled('../../outside')).toBe(false);
    expect(locator.resolveEntry('../../outside')).toBeNull();
  });
});

describe('load ↔ watch ↔ frontend share one resolution from the workspace node_modules', () => {
  it('[section:m33l7wch] the watched directory is the directory of the file the loader imported', async () => {
    install('esm-only');
    const locator = basePackageLocator(nodeModules);
    const imported: string[] = [];
    await loadWorkspacePlugins(
      new PluginRegistryImpl(),
      ['esm-only'],
      (spec) => {
        imported.push(spec);
        return import(spec);
      },
      locator,
    );
    // The base-watcher discovery of `server/index.ts`: dirname of the locator's entry.
    const watched = path.dirname(locator.resolveEntry('esm-only')!);
    expect(watched).toBe(path.join(nodeModules, 'esm-only', 'dist'));
    expect(imported.map((u) => path.dirname(fileURLToPath(u)))).toEqual([watched]);
  });

  it('[section:m33l7wch] a reload whose package no longer resolves keeps the old version — no fallback to the host resolution', async () => {
    const dir = install('esm-only');
    const locator = basePackageLocator(nodeModules);
    const registry = new PluginRegistryImpl();
    await loadWorkspacePlugins(registry, ['esm-only'], (spec) => import(spec), locator);
    fs.rmSync(dir, { recursive: true, force: true });

    const importer = vi.fn((spec: string) => import(spec));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const rec = await reloadPlugin(registry, 'esm-only', { importer, resolveEntry: locator.resolveEntry });
      expect(rec).toMatchObject({ status: 'failed', code: 'PLUGIN_IMPORT_FAILED' });
    } finally {
      warn.mockRestore();
    }
    expect(importer).not.toHaveBeenCalled();
    expect(registry.listPluginRecords().map((r) => r.version)).toEqual(['1.0.0']);
  });

  it('[section:9g96q3pp] the base frontend of a listed package is discovered in the workspace node_modules', () => {
    install('@acme/glossary', '1.4.0', { 'dist/frontend.js': 'export {}', 'dist/frontend.css': '.g{}' });
    const locator = basePackageLocator(nodeModules);
    const sources = baseFrontendSources(
      basePool({
        pluginRecords: [
          { package: '@acme/glossary', status: 'loaded' },
          { package: 'semver', status: 'loaded' },
        ],
        workspacePackages: ['@acme/glossary', 'semver'],
        resolveWorkspaceRoot: locator.packageRoot,
      }),
    );
    expect(sources).toEqual([
      expect.objectContaining({
        kind: 'npm',
        name: '@acme/glossary',
        version: '1.4.0',
        entry: path.join(nodeModules, '@acme', 'glossary', 'dist', 'frontend.js'),
        css: path.join(nodeModules, '@acme', 'glossary', 'dist', 'frontend.css'),
      }),
    ]);
    // A workspace `node_modules` without the package: nothing resolves from the
    // host's own dependencies either (`semver` is installed next to the host).
    const empty = basePackageLocator(path.join(tmp, 'empty-slots', 'node_modules'));
    expect(
      baseFrontendSources(
        basePool({
          pluginRecords: [
            { package: '@acme/glossary', status: 'loaded' },
            { package: 'semver', status: 'loaded' },
          ],
          workspacePackages: ['@acme/glossary', 'semver'],
          resolveWorkspaceRoot: empty.packageRoot,
        }),
      ),
    ).toEqual([]);
  });
});

describe('a workspace with a home — list from the committed workspace.json, packages in <home>/.claude4spec/local/node_modules', () => {
  let home: string;
  let registryHome: string;

  beforeEach(() => {
    home = path.join(tmp, 'repo');
    registryHome = path.join(tmp, 'home-registry');
    fs.mkdirSync(path.join(home, '.claude4spec'), { recursive: true });
    fs.mkdirSync(registryHome, { recursive: true });
    fs.writeFileSync(
      path.join(registryHome, 'workspaces.json'),
      JSON.stringify({ $schemaVersion: 3, workspaces: [{ name: 'team', mode: 'prod', defaultPort: 4601, home }] }),
    );
    fs.writeFileSync(
      workspaceFilePath(home),
      JSON.stringify({ projects: [{ id: 'app', path: 'specs/app' }], plugins: ['@acme/glossary', '@acme/absent'] }),
    );
  });

  it('[section:m33l2001] the base tier loads the view\'s list, each package resolved in the workspace\'s own node_modules', async () => {
    const registry = new WorkspaceRegistry(registryHome);
    const view = registry.openView('team');
    const nm = workspaceNodeModulesDir(registry.slotsDir(view));
    expect(nm).toBe(path.join(home, '.claude4spec', 'local', 'node_modules'));
    writeTree(path.join(nm, '@acme', 'glossary'), {
      'package.json': JSON.stringify({ name: '@acme/glossary', version: '3.0.0', type: 'module', exports: { '.': { import: './dist/index.js' } } }),
      'dist/index.js': manifestModule('@acme/glossary', '3.0.0'),
    });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { records } = await loadWorkspacePlugins(
        new PluginRegistryImpl(),
        view.plugins ?? [],
        (spec) => import(spec),
        basePackageLocator(nm),
      );
      expect(records.map((r) => [r.package, r.status, r.code ?? null])).toEqual([
        ['@acme/glossary', 'loaded', null],
        ['@acme/absent', 'skipped', 'PLUGIN_NOT_INSTALLED'],
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it('[section:m33trst0] [section:m33l10sc] the overlay is `.claude4spec/plugins/` of the PROJECT directory — never the home\'s `.claude4spec/`', () => {
    const registry = new WorkspaceRegistry(registryHome);
    const view = registry.openView('team');
    const project = registry.getProject(view, 'app')!;
    expect(project.cwd).toBe(path.join(home, 'specs', 'app'));
    writeTree(path.join(project.cwd, '.claude4spec', 'plugins', 'local-x'), { 'package.json': '{}', 'index.js': '' });
    // A plugins folder next to the committed workspace description is not an overlay of anyone.
    writeTree(path.join(home, '.claude4spec', 'plugins', 'home-y'), { 'package.json': '{}', 'index.js': '' });

    expect(projectPluginsDir(project.cwd)).toBe(path.join(project.cwd, '.claude4spec', 'plugins'));
    expect(enumerateOverlayPackages(project.cwd)).toEqual(['local-x']);
    // The gate's flag is machine-local: in the registry entry, never in a committed file.
    expect(registry.getProjectTrust(view, 'app')).toBeUndefined();
    registry.setProjectTrust(view, 'app', true);
    expect(registry.getProjectTrust(view, 'app')).toBe(true);
    expect(fs.readFileSync(workspaceFilePath(home), 'utf8')).not.toMatch(/trust/i);
  });
});
