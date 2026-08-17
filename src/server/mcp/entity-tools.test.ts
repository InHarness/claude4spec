import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../tests/helpers/fixture-module.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { buildEntityTools, type EntityToolsDeps } from './entity-tools.js';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { applyProjection } from '../db/projection.js';
import { RawEntityReader } from '../discovery/raw-entity-reader.js';
import { TagsService } from '../services/tags.js';
import { VersionService } from '../services/versions.js';
import type { EntityStore } from '../services/entity-store.js';
import type { BackendModule, ProjectPluginHost } from '../core/plugin-host/types.js';

interface Widget {
  slug: string;
  title: string;
}

function widgetModule(overrides: Partial<BackendModule> = {}): BackendModule {
  return {
    type: 'widget',
    data: FIXTURE_DATA,
    slugPattern: FIXTURE_SLUG_PATTERN,
    payloadVersion: 1,
    label: 'Widget',
    labelPlural: 'Widgets',
    displayOrder: 1,
    pathPrefix: '/widgets',
    systemPrompt: {
      roleNoun: 'Widgets',
    },
    backend: {},
    ...overrides,
  };
}

/**
 * Real deps for the write half, fake ones for the read half.
 *
 * 2.0.0 tier K deleted the per-type CRUD services, so `create_entities` /
 * `update_entities` / `delete_entities` go through the host's generic door,
 * which writes an actual projection. A fake service can no longer stand in for
 * it — and should not: what these tests are about is the BATCH envelope
 * (partial success, input order, rename propagation) over the write path that
 * really runs.
 *
 * `discovery` stays a stub. It is the read side, it is the M39 core's
 * responsibility, and it has its own suite.
 *
 * Types: `widget` (active), `no-crud` (active, no `backend` at all),
 * `inactive` (registered but inactive). `extraActive` modules are registered
 * AND made active — used by the describe-isolation tests to inject a type whose
 * schema can't be serialized, without disturbing tests that assert the exact
 * active-type set.
 */
const openDbs: Database.Database[] = [];
afterEach(() => {
  for (const db of openDbs.splice(0)) db.close();
});

