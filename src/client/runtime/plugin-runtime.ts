/**
 * `@c4s/plugin-runtime` — frontend half.
 *
 * The single, versioned surface a runtime plugin's frontend code compiles
 * against. It re-exports the host's live singletons; at runtime a plugin's
 * `import "@c4s/plugin-runtime"` resolves (via the import map) to a server-served
 * shim that reads these off `window.__c4s_shared` — so the plugin and host share
 * one plugin registry, one QueryClient, one EditorBridge, and one
 * extension-reference registry.
 *
 * `shared-runtime.ts` publishes this module's namespace onto the global; the
 * import-map shim re-exports it. The peers (react / react-dom / @tiptap/core /
 * @tanstack/react-query) are published the same way from `shared-runtime.ts`.
 */

export { clientPluginHost, registerFrontendModule } from '../core/plugin-host/host.js';
export { queryClient } from './query-client.js';
export { editorBridge } from './editor-bridge.js';
/**
 * 0.2.2 — a plugin that owns page ROUTES needs this, not just the singleton.
 *
 * The singleton below is the read side, for a plugin rendering outside the React
 * tree. `EditorBridgeProvider` is the write side, and until a type could
 * contribute its own detail route only the host had any reason to mount one. Now
 * a plugin route renders a `DocEditor` for its entity's description, and an
 * entity chip inside that description resolves the bridge from React context: no
 * provider means `DocEditor` falls back to a no-op, every chip click silently
 * does nothing, and — because `DocEditor` publishes whatever bridge it has into
 * the process-wide singleton — chips elsewhere on the page stop navigating too.
 */
export { EditorBridgeProvider } from '../tiptap/EditorContext.js';
export { registerExtensionReferenceType } from '../../shared/reference-extensions.js';

// M34/L11: frontend data-service singletons, each a mirror of the matching
// backend service already carried in MountContext. All bind to the shared
// `queryClient` above via their hooks — no second QueryClient. Additive to
// the current HOST_API_VERSION baseline (no version bump).
export { versionService } from './version-service.js';
export { tagsService } from './tags-service.js';
export { referencesService } from './references-service.js';
export { releasesService } from './releases-service.js';
export { useVersions, useVersionDetail, useRestoreVersion, useVersionDiff } from '../hooks/useVersions.js';
export { useTags, useEntityTags, useAssignTags, useRemoveEntityTag, useCreateTag } from '../hooks/useTags.js';
export { useReferences } from '../hooks/useReferences.js';
export { useReleases } from '../hooks/useReleases.js';

/**
 * 0.2.79 — the published equivalent of a host-only facade.
 *
 * `startSeededThread` opens the chat overlay on a fresh thread and seeds it. It
 * lives over the M05 chat store, which is a Zustand singleton rather than a
 * window event — so unlike `toast`, an envelope cannot re-create it by
 * dispatching. `c4s-plugin-ac`'s list screen needs exactly it: the "Analyze
 * consistency" action is specified as `startSeededThread(SEED_PROMPT,
 * {autoSubmit: true})`, and it left the host with the rest of the AC vertical.
 *
 * Published the same way `openPopover` / `toast.*` became `Popover` / `useToast`
 * when the host-only versions turned out to be things plugins legitimately
 * needed. Additive within the `2.0.0` baseline.
 */
export { startSeededThread } from '../chat/startSeededThread.js';
export type { StartSeededThreadOptions } from '../chat/startSeededThread.js';

// M13/L11: a PURE FUNCTION, not a singleton — no single-instance requirement.
export { lineDiffHunks } from './line-diff.js';

export { HOST_API_VERSION } from '../../shared/plugin-host/manifest.js';
export type { FrontendModule } from '../core/plugin-host/types.js';
export type { EditorBridge } from '../tiptap/EditorContext.js';
export type { VersionServiceSingleton } from './version-service.js';
export type { TagsServiceSingleton } from './tags-service.js';
export type { ReferencesServiceSingleton } from './references-service.js';
export type { ReleasesServiceSingleton } from './releases-service.js';
