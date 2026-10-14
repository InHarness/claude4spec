/**
 * M33 / L11 — a plugin must not bundle its own React or Tiptap.
 *
 * Two copies mean two reconcilers / two editor instances. The L11 contract is
 * externalized peers: the plugin imports the host's singletons (through
 * `@c4s/plugin-runtime` and the server-injected import map) and its frontend
 * build declares them `external`. The protection is the build configuration the
 * starter template carries (M38 `m38ngo01`) — neither `c4s create-plugin` nor the
 * host verifies it, and the loader does not inspect bundles at load time
 * (`m33l5imp`).
 *
 * The starter template lives in its own repository (InHarness/c4s-plugin-scaffold);
 * a built-in envelope in this repo has the starter's layout (`ywud56l6`), so the
 * build check is pinned against every envelope shipped here, through the
 * artefacts the publication actually uses: `package.json` and the Vite config.
 * ASSUMPTION:dev-2003 — the starter template lives in InHarness/c4s-plugin-scaffold
 * (outside this repo); the starter-build criterion is pinned against the envelopes,
 * which share the starter's layout.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gateManifest } from '../../../src/server/core/plugin-host/loader.js';
import { HOST_API_VERSION } from '../../../src/shared/plugin-host/manifest.js';

const pluginsDir = path.resolve(import.meta.dirname, '../../../plugins');

interface PkgJson {
  name: string;
  exports?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const envelopes = fs
  .readdirSync(pluginsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(pluginsDir, d.name, 'package.json')))
  .map((d) => {
    const dir = path.join(pluginsDir, d.name);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as PkgJson;
    return { dir, pkg, hasFrontend: Boolean(pkg.exports && './frontend' in pkg.exports) };
  });

const SINGLETONS = ['react', 'react-dom'];

type External = (id: string) => boolean;

async function rollupExternal(dir: string): Promise<External> {
  const mod = (await import(pathToFileURL(path.join(dir, 'vite.config.ts')).href)) as {
    default: { build?: { rollupOptions?: { external?: unknown } } };
  };
  const external = mod.default.build?.rollupOptions?.external;
  if (typeof external === 'function') return (id) => Boolean((external as External)(id));
  if (Array.isArray(external)) return (id) => external.includes(id);
  return () => false;
}

describe('plugins keep React/Tiptap external — detected at publication, not at load', () => {
  it('[ac:ac-build-frontendu-pluginu-wygenerowaneg] every plugin in the starter layout declares the host peers (React, Tiptap) as peers and its frontend build leaves them external, so the bundle carries no own copy', async () => {
    const withFrontend = envelopes.filter((e) => e.hasFrontend);
    expect(withFrontend.length).toBeGreaterThan(0);

    for (const { dir, pkg } of withFrontend) {
      const peers = Object.keys(pkg.peerDependencies ?? {});
      const deps = Object.keys(pkg.dependencies ?? {});
      const external = await rollupExternal(dir);

      const usesTiptap = peers.includes('@tiptap/core');
      const singletons = [...SINGLETONS, ...(usesTiptap ? ['@tiptap/core'] : [])];
      for (const id of singletons) {
        // Declared as a peer (the consumer's copy), never as an own dependency…
        expect(peers, `${pkg.name}: ${id} must be a peerDependency`).toContain(id);
        expect(deps, `${pkg.name}: ${id} must not be a dependency`).not.toContain(id);
        // …and left out of the bundle by the build.
        expect(external(id), `${pkg.name}: build must keep ${id} external`).toBe(true);
      }
      for (const id of ['react/jsx-runtime', 'react-dom/client', '@c4s/plugin-runtime']) {
        expect(external(id), `${pkg.name}: build must keep ${id} external`).toBe(true);
      }
    }
  });

  it('[ac:ac-plugin-bandlujacy-wlasna-kopie-reacta-ti] the load-time gate checks host API and engines only — a plugin with a bundled React/Tiptap copy is not rejected at load', () => {
    const manifest = {
      name: '@acme/bundles-react',
      version: '1.0.0',
      hostApiVersion: `^${HOST_API_VERSION}`,
      contributes: {},
    };
    expect(gateManifest(manifest)).toBeNull();
  });
});

/**
 * Why the externalization matters: a component written against a SECOND copy of
 * React calls hooks on a dispatcher the host renderer never set, so its hooks
 * fail inside the host tree.
 */
describe('a bundled own React copy runs on a second reconciler instance', () => {
  const nodeRequire = createRequire(import.meta.url);

  /** A fresh instance of the `react` package, as a plugin bundle would carry it. */
  function loadSecondReactCopy(): typeof import('react') {
    const reactDir = path.dirname(nodeRequire.resolve('react/package.json')) + path.sep;
    const ours = (k: string) => k.startsWith(reactDir);
    const saved = new Map<string, NodeJS.Module>();
    for (const k of Object.keys(nodeRequire.cache)) {
      if (ours(k)) {
        saved.set(k, nodeRequire.cache[k]!);
        delete nodeRequire.cache[k];
      }
    }
    try {
      return nodeRequire('react') as typeof import('react');
    } finally {
      // Put the host's copy back so nothing else in this process sees the second one.
      for (const k of Object.keys(nodeRequire.cache)) if (ours(k)) delete nodeRequire.cache[k];
      for (const [k, m] of saved) nodeRequire.cache[k] = m;
    }
  }

  it('[ac:ac-komponenty-pluginu-ze-zbundlowana-wla] components of a plugin with its own bundled React copy render on a second reconciler instance, so their hooks fail in the host tree', () => {
    // The host: its React and its renderer (which binds hooks to the host copy).
    const hostReact = nodeRequire('react') as typeof import('react');
    const { renderToStaticMarkup } = nodeRequire('react-dom/server') as typeof import('react-dom/server');
    const pluginReact = loadSecondReactCopy();
    expect(pluginReact).not.toBe(hostReact);
    expect(pluginReact.useState).not.toBe(hostReact.useState);

    // The same component, once against the host's React (externalized peer) and
    // once against the plugin's own bundled copy.
    function ExternalizedChip() {
      const [label] = hostReact.useState('host');
      return hostReact.createElement('span', null, label);
    }
    function BundledChip() {
      const [label] = pluginReact.useState('plugin');
      return pluginReact.createElement('span', null, label);
    }

    expect(renderToStaticMarkup(hostReact.createElement(ExternalizedChip))).toBe('<span>host</span>');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // The host renderer set ITS dispatcher; the second copy's is empty → the hook throws.
      expect(() => renderToStaticMarkup(hostReact.createElement(BundledChip))).toThrow();
    } finally {
      consoleError.mockRestore();
    }
  });
});
