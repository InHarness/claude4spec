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

import { describe, expect, it } from 'vitest';
import { HOST_API_VERSION } from '../shared/plugin-host/manifest.js';
import { UI_KIT_STABLE_COMPONENTS } from '../shared/plugin-host/ui-kit-surface.js';
import {
  PLUGIN_RUNTIME_EXPORT_NAMES,
  PLUGIN_RUNTIME_UI_EXPORT_NAMES,
} from '../shared/plugin-host/frontend-manifest.js';

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
  'EntityDetailToolbar',
  'RichTextField',
  'TagPicker',
  'ReferencesList',
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