function fakeDeps(extraActive: BackendModule[] = []): {
  deps: EntityToolsDeps;
  db: Database.Database;
  rows: () => Widget[];
} {
  const modules = new Map<string, BackendModule>([
    ['widget', widgetModule()],
    ['no-crud', widgetModule({ type: 'no-crud', backend: {} })],
    ['inactive', widgetModule({ type: 'inactive' })],
  ]);
  const activeTypes = new Set(['widget', 'no-crud']);
  for (const m of extraActive) {
    modules.set(m.type, m);
    activeTypes.add(m.type);
  }

  const host: ProjectPluginHost = {
    listAvailable: () => Array.from(modules.values()),
    listEntities: () => Array.from(modules.values()).filter((m) => activeTypes.has(m.type)),
    listSettings: () => [],
    listCommands: () => [],
    getEntity: (type) => (activeTypes.has(type) ? (modules.get(type) ?? null) : null),
    getAvailable: (type) => modules.get(type) ?? null,
    isActive: (type) => activeTypes.has(type),
    partition: () => ({ active: [...activeTypes], inactive: ['inactive'], unknown: [] }),
    shadowReport: () => [],
    mountBackend: () => {},
    registerMcpServer: () => {},
    buildMcpServers: () => [],
    computeEntityCounts: () => ({}),
    entityExists: () => false,
    registerEntityService: () => {},
    getEntityService: () => null,
    snapshot: () => ({}) as never,
    restore: () => ({}) as never,
    diff: () => ({}) as never,
    clearMcpFactories: () => {},
  };

  const db = createTestDb();
  openDbs.push(db);
  /**
   * Projected one module at a time, tolerating a throw.
   *
   * Two of the describe_entity_type fixtures declare a `data.schema` GETTER that
   * throws — that is their whole point — and a single `applyProjection` over the
   * batch would take the fixture down with them before a single test ran.
   */
  for (const module of host.listEntities()) {
    try {
      applyProjection(db, [module]);
    } catch {
      /* a deliberately-malformed fixture type simply gets no table */
    }
  }
  /**
   * One row, seeded directly, for the READ tests. The write tests create their
   * own through the tool — this is only here so `list`/`search` have something
   * to answer with, which is what the retired fake service's constructor did.
   */
  db.prepare(`INSERT INTO widget (slug, title) VALUES ('widget-existing', 'existing')`).run();
  const reader = new RawEntityReader(db, host);
  const tagsService = new TagsService(db, host);
  const versionService = new VersionService(db);
  // The file store is not what these tests are about; a no-op stub keeps the
  // write path off the filesystem without changing what it writes to the db.
  const entityStore = { persist: vi.fn(), remove: vi.fn() } as unknown as EntityStore;

  // Seeded through the same door the tools use, so the fixture cannot drift
  // from what a create actually produces.
  const rows = (): Widget[] =>
    db.prepare(`SELECT slug, title FROM widget ORDER BY slug`).all() as Widget[];

  const deps: EntityToolsDeps = {
    host,
    reader,
    db,
    tagsService,
    entityStore,
    versionService,
    discovery: {
      // 0.2.9 (item 15): `describe_entity_type` reads L9 through the core, not
      // through the serialization engine, so the stub answers it here.
      describeTypes: ({ types }: { types?: string[] }) => ({
        types: (types ?? ['widget']).map((type) => ({
          type,
          label: type,
          payloadVersion: 1,
          views: ['inline_mention', 'single_element', 'element_list_item', 'tagged_list_item', 'detail'],
          schemas: {},
          searchableFields: [`${type}.title`],
        })),
      }),
      listEntities: vi.fn(({ mode }: { mode?: 'items' | 'count' }) => {
        const items = rows();
        if (mode === 'count') return { mode: 'count', total: items.length };
        return {
          mode: 'items',
          // The core's FROZEN row — `{ slug, title }`, nothing wider. The stub
          // used to hand back `{ slug, data }`, which let a handler read fields
          // off a listing the real core never puts there.
          items: items.map((w) => ({ slug: w.slug, title: w.title })),
          total: items.length,
          hasMore: false,
        };
      }),
      getEntities: ({ type, slugs }: { type: string; slugs: string[] }) => ({
        type,
        view: 'detail',
        results: slugs.map((slug) => ({
          slug,
          entity: rows().find((w) => w.slug === slug) ?? null,
        })),
      }),
      /**
       * Projects the same rows, and honours `mode` — the real core does. A stub
       * that answered `mode: "hits"` regardless would let a handler ignore the
       * parameter and still pass.
       */
      searchEntities: vi.fn(({ type, query, mode }: { type: string; query: string; mode?: 'hits' | 'count' }) => {
        const hits = rows().filter((w) => w.title.includes(query));
        const searchedFields = [`${type}.title`];
        if (mode === 'count') return { mode: 'count', total: hits.length, searchedFields };
        return {
          mode: 'hits',
          items: hits.map((w) => ({ slug: w.slug, score: 1, data: w })),
          total: hits.length,
          hasMore: false,
          searchedFields,
        };
      }),
    } as unknown as EntityToolsDeps['discovery'],
    ws: { broadcast: vi.fn() },
    referencesService: {
      findReferences: vi.fn().mockResolvedValue([]),
      propagateSlugChange: vi.fn().mockResolvedValue({ changed: [] }),
    } as unknown as EntityToolsDeps['referencesService'],
  };

  return { deps, db, rows };
}

/** Create through the tool under test, so a seed cannot drift from a real create. */
async function seed(deps: EntityToolsDeps, ...names: string[]): Promise<void> {
  await tool(deps, 'create_entities').handler({ type: 'widget', items: names.map((title) => ({ title })) });
}

