import { describe, expect, it, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  enumerateFrontendBundles,
  resolveFrontendAsset,
  enumerateWorkspaceFrontendBundles,
  resolveWorkspaceFrontendAsset,
  assetContentType,
  resolveOverlayAsset,
  resolveWorkspaceAsset,
  nearestPackageRoot,
} from './frontend-assets.js';
import { buildFrontendManifest } from './frontend-manifest.js';
import { buildImportMap } from './runtime-shims.js';
import { HOST_API_VERSION } from '../../../shared/plugin-host/manifest.js';
import type { PluginRegistry } from './types.js';

// The manifest builder ignores the registry today (the project-local frontend
// axis is filesystem-driven); a bare cast is enough to exercise it.
const REGISTRY = {} as PluginRegistry;

describe('frontend-assets', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-frontend-'));
  });
  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  /**
   * Materialize `<cwd>/.claude4spec/plugins/<name>/` with an optional built
   * `dist/frontend.{js,css}` and a `package.json` carrying `version`.
   */
  function makePkg(
    name: string,
    opts: { version?: string; js?: boolean; css?: boolean; pkgJson?: boolean } = {},
  ): void {
    const { version = '2.3.4', js = true, css = false, pkgJson = true } = opts;
    const dir = path.join(cwd, '.claude4spec', 'plugins', name);
    fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
    if (pkgJson) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version }));
    if (js) fs.writeFileSync(path.join(dir, 'dist', 'frontend.js'), 'export const x = 1;');
    if (css) fs.writeFileSync(path.join(dir, 'dist', 'frontend.css'), '.x{color:red}');
  }

  describe('resolveFrontendAsset', () => {
    it('returns the abs path for a trusted, built bundle', () => {
      makePkg('glossary', { css: true });
      const js = resolveFrontendAsset(cwd, true, 'glossary', 'frontend.js');
      const css = resolveFrontendAsset(cwd, true, 'glossary', 'frontend.css');
      expect(js).toBe(path.join(cwd, '.claude4spec', 'plugins', 'glossary', 'dist', 'frontend.js'));
      expect(css).toBe(path.join(cwd, '.claude4spec', 'plugins', 'glossary', 'dist', 'frontend.css'));
    });

    it('gate off ⇒ null (no project-committed bytes emitted)', () => {
      makePkg('glossary');
      expect(resolveFrontendAsset(cwd, false, 'glossary', 'frontend.js')).toBeNull();
    });

    it('missing build ⇒ null even when trusted', () => {
      makePkg('glossary', { js: false }); // dir + package.json, but no dist/frontend.js
      expect(resolveFrontendAsset(cwd, true, 'glossary', 'frontend.js')).toBeNull();
      // css absent too
      expect(resolveFrontendAsset(cwd, true, 'glossary', 'frontend.css')).toBeNull();
    });

    it('unknown / traversal name ⇒ null (only real overlay packages are eligible)', () => {
      makePkg('glossary');
      expect(resolveFrontendAsset(cwd, true, 'nope', 'frontend.js')).toBeNull();
      expect(resolveFrontendAsset(cwd, true, '..', 'frontend.js')).toBeNull();
      expect(resolveFrontendAsset(cwd, true, '../../etc', 'frontend.js')).toBeNull();
    });
  });

  describe('generalized dist assets (native-ESM siblings)', () => {
    it('assetContentType allowlists only .js/.css/.map', () => {
      expect(assetContentType('dto-ABC123.js')).toBe('text/javascript');
      expect(assetContentType('frontend.css')).toBe('text/css');
      expect(assetContentType('frontend.js.map')).toBe('application/json');
      expect(assetContentType('package.json')).toBeNull();
      expect(assetContentType('secret.env')).toBeNull();
      expect(assetContentType('noext')).toBeNull();
    });

    it('overlay: serves a code-split chunk + source map sibling of frontend.js (trusted)', () => {
      makePkg('glossary');
      const dist = path.join(cwd, '.claude4spec', 'plugins', 'glossary', 'dist');
      fs.writeFileSync(path.join(dist, 'dto-ABC123.js'), 'export const d = 1;');
      fs.writeFileSync(path.join(dist, 'frontend.js.map'), '{}');
      expect(resolveOverlayAsset(cwd, true, 'glossary', 'dto-ABC123.js')).toBe(
        path.join(dist, 'dto-ABC123.js'),
      );
      expect(resolveOverlayAsset(cwd, true, 'glossary', 'frontend.js.map')).toBe(
        path.join(dist, 'frontend.js.map'),
      );
    });

    it('overlay: gate off / disallowed ext / traversal / missing ⇒ null', () => {
      makePkg('glossary');
      const dist = path.join(cwd, '.claude4spec', 'plugins', 'glossary', 'dist');
      fs.writeFileSync(path.join(dist, 'chunk.js'), 'export const c = 1;');
      // Secret next to the bundle must never be served (extension allowlist).
      fs.writeFileSync(path.join(dist, 'secret.json'), '{"k":1}');
      expect(resolveOverlayAsset(cwd, false, 'glossary', 'chunk.js')).toBeNull(); // gate off
      expect(resolveOverlayAsset(cwd, true, 'glossary', 'secret.json')).toBeNull(); // ext
      expect(resolveOverlayAsset(cwd, true, 'glossary', '../package.json')).toBeNull(); // traversal
      expect(resolveOverlayAsset(cwd, true, 'glossary', 'sub/x.js')).toBeNull(); // separator
      expect(resolveOverlayAsset(cwd, true, 'glossary', 'absent.js')).toBeNull(); // missing
      expect(resolveOverlayAsset(cwd, true, 'nope', 'chunk.js')).toBeNull(); // unknown pkg
    });

    it('workspace: serves a chunk sibling of the resolved frontend entry, ungated but allowlist-bounded', () => {
      const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-ws-asset-'));
      try {
        fs.mkdirSync(path.join(wsRoot, 'dist'), { recursive: true });
        fs.writeFileSync(
          path.join(wsRoot, 'package.json'),
          JSON.stringify({ name: 'c4s-ws-asset', version: '1.0.0', exports: { './frontend': { import: './dist/frontend.js' } } }),
        );
        fs.writeFileSync(path.join(wsRoot, 'dist', 'frontend.js'), 'export const x = 1;');
        fs.writeFileSync(path.join(wsRoot, 'dist', 'dto-XYZ.js'), 'export const d = 1;');
        const resolveRoot = (n: string) => (n === 'c4s-ws-asset' ? wsRoot : null);
        expect(resolveWorkspaceAsset('c4s-ws-asset', 'dto-XYZ.js', ['c4s-ws-asset'], resolveRoot)).toBe(
          path.join(wsRoot, 'dist', 'dto-XYZ.js'),
        );
        // Not in allowlist ⇒ null even for a resolvable, existing chunk.
        expect(resolveWorkspaceAsset('c4s-ws-asset', 'dto-XYZ.js', [], resolveRoot)).toBeNull();
        // Disallowed extension ⇒ null.
        fs.writeFileSync(path.join(wsRoot, 'dist', 'meta.json'), '{}');
        expect(resolveWorkspaceAsset('c4s-ws-asset', 'meta.json', ['c4s-ws-asset'], resolveRoot)).toBeNull();
      } finally {
        fs.rmSync(wsRoot, { recursive: true, force: true });
      }
    });
  });

  describe('enumerateFrontendBundles', () => {
    it('lists only packages with a built dist/frontend.js, with version + hasCss', () => {
      makePkg('with-css', { version: '1.2.3', css: true });
      makePkg('no-css', { version: '0.9.0', css: false });
      makePkg('no-build', { js: false }); // excluded — no dist/frontend.js
      const bundles = enumerateFrontendBundles(cwd).sort((a, b) => a.name.localeCompare(b.name));
      expect(bundles).toEqual([
        { name: 'no-css', version: '0.9.0', hasCss: false },
        { name: 'with-css', version: '1.2.3', hasCss: true },
      ]);
    });

    it('missing/invalid package.json ⇒ version falls back to 0.0.0', () => {
      makePkg('legacy', { pkgJson: false });
      expect(enumerateFrontendBundles(cwd)).toEqual([
        { name: 'legacy', version: '0.0.0', hasCss: false },
      ]);
    });

    it('absent plugins dir ⇒ empty', () => {
      expect(enumerateFrontendBundles(cwd)).toEqual([]);
    });
  });

  describe('buildFrontendManifest', () => {
    it('trusted ⇒ one entry per built bundle with serving URLs', () => {
      makePkg('glossary', { version: '1.0.0', css: true });
      makePkg('notes', { version: '2.0.0', css: false });
      const m = buildFrontendManifest(REGISTRY, { cwd, trusted: true });
      expect(m.hostApiVersion).toBe(HOST_API_VERSION);
      expect(m.importMap).toEqual(buildImportMap());
      expect([...m.plugins].sort((a, b) => a.name.localeCompare(b.name))).toEqual([
        {
          name: 'glossary',
          version: '1.0.0',
          entry: '/api/plugins/glossary/frontend.js',
          css: '/api/plugins/glossary/frontend.css',
        },
        { name: 'notes', version: '2.0.0', entry: '/api/plugins/notes/frontend.js' },
      ]);
    });

    it('untrusted ⇒ plugins [] but import map + host version intact', () => {
      makePkg('glossary', { css: true });
      const m = buildFrontendManifest(REGISTRY, { cwd, trusted: false });
      expect(m.plugins).toEqual([]);
      expect(m.importMap).toEqual(buildImportMap());
      expect(m.hostApiVersion).toBe(HOST_API_VERSION);
    });

    it('no serving context (workspace-only start) ⇒ plugins []', () => {
      const m = buildFrontendManifest(REGISTRY);
      expect(m.plugins).toEqual([]);
    });
  });

  // ─── Workspace tier (phase 3) ─────────────────────────────────────────────
  // A workspace plugin lives in `node_modules`; resolution is injected here (the
  // `WorkspaceRootResolver` seam) so the test owns a temp package root instead of
  // mutating the repo's node_modules (which is a symlink under a worktree).
  describe('workspace tier', () => {
    const FIXTURE = 'c4s-ws-fixture-plugin';
    let wsRoot: string; // the installed package's root dir
    /** Resolver mapping ONLY the fixture name → its temp root (else unresolvable). */
    const resolveRoot = (name: string) => (name === FIXTURE ? wsRoot : null);

    beforeAll(() => {
      wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-ws-pkg-'));
      fs.mkdirSync(path.join(wsRoot, 'dist'), { recursive: true });
      fs.writeFileSync(
        path.join(wsRoot, 'package.json'),
        JSON.stringify({
          name: FIXTURE,
          version: '3.1.4',
          exports: { './frontend': { import: './dist/frontend.js' } },
        }),
      );
      fs.writeFileSync(path.join(wsRoot, 'dist', 'frontend.js'), 'export const x = 1;');
    });
    afterAll(() => {
      fs.rmSync(wsRoot, { recursive: true, force: true });
    });

    it('resolves the package frontend.js (from exports[./frontend]) when allowlisted, ungated', () => {
      const js = resolveWorkspaceFrontendAsset(FIXTURE, 'frontend.js', [FIXTURE], resolveRoot);
      expect(js).toBe(path.join(wsRoot, 'dist', 'frontend.js'));
    });

    it('not in the allowlist ⇒ null (traversal/scope guard, even for a resolvable package)', () => {
      expect(resolveWorkspaceFrontendAsset(FIXTURE, 'frontend.js', [], resolveRoot)).toBeNull();
      expect(resolveWorkspaceFrontendAsset(FIXTURE, 'frontend.js', ['other'], resolveRoot)).toBeNull();
    });

    it('unresolvable package ⇒ null', () => {
      expect(
        resolveWorkspaceFrontendAsset('c4s-not-installed', 'frontend.js', ['c4s-not-installed'], resolveRoot),
      ).toBeNull();
    });

    it('css sibling ⇒ null when not shipped', () => {
      expect(resolveWorkspaceFrontendAsset(FIXTURE, 'frontend.css', [FIXTURE], resolveRoot)).toBeNull();
    });

    it('enumerate lists allowlisted built packages with version + hasCss', () => {
      expect(enumerateWorkspaceFrontendBundles([FIXTURE], resolveRoot)).toEqual([
        { name: FIXTURE, version: '3.1.4', hasCss: false },
      ]);
      expect(enumerateWorkspaceFrontendBundles([], resolveRoot)).toEqual([]);
    });

    it('manifest: workspace bundles are ungated (present even when project untrusted)', () => {
      const m = buildFrontendManifest(REGISTRY, { cwd, trusted: false }, [FIXTURE], resolveRoot);
      expect(m.plugins).toEqual([
        { name: FIXTURE, version: '3.1.4', entry: `/api/plugins/${FIXTURE}/frontend.js` },
      ]);
    });

    it('manifest: base ∪ overlay, overlay overrides a same-named workspace bundle', () => {
      // Overlay (project-local) bundle of the SAME name, different version.
      makePkg(FIXTURE, { version: '9.9.9' });
      const m = buildFrontendManifest(REGISTRY, { cwd, trusted: true }, [FIXTURE], resolveRoot);
      // De-duped by name → one entry; the overlay (project-local) copy wins.
      expect(m.plugins).toEqual([
        { name: FIXTURE, version: '9.9.9', entry: `/api/plugins/${FIXTURE}/frontend.js` },
      ]);
    });

    it('manifest: distinct names from both tiers are both present', () => {
      makePkg('overlay-only', { version: '1.0.0' });
      const m = buildFrontendManifest(REGISTRY, { cwd, trusted: true }, [FIXTURE], resolveRoot);
      const byName = [...m.plugins].sort((a, b) => a.name.localeCompare(b.name));
      expect(byName).toEqual([
        { name: FIXTURE, version: '3.1.4', entry: `/api/plugins/${FIXTURE}/frontend.js` },
        { name: 'overlay-only', version: '1.0.0', entry: '/api/plugins/overlay-only/frontend.js' },
      ]);
    });

    it('manifest: a SCOPED package name is percent-encoded into ONE path segment', () => {
      // Regression: a scoped name (`@scope/pkg`) has a `/`. The asset URL must
      // encode it so the `:name/:asset` serving route still matches — otherwise the
      // frontend 404s and the plugin's sidebar entry silently disappears (the exact
      // symptom when the preinstalled database-table plugin moved to its scoped name).
      const SCOPED = '@inharness-ai/c4s-plugin-simple-database-tables';
      const scopedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-ws-scoped-'));
      fs.mkdirSync(path.join(scopedRoot, 'dist'), { recursive: true });
      fs.writeFileSync(
        path.join(scopedRoot, 'package.json'),
        JSON.stringify({
          name: SCOPED,
          version: '0.1.0',
          exports: { './frontend': { import: './dist/frontend.js' } },
        }),
      );
      fs.writeFileSync(path.join(scopedRoot, 'dist', 'frontend.js'), 'export const x = 1;');
      const resolveScoped = (name: string) => (name === SCOPED ? scopedRoot : null);
      try {
        const m = buildFrontendManifest(REGISTRY, undefined, [SCOPED], resolveScoped);
        expect(m.plugins).toEqual([
          {
            name: SCOPED,
            version: '0.1.0',
            entry: `/api/plugins/${encodeURIComponent(SCOPED)}/frontend.js`,
          },
        ]);
        // The name portion of the URL must be a SINGLE segment (no raw slash) and
        // round-trip back to the real package name via the route's param decoding.
        const seg = m.plugins[0]!.entry.slice('/api/plugins/'.length).split('/')[0]!;
        expect(seg).not.toContain('/');
        expect(decodeURIComponent(seg)).toBe(SCOPED);
      } finally {
        fs.rmSync(scopedRoot, { recursive: true, force: true });
      }
    });
  });
});

