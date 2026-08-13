/**
 * 0.2.4 — the composition descriptor is validated AT REGISTRATION.
 * Host API 2.0.0 — and it is DERIVED, so most of what used to need validating
 * cannot be expressed any more.
 *
 * The point of every case below is temporal as much as structural: a descriptor
 * is a licence to `DELETE` from named tables during a rebuild, and the rebuild
 * runs at boot inside one transaction. Discovering a malformed licence there
 * means discovering it with the index already half-cleared, which is why none of
 * these may be deferred to first use.
 *
 * WHAT THIS FILE LOST, AND WHY THAT IS NOT LOST COVERAGE. It used to check a
 * hand-authored `composition` descriptor and a legacy `table` fallback: an
 * identifier that was not an identifier, a `mainTable` disagreeing with `table`,
 * a shared table without a scope predicate, a scope predicate smuggling SQL past
 * a character allowlist. Every one of those was a check on a VALUE A PLUGIN
 * WROTE. 2.0.0 removed both slots, so there is no such value left to write —
 * `mainTable` is the type slug, the identity column is `slug`, and the single
 * shared table carries the host's own predicate. Those cases did not become
 * untested; they became unrepresentable.
 *
 * What remains reachable is exactly what a plugin can still influence: its own
 * TYPE SLUG, which names its table, and a collection's `projectionTable`
 * override, which names a second one.
 */

import { describe, expect, it } from 'vitest';
import { PluginRegistryImpl } from './registry.js';
import { compositionOf } from '../../../shared/plugin-host/composition.js';
import type { BackendModule } from './types.js';
import type { DataDeclaration } from '../../../shared/plugin-host/data-schema.js';

const BASE_DATA: DataDeclaration = { schema: { title: { kind: 'string', required: true, maxLength: 200, default: 'Untitled' }, name: { kind: 'string', required: true } } };

function mod(type: string, data: DataDeclaration = BASE_DATA): BackendModule {
  return {
    type,
    data,
    slugPattern: [{ op: 'slugify', field: 'name' }],
    payloadVersion: 1,
    label: type,
    labelPlural: `${type}s`,
    displayOrder: 100,
    pathPrefix: `/${type}s`,
    serializer: {} as BackendModule['serializer'],
    systemPrompt: { roleNoun: type },
  };
}

/** A type owning a junction — the shape `endpoint` uses for `linked_dtos`. */
function withJunction(type: string, projectionTable?: string): BackendModule {
  return mod(type, {
    schema: {
      title: { kind: 'string', required: true, maxLength: 200, default: 'Untitled' },
name: { kind: 'string', required: true },
      links: {
        kind: 'collection',
        collection: 'value',
        keyFields: ['target'],
        ...(projectionTable ? { projectionTable } : {}),
        item: { kind: 'object', fields: { target: { kind: 'string', required: true } } },
      },
    },
  });
}

const register = (m: BackendModule, registry = new PluginRegistryImpl()) => () =>
  registry.registerEntityModule(m);

describe('composition descriptor — derived from data.schema', () => {
  it('names the main table after the type slug, underscored', () => {
    const registry = new PluginRegistryImpl();
    registry.registerEntityModule(mod('ui-view'));

    expect(compositionOf(registry.getAvailable('ui-view'))).toMatchObject({
      type: 'ui-view',
      mainTable: 'ui_view',
      identityColumn: 'slug',
      derivedTables: [],
      legacy: false,
    });
  });

  it('gives every type a scoped entity_tag entry', () => {
    const registry = new PluginRegistryImpl();
    registry.registerEntityModule(mod('glossary'));

    expect(compositionOf(registry.getAvailable('glossary'))?.sharedTables).toEqual([
      { table: 'entity_tag', scopePredicate: "entity_type = 'glossary'" },
    ]);
  });

  /**
   * The property the legacy `auxTables` slot could never provide. A table
   * inherited from that slot carried a NULL binding column, so the host could
   * only ever clear it wholesale — it did not know how `endpoint_dto` bound to
   * `endpoint`, and synthesizing a plausible `${type}_slug` would have produced
   * scoped DELETEs that were silently wrong. A derived table is one the host
   * GENERATED, so the binding is known by construction.
   */
  it('derives a junction with a KNOWN binding column', () => {
    const registry = new PluginRegistryImpl();
    registry.registerEntityModule(withJunction('widget'));

    expect(compositionOf(registry.getAvailable('widget'))?.derivedTables).toEqual([
      { table: 'widget_links', bindingColumn: 'widget_slug' },
    ]);
  });

  it('honours an explicit projectionTable override', () => {
    const registry = new PluginRegistryImpl();
    registry.registerEntityModule(withJunction('widget', 'widget_link'));

    expect(compositionOf(registry.getAvailable('widget'))?.derivedTables).toEqual([
      { table: 'widget_link', bindingColumn: 'widget_slug' },
    ]);
  });

  it('is the same answer whether or not the module went through registration', () => {
    const registry = new PluginRegistryImpl();
    const module = withJunction('widget');
    const beforeRegistration = compositionOf(module);
    registry.registerEntityModule(module);

    expect(compositionOf(registry.getAvailable('widget'))).toEqual(beforeRegistration);
  });

  it('leaves an embedded collection out of the descriptor entirely', () => {
    // No `keyFields` ⇒ embedded JSON on the parent row ⇒ no table to clear.
    const registry = new PluginRegistryImpl();
    registry.registerEntityModule(
      mod('widget', {
        schema: {
          title: { kind: 'string', required: true, maxLength: 200, default: 'Untitled' },
name: { kind: 'string', required: true },
          notes: { kind: 'collection', collection: 'value', item: { kind: 'string' } },
        },
      }),
    );

    expect(compositionOf(registry.getAvailable('widget'))?.derivedTables).toEqual([]);
  });
});

describe('composition descriptor — rejection at registration', () => {
  it('rejects a type whose slug would name a core baseline table', () => {
    expect(register(mod('tag'))).toThrow(/baseline schema/);
  });

  it('rejects a type whose slug would claim the host-owned shared table', () => {
    expect(register(mod('entity_tag'))).toThrow(/shared table/);
  });

  it("rejects a projectionTable prefixed with another type's slug", () => {
    expect(register(withJunction('widget', 'endpoint_dto'))).toThrow(/must be named "widget"/);
  });

  it('does not let a prefix match run past a name boundary', () => {
    // `widgetry_links` starts with "widget" as a STRING but is neither "widget"
    // nor "widget_…". A bare `startsWith` would authorize it — a small bug
    // opening a large hole, since the prefix rule is what stops one type from
    // declaring another's tables.
    expect(register(withJunction('widget', 'widgetry_links'))).toThrow(/must be named "widget"/);
  });

  it('rejects two types deriving the same projection table', () => {
    const registry = new PluginRegistryImpl();
    registry.registerEntityModule(withJunction('widget', 'widget_links'));

    expect(register(withJunction('widget_links', 'widget_links_x'), registry)).toThrow(
      /already declared by entity type "widget"/,
    );
  });

  it('accepts a junction whose name is prefixed with its own type', () => {
    expect(register(withJunction('gadget', 'gadget_widget'))).not.toThrow();
  });
});