function tool(deps: EntityToolsDeps, name: string) {
  const found = buildEntityTools(deps).find((t) => t.name === name);
  if (!found) throw new Error(`tool ${name} not found`);
  return found;
}

function parse(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text);
}

describe('entity-tools: type validation', () => {
  it('INVALID_TYPE for an unregistered type', async () => {
    const { deps } = fakeDeps();
    const result = await tool(deps, 'list_entities').handler({ type: 'nonexistent' });
    expect(result.isError).toBe(true);
    expect(parse(result)).toMatchObject({ code: 'INVALID_TYPE' });
  });

  it('INACTIVE_TYPE for a registered-but-inactive type', async () => {
    const { deps } = fakeDeps();
    const result = await tool(deps, 'list_entities').handler({ type: 'inactive' });
    expect(result.isError).toBe(true);
    expect(parse(result)).toMatchObject({ code: 'INACTIVE_TYPE' });
  });

  /**
   * 2.0.0 (item 28) — the inverse of the retired `CRUD_NOT_SUPPORTED` case.
   *
   * `no-crud` is active, declares `data.schema`, and has neither a
   * `backend.crud` slot nor a registered service — the exact shape of every
   * declaratively-authored plugin. It used to be refused by every tool that
   * went through `resolveType`, INCLUDING the read ones: a type could be
   * indexed, searched and diffed, and then answer `CRUD_NOT_SUPPORTED` to
   * `list_entities`. The core answers it now.
   */
  it('an active type with no backend.crud and no service is still listable', async () => {
    const { deps } = fakeDeps();
    const result = await tool(deps, 'list_entities').handler({ type: 'no-crud' });
    expect(result.isError).toBeUndefined();
    expect(parse(result)).toMatchObject({ type: 'no-crud', mode: 'items' });
  });
});

describe('entity-tools: batch partial-success', () => {
  it('create_entities: one rejected item does not roll back the others, envelope preserves input order', async () => {
    // The middle item omits the required `title`, so the generated create schema
    // rejects it before the write door is reached.
    const { deps, rows } = fakeDeps();
    const result = await tool(deps, 'create_entities').handler({
      type: 'widget',
      items: [{ title: 'a' }, {}, { title: 'b' }],
    });
    expect(result.isError).toBeUndefined();
    const { results } = parse(result) as { results: Array<Record<string, unknown>> };
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ slug: 'a' });
    expect(results[1]).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(results[2]).toEqual({ slug: 'b' });
    // Non-transactional in the direction that matters: the two good ones landed
    // (alongside the row the fixture seeds for the read tests).
    expect(rows().map((w) => w.slug)).toEqual(['a', 'b', 'widget-existing']);
  });

  it('delete_entities: one NOT_FOUND does not block the others', async () => {
    const { deps } = fakeDeps();
    await seed(deps, 'c');
    const result = await tool(deps, 'delete_entities').handler({
      type: 'widget',
      slugs: ['c', 'widget-ghost'],
    });
    const { results } = parse(result) as { results: Array<Record<string, unknown>> };
    expect(results[0]).toMatchObject({ deleted: true });
    expect(results[1]).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('entity-tools: update_entities rename', () => {
  it('newSlug renames; result.slug is the NEW slug; propagateSlugChange is called', async () => {
    const { deps, rows } = fakeDeps();
    const result = await tool(deps, 'update_entities').handler({
      type: 'widget',
      updates: [{ slug: 'widget-existing', data: { title: 'renamed' }, newSlug: 'widget-renamed' }],
    });
    const { results } = parse(result) as { results: Array<Record<string, unknown>> };
    expect(results[0]).toEqual({ slug: 'widget-renamed' });
    expect(rows().map((w) => w.slug)).toEqual(['widget-renamed']);
    expect(deps.referencesService.propagateSlugChange).toHaveBeenCalledWith(
      'widget',
      'widget-existing',
      'widget-renamed',
    );
  });
});

describe('entity-tools: filters (list_entities/search_entities)', () => {
  /**
   * 2.0.0 tier K — `filters` stopped being a per-type escape hatch implemented
   * by whichever service felt like it (in practice one, `AcService`) and became
   * a declarative filter the CORE evaluates against `data.schema`. What this
   * pins is that the tool hands it on rather than dropping it: the compilation
   * itself is `RawEntityReader.slugsMatching`'s own test.
   */
  it('forwards `filters` to the core, which is the only thing that can apply them', async () => {
    const { deps } = fakeDeps();
    await tool(deps, 'list_entities').handler({ type: 'widget', filters: { title: 'a' } });
    expect(deps.discovery.listEntities).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { title: 'a' } }),
    );
  });

  /**
   * The inverse of what tier E shipped, and deliberately so.
   *
   * Tier E REFUSED `filters` here, because forwarding an argument nobody reads
   * is indistinguishable, from the caller's side, from applying it — the one
   * service with a custom `search` took only `{limit, offset}` and the core
   * search path took no filters at all. `slugsMatching` is the implementation
   * that was missing, so the refusal's premise is gone and the asymmetry it
   * left behind is the thing worth closing: "the active ACs" must mean the same
   * set whether you list them, count them, or search them.
   */
  it('forwards `filters` to the core on the SEARCH path too', async () => {
    const { deps } = fakeDeps();
    const result = await tool(deps, 'search_entities').handler({
      type: 'widget',
      query: 'a',
      filters: { title: 'a' },
    });
    expect(result.isError).toBeFalsy();
    expect(deps.discovery.searchEntities).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { title: 'a' } }),
    );
  });
});

