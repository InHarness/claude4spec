/**
 * `@c4s/plugin-runtime/ui` — backend half.
 *
 * The Host UI Kit is a FRONTEND surface (React components delivered via the M33
 * import-map shim — see `client/runtime/plugin-runtime-ui.ts`). On the backend
 * there are no components to share; this module exists only so server-side
 * plugin code can reference the versioned contract — the React-free set of
 * `stable` component names and the `Stability` type — without reaching into the
 * client catalog (which imports React).
 *
 * Phase 1 ships no plugin packages, so nothing imports this yet; it keeps the
 * contract surface stable for phase 2.
 */

export { UI_KIT_STABLE_COMPONENTS } from '../../shared/plugin-host/ui-kit-surface.js';
export type { Stability, StableUiKitComponent } from '../../shared/plugin-host/ui-kit-surface.js';
