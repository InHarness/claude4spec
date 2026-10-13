/**
 * 2.1.17 (M33 L11 `m33l11sc`) — the published TYPE surfaces as a plugin author's
 * compiler sees them.
 *
 * Each case compiles an author's file with the TypeScript compiler, the
 * published subpaths mapped to the declaration sources they are emitted from
 * (`tsconfig.types.json` → `dist/plugin-types/*.d.ts`), and nothing else: no
 * vendored `.d.ts`, `types: []`, and the type packages of the harness's server
 * dependencies (express, better-sqlite3, supertest, node) made invisible to the
 * compiler — a plugin's own build does not install them.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';

const repoRoot = process.cwd();
const typesDir = path.join(repoRoot, 'src', 'plugin-types');

/** Server dependencies of the harness whose types a plugin build never has. */
const HIDDEN = /[\\/]node_modules[\\/](?:@types[\\/])?(?:express|express-serve-static-core|better-sqlite3|supertest|node)[\\/]/;

const PUBLISHED_PATHS: Record<string, string[]> = {
  '@inharness-ai/claude4spec/plugin-runtime': [path.join(typesDir, 'plugin-runtime.ts')],
  '@inharness-ai/claude4spec/plugin-runtime/ui': [path.join(typesDir, 'ui.ts')],
  '@inharness-ai/claude4spec/plugin-testing': [path.join(typesDir, 'plugin-testing.ts')],
};

/** Compile `source` as an author's file outside the host repo; return its diagnostics and program files. */
function compileAuthorFile(source: string): { errors: string[]; files: string[] } {
  const fixture = path.join(os.tmpdir(), `c4s-author-${process.pid}`, 'author.ts');
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
    jsx: ts.JsxEmit.ReactJSX,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    paths: PUBLISHED_PATHS,
  };
  const host = ts.createCompilerHost(options);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  const directoryExists = host.directoryExists?.bind(host);
  host.fileExists = (f) => (f === fixture ? true : !HIDDEN.test(f) && fileExists(f));
  host.readFile = (f) => (f === fixture ? source : HIDDEN.test(f) ? undefined : readFile(f));
  host.directoryExists = (d) => !HIDDEN.test(`${d}/`) && (directoryExists ? directoryExists(d) : true);
  host.getSourceFile = (f, lang, onError, create) =>
    f === fixture
      ? ts.createSourceFile(f, source, lang, true)
      : HIDDEN.test(f)
        ? undefined
        : getSourceFile(f, lang, onError, create);

  const program = ts.createProgram([fixture], options, host);
  const errors = ts
    .getPreEmitDiagnostics(program)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
  return { errors, files: program.getSourceFiles().map((f) => f.fileName) };
}

