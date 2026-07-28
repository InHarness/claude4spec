/**
 * M34 / L12 — per-component stability tier.
 *
 * Every component in the Host UI Kit catalog carries a mandatory `stability`
 * constant (a field-level requirement, per the L12 slice schema). It governs the
 * versioned surface:
 *
 *  - `stable`       — prop contract is frozen. A prop-shape change is breaking →
 *                     major `hostApiVersion` bump + a `migrations[]` descriptor +
 *                     a deprecation window (the L11/M33 gate machinery). Only
 *                     `stable` components enter the versioned `hostApiVersion`
 *                     surface.
 *  - `experimental` — props may change WITHOUT a major bump and are NOT gated at
 *                     plugin load. A plugin opts into them knowingly. Promotion
 *                     `experimental → stable` is an explicit decision (M34
 *                     changelog) that pulls the component into the surface.
 *
 * Since 0.1.143 every component carries a SECOND mandatory constant, `binding`
 * (`presentational` | `connected`) — see {@link Binding}. The two are
 * orthogonal: `stability` governs versioning, `binding` governs data access.
 */
export type { Stability, Binding } from '../../shared/plugin-host/ui-kit-surface.js';
import type { Stability, Binding } from '../../shared/plugin-host/ui-kit-surface.js';

/**
 * A catalog component carries its two mandatory constants as static properties:
 * `stability` (versioning tier) and `binding` (how it gets its data). A
 * `connected` component additionally names the L11 surface it consumes.
 */
export type WithStability<C> = C & {
  stability: Stability;
  binding: Binding;
  l11Surfaces?: readonly string[];
};

/**
 * Attach the catalog constants to a component (keeps them field-level, so the
 * registry can read them off the component instead of restating them).
 *
 * `binding` defaults to `presentational` — the doctrine every component follows
 * unless it deliberately reaches for the host. Pass `l11Surfaces` for
 * `connected` components to name what they consume.
 */
export function withStability<C extends object>(
  component: C,
  stability: Stability,
  binding: Binding = 'presentational',
  l11Surfaces?: readonly string[],
): WithStability<C> {
  return Object.assign(component, { stability, binding, ...(l11Surfaces ? { l11Surfaces } : {}) });
}
