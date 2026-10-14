// @vitest-environment happy-dom
/**
 * 2.1.20 (M33 `m33rt001`, "Skutek złej nogi") — a plugin frontend that statically
 * imports a backend-only value of `@c4s/plugin-runtime` never registers its
 * frontend module, and the host goes on without that plugin.
 *
 * Two halves, because they live in two runtimes:
 *
 *  1. The link failure is a fact of native ES modules, which this test runner
 *     does not reproduce (it transforms and aliases imports). So a `node`
 *     subprocess plays the browser: the bare specifier is mapped onto the very
 *     shim the server renders for the import map (`getRuntimeShim`), the host's
 *     singletons sit on `globalThis.__c4s_shared`, and the plugin entry is
 *     imported the way `boot-plugins.ts` imports it. The entry never runs — so
 *     its `registerFrontendModule` call never happens.
 *  2. The host side: `bootFrontendPlugins` imports the same entry, the import
 *     rejects, and the boot logs it and carries on — the host's own modules stay
 *     registered and are mounted, and the boot settles. (Here the entry rejects
 *     whichever way the runner loads it: natively the bare specifier has no
 *     import map; through the runner's alias it lands on the Node barrel, which
 *     has no `registerFrontendModule`. Either way the host's
 *     `registerFrontendModule` is never reached.)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FrontendManifestResponse } from '../../shared/plugin-host/frontend-manifest.js';
import { pluginRuntimeLegOf, pluginRuntimeNamesOnLeg } from '../../shared/plugin-host/runtime-legs.js';
import { getRuntimeShim } from '../../server/core/plugin-host/runtime-shims.js';

const server = vi.hoisted(() => ({
  manifest: null as unknown as FrontendManifestResponse,
}));
const mountFrontend = vi.hoisted(() => vi.fn());

vi.mock('../lib/api.js', () => ({
  pluginsApi: { frontendManifest: async () => server.manifest },
  metaApi: { pluginCommands: async () => ({ commands: [] }), entities: async () => ({}) },
}));
vi.mock('../lib/api-core.js', () => ({ PROJECT_ID: '' }));
vi.mock('../tiptap/mountFrontend.js', () => ({ mountFrontend: (...a: unknown[]) => mountFrontend(...a) }));
vi.mock('../tiptap/pluginCommands.js', () => ({ registerPluginCommands: () => {} }));
vi.mock('./shared-runtime.js', () => ({ sharedRuntimeReady: Promise.resolve() }));

import { clientPluginHost } from '../core/plugin-host/host.js';
import { bootFrontendPlugins, pluginBootPending } from './boot-plugins.js';
import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../tests/helpers/fixture-module.js';
import type { FrontendModule } from '../core/plugin-host/types.js';

/** The backend-only value the plugin reaches for. */
const BACKEND_ONLY = 'createMcpServer';

interface NativeResult {
  bad: { ok: boolean; name?: string; message?: string };
  good: { ok: boolean; name?: string; message?: string };
  registered: string[];
}

