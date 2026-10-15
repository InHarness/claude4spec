/**
 * 2.1.20 (M33 `m33l11sc`, `m33rt001`) — the types-only subpath
 * `@inharness-ai/claude4spec/plugin-runtime/ambient`, as a plugin author's
 * compiler sees it.
 *
 * The subpath declares `declare module '@c4s/plugin-runtime'` (+ `/ui`) once per
 * leg: `ambient.d.ts` (browser leg — the default) and `ambient-backend.d.ts`
 * (backend leg — the `c4s-backend` condition). Each compile below is an author's
 * file outside the host repo, the leg's ambient file as the only reference, and
 * the package's published subpaths mapped to the declaration sources
 * `build:types` emits them from (`src/plugin-types/{plugin-runtime,ui}.ts`) —
 * the self-package re-exports inside the ambient files resolve the same way on
 * the consumer side, once the package is installed.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import {
  PLUGIN_RUNTIME_LEGS,
  pluginRuntimeNamesOnLeg,
} from '../shared/plugin-host/runtime-legs.js';
import { PLUGIN_RUNTIME_UI_EXPORT_NAMES } from '../shared/plugin-host/frontend-manifest.js';

const repoRoot = process.cwd();
const typesDir = path.join(repoRoot, 'src', 'plugin-types');
const BROWSER_AMBIENT = path.join(typesDir, 'ambient.d.ts');
const BACKEND_AMBIENT = path.join(typesDir, 'ambient-backend.d.ts');

const PUBLISHED_PATHS: Record<string, string[]> = {
  '@inharness-ai/claude4spec/plugin-runtime': [path.join(typesDir, 'plugin-runtime.ts')],
  '@inharness-ai/claude4spec/plugin-runtime/ui': [path.join(typesDir, 'ui.ts')],
};

const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  name: string;
  exports: Record<string, unknown>;
  scripts: Record<string, string>;
};

/** Compile `source` as an author's file with one leg's ambient file referenced; return its diagnostics. */
function compileWithLeg(ambientFile: string, source: string): string[] {
  const fixture = path.join(os.tmpdir(), `c4s-ambient-author-${process.pid}`, 'author.tsx');
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
  host.fileExists = (f) => (f === fixture ? true : fileExists(f));
  host.readFile = (f) => (f === fixture ? source : readFile(f));
  host.getSourceFile = (f, lang, onError, create) =>
    f === fixture ? ts.createSourceFile(f, source, lang, true) : getSourceFile(f, lang, onError, create);

  const program = ts.createProgram([fixture, ambientFile], options, host);
  const ambient = program.getSourceFile(ambientFile)!;
  // The ambient file is a declaration file (not checked under skipLibCheck): its
  // syntax is checked here, its re-exports by the positive compiles below.
  const syntax = program.getSyntacticDiagnostics(ambient).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
  expect(syntax, path.basename(ambientFile)).toEqual([]);
  return ts
    .getPreEmitDiagnostics(program, program.getSourceFile(fixture))
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

/** The value names an ambient file re-exports per declared module. */
function ambientValues(file: string): Record<string, string[]> {
  const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Record<string, string[]> = {};
  for (const m of text.matchAll(/declare module '([^']+)' \{([\s\S]*?)\n\}/g)) {
    const values = [...m[2]!.matchAll(/export \{([^}]*)\} from/g)].flatMap((e) =>
      e[1]!.split(',').map((n) => n.trim()).filter(Boolean),
    );
    out[m[1]!] = values;
  }
  return out;
}

/**
 * Resolve the `/ambient` subpath the way a consumer's compiler resolves its
 * `/// <reference types>`: through the package's real `exports` entry, from a
 * project that has the package installed (a temporary `node_modules` carrying
 * this package.json and the two shipped files).
 */
