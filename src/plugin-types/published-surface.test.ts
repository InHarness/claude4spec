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
import { HOST_API_VERSION } from '../shared/plugin-host/manifest.js';
import { UI_KIT_STABLE_COMPONENTS } from '../shared/plugin-host/ui-kit-surface.js';
import {
  PLUGIN_RUNTIME_EXPORT_NAMES,
  PLUGIN_RUNTIME_UI_EXPORT_NAMES,
  PLUGIN_RUNTIME_BACKEND_VALUE_NAMES,
} from '../shared/plugin-host/frontend-manifest.js';
import * as backendBarrel from '../server/plugin-runtime/index.js';

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
  'registerExtensionReferenceType',
  'versionService',
  'tagsService',
  'referencesService',
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
  'ActionButton',
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
    expect(HOST_API_VERSION).toBe('1.0.0');
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

  it('does NOT leak vendor MCP types into the published surface', () => {
    expect(facadeCode).not.toContain('McpServerConfig');
    expect(facadeCode).not.toContain('McpServerInstance');
    expect(facadeCode).not.toContain('@inharness-ai/agent-adapters');
  });
});
