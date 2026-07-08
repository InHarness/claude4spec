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
export { registerExtensionReferenceType } from '../../shared/reference-extensions.js';

// M34/L11: frontend data-service singletons, each a mirror of the matching
// backend service already carried in MountContext. All bind to the shared
// `queryClient` above via their hooks — no second QueryClient. Additive to
// the current HOST_API_VERSION baseline (no version bump).
export { versionService } from './version-service.js';
export { tagsService } from './tags-service.js';
export { referencesService } from './references-service.js';
export { useVersions, useVersionDetail, useRestoreVersion, useVersionDiff } from '../hooks/useVersions.js';
export { useTags, useEntityTags, useAssignTags, useRemoveEntityTag, useCreateTag } from '../hooks/useTags.js';
export { useReferences } from '../hooks/useReferences.js';

export { HOST_API_VERSION } from '../../shared/plugin-host/manifest.js';
export type { FrontendModule } from '../core/plugin-host/types.js';
export type { EditorBridge } from '../tiptap/EditorContext.js';
export type { VersionServiceSingleton } from './version-service.js';
export type { TagsServiceSingleton } from './tags-service.js';
export type { ReferencesServiceSingleton } from './references-service.js';
