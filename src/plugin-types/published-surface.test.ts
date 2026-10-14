/**
 * Guards the PUBLISHED Host API type surface (`@inharness-ai/claude4spec/
 * plugin-runtime` + `/ui`) against drift from the host's real runtime surface
 * (brief 0.1.85→0.1.86, AC2 + AC3).
 *
 * The published surface is `.d.ts`-only (no runtime values), so this asserts the
 * NAME parity against the host's authoritative export-name lists: if the host
 * adds or removes a `@c4s/plugin-runtime[/ui]` export, one of these sets stops
 * matching and the build fails until `src/plugin-types/{plugin-runtime,ui}.ts`
 * is updated. Deep prop-shape drift (the `stable` UI contracts) is additionally
 * guarded end-to-end by the consuming plugin's typecheck against these very
 * declarations (see the cross-repo verification).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { HOST_API_VERSION } from '../shared/plugin-host/manifest.js';
import { UI_KIT_STABLE_COMPONENTS } from '../shared/plugin-host/ui-kit-surface.js';
import {
  PLUGIN_RUNTIME_EXPORT_NAMES,
  PLUGIN_RUNTIME_UI_EXPORT_NAMES,
  PLUGIN_RUNTIME_BACKEND_VALUE_NAMES,
} from '../shared/plugin-host/frontend-manifest.js';
import * as backendBarrel from '../server/plugin-runtime/index.js';
import {
  HOST_API_MINOR_RELEASES,
  HOST_API_UNVERSIONED_CHANGES,
  migrationsBetween,
} from '../shared/plugin-host/host-api.js';

/**
 * The names the published `@inharness-ai/claude4spec/plugin-runtime` surface
 * commits to — must equal the host's runtime value exports. Keep in lockstep
 * with `src/plugin-types/plugin-runtime.ts`.
 */
const PUBLISHED_PLUGIN_RUNTIME_NAMES = [
  'HOST_API_VERSION',
  'clientPluginHost',
  'registerFrontendModule',
  'queryClient',
  'editorBridge',
  'EditorBridgeProvider',
  'versionService',
  'tagsService',
  'referencesService',
  'releasesService',
  'useVersions',
  'useVersionDetail',
  'useRestoreVersion',
  'useVersionDiff',
  'useTags',
  'useEntityTags',
  'useAssignTags',
  'useRemoveEntityTag',
  'useCreateTag',
  'useReferences',
  'useReleases',
  // 0.2.80 — the published equivalent of the host-only chat facade, added with
  // `c4s-plugin-ac`, whose list screen is specified to seed a thread.
  'startSeededThread',
  'lineDiffHunks',
  // 2.1.20 (M50 `tbeatf5z`) — the shell's four window facades.
  'openPopover',
  'openModal',
  'confirmDestructive',
  'toast',
] as const;

/**
 * The names the published `@inharness-ai/claude4spec/plugin-runtime/ui` surface
 * commits to — must equal the host UI-kit's runtime exports. Keep in lockstep
 * with `src/plugin-types/ui.ts`.
 */
const PUBLISHED_PLUGIN_RUNTIME_UI_NAMES = [
  'EntityListHeader',
  'DetailPanelShell',
  'FieldRow',
  'FieldGrid',
  'EntityListLayout',
  'Pagination',
  'EmptyState',
  'TagFilterBar',
  'EntityListRow',
  'GroupedEntityList',
  'ActionButton',
  'ActionBar',
  'Badge',
  'LoadingState',
  'FormField',
  'InlineEditField',
  'Dialog',
  'FormShell',
  'SegmentedControlTabs',
  'VersionHistory',
  'DiffView',
  'EntityDetailToolbar',
  'RichTextField',
  'TagPicker',
  'ReferencesList',
  'DocumentBody',
  'DocEditor',
  'EntityVersionHistoryView',
  'Popover',
  'ToastViewport',
  'useToast',
  'EnumBadgePicker',
  'GroupedRelationPicker',
  'useHostTokens',
  'HOST_TOKEN_NAMES',
  'readHostTokens',
  'UI_KIT_CATALOG',
  'STABLE_UI_KIT_COMPONENTS',
] as const;