/**
 * 0.2.3 — the read tools take the core's parameters now, and two of those
 * changes are breaking. Each test below is a claim that only shows up as a bug
 * in an agent's session: an answer that came from a scope it never asked for, a
 * page-2 request against a `total` with no `hasMore` to say whether one exists.
 */
describe('entity-tools: search_entities requires one type', () => {
  it('a call with no `type` is refused rather than searching everything', async () => {
    const { deps } = fakeDeps();
    // The zod schema makes `type` required, so the SDK refuses the call before
    // the handler runs. Asserting through the handler covers the other half:
    // that nothing here treats an absent type as "all types" any more.
    const result = await tool(deps, 'search_entities').handler({ query: 'a' });
    expect(result.isError).toBe(true);
    expect(parse(result)).toMatchObject({ code: 'INVALID_TYPE' });
  });

  it('the schema declares `type` required', () => {
    const { deps } = fakeDeps();
    const schema = tool(deps, 'search_entities').inputSchema as Record<string, { isOptional?: () => boolean }>;
    expect(schema.type!.isOptional?.()).toBe(false);
    expect(schema.fields).toBeDefined();
    expect(schema.mode).toBeDefined();
  });

  it('returns one flat result with searchedFields, not a per-type grouping', async () => {
    const { deps } = fakeDeps();
    const result = await tool(deps, 'search_entities').handler({ type: 'widget', query: 'existing' });
    const payload = parse(result);
    expect(payload.results).toBeUndefined();
    expect(payload).toMatchObject({ type: 'widget', mode: 'hits', total: 1, hasMore: false });
    expect(payload.searchedFields).toEqual(expect.arrayContaining([expect.any(String)]));
  });

  /**
   * Precedence is agent > type > host. A custom ranking that ignored an explicit
   * `fields` would invert the top of it and then report a scope it never used —
   * the exact failure `searchedFields` exists to make impossible.
   */
  it('an explicit `fields` bypasses the type\'s custom ranking and goes to the core', async () => {
    const { deps } = fakeDeps();
    const result = await tool(deps, 'search_entities').handler({
      type: 'widget',
      query: 'existing',
      fields: ['name'],
    });
    expect(parse(result)).toMatchObject({ searchedFields: ['widget.title'] });
  });

  /**
   * 0.2.4 removed the per-type escape hatch. `searchedFields` is a promise about
   * what was CONSULTED, and a service ranking over columns the host cannot see
   * could only keep that promise by echoing a second declaration back. One
   * derivation, one ranking, one answer. Tier K removed the per-type services
   * outright, so there is no longer even a `search` method to not-reach.
   */
  it('answers from the core, whose searchedFields is exactly what it searched', async () => {
    const { deps } = fakeDeps();
    const result = await tool(deps, 'search_entities').handler({ type: 'widget', query: 'existing' });
    expect(parse(result)).toMatchObject({ searchedFields: ['widget.title'] });
  });

  it('an active type without CRUD is searchable — reading is not writing', async () => {
    // `no-crud` is refused by every mutation and by list_entities, which is
    // right. Refusing to SEARCH it would be the same exclusion this release
    // removed, wearing a different reason.
    const { deps } = fakeDeps();
    const result = await tool(deps, 'search_entities').handler({ type: 'no-crud', query: 'x' });
    expect(result.isError).toBeUndefined();
    expect(parse(result)).toMatchObject({ type: 'no-crud', mode: 'hits' });
  });

  it('mode "count" answers with a total and the scope, and no rows', async () => {
    const { deps } = fakeDeps();
    const payload = parse(await tool(deps, 'search_entities').handler({ type: 'widget', query: 'e', mode: 'count' }));
    expect(payload).toMatchObject({ mode: 'count', total: 1 });
    expect(payload.items).toBeUndefined();
    expect(payload.searchedFields).toBeDefined();
  });
});

