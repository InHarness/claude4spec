/**
 * M33 — frontend plugin loading contract ("Option B": import map + native ESM).
 *
 * The server injects the import map into the page (so a plugin's `import "react"`
 * resolves to the host's singleton) and filters the manifest: it announces only
 * plugins whose backend is `loaded` after the host-API / engines gate. The client
 * fetches {@link FrontendManifestResponse} at boot, injects each plugin's CSS,
 * then `await import(entry)` per announced plugin. It compares no versions.
 *
 * Shared so the server builder and the client boot loader agree on the shape.
 */

/** One announced plugin's frontend payload. */
export interface PluginFrontendEntry {
  /** Plugin name (overlay: folder name; npm package / envelope: `package.json` name). */
  name: string;
  /**
   * Package version, informational — the entry URL does not carry it (freshness
   * under a fixed address is the asset routes' ETag revalidation). NOT the
   * plugin's Host API version.
   */
  version: string;
  /**
   * Absolute URL of the plugin's frontend entry, served as native ESM by the asset
   * route of its tier: base tier `/api/plugins/<name>/<file>` (the same in every
   * project's manifest), overlay `/api/projects/<id>/plugins/<name>/<file>`. A
   * scoped name is one segment, its slash encoded as `%2F`.
   */
  entry: string;
  /** URL of the precompiled `frontend.css` next to the entry (same folder, same tier), when the plugin ships one. */
  css?: string;
}

/**
 * Response of the project's frontend manifest, `GET /api/projects/:id/plugins/frontend-manifest`
 * (`frontend-manifest-response`). `plugins[]` is the project's effective pool:
 * base ∪ this project's overlay. No field carries the project's identity.
 */
export interface FrontendManifestResponse {
  /** The HOST's Host API version. The client does not compare it: the gate runs on the server. */
  hostApiVersion: string;
  /**
   * Informational copy of the import map the server injects into the page: the
   * host's peer shims and both runtime specifiers, no plugin entries. The client
   * does not read it.
   */
  importMap: Record<string, string>;
  /** Announced plugins. Empty ⇒ the host renders on its own. */
  plugins: PluginFrontendEntry[];
}

/** Error code of every refusal of both plugin asset routes (base tier and project overlay). */
export const PLUGIN_FRONTEND_NOT_FOUND = 'PLUGIN_FRONTEND_NOT_FOUND';

/**
 * 404 body of both plugin asset routes — `GET /api/plugins/:name/:asset` and
 * `GET /api/projects/:id/plugins/:name/:asset` (`plugin-frontend-asset-error`).
 * One code for every refusal — disallowed extension, a path separator or `..`,
 * an untrusted overlay, a plugin absent from the project's overlay, a missing
 * file — so a client cannot tell a missing file from a refused one. The project
 * prefix's own answers (404 `PROJECT_NOT_IN_WORKSPACE`, 500
 * `PROJECT_BUILD_FAILED`) are not refusals of these routes and do not use it.
 */
export interface PluginFrontendAssetError {
  error: { code: string; message: string };
}

/**
 * Bare specifiers the import map externalizes to host-served shim ESM modules.
 * Each resolves to `/api/plugins/runtime/<peer>.js`, which re-exports the host's
 * live singleton from `window.__c4s_shared`. Keeping the list here lets the
 * server builder and the client publisher stay in lockstep.
 */
export const SHARED_PEER_SPECIFIERS = [
  'react',
  // The automatic JSX runtime subpaths a plugin's `dist/frontend.js` emits when
  // compiled with `jsx: 'react-jsx'` (`import { jsx, jsxs } from "react/jsx-runtime"`,
  // dev builds also `jsxDEV` from `react/jsx-dev-runtime`). These are SEPARATE bare
  // subpaths not covered by the `react` entry, so they need their own import-map
  // entries — otherwise the browser can't resolve them and the whole plugin module
  // fails to load. Sharing them keeps the plugin on the host's single React
  // reconciler (L11 invariant) instead of bundling a second copy.
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/client',
  '@tiptap/core',
  '@tanstack/react-query',
  // M33 phase 3: the router is a SHARED library peer (one instance via the import
  // map) so a plugin's `createRoute({ getParentRoute })` and the host's single
  // TanStack Router operate on the SAME route-tree types — NOT a live singleton
  // re-exported through `@c4s/plugin-runtime`.
  '@tanstack/react-router',
  // Icons (M33/0.1.121): a curatorial peer, not a correctness one — unlike
  // React/Tiptap/the router, two copies of `lucide-react` share no reconciler
  // or hook state, so there is no hook-correctness gate for it. Externalizing
  // it is purely about one consistent icon set and a smaller plugin bundle.
  'lucide-react',
  '@c4s/plugin-runtime',
  '@c4s/plugin-runtime/ui',
] as const;

export type SharedPeerSpecifier = (typeof SHARED_PEER_SPECIFIERS)[number];

