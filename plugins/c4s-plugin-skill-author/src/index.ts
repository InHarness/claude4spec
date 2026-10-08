/**
 * Backend entry. The host loader imports this module, reads `manifest` (named or
 * default) off it, checks the version gate and calls
 * `registry.registerPlugin(manifest)`.
 *
 * That is the ONLY registration path: this package is never wired through the
 * host's `registerAllPlugins` and has no `registerAll` of its own. Discovery is
 * by directory (`plugins/*` → `dist/plugins/*`), so the host holds no list naming
 * it — the composition of the built-in envelopes is recorded in M13's registry
 * of built-in envelopes, not in code.
 */
export { manifest } from './manifest.js';
export { manifest as default } from './manifest.js';