describe('entity-tools: list_entities measurement', () => {
  it('carries hasMore, so a caller can tell a full page from the last one', async () => {
    const { deps } = fakeDeps();
    const payload = parse(await tool(deps, 'list_entities').handler({ type: 'widget' }));
    expect(payload).toMatchObject({ mode: 'items', total: 1, hasMore: false });
  });

  it('mode "count" answers without walking the entities', async () => {
    const { deps } = fakeDeps();
    const payload = parse(await tool(deps, 'list_entities').handler({ type: 'widget', mode: 'count' }));
    expect(payload).toMatchObject({ mode: 'count', total: 1 });
    expect(payload.items).toBeUndefined();
  });

  /**
   * The frozen row, and the reason it is frozen: `list_entities` here used to
   * re-hydrate every slug into a full record, so ONE operation had two widths
   * depending on which MCP server the caller reached — this one answered wide
   * while `c4s-reader` and `GET /:type/list` answered `{ slug, title }`.
   *
   * Width belongs to `get_entities` and its `select` alone. A listing that
   * silently ships every field also ships a `database-table`'s `columns[]` to a
   * caller that asked for a menu.
   */
  it('answers the frozen { slug, title } row — never a full record', async () => {
    const { deps } = fakeDeps();
    const payload = parse(await tool(deps, 'list_entities').handler({ type: 'widget' }));
    expect(payload.items).toHaveLength(1);
    expect(Object.keys(payload.items[0]).sort()).toEqual(['slug', 'title']);
  });

  it('declares no `select` — width is not a parameter of this operation', async () => {
    const { deps } = fakeDeps();
    expect(Object.keys(tool(deps, 'list_entities').inputSchema ?? {})).not.toContain('select');
  });
});

