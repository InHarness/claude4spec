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
 */
export type { Stability } from '../../shared/plugin-host/ui-kit-surface.js';
import type { Stability } from '../../shared/plugin-host/ui-kit-surface.js';

/** A catalog component carries its tier as a static `stability` property. */
export type WithStability<C> = C & { stability: Stability };

/** Attach the `stability` tier to a component (keeps the constant field-level). */
export function withStability<C extends object>(component: C, stability: Stability): WithStability<C> {
  return Object.assign(component, { stability });
}
