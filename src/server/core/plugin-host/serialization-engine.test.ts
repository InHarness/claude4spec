/**
 * L9 dispatch, at the seam where a plugin's code meets the host's.
 *
 * The engine's three lookup outcomes (declared view → computed; undeclared view
 * → generic; unknown type → marker for the core to map) were exercised only
 * indirectly, through the discovery ops that sit on top. The arm that matters
 * most had no test at all: what the host does when a plugin's own view function
 * throws. A bug in one type's `detail` must not take down a `get_entities` call
 * that happens to include that type.
 */

import { describe, expect, it, vi } from 'vitest';
import { fixtureModule, FIXTURE_DATA } from '../../../../tests/helpers/fixture-module.js';
import { SerializationEngine } from './serialization-engine.js';
import type { BackendModule, ProjectPluginHost } from './types.js';
import type { RawEntity, RawEntityReader } from '../../discovery/raw-entity-reader.js';
import type { ViewSet } from '../../serialization/types.js';

const ENTITY: RawEntity = {
  type: 'widget',
  slug: 'w1',
  data: { name: 'Widget One' },
  tags: ['t'],
};

/** Only the three members the engine actually reaches for. */
function hostWith(modules: BackendModule[]): ProjectPluginHost {
  const byType = new Map(modules.map((m) => [m.type, m]));
  return {
    getAvailable: (type: string) => byType.get(type) ?? null,
    getEntity: (type: string) => byType.get(type) ?? null,
    listEntities: () => [...byType.values()],
  } as unknown as ProjectPluginHost;
}

function moduleWithViews(views: ViewSet<unknown>): BackendModule {
  const mod = fixtureModule('widget');
  return { ...mod, data: FIXTURE_DATA, serializer: { ...mod.serializer, views } };
}

const reader = { count: () => 0 } as unknown as RawEntityReader;

describe('SerializationEngine.serializeEntity — the three lookup outcomes', () => {
  it('returns the computed result, unflagged, when the type declares the view', () => {
    const engine = new SerializationEngine(
      hostWith([moduleWithViews({ detail: () => ({ computed: true }) })]),
    );

    const out = engine.serializeEntity('widget', 'detail', ENTITY, reader);

    expect(out.data).toEqual({ computed: true });
    expect(out.generic).toBe(false);
    expect(out.error).toBeUndefined();
  });

  it('[ac:ac-slot-views-zawiera-wylacznie-widoki-o] emits the schema-derived generic view for a view the type left undeclared', () => {
    // The RULE, not a fallback: `views?` carries computed views only, so a type
    // declaring one view still answers all five.
    const engine = new SerializationEngine(
      hostWith([moduleWithViews({ detail: () => ({ computed: true }) })]),
    );

    const out = engine.serializeEntity('widget', 'single_element', ENTITY, reader);

    expect(out.generic).toBe(true);
    expect(out.error).toBeUndefined();
    expect(out.data).toMatchObject({ _generic: true, _type: 'widget', _view: 'single_element' });
  });

  it('[ac:ac-helper-serialize-host-type-view-entit] resolves the type through the host, marking an unknown one instead of passing it off as a normal generic view', () => {
    // The engine reports `unknown_type`; the discovery core turns that into
    // INVALID_TYPE (see discovery.test.ts). What matters here is that a type
    // the host cannot resolve AT ALL is DISTINGUISHABLE from a type that merely
    // left a view undeclared — both are `generic: true`, only one carries the
    // marker.
    //
    // Not the same gate as deactivation: the engine resolves through
    // `getAvailable`, which still answers for a loaded-but-inactive type, so a
    // deactivated type reaches a normal view here. Refusing it is the discovery
    // core's `requireActiveType` (which goes through `getEntity`).
    const engine = new SerializationEngine(hostWith([]));

    const out = engine.serializeEntity('widget', 'detail', ENTITY, reader);

    expect(out.error).toBe('unknown_type');
    expect(out.generic).toBe(true);
  });
});

describe('SerializationEngine — a computed view that throws', () => {
  it('[ac:ac-widok-obliczeniowy-rzucajacy-wyjatek] is caught by the host, which answers with the generic view plus an error', () => {
    const boom = vi.fn(() => {
      throw new Error('bad ref');
    });
    const engine = new SerializationEngine(hostWith([moduleWithViews({ detail: boom })]));

    const out = engine.serializeEntity('widget', 'detail', ENTITY, reader);

    expect(boom).toHaveBeenCalled();
    expect(out.generic).toBe(true);
    // The host's own vocabulary, which is NOT the `view_threw` the spec states —
    // see the drift patch filed against this brief.
    expect(out.error).toMatch(/^serializer_threw: /);
    expect(out.error).toContain('bad ref');
    // Still a usable payload: the consumer gets the schema projection, not null.
    expect(out.data).toMatchObject({ _generic: true, _type: 'widget' });
  });

  it("[ac:ac-widok-obliczeniowy-rzucajacy-wyjatek] does not let one type's bug reach another type in the same batch", () => {
    const engine = new SerializationEngine(
      hostWith([
        moduleWithViews({
          detail: () => {
            throw new Error('boom');
          },
        }),
        { ...fixtureModule('gadget'), serializer: { views: { detail: () => ({ ok: true }) } } },
      ]),
    );

    const broken = engine.serializeEntity('widget', 'detail', ENTITY, reader);
    const healthy = engine.serializeEntity(
      'gadget',
      'detail',
      { ...ENTITY, type: 'gadget' },
      reader,
    );

    expect(broken.error).toMatch(/^serializer_threw: /);
    expect(healthy.error).toBeUndefined();
    expect(healthy.data).toEqual({ ok: true });
  });
});

describe('SerializationEngine — broken refs travel on the envelope', () => {
  it('[ac:ac-widok-obliczeniowy-detail-ma-depth-li] lifts `_brokenRefs` out of a computed detail view instead of throwing', () => {
    const engine = new SerializationEngine(
      hostWith([
        moduleWithViews({
          detail: () => ({ linked: null, _brokenRefs: ['dto/gone', 'dto/also-gone'] }),
        }),
      ]),
    );

    const out = engine.serializeEntity('widget', 'detail', ENTITY, reader);

    expect(out.error).toBeUndefined();
    expect(out.generic).toBe(false);
    expect(out.brokenRefs).toEqual(['dto/gone', 'dto/also-gone']);
  });

  it('leaves `brokenRefs` absent when the view resolved everything', () => {
    const engine = new SerializationEngine(
      hostWith([moduleWithViews({ detail: () => ({ linked: { slug: 'd1' } }) })]),
    );

    expect(engine.serializeEntity('widget', 'detail', ENTITY, reader).brokenRefs).toBeUndefined();
  });
});
