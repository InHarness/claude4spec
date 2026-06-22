/**
 * `@c4s/plugin-runtime` — backend half.
 *
 * The single, versioned surface a runtime plugin's server code (its
 * `backend.mount(ctx)`) compiles against, instead of reaching into deep host
 * paths. On the backend the host singletons are shared in-process; this module
 * re-exports the stable contract pieces.
 *
 * Phase 1 has no plugin packages, so nothing imports this yet — it exists so the
 * contract surface is in place and stable for phase 2 (when project-local
 * plugins under `.claude4spec/plugins/` link against it). The frontend half of
 * `@c4s/plugin-runtime` lives in `src/client/runtime/plugin-runtime.ts` and is
 * delivered to plugins through the import-map shim.
 */

export { HOST_API_VERSION } from '../../shared/plugin-host/manifest.js';
export type {
  PluginManifest,
  EntityContribution,
  PluginEngines,
} from '../../shared/plugin-host/manifest.js';
export type {
  PluginRegistry,
  ProjectPluginHost,
  BackendModule,
  MountContext,
  PluginMountFn,
} from '../core/plugin-host/types.js';
