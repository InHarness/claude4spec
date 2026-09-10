/**
 * The registry CHANGE signal (0.2.80).
 *
 * Plugin frontends are imported non-blocking, after first paint, so anything
 * that reads the registry during render can read it before the type it wants
 * has arrived. A route recovers on the next navigation. A ProseMirror NodeView
 * does not: it renders once, and nothing about a later `registerFrontendModule`
 * gives it a reason to run again — so a cold load left "⚠ unknown type: ui-view"
 * on the page permanently, for a type that registered 200ms later.
 *
 * These pin the mechanism the chip views subscribe to. The end-to-end proof (a
 * cold load of a page carrying an envelope-delivered chip) lives in
 * `tests/e2e/ac-envelope.test.ts`, because the race only exists in a browser.
 */

import { describe, expect, it, vi } from 'vitest';
import { clientPluginHost } from './host.js';
import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../../tests/helpers/fixture-module.js';
import type { FrontendModule } from './types.js';

/** The host smoke-tests `renderChip` at registration, so the slot must be real. */
const Noop = (() => null) as unknown as FrontendModule['renderChip'];

const moduleOf = (type: string): FrontendModule =>
  ({
    type,
    data: FIXTURE_DATA,
    slugPattern: FIXTURE_SLUG_PATTERN,
    payloadVersion: 1,
    label: type,
    labelPlural: `${type}s`,
    displayOrder: 500,
    pathPrefix: `/${type}s`,
    renderChip: Noop,
    renderCard: Noop,
    /**
     * A HIDDEN entity: no `routes`, no `detailPanel`, so it must carry
     * `renderOverlay` instead. That is the smallest shape the host accepts, and
     * a route tree is beside the point here — these cases are about the change
     * signal, not about slot validation.
     */
    renderOverlay: Noop,
    useGetBySlug: () => ({ data: null, isLoading: false }),
    listByTags: async () => [],
  }) as unknown as FrontendModule;

describe('clientPluginHost.onRegistryChanged', () => {
  it('fires when a module registers', () => {
    const seen = vi.fn();
    const off = clientPluginHost.onRegistryChanged(seen);
    try {
      clientPluginHost.registerFrontendModule(moduleOf('signal-probe-a'));
      expect(seen).toHaveBeenCalledTimes(1);
    } finally {
      off();
    }
  });

  /**
   * Activation moves a type between `getEntity` answering the module and
   * answering null, which is exactly the input a chip branches on — so it has to
   * wake the same readers a registration does.
   */
  it('fires when activation changes, in both directions', () => {
    const seen = vi.fn();
    const off = clientPluginHost.onRegistryChanged(seen);
    try {
      clientPluginHost.applyActivation({ active: ['signal-probe-a'] } as never);
      clientPluginHost.applyActivation(null);
      expect(seen).toHaveBeenCalledTimes(2);
    } finally {
      off();
      clientPluginHost.applyActivation(null);
    }
  });

  /**
   * The counter must move whether or not anyone was listening.
   *
   * This is the half of the pair that is easy to get wrong, and getting it wrong
   * restores the original bug in a narrower window. `useSyncExternalStore` reads
   * the snapshot during render, subscribes in an effect, and then reads it AGAIN
   * to catch a change that landed in between — the gap being exactly the moment
   * a non-blocking `bootFrontendPlugins` import tends to resolve. A counter that
   * only advanced from inside a listener would read the same value on both
   * sides of that gap and schedule no re-render, and the chip would stay on
   * "unknown type" permanently, as before the fix.
   */
  it('advances the version even with nothing subscribed', () => {
    const before = clientPluginHost.registryVersion();
    clientPluginHost.registerFrontendModule(moduleOf('signal-probe-unwatched'));
    expect(clientPluginHost.registryVersion()).toBeGreaterThan(before);
  });

  it('stops firing after unsubscribe', () => {
    const seen = vi.fn();
    clientPluginHost.onRegistryChanged(seen)();
    clientPluginHost.registerFrontendModule(moduleOf('signal-probe-b'));
    expect(seen).not.toHaveBeenCalled();
  });

  /**
   * A subscriber that throws must not take down the REGISTRATION that woke it.
   * A broken chip renderer failing here would turn a rendering bug into a
   * missing entity type — strictly worse than the bug it came from.
   */
  it('a throwing listener neither stops the others nor fails the registration', () => {
    const good = vi.fn();
    const offBad = clientPluginHost.onRegistryChanged(() => {
      throw new Error('listener blew up');
    });
    const offGood = clientPluginHost.onRegistryChanged(good);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() =>
        clientPluginHost.registerFrontendModule(moduleOf('signal-probe-c')),
      ).not.toThrow();
      expect(good).toHaveBeenCalledTimes(1);
      expect(clientPluginHost.getAvailable('signal-probe-c')).not.toBeNull();
    } finally {
      consoleError.mockRestore();
      offBad();
      offGood();
    }
  });
});
