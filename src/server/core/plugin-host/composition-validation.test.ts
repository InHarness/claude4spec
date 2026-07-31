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
import { compositionOf, legacyComposition } from '../../../shared/plugin-host/composition.js';
import type { BackendModule } from './types.js';
import type { EntityComposition } from '../../../shared/plugin-host/types.js';

/**
 * `table` follows `composition.mainTable` when one is declared: the two name the
 * SAME table while the deprecated slot survives, and the validator enforces it.
 * A fixture that let them drift would be testing a shape the host rejects.
 */
function mod(type: string, composition?: EntityComposition, auxTables?: string[]): BackendModule {
  return {
    type,
    table: composition?.mainTable ?? type.replaceAll('-', '_'),
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

  /**
   * `auxTables` is merged on the DECLARED branch too. Declaring a composition
   * for one reason must not silently drop tables the type still owns through
   * the legacy slot — a dropped junction raises no error anywhere downstream,
   * it is simply rows nobody ever clears.
   */
  it('keeps auxTables when a composition is declared for some other reason', () => {
    const registry = new PluginRegistryImpl();
    registry.registerEntityModule(
      mod('endpoint', { mainTable: 'endpoint', identityColumn: 'slug' }, ['endpoint_dto']),
    );
    const resolved = compositionOf(registry.getAvailable('endpoint')!);
    expect(resolved.legacy).toBe(false);
    expect(resolved.derivedTables).toEqual([{ table: 'endpoint_dto', bindingColumn: null }]);
  });

  /**
   * The same argument as the `auxTables` merge above, applied to the OTHER
   * inherited slot. A type that declares a composition to change its
   * `identityColumn` has said nothing about tags, so it must keep the
   * `entity_tag` scope every legacy module gets for free — otherwise the moment
   * the rebuild derives its clear from the descriptor, that type's tag rows
   * become rows nobody clears. Silent today, load-bearing tomorrow.
   */
  it('keeps the entity_tag scope when a composition is declared without sharedTables', () => {
    const registry = new PluginRegistryImpl();
    registry.registerEntityModule(mod('endpoint', { mainTable: 'endpoint', identityColumn: 'id' }));
    const resolved = compositionOf(registry.getAvailable('endpoint')!);
    expect(resolved.legacy).toBe(false);
    expect(resolved.sharedTables.map((s) => s.table)).toContain('entity_tag');
    // …and it is scoped to this type, not a blanket licence over the table.
    const tag = resolved.sharedTables.find((s) => s.table === 'entity_tag')!;
    expect(JSON.stringify(tag.scopePredicate)).toContain('endpoint');
  });

  it('emits no derivedTables from legacyComposition, since it cannot know a binding', () => {
    expect(legacyComposition('endpoint', 'endpoint')).not.toHaveProperty('derivedTables');
  });
});

/**
 * The prefix and cross-type rules are 0.2.4 CONVENTIONS. Applying them to a
 * descriptor synthesized from a legacy `table` + `auxTables` pair would take
 * every entity type in an already-installed plugin offline, with no warning
 * from the semver gate — the descriptor is additive within HOST_API 1.0.0.
 */
describe('composition descriptor — what the legacy fallback is NOT held to', () => {
  it('accepts a legacy table that is not named after its type', () => {
    const registry = new PluginRegistryImpl();
    const legacy = { ...mod('use-case'), table: 'usecase' };
    expect(() => registry.registerEntityModule(legacy)).not.toThrow();
    expect(compositionOf(registry.getAvailable('use-case')!).mainTable).toBe('usecase');
  });

  /**
   * The common shape: a junction listed from BOTH ends, which is how a legacy
   * two-sided relation says "clear this too". Under the prefix rule the second
   * registration would fail; under the collision rule, so would it.
   */
  it('accepts one junction listed in auxTables by both types it joins', () => {
    const registry = new PluginRegistryImpl();
    registry.registerEntityModule(mod('endpoint', undefined, ['endpoint_dto']));
    expect(() =>
      registry.registerEntityModule(mod('dto', undefined, ['endpoint_dto'])),
    ).not.toThrow();
  });

  /**
   * The exemption stops at conventions. An identifier that is not an identifier
   * reaches `db.exec`, and a claim on `entity_tag` destroys every other type's
   * tag assignments — neither is a naming preference, so both still reject.
   */
  it('still rejects a legacy table that is not a bare identifier', () => {
    const registry = new PluginRegistryImpl();
    expect(() =>
      registry.registerEntityModule({ ...mod('evil'), table: 'evil; DROP TABLE tag' }),
    ).toThrow(/bare SQL identifier/);
  });

  it('still rejects a legacy table claiming a host-owned shared table', () => {
    const registry = new PluginRegistryImpl();
    expect(() =>
      registry.registerEntityModule({ ...mod('tagger'), table: 'entity_tag' }),
    ).toThrow(/declare it under sharedTables/);
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

  /**
   * The character allowlist bounds what SQL a predicate can EXPRESS; it says
   * nothing about what the predicate SELECTS. Every string below passes it
   * while matching other types' rows — so without an anchor check, the rule
   * whose entire purpose is "a type may only clear its own rows" is satisfiable
   * by a predicate that clears everyone's.
   */
  it('rejects a scope predicate that does not anchor on the declaring type', () => {
    for (const predicate of ["1=1", "entity_type <> 'ac'", "entity_slug IN (SELECT slug FROM ac)"]) {
      expect(
        register(
          mod('ac', {
            mainTable: 'ac',
            identityColumn: 'slug',
            sharedTables: [{ table: 'entity_tag', scopePredicate: predicate }],
          }),
        ),
      ).toThrow(/must be `entity_type = 'ac'`/);
    }
  });

  it('accepts an anchored predicate narrowed with AND', () => {
    expect(
      register(
        mod('ac', {
          mainTable: 'ac',
          identityColumn: 'slug',
          sharedTables: [
            { table: 'entity_tag', scopePredicate: "entity_type = 'ac' AND tag_slug <> 'pinned'" },
          ],
        }),
      ),
    ).not.toThrow();
  });

  /**
   * `table` is still what the M29 indexer and every service's own SQL read;
   * `composition` is what the migrated readers read. A descriptor naming a
   * different table splits reads from writes — and reopens every check above,
   * which only ever sees `resolved.mainTable`.
   */
  it("rejects a declared mainTable that disagrees with the module's `table`", () => {
    const split: BackendModule = {
      ...mod('widget', { mainTable: 'widget', identityColumn: 'slug' }),
      table: 'legacy_widget',
    };
    expect(register(split)).toThrow(/does not match the module's `table`/);
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