describe('published Host API type surface', () => {
  it('does NOT bump hostApiVersion — type distribution is additive DX (AC3)', () => {
    expect(HOST_API_VERSION).toBe('2.1.0');
  });

  it('covers exactly the @c4s/plugin-runtime runtime value surface (no drift)', () => {
    expect(new Set(PUBLISHED_PLUGIN_RUNTIME_NAMES)).toEqual(new Set(PLUGIN_RUNTIME_EXPORT_NAMES));
  });

  it('covers exactly the @c4s/plugin-runtime/ui runtime surface (no drift)', () => {
    expect(new Set(PUBLISHED_PLUGIN_RUNTIME_UI_NAMES)).toEqual(
      new Set(PLUGIN_RUNTIME_UI_EXPORT_NAMES),
    );
  });

  it('exposes precise prop contracts for exactly the stable (versioned) components (AC2)', () => {
    // The four `stable` Core components are the versioned `hostApiVersion`
    // surface; the published `/ui` declares their full prop interfaces, while
    // experimental components are reachable but outside the guarantee.
    const published = new Set(PUBLISHED_PLUGIN_RUNTIME_UI_NAMES);
    for (const stable of UI_KIT_STABLE_COMPONENTS) {
      expect(published.has(stable)).toBe(true);
    }
    expect([...UI_KIT_STABLE_COMPONENTS].sort()).toEqual(
      ['DetailPanelShell', 'EntityListHeader', 'FieldGrid', 'FieldRow'].sort(),
    );
  });
});

/**
 * MCP builder facade (0.1.133). The vendor `@inharness-ai/agent-adapters` is an
 * internal host dependency hidden behind a C4S-owned facade: the backend barrel
 * re-exports the `createMcpServer` / `mcpTool` VALUES, while the published
 * `.d.ts` shows only the opaque `McpServerFactory` handle + facade signatures —
 * never the vendor's `McpServerConfig` / `McpServerInstance`.
 */
