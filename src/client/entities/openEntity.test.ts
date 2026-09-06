/**
 * Where a click on an entity goes — the one rule, asserted at the helper.
 *
 * 0.2.70 is what made this worth pinning. `module-dependency` is the first type
 * that is HIDDEN (no `routes`, no `detailPanel`) and yet declares `renderRow`,
 * so a row is drawn for a type with nowhere to navigate — a combination that had
 * never occurred before, and one that `TaggedListView` got wrong by calling
 * `bridge.openEntity` directly instead of going through this helper. The result
 * was a click that navigated to a route nothing registers.
 *
 * The failure is invisible in a type signature and silent at runtime, so it is
 * asserted here rather than left to the docblock that already warned about it.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../tests/helpers/fixture-module.js';
import { clientPluginHost } from '../core/plugin-host/host.js';
import { openEntityHandler } from './openEntity.js';
import { UI_EVENTS } from '../ui/events.js';
import type { FrontendModule } from '../core/plugin-host/types.js';

/*
 * Minimal `window` / `CustomEvent` stubs — the suite runs under the `node`
 * environment, per this repo's convention (see `tiptap/pluginCommands.test.ts`).
 * `openEntityOverlay` only dispatches a window event, so that is all it needs.
 */
const dispatched: Array<{ type: string; detail: unknown }> = [];
beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.CustomEvent === 'undefined') {
    g.CustomEvent = class {
      type: string;
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    };
  }
  g.window = { dispatchEvent: (e: { type: string; detail: unknown }) => dispatched.push(e) };
});

const Noop = (() => null) as unknown as FrontendModule['renderCard'];
const routesFragment = (() => []) as unknown as FrontendModule['routes'];

function browsable(type: string): FrontendModule {
  return {
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
    renderRow: Noop,
    detailPanel: Noop,
    routes: routesFragment,
    useGetBySlug: () => ({ data: null, isLoading: false }),
    listByTags: async () => [],
  } as unknown as FrontendModule;
}

/**
 * Hidden AND listable — the `module-dependency` shape. `renderRow` is kept and
 * `routes`/`detailPanel` are dropped, which is exactly the combination that had
 * no instance before this release.
 */
function hiddenListable(type: string): FrontendModule {
  const mod = browsable(type) as Partial<FrontendModule>;
  delete mod.detailPanel;
  delete mod.routes;
  return { ...mod, renderOverlay: Noop } as unknown as FrontendModule;
}

describe('openEntityHandler — where a click goes', () => {
  /*
   * Registration is NOT undone between tests, because the client host has no
   * unregister door — `registerFrontendModule` is the whole surface. Each
   * fixture therefore uses a type name of its own, which is what keeps the tests
   * independent; an `afterEach` calling an optional method that does not exist
   * would look like cleanup while doing nothing.
   */
  const register = (mod: FrontendModule): void => clientPluginHost.registerFrontendModule(mod);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('navigates through the bridge for a type that has a detail route', () => {
    register(browsable('browsable-fixture'));
    const bridge = { openEntity: vi.fn() };

    openEntityHandler('browsable-fixture', 'thing', bridge)?.();

    expect(bridge.openEntity).toHaveBeenCalledWith('browsable-fixture', 'thing');
  });

  /**
   * THE REGRESSION. A hidden type has no route, so the click must raise the
   * overlay event and must NOT reach the bridge — a bridge call here navigates
   * to `/hidden-listable-fixtures/thing`, which nothing registers.
   *
   * `renderRow` is present on the fixture on purpose: listability and hidden-ness
   * are independent, and it was believing otherwise that produced the bug.
   */
  it('raises the overlay — never the bridge — for a hidden type, even a listable one', () => {
    register(hiddenListable('hidden-listable-fixture'));
    const bridge = { openEntity: vi.fn() };
    dispatched.length = 0;

    openEntityHandler('hidden-listable-fixture', 'thing', bridge)?.();

    expect(bridge.openEntity).not.toHaveBeenCalled();
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.type).toBe(UI_EVENTS.ENTITY_OVERLAY);
    expect(dispatched[0]!.detail).toMatchObject({
      type: 'hidden-listable-fixture',
      slug: 'thing',
    });
  });

  /**
   * A type that resolves to nothing — unregistered, or deactivated by
   * `config.entities` — yields no handler at all. That is what makes a broken
   * chip INERT rather than opening an empty overlay, and it is the same rule for
   * a row inside a tagged list.
   */
  it('yields no handler for a type that resolves to nothing', () => {
    expect(openEntityHandler('never-registered', 'thing', { openEntity: vi.fn() })).toBeUndefined();
  });
});
