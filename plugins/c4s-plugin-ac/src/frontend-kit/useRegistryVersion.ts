import { useSyncExternalStore } from 'react';
import { clientPluginHost } from '@c4s/plugin-runtime';

/**
 * Re-render when the entity-type registry changes.
 *
 * The envelope's counterpart to the host's hook of the same name, over the
 * published `onRegistryChanged`/`registryVersion` pair. Anything that reads the
 * registry during render needs it: plugin frontends are imported non-blocking
 * after first paint, so a component that mounts on a cold load reads a registry
 * that does not hold the other envelopes' types yet.
 *
 * The failure is silent rather than loud — a picker built from `listEntities()`
 * simply offers fewer groups — which is why it has to be structural rather than
 * left to whoever remembers.
 *
 * `useSyncExternalStore` rather than an effect: the subscription must be in
 * place before the first render's read is committed.
 */
export function useRegistryVersion(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const subscribe = (onChange: () => void): (() => void) => clientPluginHost.onRegistryChanged(onChange);

const getSnapshot = (): number => clientPluginHost.registryVersion();