/**
 * The value exports of `@c4s/plugin-runtime` (frontend facade), the one peer the
 * server can't introspect by importing (it's a browser module). The runtime
 * shim generator emits these names; a parity test asserts they match the actual
 * module so this list can't silently drift. Keep in sync with
 * `src/client/runtime/plugin-runtime.ts` value exports.
 */
export const PLUGIN_RUNTIME_EXPORT_NAMES = [
  'clientPluginHost',
  'registerFrontendModule',
  'queryClient',
  'editorBridge',
  // 0.2.2 — the WRITE side of the bridge, needed by a plugin that owns page
  // routes: its detail route must supply one or every entity chip in the body
  // silently stops navigating.
  'EditorBridgeProvider',
  // 2.1.2 (M51) — `registerExtensionReferenceType` is gone: XML tag names are
  // registered by host modules only; a loaded plugin never reaches the registry.
  // M34/L11: frontend data-service singletons + hooks, additive to the 1.0.0
  // baseline (no HOST_API_VERSION bump).
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
  /**
   * M05/0.2.80 — the published equivalent of a host-only facade.
   *
   * It drives the chat store, a singleton rather than a window event, so an
   * envelope cannot reproduce it by dispatching the way it can `toast`. Named
   * here because a shim that omitted it would leave `c4s-plugin-ac`'s list
   * screen importing `undefined` and its "Analyze consistency" action throwing
   * on click — the failure this parity test exists to make impossible.
   */
  'startSeededThread',
  // M13/L11: a pure function, deliberately not a singleton.
  'lineDiffHunks',
  // 2.1.20 (M50 `tbeatf5z`): the shell's four window facades — the host's own
  // functions, so a plugin opens windows and toasts by `kind`, never by
  // dispatching a host event.
  'openPopover',
  'openModal',
  'confirmDestructive',
  'toast',
  'HOST_API_VERSION',
] as const;

/**
 * The BACKEND value exports of `@c4s/plugin-runtime` (0.1.133 MCP builder
 * facade). Unlike {@link PLUGIN_RUNTIME_EXPORT_NAMES}, these are NOT browser
 * singletons routed through the import-map shim — they are host-process values
 * re-exported from the backend barrel (`server/plugin-runtime/index.ts`) and
 * shipped via the package's `./plugin-runtime` runtime export. A parity test
 * (`published-surface.test.ts`) asserts the barrel exports exactly these and
 * that the published `.d.ts` declares their facade signatures.
 */
export const PLUGIN_RUNTIME_BACKEND_VALUE_NAMES = [
  'createMcpServer',
  'mcpTool',
  // 0.2.2 — the host narrows on this class with `instanceof`, so a plugin that
  // declares its own copy loses every structured error code to INTERNAL/500.
  'DomainError',
  // 0.2.27 — the named-validator registry, needed by a `payloadUpgrades` step
  // migrating files onto a field that has just gained a `kind`. The rule is the
  // host's; a plugin transcribing it drifts on the first entry the host adds.
  'checkValidator',
  'validatorMessage',
  // 0.2.27 — a type overriding `diff` must report the byte counts the read
  // descriptors advertise, not a second count of its own.
  'contentBytes',
] as const;

/**
 * The VALUE exports of `@c4s/plugin-runtime/ui` (Host UI Kit catalog, M34/L12) —
 * a browser module the server can't introspect, same as the main facade above.
 * The runtime shim emits these names; a parity test asserts they match the
 * actual module so this list can't silently drift. Keep in sync with
 * `src/client/runtime/plugin-runtime-ui.ts` (→ `client/host-ui-kit/index.ts`)
 * value exports. Type-only exports are erased at runtime and excluded here.
 */
export const PLUGIN_RUNTIME_UI_EXPORT_NAMES = [
  // Core (stable)
  'EntityListHeader',
  'DetailPanelShell',
  'FieldRow',
  'FieldGrid',
  // List (experimental)
  'EntityListLayout',
  'Pagination',
  'EmptyState',
  'TagFilterBar',
  'EntityListRow',
  'GroupedEntityList',
  // Actions & states (experimental)
  'ActionButton',
  'ActionBar',
  'Badge',
  'LoadingState',
  // Form (experimental)
  'FormField',
  'InlineEditField',
  // Overlay (experimental)
  'Dialog',
  'FormShell',
  // Panel detalu (experimental, M34/L11)
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
  // Feedback (experimental, M34/L12)
  'Popover',
  'ToastViewport',
  // Hooks exported beside the catalog (no registry entry)
  'useToast',
  // Pickers (experimental, M34/L12)
  'EnumBadgePicker',
  'GroupedRelationPicker',
  // Token bridge
  'useHostTokens',
  'HOST_TOKEN_NAMES',
  'readHostTokens',
  // Stability metadata
  'UI_KIT_CATALOG',
  'UI_KIT_STABLE_COMPONENTS',
] as const;
