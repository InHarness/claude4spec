/**
 * `@c4s/plugin-runtime/ui` — frontend half (Host UI Kit catalog).
 *
 * A sibling subpath of `@c4s/plugin-runtime`: the main specifier carries the
 * host's LIVE, mutable singletons (registry, QueryClient, editor bridge); this
 * `/ui` subpath carries the host's STABLE, purely-presentational component
 * catalog + token bridge (M34 / L12). Keeping them on separate specifiers makes
 * the split explicit.
 *
 * `shared-runtime.ts` publishes this module's namespace onto `window.__c4s_shared`
 * under `'@c4s/plugin-runtime/ui'`; the M33 import-map shim re-exports it — so a
 * plugin's `import "@c4s/plugin-runtime/ui"` resolves to the ONE host UI bundle,
 * not a per-plugin copy.
 */

export * from '../host-ui-kit/index.js';