// `defaultWorkspaceRoot` resolves a plugin's package root by walking up from the
// `import.meta.resolve`d entry via this pure helper. The regression: it must NOT
// gate on the manifest `name`, so a plugin installed under an unscoped dir name
// whose real `package.json` `name` is scoped still resolves (else its frontend
// is silently dropped — no manifest entry, no sidebar link).
describe('nearestPackageRoot', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-pkgroot-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('walks up from a nested entry dir to the package root (name mismatch tolerated)', () => {
    // Dir/install name (unscoped) ≠ real package.json name (scoped) — the bug case.
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: '@inharness-ai/c4s-plugin-simple-database-tables', version: '1.0.0' }),
    );
    fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
    // entry resolves to <root>/dist/frontend.js → start the walk from <root>/dist.
    expect(nearestPackageRoot(path.join(root, 'dist'))).toBe(root);
  });

  it('returns the start dir itself when it owns a package.json', () => {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'whatever' }));
    expect(nearestPackageRoot(root)).toBe(root);
  });

  it('returns null when no ancestor owns a readable package.json', () => {
    // A temp dir with no package.json and (within 12 hops) none up the chain.
    const deep = path.join(root, 'a', 'b', 'c');
    fs.mkdirSync(deep, { recursive: true });
    // Guard: only assert null when the real fs has no package.json up to root.
    // os.tmpdir() chains have none, so the walk terminates at filesystem root.
    expect(nearestPackageRoot(deep)).toBeNull();
  });
});
