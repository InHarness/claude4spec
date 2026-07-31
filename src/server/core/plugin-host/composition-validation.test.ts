/**
 * 0.2.4 — the composition descriptor is validated AT REGISTRATION.
 *
 * The point of every case below is temporal as much as structural: a descriptor
 * is a licence to `DELETE` from named tables during a rebuild, and the rebuild
 * runs at boot inside one transaction. Discovering a malformed licence there
 * means discovering it with the index already half-cleared, which is why none of
 * these may be deferred to first use.
 */

import { describe, expect, it } from 'vitest';
import { PluginRegistryImpl } from './registry.js';
import { compositionOf } from '../../../shared/plugin-host/composition.js';
import type { BackendModule } from './types.js';
import type { EntityComposition } from '../../../shared/plugin-host/types.js';

function mod(type: string, composition?: EntityComposition, auxTables?: string[]): BackendModule {
  return {
    type,
    table: type.replaceAll('-', '_'),
    ...(composition ? { composition } : {}),
    label: type,
    labelPlural: `${type}s`,
    displayOrder: 100,
    slugFrom: (d: unknown) => String((d as { slug?: string }).slug ?? type),
    pathPrefix: `/${type}s`,
    serializer: {} as BackendModule['serializer'],
    systemPrompt: { roleNoun: type },
    ...(auxTables ? { backend: { auxTables } } : {}),
  };
}

const register = (m: BackendModule, registry = new PluginRegistryImpl()) => () =>
  registry.registerEntityModule(m);

describe('composition descriptor — the legacy fallback', () => {
  it('synthesizes an equivalent descriptor from `table` when none is declared', () => {
    const registry = new PluginRegistryImpl();
    registry.registerEntityModule(mod('ui-view'));
    const resolved = compositionOf(registry.getAvailable('ui-view')!);
    expect(resolved.mainTable).toBe('ui_view');
    expect(resolved.identityColumn).toBe('slug');
    expect(resolved.legacy).toBe(true);
  });

  /**
   * The synthesized shared entry is what lets the rebuild scope its `entity_tag`
   * clear WITHOUT every existing module being re-authored — the predicate is the
   * same one `handleUnlink` has always written by hand.
   */
  it('gives every legacy type a scoped entity_tag entry', () => {
    const registry = new PluginRegistryImpl();
    registry.registerEntityModule(mod('ac'));
    expect(compositionOf(registry.getAvailable('ac')!).sharedTables).toEqual([
      { table: 'entity_tag', scopePredicate: "entity_type = 'ac'" },
    ]);
  });

  /**
   * A legacy `auxTables` entry keeps a NULL binding column deliberately: the
   * host does not know how `endpoint_dto` binds to `endpoint`, so the table may
   * only be cleared wholesale. Inventing `endpoint_slug` here would produce
   * scoped deletes that are silently wrong.
   */
  it('carries auxTables across as derived tables with no binding column', () => {
    const registry = new PluginRegistryImpl();
    registry.registerEntityModule(mod('endpoint', undefined, ['endpoint_dto']));
    expect(compositionOf(registry.getAvailable('endpoint')!).derivedTables).toEqual([
      { table: 'endpoint_dto', bindingColumn: null },
    ]);
  });
});

