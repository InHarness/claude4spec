/**
 * M33 / L11 — a plugin must not bundle its own React or Tiptap.
 *
 * Two copies mean two reconcilers / two editor instances. The L11 contract is
 * externalized peers: the plugin imports the host's singletons (through
 * `@c4s/plugin-runtime` and the import map) and declares them as
 * `peerDependencies`, so the plugin's BUILD — at publication — is where a
 * bundled copy is caught. The loader does not inspect bundles at load time.
 *
 * Pinned against every envelope shipped in this repo, through the artefacts
 * the publication actually uses: `package.json` and the Vite build config.
 */
import { describe, expect, it } from 'vitest';
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
  it('[ac:ac-plugin-bandlujacy-wlasna-kopie-reacta-ti] every envelope with a frontend declares the host singletons as peers and its build leaves them external', async () => {
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

  it('the load-time gate checks host API and engines only — a bundled copy is not a load-time rejection', () => {
    const manifest = {
      name: '@acme/bundles-react',
      version: '1.0.0',
      hostApiVersion: `^${HOST_API_VERSION}`,
      contributes: {},
    };
    expect(gateManifest(manifest)).toBeNull();
  });
});
