/**
 * 2.1.63 — `diagram` leaves the host's code and arrives as a PREBUILT built-in
 * envelope (M13 `m13plenv` / `hevpbnsk`, M33 `rki0ykan`, L11 `9g96q3pp`).
 *
 * The envelope is committed under `plugins/c4s-plugin-diagram/` as a ready
 * bundle (`package.json` + `dist/`, no source, no source maps) built in the
 * plugin's own repository. The host never builds it: its build step copies the
 * bundle into `dist/plugins/<name>/`, where built-in envelopes are loaded from,
 * and the loader takes it into the base tier like any envelope built from
 * source — outside the `trustProjectPlugins` gate, because it ships in the
 * host package. The direct-registration tier is empty, so nothing else in the
 * host registers the type, and the host's own diagram code (server, shared and
 * client module, `validate_diagram`, the editor's `/diagram` arm and its
 * popover, the fullscreen, the hooks, the `diagram-expand` content) is gone.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PluginRegistryImpl } from '../../../src/server/core/plugin-host/registry.js';
import { loadBuiltinEnvelopes, type PluginLoadRecord } from '../../../src/server/core/plugin-host/loader.js';
import {
  discoverBuiltinEnvelopes,
  servableEnvelopes,
} from '../../../src/server/core/plugin-host/builtin-envelopes.js';
import { basePackageLocator, workspaceNodeModulesDir } from '../../../src/server/core/plugin-host/workspace-packages.js';
import { CATALOG } from '../../../src/server/operations/catalog.js';
import { registerCoreOperations } from '../../../src/server/operations/core-operations.js';
import { FileWatchRuntime } from '../../../src/server/fs/watcher.js';
import { WsGateway } from '../../../src/server/ws/gateway.js';
import { ProjectContextCache } from '../../../src/server/workspace/context-cache.js';
import { projectDispatchMiddleware } from '../../../src/server/workspace/middleware.js';
import { buildProjectContext } from '../../../src/server/workspace/project-context.js';
import { WorkspaceRegistry } from '../../../src/server/workspace/registry.js';
import { bootstrapProject } from '../../../src/server/workspace/bootstrap.js';
import { pluginsRouter } from '../../../src/server/routes/plugins.js';
import { errorHandler } from '../../../src/server/routes/errors.js';
import type { ProjectRecord, WorkspaceRecord } from '../../../src/server/workspace/types.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const ENVELOPE = 'c4s-plugin-diagram';
const PREBUILT_DIR = path.join(REPO_ROOT, 'plugins', ENVELOPE);
const COPY_SCRIPT = path.join(REPO_ROOT, 'scripts', 'copy-prebuilt-envelopes.mjs');

/** Every file under `dir`, relative to it. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(path.relative(dir, full));
    }
  };
  walk(dir);
  return out.sort();
}

/** Source with comments stripped — assertions about code, not prose. */
function codeOf(abs: string): string {
  return fs
    .readFileSync(abs, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Every non-test TS/TSX source file under `rel` (relative to the repo root). */
function sourcesUnder(rel: string): string[] {
  return filesUnder(path.join(REPO_ROOT, rel))
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => path.join(REPO_ROOT, rel, f));
}

describe('[entity:encje-pluginy#c4s-plugin-diagram] diagram ships as a prebuilt built-in envelope', () => {
  it('[entity:encje-pluginy#c4s-plugin-diagram] the committed envelope is a ready bundle the host does not build — package.json + dist/, no source, no source maps', () => {
    expect(fs.existsSync(path.join(PREBUILT_DIR, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(PREBUILT_DIR, 'src'))).toBe(false);
    const pkg = JSON.parse(fs.readFileSync(path.join(PREBUILT_DIR, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.build).toBeUndefined();
    const files = filesUnder(path.join(PREBUILT_DIR, 'dist'));
    expect(files).toEqual(expect.arrayContaining(['index.js', 'frontend.js', 'frontend.css']));
    expect(files.filter((f) => f.endsWith('.map'))).toEqual([]);
  });

  it('[entity:encje-pluginy#c4s-plugin-diagram] the build copies the bundle into dist/plugins/<name> — without source maps, with a flattened package.json — beside build:envelopes, and discovery resolves it there', () => {
    // `build:envelopes` (run by `prebuild` / `pretest`) ends with the copy step.
    const scripts = (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    }).scripts;
    expect(scripts['build:envelopes']).toMatch(/&& node scripts\/copy-prebuilt-envelopes\.mjs$/);

    // The step itself, on a throwaway host root holding the real prebuilt
    // bundle (plus a source map the copy must leave behind), an envelope built
    // from source (which the copy must skip) and a stale output to be emptied.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-prebuilt-copy-'));
    try {
      const prebuilt = path.join(root, 'plugins', ENVELOPE);
      fs.cpSync(PREBUILT_DIR, prebuilt, { recursive: true });
      fs.writeFileSync(path.join(prebuilt, 'dist', 'index.js.map'), '{}');
      const fromSource = path.join(root, 'plugins', 'c4s-plugin-from-source');
      fs.mkdirSync(path.join(fromSource, 'src'), { recursive: true });
      fs.mkdirSync(path.join(fromSource, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(fromSource, 'package.json'), JSON.stringify({ name: 'from-source', main: './dist/index.js' }));
      fs.writeFileSync(path.join(fromSource, 'dist', 'index.js'), 'export const manifest = {};');
      const stale = path.join(root, 'dist', 'plugins', ENVELOPE, 'stale-chunk.js');
      fs.mkdirSync(path.dirname(stale), { recursive: true });
      fs.writeFileSync(stale, '');

      execFileSync(process.execPath, [COPY_SCRIPT, root], { stdio: 'ignore' });

      const out = path.join(root, 'dist', 'plugins', ENVELOPE);
      const copied = filesUnder(out);
      expect(copied).toEqual(
        [...filesUnder(path.join(PREBUILT_DIR, 'dist')), 'package.json'].sort(),
      );
      expect(copied.filter((f) => f.endsWith('.map'))).toEqual([]);
      expect(fs.existsSync(stale)).toBe(false);
      expect(fs.existsSync(path.join(root, 'dist', 'plugins', 'c4s-plugin-from-source'))).toBe(false);

      const manifest = JSON.parse(fs.readFileSync(path.join(out, 'package.json'), 'utf8')) as {
        name: string;
        exports: Record<string, { import: string }>;
        main: string;
      };
      expect(manifest.name).toBe('@inharness-ai/c4s-plugin-diagram');
      expect(manifest.main).toBe('./index.js');
      expect(manifest.exports['.']!.import).toBe('./index.js');
      expect(manifest.exports['./frontend']!.import).toBe('./frontend.js');

      const found = discoverBuiltinEnvelopes(root).find((e) => e.name === ENVELOPE);
      expect(found?.dir).toBe(out);
      expect(found?.specifier.endsWith(`/dist/plugins/${ENVELOPE}/index.js`)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('[entity:encje-pluginy#c4s-plugin-diagram] the base pool gets `diagram` from the envelope, through the loader — not from a direct registration', async () => {
    const registry = new PluginRegistryImpl();
    // Nothing registers the type before the loader runs: the direct tier is empty.
    expect(registry.getAvailable('diagram')).toBeNull();

    const { records } = await loadBuiltinEnvelopes(registry);
    expect(records.find((r) => r.package === ENVELOPE)).toMatchObject({
      status: 'loaded',
      contributedTypes: ['diagram'],
    });
    expect(registry.getAvailable('diagram')).not.toBeNull();
    const record = registry.listPluginRecords().find((p) => p.contributedTypes.includes('diagram'));
    expect(record?.name).toBe(ENVELOPE);
    // The envelope's own `diagram-tools` and `/diagram` command come with it.
    expect(record?.commands?.map((c) => c.trigger)).toContain('diagram');
  }, 60_000);

  it('[entity:encje-pluginy#c4s-plugin-diagram] host code registers no `diagram`: no direct-registration module, no diagram module, no bootstrap call', () => {
    for (const gone of [
      'src/server/core/plugin-host/register-builtins.ts',
      'src/server/entities/diagram/plugin.ts',
      'src/server/entities/diagram/mcp-server.ts',
      'src/server/entities/diagram/validate.ts',
      'src/server/entities/diagram/serializer.ts',
      'src/server/entities/diagram/upgrades.ts',
      'src/shared/entities/diagram',
      'src/client/entities/diagram',
    ]) {
      expect(fs.existsSync(path.join(REPO_ROOT, gone)), gone).toBe(false);
    }
    const bootstrap = codeOf(path.join(REPO_ROOT, 'src/server/index.ts'));
    expect(bootstrap).not.toMatch(/registerAllPlugins|registerDiagram|registerEntityModule/);
    for (const file of [...sourcesUnder('src/server'), ...sourcesUnder('src/shared'), ...sourcesUnder('src/client')]) {
      expect(codeOf(file), path.relative(REPO_ROOT, file)).not.toMatch(/entities\/diagram\/(plugin|schema|api|DiagramCard)/);
    }
  });
});

describe('[ac:ac-koperta-prebuilt-laduje-sie-w-projekc] the prebuilt envelope loads in a project without trustProjectPlugins consent', () => {
  let home: string;
  let prevHome: string | undefined;
  let registry: WorkspaceRegistry;
  let workspace: WorkspaceRecord;
  let cache: ProjectContextCache;
  let serverApp: express.Express;
  let httpServer: http.Server;
  let watchRuntime: FileWatchRuntime;
  let project: ProjectRecord;
  const overlayImports: string[] = [];

  beforeAll(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-prebuilt-untrusted-'));
    prevHome = process.env.C4S_HOME;
    process.env.C4S_HOME = path.join(home, 'registry');
    registry = new WorkspaceRegistry(process.env.C4S_HOME);
    workspace = registry.selectOrCreate({ name: 'default' });

    // A cloned repo bringing a project-local plugin, and NO consent given: the
    // trust gate is engaged for this project, and stays closed.
    const cwd = path.join(home, 'project');
    project = bootstrapProject(registry, workspace, cwd).project;
    const local = path.join(cwd, '.claude4spec', 'plugins', 'local-untrusted');
    fs.mkdirSync(path.join(local, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(local, 'package.json'), JSON.stringify({ name: 'local-untrusted', version: '0.1.0', main: 'index.js' }));
    fs.writeFileSync(path.join(local, 'index.js'), '');
    fs.writeFileSync(path.join(local, 'dist', 'frontend.js'), 'export {};');
    workspace = registry.getWorkspace('default')!;

    const pluginRegistry = new PluginRegistryImpl();
    const envelopeLoad = await loadBuiltinEnvelopes(pluginRegistry);
    const pluginRecords: PluginLoadRecord[] = [...envelopeLoad.records];
    const nodeModules = workspaceNodeModulesDir(registry.slotsDir(workspace));
    const frontendBase = {
      workspacePackages: [],
      envelopes: servableEnvelopes(discoverBuiltinEnvelopes(), envelopeLoad.records),
      resolveWorkspaceRoot: basePackageLocator(nodeModules).packageRoot,
    };

    httpServer = http.createServer();
    const gateway = new WsGateway(httpServer, () => true);
    watchRuntime = new FileWatchRuntime({ broadcaster: { broadcast: () => {} } });
    cache = new ProjectContextCache((p) =>
      buildProjectContext({
        registry,
        pluginRegistry,
        pluginRecords,
        frontendBase,
        // Recorded, never satisfied: an untrusted overlay must not be imported at all.
        overlayImporter: async (href: string) => {
          overlayImports.push(href);
          throw new Error('an untrusted overlay was imported');
        },
        workspace,
        projectId: p.id,
        cwd: p.cwd,
        gateway,
        watchRuntime,
        mode: 'prod',
        onContextConfigChanged: (opts) => cache.invalidate(p.id, opts),
      }),
    );

    serverApp = express();
    serverApp.use(express.json());
    serverApp.use('/api', pluginsRouter({ pluginRegistry, pluginRecords, ...frontendBase }));
    serverApp.use('/api/projects/:id', projectDispatchMiddleware(registry, workspace, cache));
    serverApp.use('/api', errorHandler);
  }, 60_000);

  afterAll(async () => {
    await cache.disposeAll();
    await watchRuntime.close();
    httpServer.close();
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('[ac:ac-koperta-prebuilt-laduje-sie-w-projekc] `diagram` is active in the untrusted project, and its frontend is announced and served on the base route, while the overlay stays unloaded', async () => {
    const ctx = await cache.get(registry.getProject(workspace, project.id)!);
    // The gate is closed: no consent recorded, the overlay was never imported.
    expect(registry.getProjectTrust(workspace, project.id)).not.toBe(true);
    expect(overlayImports).toEqual([]);

    // …and the prebuilt envelope's type is there all the same.
    expect(ctx.pluginHost.isActive('diagram')).toBe(true);

    const manifest = await request(serverApp).get(`/api/projects/${project.id}/plugins/frontend-manifest`).expect(200);
    const plugins = manifest.body.plugins as Array<{ name: string; entry: string }>;
    expect(plugins.map((p) => p.name)).not.toContain('local-untrusted');
    const diagram = plugins.find((p) => p.name === '@inharness-ai/c4s-plugin-diagram');
    expect(diagram, JSON.stringify(plugins)).toBeDefined();
    // The base tier's process-global address — no project in it, no gate behind it.
    expect(diagram!.entry).toBe('/api/plugins/@inharness-ai%2Fc4s-plugin-diagram/frontend.js');
    const served = await request(serverApp).get(diagram!.entry).expect(200);
    expect(served.text.length).toBeGreaterThan(0);
  }, 120_000);
});

describe('the host carries no diagram tooling of its own', () => {
  it('no host source registers `validate_diagram`, and the host operation catalog declares no row for it — `diagram-tools` is the envelope\'s', () => {
    registerCoreOperations();
    // Seeded, plugin rows included — so the absence below is a real answer.
    expect(CATALOG.get('analyze_ac_against_entities')?.contributedBy).toBe('plugin');
    expect(CATALOG.get('validate_diagram')).toBeUndefined();
    // A registration names the tool or the server as a string literal.
    for (const file of [...sourcesUnder('src/server'), ...sourcesUnder('src/shared')]) {
      expect(codeOf(file), path.relative(REPO_ROOT, file)).not.toMatch(/['"](validate_diagram|diagram-tools)['"]/);
    }
  });

  it('the host editor contributes nothing for `diagram`: no `/diagram` arm, no diagram popover, fullscreen, hooks or `diagram-expand` content', () => {
    for (const gone of [
      'src/client/ui/popovers/DiagramForm.tsx',
      'src/client/components/DiagramFullscreen.tsx',
      'src/client/hooks/useDiagrams.ts',
      'src/client/tiptap/extensions/diagramRender.ts',
    ]) {
      expect(fs.existsSync(path.join(REPO_ROOT, gone)), gone).toBe(false);
    }
    for (const file of sourcesUnder('src/client')) {
      expect(codeOf(file), path.relative(REPO_ROOT, file)).not.toMatch(
        /runDiagram|DiagramForm|DiagramFullscreen|DiagramOverlay|useDiagram|diagramRender|diagramAuthoringExtension|diagram-expand|openPopover\('diagram'/,
      );
    }
    // The page context's slash gates name no `/diagram`: a plugin command takes
    // the reference gate by default (M33 `m33l8cmd`).
    expect(codeOf(path.join(REPO_ROOT, 'src/client/tiptap/contextSpec.ts'))).not.toMatch(/\bdiagram\s*:/);
  });
});