describe('composition descriptor — rejection at registration', () => {
  it('rejects a table name that is not a bare SQL identifier', () => {
    // The name is interpolated into `db.exec`, which runs MULTIPLE statements.
    expect(
      register(mod('evil', { mainTable: 'evil; DROP TABLE tag', identityColumn: 'slug' })),
    ).toThrow(/bare SQL identifier/);
  });

  it("rejects a table prefixed with another type's slug", () => {
    expect(register(mod('ac', { mainTable: 'endpoint_notes', identityColumn: 'slug' }))).toThrow(
      /must be named "ac" or start with "ac_"/,
    );
  });

  /**
   * Boundary-awareness is the whole content of the prefix rule: a bare
   * `startsWith('ac')` would authorize `account_secrets`.
   */
  it('does not let a prefix match run past a name boundary', () => {
    expect(register(mod('ac', { mainTable: 'account_secrets', identityColumn: 'slug' }))).toThrow(
      /must be named "ac" or start with "ac_"/,
    );
    expect(register(mod('ac', { mainTable: 'ac_notes', identityColumn: 'slug' }))).not.toThrow();
  });

  it('rejects a descriptor claiming a core baseline table', () => {
    expect(
      register(mod('spec-release', { mainTable: 'spec_release', identityColumn: 'slug' })),
    ).toThrow(/core baseline schema/);
  });

  /**
   * The forbidden list now binds the DECLARATION, not just a `CREATE TABLE` in a
   * migration — which is the case the DDL check structurally cannot see, since a
   * plugin may ship no migrations at all.
   */
  it("rejects a descriptor pointing at another registered type's main table", () => {
    const registry = new PluginRegistryImpl();
    // `ac_notes` is legitimately within `ac`'s prefix — and equally within
    // `ac-notes`'s. The prefix rule cannot separate them, so the collision check
    // is the only thing standing between two types and one table.
    registry.registerEntityModule(mod('ac', { mainTable: 'ac_notes', identityColumn: 'slug' }));
    expect(
      register(mod('ac-notes', { mainTable: 'ac_notes', identityColumn: 'slug' }), registry),
    ).toThrow(/already declared by entity type "ac"/);
  });

  it('rejects a shared table declared without a scope predicate', () => {
    expect(
      register(
        mod('ac', {
          mainTable: 'ac',
          identityColumn: 'slug',
          sharedTables: [{ table: 'entity_tag', scopePredicate: '' }],
        }),
      ),
    ).toThrow(/must declare a non-empty scopePredicate/);
  });

  it('rejects a scope predicate carrying SQL beyond comparison', () => {
    for (const predicate of ["entity_type = 'ac'; DROP TABLE tag", "1=1 -- comment"]) {
      expect(
        register(
          mod('ac', {
            mainTable: 'ac',
            identityColumn: 'slug',
            sharedTables: [{ table: 'entity_tag', scopePredicate: predicate }],
          }),
        ),
      ).toThrow(/outside the allowed set/);
    }
  });

  /**
   * A hyphen IS allowed, because type slugs are kebab-case and the default
   * predicate is `entity_type = 'ui-view'`. The dangerous form is `--`, rejected
   * above.
   */
  it('accepts the kebab-case default predicate', () => {
    expect(
      register(
        mod('ui-view', {
          mainTable: 'ui_view',
          identityColumn: 'slug',
          sharedTables: [{ table: 'entity_tag', scopePredicate: "entity_type = 'ui-view'" }],
        }),
      ),
    ).not.toThrow();
  });

  it('rejects claiming a host-owned shared table as one of its own', () => {
    expect(register(mod('ac', { mainTable: 'entity_tag', identityColumn: 'slug' }))).toThrow(
      /declare it under sharedTables/,
    );
  });

  it('rejects an unknown table listed under sharedTables', () => {
    expect(
      register(
        mod('ac', {
          mainTable: 'ac',
          identityColumn: 'slug',
          sharedTables: [{ table: 'ac_cells', scopePredicate: "entity_type = 'ac'" }],
        }),
      ),
    ).toThrow(/not a host-owned shared table/);
  });

  it('requires a declared derived table to name its binding column', () => {
    expect(
      register(
        mod('ac', {
          mainTable: 'ac',
          identityColumn: 'slug',
          derivedTables: [{ table: 'ac_cells', bindingColumn: '' }],
        }),
      ),
    ).toThrow(/bindingColumn/);
  });

  it('accepts a fully declared descriptor and reports it as non-legacy', () => {
    const registry = new PluginRegistryImpl();
    registry.registerEntityModule(
      mod('spreadsheet', {
        mainTable: 'spreadsheet',
        identityColumn: 'slug',
        derivedTables: [{ table: 'spreadsheet_cell', bindingColumn: 'spreadsheet_slug' }],
        sharedTables: [{ table: 'entity_tag', scopePredicate: "entity_type = 'spreadsheet'" }],
      }),
    );
    const resolved = compositionOf(registry.getAvailable('spreadsheet')!);
    expect(resolved.legacy).toBe(false);
    expect(resolved.derivedTables).toEqual([
      { table: 'spreadsheet_cell', bindingColumn: 'spreadsheet_slug' },
    ]);
  });
});
