/**
 * M33 — frontend plugin loading contract ("Option B": import map + native ESM).
 *
 * The client fetches {@link FrontendManifestResponse} at boot, injects an
 * import map (so plugin `import "react"` resolves to the host's singleton),
 * injects each plugin's CSS, then `await import(entry)` per active plugin.
 *
 * Shared so the server builder and the client boot loader agree on the shape.
 */

/** One active plugin's frontend payload. */
export interface PluginFrontendEntry {
  /** npm package name. */
  name: string;
  /** plugin semver. */
  version: string;
  /** ESM URL of the plugin's frontend entry, served as native ESM. */
  entry: string;
  /** Optional precompiled CSS URL for this plugin. */
  css?: string;
}

/** Response of `GET /api/plugins/frontend-manifest`. */
export interface FrontendManifestResponse {
  /** Host semver the client compares against (major-mismatch omits a plugin). */
  hostApiVersion: string;
  /** Bare specifier → ESM URL. Externalizes shared peers to host bundle URLs. */
  importMap: Record<string, string>;
  /** Active plugins to load. Empty (no plugin packages shipped yet). */
  plugins: PluginFrontendEntry[];
  /** Optional host-level precompiled CSS URLs to inject (order preserved). */
  css?: string[];
}

/**
 * Bare specifiers the import map externalizes to host-served shim ESM modules.
 * Each resolves to `/api/plugins/runtime/<peer>.js`, which re-exports the host's
 * live singleton from `window.__c4s_shared`. Keeping the list here lets the
 * server builder and the client publisher stay in lockstep.
 */
export const SHARED_PEER_SPECIFIERS = [
  'react',
  'react-dom',
  'react-dom/client',
  '@tiptap/core',
  '@tanstack/react-query',
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
  'registerExtensionReferenceType',
  'HOST_API_VERSION',
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
  // Actions & states (experimental)
  'ActionButton',
  'Badge',
  'LoadingState',
  // Form (experimental)
  'FormField',
  'InlineEditField',
  // Token bridge
  'useHostTokens',
  'HOST_TOKEN_NAMES',
  'readHostTokens',
  // Stability metadata
  'UI_KIT_CATALOG',
  'STABLE_UI_KIT_COMPONENTS',
] as const;
