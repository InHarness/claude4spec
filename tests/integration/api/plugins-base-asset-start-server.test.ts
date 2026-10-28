import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, type ServerHandle } from '../../../src/server/index.js';
import { WorkspaceRegistry } from '../../../src/server/workspace/registry.js';
import { workspaceNodeModulesDir } from '../../../src/server/core/plugin-host/workspace-packages.js';
import type { ProjectRecord } from '../../../src/server/workspace/types.js';

/**
 * M33 / L11 `9g96q3pp` (2.1.58) — the base tier through the REAL `startServer`:
 * not a hand-built `/api` composition, but the routers the process actually
 * mounts. A workspace npm package listed in the workspace and installed in the
 * workspace `node_modules` (M31 `vzkw903j`) is announced by a project's
 * frontend manifest AND served by the process-global asset route
 * `GET /api/plugins/:name/:asset` from that `node_modules` — the route gets the
 * same workspace-root resolver as the manifest, so what is announced loads.
 *
 * The registry lives in a temp home (`C4S_HOME`), the server listens on an
 * ephemeral loopback port, in `prod` mode (no Vite).
 */

const PKG = 'ws-only-glossary';

function writeTree(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

describe('base frontend tier through startServer — workspace npm package', () => {
  let home: string;
  let prevHome: string | undefined;
  let server: ServerHandle;
  let project: ProjectRecord;
  let installedDir: string;

  beforeAll(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-start-base-asset-'));
    prevHome = process.env.C4S_HOME;
    const registryDir = path.join(home, 'registry');
    process.env.C4S_HOME = registryDir;

    const registry = new WorkspaceRegistry(registryDir);
    const created = registry.selectOrCreate({ name: 'default' });
    const projectCwd = path.join(home, 'project');
    fs.mkdirSync(projectCwd, { recursive: true });
    project = registry.registerProject(created, projectCwd);

    // The workspace's plugin list (what `c4s plugins add` writes to the entry).
    const file = JSON.parse(fs.readFileSync(registry.filePath, 'utf-8')) as {
      workspaces: Array<{ name: string; plugins?: string[] }>;
    };
    file.workspaces.find((w) => w.name === 'default')!.plugins = [PKG];
    fs.writeFileSync(registry.filePath, JSON.stringify(file, null, 2));

    // Installed ONLY in the workspace `node_modules` — the host has no such package.
    installedDir = path.join(workspaceNodeModulesDir(registry.slotsDir(created)), PKG);
    writeTree(installedDir, {
      'package.json': JSON.stringify({
        name: PKG,
        version: '3.1.0',
        type: 'module',
        exports: { '.': { import: './dist/index.js' }, './frontend': './dist/frontend.js' },
      }),
      'dist/index.js': `export const manifest = {
  name: ${JSON.stringify(PKG)},
  version: '3.1.0',
  hostApiVersion: '^2.0.0',
  contributes: { commands: [{ name: 'cmd-ws-only-glossary', trigger: 'x', label: 'X', popoverKind: 'x' }] },
};
`,
      'dist/frontend.js': 'export const FROM = "workspace-node-modules";',
      'dist/frontend.css': '.ws-only{}',
    });

    // As `prepareStart` hands it over: the migrated registry and the opened view.
    const workspace = registry.openView('default');
    server = await startServer({ cwd: home, registry, workspace, port: 0, host: '127.0.0.1', mode: 'prod' });
  }, 120_000);

  afterAll(async () => {
    await server?.shutdown();
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('[section:9g96q3pp] the base asset a project manifest announces is served by the process-global route from the workspace node_modules', async () => {
    expect(server.port).toBeGreaterThan(0);
    // The bound loopback address itself (`server.url` names `localhost`, which may resolve to ::1 first).
    const base = `http://127.0.0.1:${server.port}`;

    const manifestRes = await fetch(`${base}/api/projects/${project.id}/plugins/frontend-manifest`);
    expect(manifestRes.status).toBe(200);
    const manifest = (await manifestRes.json()) as {
      plugins: Array<{ name: string; version: string; entry: string; css?: string }>;
    };
    const announced = manifest.plugins.find((p) => p.name === PKG);
    expect(announced).toEqual({
      name: PKG,
      version: '3.1.0',
      entry: `/api/plugins/${PKG}/frontend.js`,
      css: `/api/plugins/${PKG}/frontend.css`,
    });

    // Announced ⇒ served: the very addresses of the manifest, by the route `startServer` mounts.
    const js = await fetch(`${base}${announced!.entry}`);
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toMatch(/^text\/javascript/);
    expect(await js.text()).toBe(fs.readFileSync(path.join(installedDir, 'dist', 'frontend.js'), 'utf-8'));

    const css = await fetch(`${base}${announced!.css}`);
    expect(css.status).toBe(200);
    expect(await css.text()).toBe('.ws-only{}');
  }, 120_000);
});
