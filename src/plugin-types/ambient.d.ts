/**
 * Ambient binding for the runtime value specifiers `@c4s/plugin-runtime` and
 * `@c4s/plugin-runtime/ui` — the BROWSER leg (2.1.20, M33 `m33l11sc` /
 * `m33rt001`). Its twin for plugin backend code is `./ambient-backend.d.ts`.
 *
 * A plugin's source imports those BARE specifiers (resolved at runtime by the
 * M33 import-map shim in the browser, by the host-owned resolver in Node). This
 * file makes TypeScript resolve their TYPES to the host's published surface, so
 * a plugin drops its vendored `c4s-runtime.d.ts` and references the host
 * package once, in the tsconfig that compiles its FRONTEND code:
 *
 *   /// <reference types="@inharness-ai/claude4spec/plugin-runtime/ambient" />
 *
 * or via tsconfig `compilerOptions.types`. The tsconfig that compiles the
 * plugin's backend code references the same subpath with
 * `"customConditions": ["c4s-backend"]`, which the package's `exports` routes to
 * `ambient-backend.d.ts`.
 *
 * Per leg: every TYPE name of the published surface is re-exported (types are
 * erased, they never link), but a VALUE only when the leg serves it at runtime —
 * the browser leg's names in `shared/plugin-host/runtime-legs.ts`. A value of the
 * backend leg only (`createMcpServer`, `z`, `DomainError`, …) is visible here as
 * a type and nothing more, so using it in frontend code is a compile error of
 * the plugin — the compile-time mirror of the ES-module link error the shim
 * would raise in the browser. A test holds the value lists equal to the leg
 * inventory.
 *
 * This is a SCRIPT file (no top-level import/export) so the `declare module`
 * blocks are AMBIENT declarations, not augmentations. The bodies live in the
 * tsc-emitted module surfaces — re-exported here by their official subpaths, so
 * there is a single source and no hand-mirrored copy of a signature. It is
 * shipped verbatim (copied into `dist/plugin-types/`), never compiled by the
 * host, so the self-package specifiers resolve on the consumer side (where the
 * package is installed), not during the host's own build.
 */

declare module '@c4s/plugin-runtime' {
  export type * from '@inharness-ai/claude4spec/plugin-runtime';
  export {
    HOST_API_VERSION,
    clientPluginHost,
    registerFrontendModule,
    queryClient,
    versionService,
    useVersions,
    useVersionDetail,
    useRestoreVersion,
    useVersionDiff,
    lineDiffHunks,
    editorBridge,
    EditorBridgeProvider,
    tagsService,
    useTags,
    useEntityTags,
    useAssignTags,
    useRemoveEntityTag,
    useCreateTag,
    referencesService,
    useReferences,
    releasesService,
    useReleases,
    startSeededThread,
    openPopover,
    openModal,
    confirmDestructive,
    toast,
  } from '@inharness-ai/claude4spec/plugin-runtime';
}

declare module '@c4s/plugin-runtime/ui' {
  export type * from '@inharness-ai/claude4spec/plugin-runtime/ui';
  export {
    EntityListHeader,
    DetailPanelShell,
    FieldRow,
    FieldGrid,
    EntityListLayout,
    Pagination,
    EmptyState,
    TagFilterBar,
    EntityListRow,
    GroupedEntityList,
    ActionButton,
    ActionBar,
    Badge,
    TagChip,
    LoadingState,
    FormField,
    InlineEditField,
    Dialog,
    FormShell,
    SegmentedControlTabs,
    VersionHistory,
    DiffView,
    EntityDetailToolbar,
    RichTextField,
    TagPicker,
    ReferencesList,
    DocumentBody,
    DocEditor,
    EntityVersionHistoryView,
    Popover,
    ToastViewport,
    useToast,
    EnumBadgePicker,
    GroupedRelationPicker,
    useHostTokens,
    HOST_TOKEN_NAMES,
    readHostTokens,
    UI_KIT_CATALOG,
    UI_KIT_STABLE_COMPONENTS,
  } from '@inharness-ai/claude4spec/plugin-runtime/ui';
}
