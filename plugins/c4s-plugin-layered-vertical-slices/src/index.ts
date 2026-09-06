/**
 * Backend entry. The host loader imports this module, reads `manifest` (named or
 * default) off it, checks the version gate and calls
 * `registry.registerPlugin(manifest)`.
 *
 * That is the ONLY registration path: this package is never wired through the
 * host's `registerAllPlugins`, and it has no `registerAll` of its own. Since
 * 0.2.70 it does contribute an entity type (`module-dependency`), but that type
 * still does not go through the core's `entities/index.ts` — it reaches
 * `registerEntityModule` through the manifest fan-out, exactly as every other
 * envelope's type does.
 */
export { manifest } from './manifest.js';
export { manifest as default } from './manifest.js';
