/**
 * Backend entry. The host loader imports this module, reads `manifest` (named or
 * default) off it, checks the version gate and calls
 * `registry.registerPlugin(manifest)`.
 *
 * That is the ONLY registration path: this package is never wired through the
 * host's `registerAllPlugins`, and it has no `registerAll` of its own.
 */
export { manifest } from './manifest.js';
export { manifest as default } from './manifest.js';
