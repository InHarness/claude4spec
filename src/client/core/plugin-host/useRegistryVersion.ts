import { useSyncExternalStore } from 'react';
import { clientPluginHost } from './host.js';

/**
 * Re-render when the entity-type registry changes.
 *
 * 0.2.80 — the fix for a race that only ever bit a COLD LOAD, and bit it
 * permanently. `bootFrontendPlugins` imports plugin frontends non-blocking,
 * after first paint, so a page whose editor mounts first renders its chips
 * against a registry that does not hold the envelope-delivered types yet. A
 * route recovers on the next navigation; a ProseMirror NodeView does not — it
 * renders once, and nothing about a later `registerFrontendModule` gives it a
 * reason to run again. The reader is left looking at "⚠ unknown type: ui-view"
 * on a type that registered 200ms later, and a reload usually reproduces it.
 *
 * It surfaced when `ac` became the ninth built-in envelope: one more bundle on
 * the boot path was enough to lose a race the other eight had been winning, and
 * `ui-view`/`endpoint` chips broke alongside `ac` on the same page — which is
 * what showed this was never about `ac`.
 *
 * `useSyncExternalStore` rather than an effect: the subscription has to be in
 * place before the first paint's registry read is committed, or the fix has a
 * race of its own.
 */
export function useRegistryVersion(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const subscribe = (onChange: () => void): (() => void) =>
  clientPluginHost.onRegistryChanged(() => {
    version += 1;
    onChange();
  });

/**
 * A counter, not the module list. `getSnapshot` must return something
 * `Object.is`-stable between changes — an array rebuilt per call would make
 * React re-render forever.
 */
let version = 0;
const getSnapshot = (): number => version;