describe('a plugin frontend importing a backend-only @c4s/plugin-runtime value', () => {
  let dir: string;
  let badEntry: string;
  let native: NativeResult | null = null;
  let failure = '';

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-backend-only-import-'));

    // The browser leg exactly as the import map serves it.
    const shim = await getRuntimeShim('plugin-runtime');
    const shimFile = path.join(dir, 'plugin-runtime-shim.mjs');
    fs.writeFileSync(shimFile, shim!);

    // Stand-in for the page's import map: the bare specifier → the shim.
    const hook = path.join(dir, 'import-map-hook.mjs');
    fs.writeFileSync(
      hook,
      [
        `const SHIM = ${JSON.stringify(pathToFileURL(shimFile).href)};`,
        'export async function resolve(specifier, context, next) {',
        "  if (specifier === '@c4s/plugin-runtime') return { url: SHIM, shortCircuit: true };",
        '  return next(specifier, context);',
        '}',
      ].join('\n'),
    );

    // The plugin under test: registers its frontend module, but also imports a backend-only value.
    const bad = path.join(dir, 'gadgets-frontend.mjs');
    fs.writeFileSync(
      bad,
      [
        `import { registerFrontendModule, ${BACKEND_ONLY} } from '@c4s/plugin-runtime';`,
        "registerFrontendModule({ type: 'lgx-gadget' });",
        `export const server = ${BACKEND_ONLY};`,
      ].join('\n'),
    );
    badEntry = pathToFileURL(bad).href;

    // A control plugin importing browser-leg names only.
    const good = path.join(dir, 'control-frontend.mjs');
    fs.writeFileSync(
      good,
      ["import { registerFrontendModule } from '@c4s/plugin-runtime';", "registerFrontendModule({ type: 'lgx-control' });"].join(
        '\n',
      ),
    );

    const out = path.join(dir, 'result.json');
    const probe = path.join(dir, 'probe.mjs');
    fs.writeFileSync(
      probe,
      [
        "import { register } from 'node:module';",
        "import fs from 'node:fs';",
        'const registered = [];',
        'const ns = {};',
        `for (const name of ${JSON.stringify(pluginRuntimeNamesOnLeg('browser'))}) ns[name] = () => {};`,
        'ns.registerFrontendModule = (m) => { registered.push(m.type); };',
        "globalThis.__c4s_shared = { '@c4s/plugin-runtime': ns };",
        `register(${JSON.stringify(pathToFileURL(hook).href)});`,
        'const attempt = async (url) => {',
        '  try { await import(url); return { ok: true }; }',
        '  catch (e) { return { ok: false, name: e?.name, message: String(e?.message ?? e) }; }',
        '};',
        // The control first: the shim is then linked and evaluated, so the
        // plugin under test fails on its own import list, nothing else.
        `const good = await attempt(${JSON.stringify(pathToFileURL(good).href)});`,
        `const bad = await attempt(${JSON.stringify(badEntry)});`,
        `fs.writeFileSync(${JSON.stringify(out)}, JSON.stringify({ bad, good, registered }));`,
      ].join('\n'),
    );

    try {
      execFileSync(process.execPath, [probe], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      native = JSON.parse(fs.readFileSync(out, 'utf8')) as NativeResult;
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      failure = e.stderr || e.message || String(err);
    }
  }, 60_000);

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('[ac:ac-frontend-pluginu-ktory-statycznie-imp] the plugin does not register its frontend module, and the host renders on without it', async () => {
    expect(pluginRuntimeLegOf(BACKEND_ONLY)).toBe('backend');

    // ── 1. natively: the entry fails to link, so its registration never runs ──
    expect(native, failure).not.toBeNull();
    const r = native!;
    expect(r.bad.ok).toBe(false);
    expect(r.bad.name).toBe('SyntaxError');
    expect(r.bad.message).toContain(BACKEND_ONLY);
    // The control plugin, served by the same shim, links and registers…
    expect(r.good.ok).toBe(true);
    // …the plugin with the backend-only import never did.
    expect(r.registered).toEqual(['lgx-control']);

    // ── 2. the host: the failed import is logged and the boot goes on ──
    const hostModule = {
      type: 'lgx-widget',
      data: FIXTURE_DATA,
      slugPattern: FIXTURE_SLUG_PATTERN,
      payloadVersion: 1,
      label: 'Widget',
      labelPlural: 'Widgets',
      displayOrder: 10,
      pathPrefix: '/lgx-widgets',
      renderChip: () => null,
      renderCard: () => null,
      renderOverlay: () => null,
      useGetBySlug: () => ({ data: null, isLoading: false }),
      listByTags: async () => [],
    } as unknown as FrontendModule;
    clientPluginHost.registerFrontendModule(hostModule);

    server.manifest = {
      hostApiVersion: '2.1.0',
      importMap: {},
      plugins: [{ name: '@acme/c4s-plugin-gadgets', version: '1.0.0', entry: badEntry }],
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(bootFrontendPlugins({} as never)).resolves.toBeUndefined();

      // The import failure went to the log, naming the plugin.
      expect(warn.mock.calls.some((args) => String(args[0]).includes('@acme/c4s-plugin-gadgets'))).toBe(true);
    } finally {
      warn.mockRestore();
    }

    // The plugin is gone from the front: no module of it was registered…
    const types = clientPluginHost.listEntities().map((m) => m.type);
    expect(types).not.toContain('lgx-gadget');
    expect(clientPluginHost.getAvailable('lgx-gadget')).toBeNull();
    // …while the host's own modules were mounted as usual, and the boot settled.
    expect(types).toContain('lgx-widget');
    expect(mountFrontend).toHaveBeenCalledTimes(1);
    const mounted = (mountFrontend.mock.calls[0]![1] as FrontendModule[]).map((m) => m.type);
    expect(mounted).toContain('lgx-widget');
    expect(mounted).not.toContain('lgx-gadget');
    expect(pluginBootPending()).toBe(false);
  }, 60_000);
});
