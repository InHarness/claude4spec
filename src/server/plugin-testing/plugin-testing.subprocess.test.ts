/**
 * 2.1.17 (M33 L11 `m33l11sc`) — the plugin test harness in the REAL runtime, as
 * an external plugin package's own integration test uses it.
 *
 * Why a subprocess: vitest's module runner cannot host `module.register`, and
 * the harness's value transport IS the host-owned resolver installed through it
 * (same reason as `plugin-runtime-resolver.subprocess.test.ts`). So the author's
 * test runs as a probe through `tsx`, exactly as the dev server runs.
 *
 * The probe and the plugin package live in a temporary directory OUTSIDE the
 * host repo. The package imports the host only through the bare
 * `@c4s/plugin-runtime`; the test imports the harness only through
 * `@inharness-ai/claude4spec/plugin-testing`. Installing the host package into
 * that directory would need the built `dist/`, which the test run does not have,
 * so the probe stands in for the install with one resolve hook mapping that
 * exact specifier to the subpath's source module — the module the package's
 * `exports["./plugin-testing"]` entry is built from (asserted below).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const tsx = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
const harnessSource = path.join(repoRoot, 'src', 'server', 'plugin-testing', 'index.ts');
const hostBarrel = path.join(repoRoot, 'src', 'server', 'plugin-runtime', 'index.ts');

interface ProbeResult {
  version: string;
  sameZ: boolean;
  sameCreateMcpServer: boolean;
  active: boolean;
  createStatus: number;
  createdSlug: string | null;
  listed: string[];
  baseUrl: string;
  projectId: string;
  cwdOutsideRepo: boolean;
  cwdRemoved: boolean;
}

describe('createPluginTestApp from an external plugin package (real runtime)', () => {
  let dir: string;
  let result: ProbeResult | null = null;
  let failure = '';

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-external-plugin-'));

    // ── the plugin package, outside the host repo ──
    const pkgDir = path.join(dir, 'c4s-plugin-gadgets');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: '@acme/c4s-plugin-gadgets', version: '1.0.0', type: 'module', main: 'index.js' }),
    );
    fs.writeFileSync(
      path.join(pkgDir, 'index.js'),
      [
        "import { z, createMcpServer, HOST_API_VERSION } from '@c4s/plugin-runtime';",
        'export const runtime = { z, createMcpServer, HOST_API_VERSION };',
        'export const manifest = {',
        "  name: '@acme/c4s-plugin-gadgets',",
        "  version: '1.0.0',",
        "  hostApiVersion: '^2.0.0',",
        '  contributes: {',
        '    entities: [',
        '      {',
        "        type: 'gadget',",
        "        data: { schema: { title: { type: 'string', required: true, maxLength: 200 } } },",
        "        slugPattern: [{ op: 'slugify', field: 'title' }],",
        '        payloadVersion: 1,',
        "        label: 'Gadget',",
        "        labelPlural: 'Gadgets',",
        '        displayOrder: 900,',
        "        pathPrefix: '/gadgets',",
        "        systemPrompt: { roleNoun: 'gadget', mcpToolsLine: 'gadget-tools: ...' },",
        '      },',
        '    ],',
        '  },',
        '};',
      ].join('\n'),
    );

    // ── stand-in for `npm install @inharness-ai/claude4spec` (see the docblock) ──
    const hook = path.join(dir, 'install-hook.mjs');
    fs.writeFileSync(
      hook,
      [
        `const TARGET = ${JSON.stringify(pathToFileURL(harnessSource).href)};`,
        'export async function resolve(specifier, context, next) {',
        "  if (specifier === '@inharness-ai/claude4spec/plugin-testing') return next(TARGET, context);",
        '  return next(specifier, context);',
        '}',
      ].join('\n'),
    );

    // ── the plugin author's integration test ──
    const out = path.join(dir, 'result.json');
    const probe = path.join(dir, 'gadgets.integration.mjs');
    fs.writeFileSync(
      probe,
      [
        "import { register } from 'node:module';",
        "import fs from 'node:fs';",
        "import { once } from 'node:events';",
        `register(${JSON.stringify(pathToFileURL(hook).href)});`,
        "const { createPluginTestApp } = await import('@inharness-ai/claude4spec/plugin-testing');",
        `const plugin = await import(${JSON.stringify(pathToFileURL(path.join(pkgDir, 'index.js')).href)});`,
        `const host = await import(${JSON.stringify(pathToFileURL(hostBarrel).href)});`,
        'const t = await createPluginTestApp([plugin.manifest]);',
        'const server = t.app.listen(0, "127.0.0.1");',
        "await once(server, 'listening');",
        'const base = `http://127.0.0.1:${server.address().port}${t.baseUrl}`;',
        "const created = await fetch(`${base}/gadgets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'First gadget' }) });",
        'const createdBody = await created.json();',
        'const listBody = await (await fetch(`${base}/gadgets`)).json();',
        'server.close();',
        'const cwd = t.cwd;',
        'const active = t.host.isActive("gadget");',
        'await t.cleanup();',
        `fs.writeFileSync(${JSON.stringify(out)}, JSON.stringify({`,
        '  version: plugin.runtime.HOST_API_VERSION,',
        '  sameZ: plugin.runtime.z === host.z,',
        '  sameCreateMcpServer: plugin.runtime.createMcpServer === host.createMcpServer,',
        '  active,',
        '  createStatus: created.status,',
        '  createdSlug: createdBody?.data?.slug ?? null,',
        '  listed: (listBody?.data ?? []).map((e) => e.slug),',
        '  baseUrl: t.baseUrl,',
        '  projectId: t.projectId,',
        `  cwdOutsideRepo: !cwd.startsWith(${JSON.stringify(repoRoot)}),`,
        '  cwdRemoved: !fs.existsSync(cwd),',
        '}));',
        'process.exit(0);',
      ].join('\n'),
    );

    try {
      execFileSync(tsx, [probe], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
      result = JSON.parse(fs.readFileSync(out, 'utf8')) as ProbeResult;
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      failure = e.stderr || e.message || String(err);
    }
  }, 180_000);

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('[ac:ac-test-integracyjny-pakietu-pluginu-spo] an integration test of a plugin package outside the host repo starts the host in process through createPluginTestApp from @inharness-ai/claude4spec/plugin-testing', () => {
    // The published subpath exists and is built from the module the probe imported.
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('@inharness-ai/claude4spec');
    expect(pkg.exports['./plugin-testing']).toEqual({
      types: './dist/plugin-types/plugin-testing.d.ts',
      default: './dist/server/plugin-testing/index.js',
    });

    expect(result, failure).not.toBeNull();
    const r = result!;
    // A host ran in the probe's own process, on a temporary project outside the repo…
    expect(r.baseUrl).toBe(`/api/projects/${r.projectId}`);
    expect(r.cwdOutsideRepo).toBe(true);
    // …serving the package's type over HTTP…
    expect(r.createStatus).toBe(201);
    expect(r.createdSlug).toBe('first-gadget');
    expect(r.listed).toEqual(['first-gadget']);
    // …and cleanup took the temporary project away.
    expect(r.cwdRemoved).toBe(true);
  });

  it('[ac:ac-goly-import-c4s-plugin-runtime-w-kodz] a bare @c4s/plugin-runtime import in the code of a plugin started by createPluginTestApp resolves to the harness host\'s live values', () => {
    expect(result, failure).not.toBeNull();
    const r = result!;
    // The plugin's module imported the bare alias and loaded at all (no
    // ERR_MODULE_NOT_FOUND), and its manifest was registered: the type is active.
    expect(r.active).toBe(true);
    expect(r.version).toBe('2.1.0');
    // Identity, not equality: the SAME instances the host barrel holds.
    expect(r.sameZ).toBe(true);
    expect(r.sameCreateMcpServer).toBe(true);
  });
});
