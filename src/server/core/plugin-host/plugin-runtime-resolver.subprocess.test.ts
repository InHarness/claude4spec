/**
 * M33 (0.1.134) — the backend `@c4s/plugin-runtime` resolver, proven in the REAL runtime.
 *
 * Why a subprocess: vitest's module runner cannot host `module.register` (same reason
 * `base-entry-resolver.test.ts` shells out for `import.meta.resolve`), and a mocked
 * loader thread would prove nothing about the property that actually matters — that
 * Node hands a plugin the host's LIVE barrel. So each case runs a probe through
 * `tsx`, exactly as the dev server runs.
 *
 * The headline assertion is identity: a bare `@c4s/plugin-runtime` import must be the
 * SAME module instance the host reaches by relative path. If that ever regresses, a
 * plugin gets its own copy of the facade — a second `HOST_API_VERSION`, and MCP
 * builders from a different vendor instance than the host's.
 */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const tsx = path.join(repoRoot, 'node_modules', '.bin', 'tsx');

/** Run `body` through tsx with the resolver installed; return its stdout. */
function runProbe(body: string): { ok: true; out: string } | { ok: false; err: string } {
  const probe = path.join(repoRoot, `.runtime-probe-${process.pid}-${Math.random().toString(36).slice(2)}.mts`);
  fs.writeFileSync(
    probe,
    `import { installPluginRuntimeResolver } from './src/server/core/plugin-host/plugin-runtime-resolver.js';\n` +
      `installPluginRuntimeResolver();\n${body}\n`,
  );
  try {
    return { ok: true, out: execFileSync(tsx, [probe], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    return { ok: false, err: e.stderr || e.message || '' };
  } finally {
    fs.rmSync(probe, { force: true });
  }
}

describe('M33 — backend @c4s/plugin-runtime resolver (real runtime)', () => {
  it('resolves the bare alias to the host barrel — SAME instance as the relative import', () => {
    // The whole point of the resolver: one live facade, both ends.
    const res = runProbe(
      `const bare = await import('@c4s/plugin-runtime');\n` +
        `const relative = await import('./src/server/plugin-runtime/index.js');\n` +
        `process.stdout.write(JSON.stringify({\n` +
        `  same: bare === relative,\n` +
        `  sameFn: bare.createMcpServer === relative.createMcpServer,\n` +
        `  version: bare.HOST_API_VERSION,\n` +
        `  builders: [typeof bare.createMcpServer, typeof bare.mcpTool],\n` +
        `}));`,
    );
    expect(res.ok, res.ok ? '' : res.err).toBe(true);
    if (!res.ok) return;

    const got = JSON.parse(res.out) as Record<string, unknown>;
    expect(got.same).toBe(true);
    expect(got.sameFn).toBe(true);
    expect(got.version).toBe('1.0.0');
    expect(got.builders).toEqual(['function', 'function']);
  });

  it('resolves the /ui alias to the React-free contract half', () => {
    // The backend `/ui` carries the versioned contract (stable names + Stability),
    // NOT the React components — those are frontend-only, via the import-map shim.
    const res = runProbe(
      `const ui = await import('@c4s/plugin-runtime/ui');\n` +
        `process.stdout.write(JSON.stringify({ stable: [...ui.UI_KIT_STABLE_COMPONENTS].sort() }));`,
    );
    expect(res.ok, res.ok ? '' : res.err).toBe(true);
    if (!res.ok) return;

    expect((JSON.parse(res.out) as { stable: string[] }).stable).toEqual(
      ['DetailPanelShell', 'EntityListHeader', 'FieldGrid', 'FieldRow'].sort(),
    );
  });

  it('reports an unknown subpath as ERR_PACKAGE_PATH_NOT_EXPORTED, not "cannot find package"', () => {
    const res = runProbe(`await import('@c4s/plugin-runtime/nope');`);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.err).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
    // The failure must name the subpath, not send the author after a missing package.
    expect(res.err).not.toContain('Cannot find package');
  });

  it('leaves every other specifier alone', () => {
    // The hook sees every import in the process; a foreign specifier must pass through.
    const res = runProbe(
      `const fs = await import('node:fs');\n` +
        `const semver = await import('semver');\n` +
        `process.stdout.write(JSON.stringify({ fs: typeof fs.existsSync, semver: typeof semver.default.satisfies }));`,
    );
    expect(res.ok, res.ok ? '' : res.err).toBe(true);
    if (!res.ok) return;
    expect(JSON.parse(res.out)).toEqual({ fs: 'function', semver: 'function' });
  });
});

describe('M33 — resolver from a plugin-like location', () => {
  const fixtureDir = path.join(repoRoot, 'node_modules', '@c4s-fixture', 'probe-plugin');

  /**
   * The only case that exercises a REAL external-plugin location: an installed
   * package under `node_modules` importing the bare alias, which is precisely the
   * shape that used to die with ERR_MODULE_NOT_FOUND.
   */
  it('an installed package under node_modules resolves the bare alias to the host instance', () => {
    fs.mkdirSync(fixtureDir, { recursive: true });
    try {
      fs.writeFileSync(
        path.join(fixtureDir, 'package.json'),
        JSON.stringify({ name: '@c4s-fixture/probe-plugin', version: '1.0.0', type: 'module', main: 'index.js' }),
      );
      fs.writeFileSync(
        path.join(fixtureDir, 'index.js'),
        `import { createMcpServer, mcpTool, HOST_API_VERSION } from '@c4s/plugin-runtime';\n` +
          `export const probe = { version: HOST_API_VERSION, builders: [typeof createMcpServer, typeof mcpTool] };\n` +
          `export const builders = { createMcpServer, mcpTool };\n`,
      );

      const res = runProbe(
        `const plugin = await import('@c4s-fixture/probe-plugin');\n` +
          `const host = await import('./src/server/plugin-runtime/index.js');\n` +
          `process.stdout.write(JSON.stringify({\n` +
          `  ...plugin.probe,\n` +
          `  sharesHostInstance: plugin.builders.createMcpServer === host.createMcpServer,\n` +
          `}));`,
      );
      expect(res.ok, res.ok ? '' : res.err).toBe(true);
      if (!res.ok) return;

      const got = JSON.parse(res.out) as Record<string, unknown>;
      expect(got.version).toBe('1.0.0');
      expect(got.builders).toEqual(['function', 'function']);
      expect(got.sharesHostInstance).toBe(true);
    } finally {
      // Remove only THIS test's own fixture subdir, not the shared `@c4s-fixture`
      // parent — so tests stay independent even if this file is ever run with
      // per-test concurrency.
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  /**
   * zod facade (0.1.134→next). A plugin that builds its entity schemas with `z` from
   * `@c4s/plugin-runtime` shares the host's SINGLE zod instance — so a schema it builds
   * survives the host's `z.toJSONSchema()` (the zod v4 `.def` walker) instead of
   * throwing `Cannot read properties of undefined (reading 'def')`. This is the
   * real-runtime proof of the facade path; the identity assertion is the guard that a
   * regression (a second zod copy) would trip.
   */
  it('a plugin building schemas with the facade `z` shares the host zod and survives z.toJSONSchema()', () => {
    // Distinct package name + subdir from the probe-plugin test above, so the two
    // never share a mutable `node_modules` path (each finally clears only its own).
    const zodFixtureDir = path.join(repoRoot, 'node_modules', '@c4s-fixture', 'probe-zod-plugin');
    fs.mkdirSync(zodFixtureDir, { recursive: true });
    try {
      fs.writeFileSync(
        path.join(zodFixtureDir, 'package.json'),
        JSON.stringify({ name: '@c4s-fixture/probe-zod-plugin', version: '1.0.0', type: 'module', main: 'index.js' }),
      );
      fs.writeFileSync(
        path.join(zodFixtureDir, 'index.js'),
        `import { z } from '@c4s/plugin-runtime';\n` +
          `export const facadeZ = z;\n` +
          `export const schema = z.object({ title: z.string() });\n`,
      );

      const res = runProbe(
        `const plugin = await import('@c4s-fixture/probe-zod-plugin');\n` +
          `const host = await import('./src/server/plugin-runtime/index.js');\n` +
          `const zod = await import('zod');\n` +
          `let toJsonOk = true, jsonType = null, err = '';\n` +
          `try { jsonType = host.z.toJSONSchema(plugin.schema).type; } catch (e) { toJsonOk = false; err = String(e && e.message || e); }\n` +
          `process.stdout.write(JSON.stringify({\n` +
          `  facadeIsHostZod: plugin.facadeZ === zod.z,\n` +
          `  barrelIsHostZod: host.z === zod.z,\n` +
          `  toJsonOk, jsonType, err,\n` +
          `}));`,
      );
      expect(res.ok, res.ok ? '' : res.err).toBe(true);
      if (!res.ok) return;

      const got = JSON.parse(res.out) as Record<string, unknown>;
      // One instance across the facade import, the host barrel and bare `zod`.
      expect(got.facadeIsHostZod).toBe(true);
      expect(got.barrelIsHostZod).toBe(true);
      // The host introspects the plugin-built schema with no `.def` throw.
      expect(got.toJsonOk, String(got.err)).toBe(true);
      expect(got.jsonType).toBe('object');
    } finally {
      fs.rmSync(zodFixtureDir, { recursive: true, force: true });
    }
  });
});