describe('MCP builder facade', () => {
  const facadeSource = readFileSync(
    fileURLToPath(new URL('./plugin-runtime.ts', import.meta.url)),
    'utf8',
  );
  // Mirror what actually reaches the emitted `.d.ts`: tsc RETAINS JSDoc (`/** */`)
  // on declarations but drops `//` line comments. So strip ONLY line comments —
  // stripping JSDoc too would let a vendor-type name added inside a JSDoc block
  // leak into the shipped surface while this guard (blind to it) stayed green.
  // A prose mention in a `//` comment is fine (it never reaches the `.d.ts`); a
  // reference in code OR retained JSDoc is a real leak and must fail here.
  const facadeCode = facadeSource.replace(/\/\/.*$/gm, '');

  it('re-exports exactly the backend MCP builder values from the barrel', () => {
    for (const name of PLUGIN_RUNTIME_BACKEND_VALUE_NAMES) {
      expect(typeof (backendBarrel as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('declares the C4S facade names in the published type surface', () => {
    for (const name of ['McpServerFactory', 'McpTool', 'createMcpServer', 'mcpTool']) {
      expect(facadeCode).toContain(name);
    }
  });

  it('declares the optional, C4S-owned annotations parameter of mcpTool (2.1.20)', () => {
    expect(facadeCode).toMatch(/export declare function mcpTool\([\s\S]*?annotations\?: McpToolAnnotations,?\s*\): McpTool;/);
    const annotationsDecl = /export interface McpToolAnnotations \{([^}]*)\}/s.exec(facadeCode)?.[1] ?? '';
    for (const field of ['readOnlyHint?: boolean', 'destructiveHint?: boolean', 'idempotentHint?: boolean', 'openWorldHint?: boolean', 'title?: string']) {
      expect(annotationsDecl).toContain(field);
    }
  });

  it('does NOT leak vendor MCP types into the published surface', () => {
    expect(facadeCode).not.toContain('McpServerConfig');
    expect(facadeCode).not.toContain('McpServerInstance');
    expect(facadeCode).not.toContain('@inharness-ai/agent-adapters');
  });
});

/**
 * zod facade (0.1.134→next). The backend barrel re-exports the host's OWN `z`, so a
 * plugin importing `z` from `@c4s/plugin-runtime` builds schemas with the single host
 * instance the host later introspects via `z.toJSONSchema()` — closing the "two zod
 * copies in one process" `.def` throw for plugin-contributed entity schemas.
 */
describe('zod facade', () => {
  const facadeCode = readFileSync(
    fileURLToPath(new URL('./plugin-runtime.ts', import.meta.url)),
    'utf8',
  ).replace(/\/\/.*$/gm, '');

  it('re-exports the host\'s OWN zod instance from the backend barrel', () => {
    // Identity, not just presence: a second copy is exactly the bug this closes.
    expect((backendBarrel as { z?: unknown }).z).toBe(z);
    expect(typeof (backendBarrel as { z: typeof z }).z.toJSONSchema).toBe('function');
  });

  it('declares `z` in the published type surface so the facade import type-checks', () => {
    expect(facadeCode).toContain('export declare const z');
  });

  it('the shared `z` survives `z.toJSONSchema()` (the v4 `.def` walker)', () => {
    // A schema built with the barrel's `z` is introspectable by the host's `z` —
    // the whole point. (Same instance here, so this asserts the v4 API is present
    // and the round-trip works, standing in for the cross-instance repro proven in
    // the resolver subprocess test.)
    const schema = (backendBarrel as { z: typeof z }).z.object({ title: z.string() });
    expect(() => z.toJSONSchema(schema)).not.toThrow();
    expect(z.toJSONSchema(schema)).toMatchObject({ type: 'object' });
  });
});

/**
 * 2.1.17 (M33 L11 `m33l11sc`) — the plugin test harness `…/plugin-testing` sits
 * OUTSIDE the versioned Host API surface, on the same rule as the `experimental`
 * UI-kit components: its shape is a matter of the package release (npm semver),
 * so neither adding it nor changing it moves `HOST_API_VERSION`.
 *
 * 2.1.20: the subpath is not published any more (an intent, not a contract); the
 * implementation lives in the host repo's internal test setup
 * (`tests/helpers/plugin-test-setup.ts`). The rule still holds of it: no record
 * of the versioned surface carries it, so publishing it again later moves
 * nothing either.
 */
describe('plugin test harness subpath — outside hostApiVersion', () => {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')) as {
    exports: Record<string, unknown>;
  };
  /** Every record the Host API keeps of its versioned surface, as one searchable text. */
  const versionedRecords = JSON.stringify([
    migrationsBetween(0, Number.MAX_SAFE_INTEGER),
    HOST_API_MINOR_RELEASES,
    HOST_API_UNVERSIONED_CHANGES,
  ]);
  const publishedSurface = ['./plugin-runtime.ts', './ui.ts', './ambient.d.ts', './ambient-backend.d.ts'].map((f) =>
    readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8'),
  );

  it('[ac:ac-dodanie-subpathu-plugin-testing-do-pu] adding the …/plugin-testing subpath to the published package does not change hostApiVersion', () => {
    // 2.1.20 — not published today (M33 `m33l11sc`: an intent, not a contract)…
    expect(pkg.exports['./plugin-testing']).toBeUndefined();
    // …and the Host API version is the baseline the published runtime surface pins
    // (the first assertion of this file): neither withdrawing the subpath nor
    // adding it back is a bump.
    expect(HOST_API_VERSION).toBe('2.1.0');
    // No record of the versioned surface — major migrations, minor releases,
    // in-baseline changes — carries the harness: its addition was not a Host API change.
    expect(versionedRecords).not.toMatch(/plugin-testing|createPluginTestApp/);
    // The versioned value surface does not carry it either.
    expect(PLUGIN_RUNTIME_EXPORT_NAMES).not.toContain('createPluginTestApp' as never);
    expect(PLUGIN_RUNTIME_BACKEND_VALUE_NAMES).not.toContain('createPluginTestApp' as never);
    expect(backendBarrel).not.toHaveProperty('createPluginTestApp');
  });

  it('[ac:ac-lamiaca-zmiana-sygnatury-createplugin] a breaking change to the createPluginTestApp signature does not bump the hostApiVersion major', () => {
    // The surface `hostApiVersion` versions is `…/plugin-runtime` (+ `/ui`), and
    // its published declarations never reference the harness — so no signature
    // of the harness, breaking or not, is part of what the major guards.
    for (const source of publishedSurface) {
      expect(source).not.toMatch(/plugin-testing|createPluginTestApp|PluginTestApp/);
    }
    // The harness module neither defines nor re-exports the version constant the
    // loader gates on: reshaping it cannot move `HOST_API_VERSION`.
    const harness = readFileSync(fileURLToPath(new URL('../../tests/helpers/plugin-test-setup.ts', import.meta.url)), 'utf8');
    expect(harness).toMatch(/export async function createPluginTestApp\(/);
    expect(harness).not.toMatch(/HOST_API_VERSION\s*=|export\s*\{[^}]*HOST_API_VERSION/);
    // A plugin built against the current major keeps passing the gate whatever the
    // harness looks like: no major boundary has been crossed past 2.
    expect(HOST_API_VERSION.split('.')[0]).toBe('2');
    expect(migrationsBetween(2, Number.MAX_SAFE_INTEGER)).toEqual([]);
  });
});