/** Module specifiers a source file imports or re-exports. */
function importedSpecifiers(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8');
  return [...text.matchAll(/(?:import|export)\s[^'";]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
}

describe('published type surfaces, as a plugin author compiles them', () => {
  it('[ac:ac-autor-pluginu-typuje-test-przez-d-ts] a plugin author types a test through the .d.ts published under …/plugin-testing, with no vendored copy of the harness types', () => {
    // Published: the subpath's `types` is the declaration emitted from
    // `src/plugin-types/plugin-testing.ts` by `build:types`.
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(pkg.exports['./plugin-testing'].types).toBe('./dist/plugin-types/plugin-testing.d.ts');
    const typesConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tsconfig.types.json'), 'utf8'));
    expect(typesConfig.include).toContain('src/plugin-types/**/*');
    expect(typesConfig.exclude).not.toContain('src/plugin-types/plugin-testing.ts');
    expect(typesConfig.compilerOptions.outDir).toBe('./dist');
    expect(typesConfig.compilerOptions.rootDir).toBe('./src');

    // No host-internal types behind it: the manifest and the host facade come
    // from the already-published runtime surface, nothing else is imported.
    expect(importedSpecifiers(path.join(typesDir, 'plugin-testing.ts'))).toEqual(['./plugin-runtime.js']);

    // The author's test compiles against the published declaration alone…
    const ok = compileAuthorFile(
      [
        "import { createPluginTestApp, type PluginTestApp } from '@inharness-ai/claude4spec/plugin-testing';",
        "import type { PluginManifest } from '@inharness-ai/claude4spec/plugin-runtime';",
        "const manifest: PluginManifest = { name: '@acme/p', version: '1.0.0', hostApiVersion: '^2.0.0', contributes: {} };",
        'export async function gadgets(): Promise<void> {',
        '  const t: PluginTestApp = await createPluginTestApp([manifest]);',
        '  const cwd: string = t.cwd;',
        '  const baseUrl: string = t.baseUrl;',
        '  const projectId: string = t.projectId;',
        '  t.broadcasts.length = 0;',
        "  await t.crud.create('gadget', { title: 'x' }, 'user');",
        "  t.host.isActive('gadget');",
        "  t.db.prepare('SELECT 1').get();",
        '  void t.app; void cwd; void baseUrl; void projectId;',
        '  await t.cleanup();',
        '}',
      ].join('\n'),
    );
    expect(ok.errors).toEqual([]);
    // …with no host source behind it, and none of the server dependencies' types.
    expect(ok.files.some((f) => f.includes(`${path.sep}src${path.sep}server${path.sep}`))).toBe(false);
    expect(ok.files.some((f) => HIDDEN.test(f))).toBe(false);

    // And it is really typed, not `any`: a wrong call and a wrong field type fail.
    const wrong = compileAuthorFile(
      [
        "import { createPluginTestApp } from '@inharness-ai/claude4spec/plugin-testing';",
        'export async function gadgets(): Promise<void> {',
        "  const t = await createPluginTestApp('not-a-manifest-list');",
        '  const n: number = t.cwd;',
        '  void n;',
        '}',
      ].join('\n'),
    );
    expect(wrong.errors.length).toBe(2);
  }, 60_000);

  it('[ac:ac-plugin-typujacy-sie-wylacznie-przez-p] a plugin typed only through …/plugin-runtime (+ /ui) compiles without the types of the test harness\'s server dependencies', () => {
    const plugin = compileAuthorFile(
      [
        "import type { PluginManifest, MountContext } from '@inharness-ai/claude4spec/plugin-runtime';",
        "import type { EntityListHeaderProps } from '@inharness-ai/claude4spec/plugin-runtime/ui';",
        'export function mount(ctx: MountContext): void {',
        "  ctx.registerRenameListener(() => {});",
        '  void ctx.cwd;',
        '}',
        'export const manifest: PluginManifest = {',
        "  name: '@acme/c4s-plugin-gadgets',",
        "  version: '1.0.0',",
        "  hostApiVersion: '^2.0.0',",
        '  contributes: {},',
        '};',
        'export type HeaderProps = EntityListHeaderProps;',
      ].join('\n'),
    );
    expect(plugin.errors).toEqual([]);
    // Neither the harness declaration nor any server dependency entered the program.
    expect(plugin.files.some((f) => HIDDEN.test(f))).toBe(false);
    expect(plugin.files).not.toContain(path.join(typesDir, 'plugin-testing.ts'));

    // The runtime surfaces stay dep-free of the harness: neither the published
    // declarations nor the backend barrel ever reach for it.
    for (const file of ['plugin-runtime.ts', 'ui.ts', 'ambient.d.ts']) {
      expect(fs.readFileSync(path.join(typesDir, file), 'utf8'), file).not.toMatch(/plugin-testing/);
    }
    const barrelDir = path.join(repoRoot, 'src', 'server', 'plugin-runtime');
    for (const file of fs.readdirSync(barrelDir).filter((f) => f.endsWith('.ts'))) {
      expect(importedSpecifiers(path.join(barrelDir, file)).filter((s) => s.includes('plugin-testing')), file).toEqual([]);
    }
  }, 60_000);
});