function resolveAmbient(customConditions?: string[]): string | undefined {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-ambient-install-'));
  try {
    const installed = path.join(root, 'node_modules', '@inharness-ai', 'claude4spec');
    fs.mkdirSync(path.join(installed, 'dist', 'plugin-types'), { recursive: true });
    fs.writeFileSync(path.join(installed, 'package.json'), JSON.stringify({ name: pkg.name, exports: pkg.exports }));
    fs.copyFileSync(BROWSER_AMBIENT, path.join(installed, 'dist', 'plugin-types', 'ambient.d.ts'));
    fs.copyFileSync(BACKEND_AMBIENT, path.join(installed, 'dist', 'plugin-types', 'ambient-backend.d.ts'));
    const containing = path.join(root, 'src', 'index.ts');
    const options: ts.CompilerOptions = {
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      module: ts.ModuleKind.ESNext,
      typeRoots: [],
      ...(customConditions ? { customConditions } : {}),
    };
    const resolved = ts.resolveTypeReferenceDirective(
      '@inharness-ai/claude4spec/plugin-runtime/ambient',
      containing,
      options,
      ts.sys,
    ).resolvedTypeReferenceDirective?.resolvedFileName;
    return resolved ? path.basename(resolved) : undefined;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const BACKEND_ONLY = PLUGIN_RUNTIME_LEGS.filter((r) => r.leg === 'backend').flatMap((r) => [...r.names]);
const BROWSER_ONLY = PLUGIN_RUNTIME_LEGS.filter((r) => r.leg === 'browser').flatMap((r) => [...r.names]);

describe('…/plugin-runtime/ambient — one declaration per leg', () => {
  it('[ac:ac-autor-pluginu-importuje-typy-host-api-z] a plugin author types the Host API from the published …/plugin-runtime (+ /ui) through …/plugin-runtime/ambient, declared separately for the browser and the backend leg, with no vendored .d.ts', () => {
    // Published: the type subpaths and the ambient one, which routes per leg.
    expect(pkg.name).toBe('@inharness-ai/claude4spec');
    expect((pkg.exports['./plugin-runtime'] as { types: string }).types).toBe('./dist/plugin-types/plugin-runtime.d.ts');
    expect((pkg.exports['./plugin-runtime/ui'] as { types: string }).types).toBe('./dist/plugin-types/ui.d.ts');
    expect(pkg.exports['./plugin-runtime/ambient']).toEqual({
      'c4s-backend': { types: './dist/plugin-types/ambient-backend.d.ts' },
      types: './dist/plugin-types/ambient.d.ts',
    });
    // Both leg files are shipped verbatim next to the emitted declarations.
    expect(pkg.scripts['build:types']).toContain('src/plugin-types/ambient.d.ts');
    expect(pkg.scripts['build:types']).toContain('src/plugin-types/ambient-backend.d.ts');
    // A consumer's reference resolves to the browser leg by default and to the
    // backend leg under the `c4s-backend` condition.
    expect(resolveAmbient()).toBe('ambient.d.ts');
    expect(resolveAmbient(['c4s-backend'])).toBe('ambient-backend.d.ts');

    // Each leg declares BOTH specifiers, ambiently (a script file), from the
    // official subpaths only — no hand-copied signature, nothing vendored.
    for (const file of [BROWSER_AMBIENT, BACKEND_AMBIENT]) {
      const code = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(Object.keys(ambientValues(file)).sort(), path.basename(file)).toEqual(['@c4s/plugin-runtime', '@c4s/plugin-runtime/ui']);
      expect(code, path.basename(file)).not.toMatch(/^(?:import|export)\b/m);
      const sources = [...code.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      expect(new Set(sources), path.basename(file)).toEqual(
        new Set(['@inharness-ai/claude4spec/plugin-runtime', '@inharness-ai/claude4spec/plugin-runtime/ui']),
      );
    }

    // One reference types both the value specifier and the type names — frontend code…
    const frontend = compileWithLeg(
      BROWSER_AMBIENT,
      [
        "import { registerFrontendModule, queryClient, useEntityTags, HOST_API_VERSION, type FrontendModule, type EntityChipProps } from '@c4s/plugin-runtime';",
        "import { EntityListHeader, UI_KIT_STABLE_COMPONENTS, type EntityListHeaderProps } from '@c4s/plugin-runtime/ui';",
        'export function Chip(props: EntityChipProps): null { void props; return null; }',
        'export function register(module: FrontendModule): void { registerFrontendModule(module); }',
        'export const used = [queryClient, useEntityTags, HOST_API_VERSION, EntityListHeader, UI_KIT_STABLE_COMPONENTS];',
        'export type Header = EntityListHeaderProps;',
      ].join('\n'),
    );
    expect(frontend).toEqual([]);

    // …and backend code.
    const backend = compileWithLeg(
      BACKEND_AMBIENT,
      [
        "import { createMcpServer, mcpTool, z, DomainError, TOOL_RESULT_CEILING_TOKENS, HOST_API_VERSION, type MountContext, type PluginManifest, type McpServerFactory } from '@c4s/plugin-runtime';",
        "import { UI_KIT_STABLE_COMPONENTS, type EntityListHeaderProps } from '@c4s/plugin-runtime/ui';",
        "export const server: McpServerFactory = createMcpServer({ name: 'gadgets', tools: [] });",
        'export function mount(ctx: MountContext): void { void ctx.cwd; }',
        "export const manifest: PluginManifest = { name: '@acme/c4s-plugin-gadgets', version: '1.0.0', hostApiVersion: '^2.0.0', contributes: {} };",
        'export const used = [mcpTool, z, DomainError, TOOL_RESULT_CEILING_TOKENS, HOST_API_VERSION, UI_KIT_STABLE_COMPONENTS];',
        'export type Header = EntityListHeaderProps;',
      ].join('\n'),
    );
    expect(backend).toEqual([]);

    // Really typed, not `any`: a wrong call fails on either leg.
    expect(compileWithLeg(BROWSER_AMBIENT, "import { registerFrontendModule } from '@c4s/plugin-runtime';\nregisterFrontendModule(42);").length).toBe(1);
    expect(compileWithLeg(BACKEND_AMBIENT, "import { createMcpServer } from '@c4s/plugin-runtime';\ncreateMcpServer('gadgets');").length).toBe(1);
  }, 120_000);

  it('[ac:ac-import-wartosci-tylko-backendowej-z-c] importing a backend-only value of @c4s/plugin-runtime in plugin frontend code fails the plugin\'s type compilation', () => {
    expect(BACKEND_ONLY.length).toBeGreaterThan(0);
    // 2.1.25 — `UI_KIT_STABLE_COMPONENTS` is no longer backend-only on `/ui`:
    // both legs carry it under that one name, so it is not in this list.
    const source = [
      `import { ${BACKEND_ONLY.join(', ')} } from '@c4s/plugin-runtime';`,
      `export const used = [${BACKEND_ONLY.join(', ')}];`,
    ].join('\n');

    // Frontend code (browser leg): every backend-only value is a compile error…
    const frontend = compileWithLeg(BROWSER_AMBIENT, source);
    for (const name of BACKEND_ONLY) {
      expect(
        frontend.some((e) => e.includes(`'${name}'`)),
        `${name} — ${frontend.join(' | ')}`,
      ).toBe(true);
    }
    // …that names the value as unusable here, not a missing module or a typo.
    expect(frontend.every((e) => /cannot be used as a value/.test(e))).toBe(true);

    // The same file is fine as backend code: the error is the leg, not the name.
    expect(compileWithLeg(BACKEND_AMBIENT, source)).toEqual([]);
  }, 120_000);
});

describe('[section:m33l11sc] the published type surface — subpaths and legs', () => {
  it('[section:m33l11sc] the package publishes …/plugin-runtime, …/plugin-runtime/ui and …/plugin-runtime/ambient — and no …/plugin-testing', () => {
    expect(Object.keys(pkg.exports).sort()).toEqual(
      ['./package.json', './plugin-runtime', './plugin-runtime/ambient', './plugin-runtime/ui'].sort(),
    );
    expect(pkg.exports['./plugin-testing']).toBeUndefined();
    // No source left to emit a harness declaration or entry from.
    expect(fs.existsSync(path.join(typesDir, 'plugin-testing.ts'))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, 'src', 'server', 'plugin-testing'))).toBe(false);
  });

  it('[section:m33l11sc] each ambient leg re-exports exactly the values its leg serves; every type rides both legs', () => {
    const browser = ambientValues(BROWSER_AMBIENT);
    const backend = ambientValues(BACKEND_AMBIENT);
    const sorted = (xs: readonly string[]) => [...xs].sort();
    expect(sorted(browser['@c4s/plugin-runtime']!)).toEqual(sorted(pluginRuntimeNamesOnLeg('browser')));
    expect(sorted(backend['@c4s/plugin-runtime']!)).toEqual(sorted(pluginRuntimeNamesOnLeg('backend')));
    expect(sorted(browser['@c4s/plugin-runtime/ui']!)).toEqual(sorted(PLUGIN_RUNTIME_UI_EXPORT_NAMES));
    expect(backend['@c4s/plugin-runtime/ui']).toEqual(['UI_KIT_STABLE_COMPONENTS']);
    // 2.1.25 (m33rt001) — one name for the `stable` list on both `/ui` legs;
    // the previous browser name is gone with no alias.
    expect(browser['@c4s/plugin-runtime/ui']).toContain('UI_KIT_STABLE_COMPONENTS');
    expect(browser['@c4s/plugin-runtime/ui']).not.toContain('STABLE_UI_KIT_COMPONENTS');
    for (const file of [BROWSER_AMBIENT, BACKEND_AMBIENT]) {
      const text = fs.readFileSync(file, 'utf8');
      expect(text.match(/export type \* from '@inharness-ai\/claude4spec\/plugin-runtime';/g)?.length, file).toBe(1);
      expect(text.match(/export type \* from '@inharness-ai\/claude4spec\/plugin-runtime\/ui';/g)?.length, file).toBe(1);
      // The vendor stays behind the facade on both legs.
      expect(text).not.toContain('@inharness-ai/agent-adapters');
    }
  });

  it('[section:m33l11sc] a browser-only value used in plugin backend code fails the backend leg\'s compilation', () => {
    const source = [
      `import { ${BROWSER_ONLY.join(', ')} } from '@c4s/plugin-runtime';`,
      `export const used = [${BROWSER_ONLY.join(', ')}];`,
    ].join('\n');
    const errors = compileWithLeg(BACKEND_AMBIENT, source);
    for (const name of BROWSER_ONLY) expect(errors.some((e) => e.includes(`'${name}'`)), name).toBe(true);
    expect(compileWithLeg(BROWSER_AMBIENT, source)).toEqual([]);
  }, 120_000);
});

describe('[section:m33rt001] one name for the stable list on both /ui legs', () => {
  it('[section:m33rt001] UI_KIT_STABLE_COMPONENTS compiles from @c4s/plugin-runtime/ui on the browser and the backend leg; the old browser name STABLE_UI_KIT_COMPONENTS exists on neither', () => {
    const uses = [
      "import { UI_KIT_STABLE_COMPONENTS } from '@c4s/plugin-runtime/ui';",
      'export const stable: readonly string[] = UI_KIT_STABLE_COMPONENTS;',
    ].join('\n');
    expect(compileWithLeg(BROWSER_AMBIENT, uses)).toEqual([]);
    expect(compileWithLeg(BACKEND_AMBIENT, uses)).toEqual([]);

    const old = [
      "import { STABLE_UI_KIT_COMPONENTS } from '@c4s/plugin-runtime/ui';",
      'export const stable = STABLE_UI_KIT_COMPONENTS;',
    ].join('\n');
    for (const file of [BROWSER_AMBIENT, BACKEND_AMBIENT]) {
      const errors = compileWithLeg(file, old);
      expect(errors.some((e) => e.includes("'STABLE_UI_KIT_COMPONENTS'")), `${path.basename(file)} — ${errors.join(' | ')}`).toBe(true);
    }
  }, 120_000);
});

describe('[section:tbeatf5z] the shell window facades as a plugin author compiles them', () => {
  it('[section:tbeatf5z] plugin frontend code calls openPopover, openModal, confirmDestructive and toast with its own kinds; the backend leg has none of them', () => {
    const source = [
      "import { openPopover, openModal, confirmDestructive, toast, type ConfirmDestructiveOptions } from '@c4s/plugin-runtime';",
      "const options: ConfirmDestructiveOptions = { title: 'Delete gadget?', body: 'Gone.', confirmLabel: 'Delete', cancelLabel: 'Keep', danger: true, requireText: 'gadget', action: async () => true };",
      "export async function run(): Promise<void> {",
      "  const picked: { id: string } | null = await openPopover<{ id: string }>('acme-gadget-create', { x: 1, y: 2, preset: 'wide' });",
      "  const answer: string | null = await openModal<string>('acme-gadget-wizard', { step: 1 }, { dismissible: false });",
      "  const ok: boolean = await confirmDestructive('acme-gadget-delete', options);",
      "  toast.success('Saved', { label: 'Undo', onClick: () => undefined });",
      "  toast.error('Failed');",
      "  toast.warning('Careful', { durationMs: 900 });",
      "  void picked; void answer; void ok;",
      "}",
    ].join('\n');
    // Any string is a kind: no host kind map narrows it.
    expect(compileWithLeg(BROWSER_AMBIENT, source)).toEqual([]);
    // Typed, not `any`: confirm without its title/body, or a toast with a kind-like variant, fails.
    expect(compileWithLeg(BROWSER_AMBIENT, "import { confirmDestructive } from '@c4s/plugin-runtime';\nvoid confirmDestructive('acme-gadget-delete', { body: 'x' });").length).toBe(1);
    expect(compileWithLeg(BROWSER_AMBIENT, "import { toast } from '@c4s/plugin-runtime';\ntoast.info('x');").length).toBe(1);
    // Browser values only: in plugin backend code each is unusable as a value.
    const backend = compileWithLeg(BACKEND_AMBIENT, source);
    for (const name of ['openPopover', 'openModal', 'confirmDestructive', 'toast']) {
      expect(backend.some((e) => e.includes(`'${name}'`)), name).toBe(true);
    }
  }, 120_000);
});