describe('entity-tools: describe_entity_type', () => {
  /**
   * 0.2.4 removed `searchSupported` from this output entirely.
   *
   * Its meaning had already moved once — from "the service implements `search`"
   * to "the type narrowed the default scope" — and with both type-side layers
   * gone there is nothing left for it to report: every active type is
   * searchable, over a scope that is guaranteed non-empty, so the flag could
   * only ever be `true`. `searchableFields` stays, but as a DERIVED field.
   */
  it('reports crudSupported and a derived scope, with no searchSupported flag at all', async () => {
    const { deps } = fakeDeps();
    const result = await tool(deps, 'describe_entity_type').handler({ type: 'widget' });
    const { types } = parse(result) as { types: Array<Record<string, unknown>> };
    expect(types).toHaveLength(1);
    expect(types[0]).toMatchObject({ type: 'widget', crudSupported: true });
    expect(types[0]).not.toHaveProperty('searchSupported');
    // Derived from the create schema — the only source of scope since 0.2.4.
    expect(types[0]!.searchableFields).toEqual(expect.arrayContaining(['title']));
  });

  /**
   * The scope is non-empty for EVERY active type. A type with no CRUD slot at
   * all derives nothing from a schema it does not have, and the fallback is
   * what stops it from answering every query with silence.
   */
  it('never reports an empty scope, even for a type with no create schema', async () => {
    const { deps } = fakeDeps();
    const result = await tool(deps, 'describe_entity_type').handler({ type: 'no-crud' });
    const { types } = parse(result) as { types: Array<Record<string, unknown>> };
    expect(types[0]!.searchableFields).toEqual(expect.arrayContaining(['slug']));
    expect((types[0]!.searchableFields as string[]).length).toBeGreaterThan(0);
  });

  it('omitting type describes every active type (widget + no-crud), not the inactive one', async () => {
    const { deps } = fakeDeps();
    const result = await tool(deps, 'describe_entity_type').handler({});
    const { types } = parse(result) as { types: Array<{ type: string; crudSupported: boolean }> };
    expect(types.map((t) => t.type).sort()).toEqual(['no-crud', 'widget']);
    // 2.0.0 (item 28): `true` for every active type, `no-crud` included — the
    // schemas come from `data.schema`, which it has, not from a slot it lacks.
    expect(types.find((t) => t.type === 'no-crud')?.crudSupported).toBe(true);
  });

  /**
   * A module whose GENERATED schema cannot be built — a stand-in for the
   * real-world malformed type that used to crash the whole handler with
   * `Cannot read properties of undefined (reading 'def')`.
   *
   * 2.0.0: the failure mode moved with the source. It used to be a `z.bigint()`
   * planted in a hand-written `backend.crud.createSchema`, which
   * `z.toJSONSchema()` cannot represent; the slot is gone and `data.schema` is
   * a closed vocabulary with no such member, so the reachable malformation is a
   * type registered WITHOUT the declaration the generator reads. Different
   * cause, same guard, same contract: one bad type must not cost the others
   * their answer.
   */
  const badSchemaModule = () =>
    widgetModule({
      type: 'bad-schema',
      // No `backend.crud`, so the GENERATED branch is the one under test — a
      // declared crud slot still wins while the six services own the write path.
      backend: {},
      data: undefined as unknown as BackendModule['data'],
    });

  it('describe-all isolates one un-serializable type: healthy types still described, bad type carries an __error placeholder', async () => {
    const { deps } = fakeDeps([badSchemaModule()]);
    const result = await tool(deps, 'describe_entity_type').handler({});
    expect(result.isError).toBeUndefined(); // no process-level throw
    const { types } = parse(result) as {
      types: Array<{ type: string; createSchema?: Record<string, unknown>; updateSchema?: Record<string, unknown> }>;
    };
    // healthy type serializes normally — a real JSON Schema, not an error placeholder
    const widget = types.find((t) => t.type === 'widget')!;
    expect(widget.createSchema).toMatchObject({ type: 'object' });
    expect(widget.createSchema).not.toHaveProperty('__error');
    // failing type degrades to a type-named placeholder for both schemas
    const bad = types.find((t) => t.type === 'bad-schema')!;
    expect(bad.createSchema).toMatchObject({ __error: expect.stringMatching(/^bad-schema: /) });
    expect(bad.updateSchema).toMatchObject({ __error: expect.stringMatching(/^bad-schema: /) });
  });

  it('single-type describe of the failing type returns the placeholder instead of throwing', async () => {
    const { deps } = fakeDeps([badSchemaModule()]);
    const result = await tool(deps, 'describe_entity_type').handler({ type: 'bad-schema' });
    expect(result.isError).toBeUndefined();
    const { types } = parse(result) as {
      types: Array<{ type: string; createSchema?: Record<string, unknown>; updateSchema?: Record<string, unknown> }>;
    };
    expect(types).toHaveLength(1);
    expect(types[0]!.createSchema).toMatchObject({ __error: expect.stringMatching(/^bad-schema: /) });
    expect(types[0]!.updateSchema).toMatchObject({ __error: expect.stringMatching(/^bad-schema: /) });
  });

  // A module whose schema throws during the zod-object BUILD (property access),
  // not at serialization time — exercises the inner guard's "wraps both the build and
  // the toJSONSchema call" claim. 2.0.0: the throwing getter moved from the retired
  // `backend.crud.createSchema` onto `data.schema`, the input the generator reads.
  const buildThrowModule = () => {
    const data: Record<string, unknown> = {};
    Object.defineProperty(data, 'schema', {
      enumerable: true,
      get() {
        throw new Error('boom-build');
      },
    });
    return widgetModule({ type: 'build-throw', backend: {}, data: data as BackendModule['data'] });
  };

  it('inner guard catches a throw during schema build (not just serialization)', async () => {
    const { deps } = fakeDeps([buildThrowModule()]);
    const result = await tool(deps, 'describe_entity_type').handler({ type: 'build-throw' });
    expect(result.isError).toBeUndefined();
    const { types } = parse(result) as {
      types: Array<{ createSchema?: Record<string, unknown>; updateSchema?: Record<string, unknown> }>;
    };
    expect(types[0]!.createSchema).toMatchObject({ __error: expect.stringMatching(/^build-throw: boom-build/) });
    expect(types[0]!.updateSchema).toMatchObject({ __error: expect.stringMatching(/^build-throw: boom-build/) });
  });

  it('describe-all isolates a type whose describeTypes() throws: healthy types survive, bad type gets an entry-level __error', async () => {
    const { deps } = fakeDeps([widgetModule({ type: 'describe-throw' })]);
    /**
     * The outer per-type guard must contain failures beyond schema
     * serialization — here the core's `describeTypes()` itself throws for one
     * type. 0.2.9 describes the whole batch in ONE call, so a broken type takes
     * the batch down with it (the stub below models exactly that: it throws for
     * the all-types call as well as for the type's own). The tool must then fall
     * back to per-type calls and isolate the damage to that one entry.
     */
    const original = deps.discovery.describeTypes;
    deps.discovery.describeTypes = ((input: { types?: string[] }) => {
      const asked = input.types ?? ['widget', 'no-crud', 'describe-throw'];
      if (asked.includes('describe-throw')) throw new Error('boom-describe');
      return (original as (i: unknown) => unknown)(input);
    }) as typeof deps.discovery.describeTypes;

    const result = await tool(deps, 'describe_entity_type').handler({});
    expect(result.isError).toBeUndefined(); // batch completes, no process-level throw
    const { types } = parse(result) as {
      types: Array<{ type: string; __error?: string; createSchema?: Record<string, unknown> }>;
    };
    // healthy type is still fully described
    const widget = types.find((t) => t.type === 'widget')!;
    expect(widget.createSchema).toMatchObject({ type: 'object' });
    expect(widget).not.toHaveProperty('__error');
    // failing type degrades to a type-named entry-level placeholder instead of aborting the batch
    const bad = types.find((t) => t.type === 'describe-throw')!;
    expect(bad.__error).toMatch(/^describe-throw: boom-describe/);
  });
});
