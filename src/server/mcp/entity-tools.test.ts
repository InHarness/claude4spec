import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../tests/helpers/fixture-module.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { buildEntityTools, type EntityToolsDeps } from './entity-tools.js';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { applyProjection } from '../db/projection.js';
import { RawEntityReader } from '../discovery/raw-entity-reader.js';
import { entityNotFound, indexStale, invalidArgument, searchBudgetExceeded } from '../discovery/errors.js';
import { TagsService } from '../services/tags.js';
import { VersionService } from '../services/versions.js';
import type { EntityStore } from '../services/entity-store.js';
import type { BackendModule, ProjectPluginHost } from '../core/plugin-host/types.js';
import { expectToolMatchesRecord } from '../../../tests/helpers/read-tool-records.js';
import { expectToolMatchesWriteRecord } from '../../../tests/helpers/write-tool-records.js';

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
    listCommands: () => [],
    listSubagents: () => [],
    getEntity: (type) => (activeTypes.has(type) ? (modules.get(type) ?? null) : null),
    getAvailable: (type) => modules.get(type) ?? null,
    isActive: (type) => activeTypes.has(type),
    partition: () => ({ active: [...activeTypes], inactive: ['inactive'], unknown: [] }),
    shadowReport: () => [],
    mountBackend: () => {},
    registerMcpServer: () => {},
    buildMcpServers: () => [],
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
      // 0.2.9 (item 15): `describe_entity_type` reads M13 through the core, not
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
      searchEntities: vi.fn(
        ({
          type,
          query,
          regex,
          mode,
        }: {
          type: string;
          query?: string;
          regex?: string;
          mode?: 'count' | 'map' | 'hits';
        }) => {
          const needle = query ?? regex ?? '';
          const hits = rows().filter((w) => w.title.includes(needle));
          const searchedFields = [`${type}.title`];
          // 0.2.95 — all THREE rungs, and no `score` on any of them, because the
          // real core has none. A stub still shaped like the old contract would
          // let a serializer keep emitting a field nothing produces.
          if (mode === 'count') {
            return { mode: 'count', total: hits.length, matches: hits.length, searchedFields };
          }
          const base = {
            items: hits.map((w) => ({ slug: w.slug, title: w.title, matchCount: 1 })),
            total: hits.length,
            hasMore: false,
            truncated: false,
            searchedFields,
          };
          return mode === 'hits'
            ? {
                ...base,
                mode: 'hits',
                items: base.items.map((i) => ({
                  ...i,
                  hunks: [{ field: 'title', text: needle, matches: 1 }],
                  omittedChars: 0,
                })),
              }
            : { ...base, mode: 'map' };
        },
      ),
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

/**
 * THE SECOND DOOR for a named validator.
 *
 * `kind` is enforced in the shared input-schema builder, so REST and this MCP
 * surface get it from one edit — but "one builder" is a claim about the code, and
 * an agent writing through `create_entities` is the caller who actually has to be
 * stopped. `database-table` proves the REST half in its own suite; this proves
 * the half an agent uses, and proves the two report it the same way: per ITEM,
 * inside the batch envelope, as `VALIDATION_ERROR`.
 */
describe('entity-tools: a named validator, at the MCP door', () => {
  const identified = () =>
    widgetModule({
      data: {
        schema: {
          title: { type: 'string', required: true, maxLength: 200, kind: 'sql-identifier' },
        },
      },
    });

  it('refuses a title that is not a SQL identifier, per item', async () => {
    const { deps } = fakeDeps([identified()]);
    const result = await tool(deps, 'create_entities').handler({
      type: 'widget',
      items: [{ title: 'order_items' }, { title: 'order items' }],
    });
    const body = parse(result) as { results: Array<Record<string, unknown>> };
    expect(body.results[0]).toMatchObject({ slug: 'order-items' });
    expect(body.results[1]).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('names the reserved word rather than reporting a shape mismatch', async () => {
    const { deps } = fakeDeps([identified()]);
    const result = await tool(deps, 'create_entities').handler({
      type: 'widget',
      items: [{ title: 'select' }],
    });
    const body = parse(result) as { results: Array<{ error?: string }> };
    expect(body.results[0]?.error).toMatch(/reserved SQL word/);
  });

  it('accepts mixed case and leaves the lowercasing to the slug', async () => {
    const { deps } = fakeDeps([identified()]);
    const result = await tool(deps, 'create_entities').handler({
      type: 'widget',
      items: [{ title: 'Order_Archive' }],
    });
    const body = parse(result) as { results: Array<{ slug?: string }> };
    expect(body.results[0]).toMatchObject({ slug: 'order-archive' });
  });

  it('refuses it on update too — a rename is when a bad identifier arrives', async () => {
    const { deps } = fakeDeps([identified()]);
    await tool(deps, 'create_entities').handler({ type: 'widget', items: [{ title: 'orders' }] });
    const result = await tool(deps, 'update_entities').handler({
      type: 'widget',
      updates: [{ slug: 'orders', data: { title: 'order list' } }],
    });
    const body = parse(result) as { results: Array<Record<string, unknown>> };
    expect(body.results[0]).toMatchObject({ code: 'VALIDATION_ERROR' });
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
    // 0.2.95 — `map` is what a caller that named no mode now gets.
    expect(payload).toMatchObject({ type: 'widget', mode: 'map', total: 1, hasMore: false });
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
    expect(parse(result)).toMatchObject({ type: 'no-crud', mode: 'map' });
  });

  it('mode "count" answers with a total and the scope, and no rows', async () => {
    const { deps } = fakeDeps();
    const payload = parse(await tool(deps, 'search_entities').handler({ type: 'widget', query: 'e', mode: 'count' }));
    // 0.2.95 — both numbers: `total` counts entities, `matches` occurrences.
    expect(payload).toMatchObject({ mode: 'count', total: 1, matches: 1 });
    expect(payload.items).toBeUndefined();
    expect(payload.searchedFields).toBeDefined();
  });

  /**
   * 0.2.95 — the three schema changes, asserted where an agent meets them.
   *
   * `query` becoming optional is the one that cannot be checked any other way:
   * the SDK validates the shape before the handler runs, so a `query` still
   * marked required would refuse every `regex` call without the handler — or
   * this suite — ever seeing it.
   */
  it('[ac:ac-search-entities-regex-z-wzorcem-zawie] the schema takes regex beside query, neither of them required', () => {
    const { deps } = fakeDeps();
    const schema = tool(deps, 'search_entities').inputSchema as Record<
      string,
      { isOptional?: () => boolean }
    >;
    expect(schema.query!.isOptional?.()).toBe(true);
    expect(schema.regex).toBeDefined();
    expect(schema.regex!.isOptional?.()).toBe(true);
  });

  it('[ac:ac-search-entities-w-trybie-map-nie-zwra] forwards only the input it was given, so the core can refuse two', async () => {
    const { deps } = fakeDeps();
    await tool(deps, 'search_entities').handler({ type: 'widget', regex: 'e' });
    const passed = (deps.discovery.searchEntities as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]![0] as Record<string, unknown>;
    // NOT `query: undefined` — the core's exclusive choice counts PRESENCE, so a
    // forwarded `undefined` would make every regex call look like two inputs.
    expect('query' in passed).toBe(false);
    expect(passed).toMatchObject({ regex: 'e', mode: 'map' });
  });

  it('[ac:ac-zadna-odpowiedz-search-entities-nie-n] no row carries `score`, in any of the three modes', async () => {
    const { deps } = fakeDeps();
    for (const mode of ['count', 'map', 'hits'] as const) {
      const payload = parse(
        await tool(deps, 'search_entities').handler({ type: 'widget', query: 'e', mode }),
      );
      expect(JSON.stringify(payload)).not.toContain('score');
    }
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

describe('entity-tools: no overview (0.2.92, M05 internal channel)', () => {
  it('does not render the M39 overview operation — the catalog cell is n/a', () => {
    const { deps } = fakeDeps();
    expect(buildEntityTools(deps).map((t) => t.name)).not.toContain('overview');
  });

  it('renders resolve_identity through the core, the internal half of its `direct` cell', async () => {
    const { deps } = fakeDeps();
    const seen: unknown[] = [];
    (deps.discovery as unknown as { resolveIdentity: (i: unknown) => unknown }).resolveIdentity = (input) => {
      seen.push(input);
      return { candidates: [] };
    };
    const result = await tool(deps, 'resolve_identity').handler({ query: 'user', types: ['dto'], limit: 3 });
    expect(result.isError).toBeFalsy();
    expect(seen).toEqual([{ query: 'user', types: ['dto'], limit: 3 }]);
  });
});

/**
 * 2.1.26 — `entity-tools · get_field_content` (record
 * `entity-tools-get-field-content`), the `internal` rendering of the generic
 * core operation `get_field_content`. The handler checks the type (unknown →
 * `INVALID_TYPE`, inactive → `INACTIVE_TYPE`) BEFORE the core and then calls
 * `DiscoveryCore.getFieldContent`; it does not catch the core's refusals, so
 * those are not reframed into this server's `{ error, code, hint }` envelope.
 */
describe('[entity:entity-tools-get-field-content] entity-tools: get_field_content', () => {
  type Shape = Record<string, { isOptional: () => boolean; description?: string }>;

  function withCore(deps: EntityToolsDeps, impl: (input: unknown) => unknown): unknown[] {
    const seen: unknown[] = [];
    (deps.discovery as unknown as { getFieldContent: (i: unknown) => unknown }).getFieldContent = (input) => {
      seen.push(input);
      return impl(input);
    };
    return seen;
  }

  it('[entity:entity-tools-get-field-content] is registered with the record\'s name, description, params (all three required) and no declared hints', () => {
    const { deps } = fakeDeps();
    const t = tool(deps, 'get_field_content');
    expect(t.name).toBe('get_field_content');
    expect(t.description).toBe(
      'Fetch the content of ONE content-bearing field of one entity. Such a field never travels in get_entities or list_entities — you get `has<Field>`/`<field>Bytes` and this operation\'s name instead — so this is how you read a diagram body or any other field measured in kilobytes. Call describe_entity_type for the type\'s `contentFields`. A field that is not content-bearing is INVALID_ARGUMENT with the covered fields listed; an unknown slug is NOT_FOUND. No side effects; write the field with update_entities as usual.',
    );
    const shape = t.inputSchema as unknown as Shape;
    expect(Object.keys(shape).sort()).toEqual(['field', 'slug', 'type']);
    for (const key of ['type', 'slug', 'field']) expect(shape[key]!.isOptional(), key).toBe(false);
    expect(shape.type!.description).toBe('Entity type, e.g. "diagram"');
    expect(shape.slug!.description).toBeUndefined();
    expect(shape.field!.description).toBe('A content-bearing field of that type, e.g. "source"');
    // Every hint of the record is empty: the server declares none.
    expect((t as { annotations?: unknown }).annotations).toBeUndefined();
  });

  it('[entity:entity-tools-get-field-content] an unknown type is INVALID_TYPE and an inactive one INACTIVE_TYPE, both before the core is asked', async () => {
    const { deps } = fakeDeps();
    const seen = withCore(deps, () => {
      throw new Error('the core must not be reached');
    });
    const unknown = await tool(deps, 'get_field_content').handler({ type: 'nonexistent', slug: 'x', field: 'body' });
    expect(unknown.isError).toBe(true);
    expect(parse(unknown)).toMatchObject({ code: 'INVALID_TYPE' });
    const inactive = await tool(deps, 'get_field_content').handler({ type: 'inactive', slug: 'x', field: 'body' });
    expect(inactive.isError).toBe(true);
    expect(parse(inactive)).toMatchObject({ code: 'INACTIVE_TYPE' });
    expect(seen).toEqual([]);
  });

  it('[entity:entity-tools-get-field-content] passes (type, slug, field) to DiscoveryCore.getFieldContent and returns { type, slug, field, content, bytes } as the core gave it', async () => {
    const { deps } = fakeDeps();
    const answer = { type: 'widget', slug: 'widget-existing', field: 'body', content: 'héllo', bytes: 6 };
    const seen = withCore(deps, () => answer);
    const result = await tool(deps, 'get_field_content').handler({ type: 'widget', slug: 'widget-existing', field: 'body' });
    expect(result.isError).toBeFalsy();
    expect(seen).toEqual([{ type: 'widget', slug: 'widget-existing', field: 'body' }]);
    expect(parse(result)).toEqual(answer);
  });

  it('[entity:entity-tools-get-field-content] the core\'s INVALID_ARGUMENT, ENTITY_NOT_FOUND and INDEX_STALE are not caught by the handler', async () => {
    const { deps } = fakeDeps();
    for (const err of [
      invalidArgument("'title' is not a content-bearing field of 'widget'", 'content-bearing fields of this type: body'),
      entityNotFound('widget', 'missing', ['widget-existing']),
      indexStale('entities', ['widget']),
    ]) {
      withCore(deps, () => {
        throw err;
      });
      await expect(
        tool(deps, 'get_field_content').handler({ type: 'widget', slug: 'missing', field: 'title' }),
      ).rejects.toMatchObject({ code: err.code });
    }
  });
});

/**
 * 2.1.26 (M39 `v0fldrd8`) — the content read is ONE generic operation, not a
 * surface generated per type: an active type with a content-bearing field adds
 * no tool to `entity-tools`, and the one `get_field_content` serves it.
 */
describe('[section:v0fldrd8] entity-tools: no field-content tool per type', () => {
  const contentType = () =>
    widgetModule({
      type: 'gizmo',
      data: {
        schema: {
          ...FIXTURE_DATA.schema,
          body: { type: 'string', contentBearing: true },
          notes: { type: 'string', contentBearing: true },
        },
      },
    });

  it('[section:v0fldrd8] the tool list is the same with or without a type declaring two content-bearing fields', () => {
    const without = buildEntityTools(fakeDeps().deps).map((t) => t.name);
    const withType = buildEntityTools(fakeDeps([contentType()]).deps).map((t) => t.name);
    expect(withType).toEqual(without);
    expect(withType.filter((n) => n === 'get_field_content')).toHaveLength(1);
    expect(withType.some((n) => /gizmo|body|notes/.test(n))).toBe(false);
  });

  it('[section:v0fldrd8] the one get_field_content answers that type\'s fields through the same core call', async () => {
    const { deps } = fakeDeps([contentType()]);
    const seen: unknown[] = [];
    (deps.discovery as unknown as { getFieldContent: (i: unknown) => unknown }).getFieldContent = (input) => {
      seen.push(input);
      const { type, slug, field } = input as { type: string; slug: string; field: string };
      return { type, slug, field, content: field, bytes: field.length };
    };
    for (const field of ['body', 'notes']) {
      const result = await tool(deps, 'get_field_content').handler({ type: 'gizmo', slug: 'g', field });
      expect(result.isError).toBeFalsy();
      expect(parse(result)).toMatchObject({ type: 'gizmo', field, content: field });
    }
    expect(seen).toEqual([
      { type: 'gizmo', slug: 'g', field: 'body' },
      { type: 'gizmo', slug: 'g', field: 'notes' },
    ]);
  });
});

/**
 * 2.1.26 — the four `entity-tools` read tools as their re-rendered `mcp-tool`
 * records declare them (the `internal` renderings of `describe_types`,
 * `get_entities`, `list_entities` and `resolve_identity`): name, description,
 * parameters, no declared hint — `resolve_identity` included, whose read-only
 * declaration is gone — and the behaviour each record's `logic` states.
 */
describe('entity-tools — the read tools as their 2.1.26 records declare them', () => {
  type CoreStub = Record<string, (input: unknown) => unknown>;
  const core = (deps: EntityToolsDeps) => deps.discovery as unknown as CoreStub;

  it('[entity:entity-tools-describe-entity-type] describe_entity_type: the record\'s contract; unknown type INVALID_TYPE, inactive INACTIVE_TYPE', async () => {
    const { deps } = fakeDeps();
    expectToolMatchesRecord(tool(deps, 'describe_entity_type'), 'entity-tools-describe-entity-type');
    const unknown = await tool(deps, 'describe_entity_type').handler({ type: 'nonexistent' }, {});
    expect(unknown.isError).toBe(true);
    expect(parse(unknown as never)).toMatchObject({ code: 'INVALID_TYPE' });
    const inactive = await tool(deps, 'describe_entity_type').handler({ type: 'inactive' }, {});
    expect(inactive.isError).toBe(true);
    expect(parse(inactive as never)).toMatchObject({ code: 'INACTIVE_TYPE' });
  });

  it('[entity:entity-tools-describe-entity-type] without `type` every active type, each entry built from one core call; when that call throws, per type — and a type whose description throws gets `{ type, label, __error }`', async () => {
    const { deps } = fakeDeps();
    const derived = {
      constraints: [{ field: 'title', type: 'maxLength', maxLength: 200 }],
      contentFields: [{ field: 'body', operation: 'get_field_content' }],
      selectableFields: ['title'],
    };
    const calls: unknown[] = [];
    core(deps).describeTypes = (input) => {
      calls.push(input);
      return { types: ['widget', 'no-crud'].map((type) => ({ type, ...derived })) };
    };
    const all = parse((await tool(deps, 'describe_entity_type').handler({}, {})) as never) as {
      types: Array<Record<string, unknown>>;
    };
    expect(calls).toEqual([{}]);
    expect(all.types.map((t) => t.type)).toEqual(['widget', 'no-crud']);
    for (const entry of all.types) {
      expect(Object.keys(entry).sort()).toEqual(
        [
          'constraints',
          'contentFields',
          'createSchema',
          'crudSupported',
          'customToolsLine',
          'label',
          'searchableFields',
          'selectableFields',
          'type',
          'updateSchema',
        ].filter((k) => k !== 'customToolsLine' || entry.customToolsLine !== undefined),
      );
      expect(entry).toMatchObject({ label: 'Widget', crudSupported: true, ...derived });
      expect(entry.createSchema).toMatchObject({ type: 'object' });
      expect(entry.updateSchema).toMatchObject({ type: 'object' });
      expect(entry.searchableFields).toEqual(expect.arrayContaining(['title']));
    }

    // The batch throws → one core call per type; the type whose own call throws
    // degrades to its `__error` entry, the healthy one is untouched.
    core(deps).describeTypes = (input) => {
      const { types } = input as { types?: string[] };
      if (!types) throw new Error('batch failed');
      if (types[0] === 'no-crud') throw new Error('bad schema');
      return { types: [{ type: types[0], ...derived }] };
    };
    const fallback = parse((await tool(deps, 'describe_entity_type').handler({}, {})) as never) as {
      types: Array<Record<string, unknown>>;
    };
    expect(fallback.types[0]).toMatchObject({ type: 'widget', crudSupported: true, ...derived });
    expect(fallback.types[1]).toEqual({ type: 'no-crud', label: 'Widget', __error: 'no-crud: bad schema' });
  });

  it('[entity:entity-tools-get-entities] get_entities: the record\'s contract; unknown type INVALID_TYPE and inactive INACTIVE_TYPE before the core', async () => {
    const { deps } = fakeDeps();
    expectToolMatchesRecord(tool(deps, 'get_entities'), 'entity-tools-get-entities');
    const seen: unknown[] = [];
    core(deps).getEntities = (input) => (seen.push(input), { results: [], selectedFields: [] });
    const unknown = await tool(deps, 'get_entities').handler({ type: 'nonexistent', slugs: ['a'] }, {});
    expect(parse(unknown as never)).toMatchObject({ code: 'INVALID_TYPE' });
    const inactive = await tool(deps, 'get_entities').handler({ type: 'inactive', slugs: ['a'] }, {});
    expect(parse(inactive as never)).toMatchObject({ code: 'INACTIVE_TYPE' });
    expect(seen).toEqual([]);
  });

  it('[entity:entity-tools-get-entities] slugs go to the core in batches of 50 with no cap, a budget-cut item is re-fetched alone, and the answer is `{ type, selectedFields, results }` with no `truncated` or `message`', async () => {
    const { deps } = fakeDeps();
    const batches: string[][] = [];
    core(deps).getEntities = (input) => {
      const { slugs } = input as { slugs: string[] };
      batches.push(slugs);
      return {
        type: 'widget',
        selectedFields: ['title'],
        // In a batch, `w-2` falls past the budget; asked alone it is emitted whole.
        results: slugs.map((slug) =>
          slug === 'w-2' && slugs.length > 1
            ? { slug, entity: null, truncated: true }
            : { slug, entity: slug === 'w-gone' ? null : { slug, title: slug } },
        ),
        truncated: slugs.length > 1,
        message: 'response budget reached',
      };
    };
    const slugs = [...Array.from({ length: 50 }, (_, i) => `w-${i}`), 'w-gone'];
    const body = parse((await tool(deps, 'get_entities').handler({ type: 'widget', slugs, select: ['title'] }, {})) as never) as {
      type: string;
      selectedFields: string[];
      results: Array<Record<string, unknown>>;
    };
    expect(batches.map((b) => b.length)).toEqual([50, 1, 1]);
    expect(batches[2]).toEqual(['w-2']);
    expect(Object.keys(body).sort()).toEqual(['results', 'selectedFields', 'type']);
    expect(body).toMatchObject({ type: 'widget', selectedFields: ['title'] });
    expect(body.results).toHaveLength(51);
    expect(body.results[2]).toEqual({ slug: 'w-2', entity: { slug: 'w-2', title: 'w-2' } });
    // A slug with no entity is an item with an empty record, not a refusal.
    expect(body.results[50]).toEqual({ slug: 'w-gone', entity: null });
    for (const row of body.results) expect(Object.keys(row).sort()).toEqual(['entity', 'slug']);
  });

  it('[entity:entity-tools-get-entities] the core\'s INVALID_ARGUMENT and INDEX_STALE are not caught by the handler', async () => {
    const { deps } = fakeDeps();
    for (const err of [invalidArgument('bad select', 'selectable: title'), indexStale('entities', ['widget'])]) {
      core(deps).getEntities = () => {
        throw err;
      };
      await expect(
        tool(deps, 'get_entities').handler({ type: 'widget', slugs: ['w'], select: ['a.b'] }, {}),
      ).rejects.toMatchObject({ code: err.code });
    }
  });

  it('[entity:entity-tools-list-entities] list_entities: the record\'s contract (no sort, no dir); unknown type INVALID_TYPE and inactive INACTIVE_TYPE before the core', async () => {
    const { deps } = fakeDeps();
    const t = tool(deps, 'list_entities');
    expectToolMatchesRecord(t, 'entity-tools-list-entities');
    expect(Object.keys(t.inputSchema as object)).not.toContain('sort');
    expect(Object.keys(t.inputSchema as object)).not.toContain('dir');
    const unknown = await t.handler({ type: 'nonexistent' }, {});
    expect(parse(unknown as never)).toMatchObject({ code: 'INVALID_TYPE' });
    const inactive = await t.handler({ type: 'inactive' }, {});
    expect(parse(inactive as never)).toMatchObject({ code: 'INACTIVE_TYPE' });
  });

  it('[entity:entity-tools-list-entities] the core enumerates with the type\'s default predicate; tagFilter defaults to and, empty tags filter nothing, limit 50 / offset 0 by default; hasMore from offset, items and total; count is `{ type, mode, total }`', async () => {
    const { deps } = fakeDeps();
    const seen: Array<Record<string, unknown>> = [];
    core(deps).listEntities = (input) => {
      seen.push(input as Record<string, unknown>);
      return { mode: 'items', items: [{ slug: 'a', title: 'A' }], total: 3, hasMore: true };
    };
    const call = async (args: Record<string, unknown>) =>
      parse((await tool(deps, 'list_entities').handler({ type: 'widget', ...args }, {})) as never);

    expect(await call({})).toEqual({ type: 'widget', mode: 'items', items: [{ slug: 'a', title: 'A' }], total: 3, hasMore: true });
    expect(seen[0]).toEqual({ type: 'widget', applyDefaultPredicate: true, limit: 50, offset: 0 });

    await call({ tags: ['m39'], filters: { status: 'active' }, limit: 5, offset: 1 });
    expect(seen[1]).toEqual({
      type: 'widget',
      tags: ['m39'],
      tagFilter: 'and',
      filters: { status: 'active' },
      applyDefaultPredicate: true,
      limit: 5,
      offset: 1,
    });

    await call({ tags: [], tagFilter: 'or' });
    expect(seen[2]).not.toHaveProperty('tags');
    expect(seen[2]).not.toHaveProperty('tagFilter');

    expect((await call({ offset: 2 })).hasMore).toBe(false);
    expect(await call({ mode: 'count' })).toEqual({ type: 'widget', mode: 'count', total: 3 });
  });

  it('[entity:entity-tools-list-entities] the core\'s INDEX_STALE is not caught by the handler', async () => {
    const { deps } = fakeDeps();
    core(deps).listEntities = () => {
      throw indexStale('entities', ['widget']);
    };
    await expect(tool(deps, 'list_entities').handler({ type: 'widget' }, {})).rejects.toMatchObject({ code: 'INDEX_STALE' });
  });

  it('[entity:entity-tools-resolve-identity] resolve_identity: the record\'s contract with no declared hint (no readOnlyHint); the core\'s candidates passed through, `types` and `limit` forwarded only when given', async () => {
    const { deps } = fakeDeps();
    const t = tool(deps, 'resolve_identity');
    expectToolMatchesRecord(t, 'entity-tools-resolve-identity');
    expect((t as { annotations?: { readOnlyHint?: boolean } }).annotations?.readOnlyHint).toBeUndefined();

    const seen: Array<Record<string, unknown>> = [];
    const answer = {
      candidates: [
        { type: 'dto', slug: 'user', title: 'User', score: 400 },
        { type: 'endpoint', slug: 'user', title: 'User', score: 400 },
      ],
      truncated: false,
    };
    core(deps).resolveIdentity = (input) => (seen.push(input as Record<string, unknown>), answer);
    const plain = await t.handler({ query: 'user' }, {});
    expect(plain.isError).toBeFalsy();
    expect(parse(plain as never)).toEqual(answer);
    expect(Object.keys(seen[0]!)).toEqual(['query']);
    await t.handler({ query: 'user', types: ['dto'], limit: 3 }, {});
    expect(seen[1]).toEqual({ query: 'user', types: ['dto'], limit: 3 });
  });

  it('[entity:entity-tools-resolve-identity] a core error comes back with its code, message and hint; an exception without a code is INTERNAL', async () => {
    const { deps } = fakeDeps();
    core(deps).resolveIdentity = () => {
      throw indexStale('entities', 'global');
    };
    const stale = await tool(deps, 'resolve_identity').handler({ query: 'user' }, {});
    expect(stale.isError).toBe(true);
    const body = parse(stale as never) as Record<string, unknown>;
    expect(body.code).toBe('INDEX_STALE');
    expect(String(body.error)).toContain("projection 'entities' is marked stale");
    expect(String(body.hint)).toContain('Rebuild it');

    core(deps).resolveIdentity = () => {
      throw new Error('boom');
    };
    const crashed = await tool(deps, 'resolve_identity').handler({ query: 'user' }, {});
    expect(parse(crashed as never)).toMatchObject({ code: 'INTERNAL', error: 'boom' });
  });
});

/**
 * 2.1.26 — `entity-tools · search_entities` (the `internal` rendering of
 * `search_entities`) as its re-rendered record declares it: name, description,
 * parameters (`filters` beside the search inputs, numeric paging), no declared
 * hint; and the handler behaviour its `logic` states.
 */
describe('entity-tools — search_entities as its 2.1.26 record declares it', () => {
  type CoreStub = Record<string, (input: unknown) => unknown>;
  const core = (deps: EntityToolsDeps) => deps.discovery as unknown as CoreStub;

  it('[entity:entity-tools-search-entities] the record\'s contract; unknown type INVALID_TYPE and inactive INACTIVE_TYPE, both before the core', async () => {
    const { deps } = fakeDeps();
    const t = tool(deps, 'search_entities');
    expectToolMatchesRecord(t, 'entity-tools-search-entities');
    const seen: unknown[] = [];
    core(deps).searchEntities = (input) => (seen.push(input), { mode: 'map', items: [], total: 0, hasMore: false, searchedFields: [] });
    const unknown = await t.handler({ type: 'nonexistent', query: 'x' }, {});
    expect(unknown.isError).toBe(true);
    expect(parse(unknown as never)).toMatchObject({ code: 'INVALID_TYPE' });
    const inactive = await t.handler({ type: 'inactive', query: 'x' }, {});
    expect(inactive.isError).toBe(true);
    expect(parse(inactive as never)).toMatchObject({ code: 'INACTIVE_TYPE' });
    expect(seen).toEqual([]);
  });

  it('[entity:entity-tools-search-entities] defaults mode map, limit 50, offset 0 and the type\'s default predicate; `filters` and the given input forwarded; map/hits answer `{ type, mode, items, total, hasMore, searchedFields }` without the core\'s `truncated`', async () => {
    const { deps } = fakeDeps();
    const seen: Array<Record<string, unknown>> = [];
    const row = { slug: 'w-1', title: 'W', matchCount: 2, hunks: [{ field: 'title', text: 'W', matches: 2 }], omittedChars: 0 };
    core(deps).searchEntities = (input) => {
      seen.push(input as Record<string, unknown>);
      const mode = (input as { mode: string }).mode;
      return { mode, items: [row], total: 1, hasMore: false, truncated: false, searchedFields: ['slug', 'title'] };
    };
    const map = parse((await tool(deps, 'search_entities').handler({ type: 'widget', query: 'w' }, {})) as never);
    expect(seen[0]).toEqual({ type: 'widget', query: 'w', fields: undefined, mode: 'map', limit: 50, offset: 0, applyDefaultPredicate: true });
    expect('regex' in seen[0]!).toBe(false);
    expect(map).toEqual({ type: 'widget', mode: 'map', items: [row], total: 1, hasMore: false, searchedFields: ['slug', 'title'] });

    const filters = { status: ['active', 'deprecated'] };
    const hits = parse(
      (await tool(deps, 'search_entities').handler(
        { type: 'widget', regex: 'w', fields: ['title'], mode: 'hits', limit: 5, offset: 10, filters },
        {},
      )) as never,
    ) as Record<string, unknown>;
    expect(seen[1]).toEqual({ type: 'widget', regex: 'w', fields: ['title'], mode: 'hits', limit: 5, offset: 10, applyDefaultPredicate: true, filters });
    expect('query' in seen[1]!).toBe(false);
    expect(Object.keys(hits).sort()).toEqual(['hasMore', 'items', 'mode', 'searchedFields', 'total', 'type']);
    expect(hits).not.toHaveProperty('truncated');
  });

  it('[entity:entity-tools-search-entities] mode count answers `{ type, mode, total, matches, searchedFields }`', async () => {
    const { deps } = fakeDeps();
    core(deps).searchEntities = () => ({ mode: 'count', total: 3, matches: 7, searchedFields: ['title'], truncated: false });
    const body = parse((await tool(deps, 'search_entities').handler({ type: 'widget', query: 'w', mode: 'count' }, {})) as never);
    expect(body).toEqual({ type: 'widget', mode: 'count', total: 3, matches: 7, searchedFields: ['title'] });
  });

  it('[entity:entity-tools-search-entities] the core\'s INVALID_ARGUMENT, SEARCH_BUDGET_EXCEEDED and INDEX_STALE are not caught by the handler', async () => {
    const { deps } = fakeDeps();
    for (const err of [
      invalidArgument('pass exactly one of query or regex', 'search_entities({ type, query })'),
      searchBudgetExceeded('search_entities', 5000),
      indexStale('entities', ['widget']),
    ]) {
      core(deps).searchEntities = () => {
        throw err;
      };
      await expect(tool(deps, 'search_entities').handler({ type: 'widget', query: 'w' }, {})).rejects.toMatchObject({
        code: err.code,
      });
    }
  });
});

/**
 * 2.1.26 — the three M13 mutation tools as their re-rendered `mcp-tool` records
 * declare them (the `internal`/`mcp` renderings of `create_entities`,
 * `update_entities` and `delete_entities`): name, description, parameters, no
 * declared hint, and the behaviour each record's `logic` states — the whole-call
 * type refusals, the per-item envelope (`{ slug }`, `{ slug, warnings[] }`,
 * `{ error, code }`), the actor `agent` and the change broadcast.
 */
describe('entity-tools — the mutation tools as their 2.1.26 records declare them', () => {
  /** A type with a soft-FK scalar: a write naming a missing target WARNS, never blocks. */
  const palModule = () =>
    widgetModule({
      type: 'pal',
      data: {
        schema: {
          title: { type: 'string', required: true, maxLength: 200, default: 'Untitled' },
          buddy: { type: 'string', ref: 'pal', onMissing: 'warn', onDelete: 'leave-dangling' },
        },
      },
    });
  const results = (r: { content: Array<{ text: string }> }) => (parse(r) as { results: Array<Record<string, unknown>> }).results;

  it('[entity:entity-tools-create-entities] create_entities: the record\'s contract; unknown type INVALID_TYPE, inactive INACTIVE_TYPE, both for the whole call before any item is written', async () => {
    const { deps, rows } = fakeDeps();
    expectToolMatchesWriteRecord(tool(deps, 'create_entities'), 'entity-tools-create-entities');
    const unknown = await tool(deps, 'create_entities').handler({ type: 'nonexistent', items: [{ title: 'x' }] });
    expect(unknown.isError).toBe(true);
    expect(parse(unknown)).toMatchObject({ code: 'INVALID_TYPE' });
    const inactive = await tool(deps, 'create_entities').handler({ type: 'inactive', items: [{ title: 'x' }] });
    expect(inactive.isError).toBe(true);
    expect(parse(inactive)).toMatchObject({ code: 'INACTIVE_TYPE' });
    expect(rows().map((w) => w.slug)).toEqual(['widget-existing']);
    expect(deps.ws.broadcast).not.toHaveBeenCalled();
  });

  it('[entity:entity-tools-create-entities] per item, in input order: { slug }, VALIDATION_ERROR for a schema failure, a domain code kept (SLUG_CONFLICT), anything else INTERNAL — the others still written', async () => {
    const { deps, rows } = fakeDeps();
    (deps.entityStore!.persist as unknown as ReturnType<typeof vi.fn>).mockImplementation((_type: string, slug: string) => {
      if (slug === 'boom') throw new Error('disk full');
    });
    const result = await tool(deps, 'create_entities').handler({
      type: 'widget',
      items: [{ title: 'a' }, { title: 7 }, { title: 'dup', slug: 'widget-existing' }, { title: 'boom' }, { title: 'b' }],
    });
    expect(result.isError).toBeUndefined();
    const r = results(result);
    expect(r).toHaveLength(5);
    expect(r[0]).toEqual({ slug: 'a' });
    expect(r[1]).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(r[2]).toMatchObject({ code: 'SLUG_CONFLICT' });
    expect(r[3]).toEqual({ error: 'disk full', code: 'INTERNAL' });
    expect(r[4]).toEqual({ slug: 'b' });
    expect(rows().map((w) => w.slug)).toEqual(expect.arrayContaining(['a', 'b', 'widget-existing']));
  });

  it('[entity:entity-tools-create-entities] an item whose write returned warnings answers { slug, warnings[] }; written with actor agent and broadcast as entity:changed per created entity', async () => {
    const { deps } = fakeDeps([palModule()]);
    const capture = vi.spyOn(deps.versionService!, 'captureEntitySnapshot');
    const result = await tool(deps, 'create_entities').handler({
      type: 'pal',
      items: [{ title: 'one' }, { title: 'two', buddy: 'ghost' }],
    });
    const r = results(result);
    expect(r[0]).toEqual({ slug: 'one' });
    expect(r[1]!.slug).toBe('two');
    expect(r[1]!.warnings).toEqual([expect.stringMatching(/ghost.*dangling/)]);
    expect(capture).toHaveBeenCalledWith('pal', 'one', 'create', 'agent', 'Created');
    expect(deps.ws.broadcast).toHaveBeenCalledWith({ kind: 'entity:changed', entityType: 'pal', slug: 'one', action: 'create' });
    expect(deps.ws.broadcast).toHaveBeenCalledWith({ kind: 'entity:changed', entityType: 'pal', slug: 'two', action: 'create' });
  });

  it('[entity:entity-tools-update-entities] update_entities: the record\'s contract; unknown type INVALID_TYPE, inactive INACTIVE_TYPE, both for the whole call', async () => {
    const { deps, rows } = fakeDeps();
    expectToolMatchesWriteRecord(tool(deps, 'update_entities'), 'entity-tools-update-entities');
    const update = [{ slug: 'widget-existing', data: { title: 'changed' } }];
    const unknown = await tool(deps, 'update_entities').handler({ type: 'nonexistent', updates: update });
    expect(unknown.isError).toBe(true);
    expect(parse(unknown)).toMatchObject({ code: 'INVALID_TYPE' });
    const inactive = await tool(deps, 'update_entities').handler({ type: 'inactive', updates: update });
    expect(inactive.isError).toBe(true);
    expect(parse(inactive)).toMatchObject({ code: 'INACTIVE_TYPE' });
    expect(rows()).toEqual([{ slug: 'widget-existing', title: 'existing' }]);
  });

  it('[entity:entity-tools-update-entities] per item: VALIDATION_ERROR for a schema failure, an absent slug keeps its domain code, anything else INTERNAL — the others still applied', async () => {
    const { deps, rows } = fakeDeps();
    await seed(deps, 'boom');
    (deps.entityStore!.persist as unknown as ReturnType<typeof vi.fn>).mockImplementation((_type: string, slug: string) => {
      if (slug === 'boom') throw new Error('disk full');
    });
    const result = await tool(deps, 'update_entities').handler({
      type: 'widget',
      updates: [
        { slug: 'widget-existing', data: { title: 7 } },
        { slug: 'widget-ghost', data: { title: 'x' } },
        { slug: 'boom', data: { title: 'boom 2' } },
        { slug: 'widget-existing', data: { title: 'changed' } },
      ],
    });
    const r = results(result);
    expect(r[0]).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(r[1]).toMatchObject({ code: 'NOT_FOUND' });
    expect(r[2]).toEqual({ error: 'disk full', code: 'INTERNAL' });
    expect(r[3]).toEqual({ slug: 'widget-existing' });
    expect(rows().find((w) => w.slug === 'widget-existing')?.title).toBe('changed');
  });

  it('[entity:entity-tools-update-entities] newSlug goes to the write with data — the result is the NEW slug and page references are repointed; warnings come back as { slug, warnings[] }; actor agent, entity:changed broadcast', async () => {
    const { deps } = fakeDeps([palModule()]);
    await tool(deps, 'create_entities').handler({ type: 'pal', items: [{ title: 'one' }, { title: 'two' }] });
    const capture = vi.spyOn(deps.versionService!, 'captureEntitySnapshot');
    const result = await tool(deps, 'update_entities').handler({
      type: 'pal',
      updates: [
        { slug: 'one', data: { title: 'uno' }, newSlug: 'uno' },
        { slug: 'two', data: { buddy: 'ghost' } },
      ],
    });
    const r = results(result);
    expect(r[0]).toEqual({ slug: 'uno' });
    expect(deps.referencesService.propagateSlugChange).toHaveBeenCalledWith('pal', 'one', 'uno');
    expect(r[1]!.slug).toBe('two');
    expect(r[1]!.warnings).toEqual([expect.stringMatching(/ghost.*dangling/)]);
    expect(capture).toHaveBeenCalledWith('pal', 'uno', 'update', 'agent', 'Updated');
    expect(deps.ws.broadcast).toHaveBeenCalledWith({ kind: 'entity:changed', entityType: 'pal', slug: 'uno', action: 'update' });
  });

  it('[entity:entity-tools-delete-entities] delete_entities: the record\'s contract; unknown type INVALID_TYPE, inactive INACTIVE_TYPE, both for the whole call', async () => {
    const { deps, rows } = fakeDeps();
    expectToolMatchesWriteRecord(tool(deps, 'delete_entities'), 'entity-tools-delete-entities');
    const unknown = await tool(deps, 'delete_entities').handler({ type: 'nonexistent', slugs: ['widget-existing'] });
    expect(unknown.isError).toBe(true);
    expect(parse(unknown)).toMatchObject({ code: 'INVALID_TYPE' });
    const inactive = await tool(deps, 'delete_entities').handler({ type: 'inactive', slugs: ['widget-existing'] });
    expect(inactive.isError).toBe(true);
    expect(parse(inactive)).toMatchObject({ code: 'INACTIVE_TYPE' });
    expect(rows().map((w) => w.slug)).toEqual(['widget-existing']);
  });

  it('[entity:entity-tools-delete-entities] references are collected BEFORE the delete and grouped by pagePath; an absent slug is NOT_FOUND for its item (a repeat is a refusal); another error is INTERNAL', async () => {
    const { deps, rows } = fakeDeps();
    await seed(deps, 'c', 'd');
    const presentWhenAsked: boolean[] = [];
    (deps.referencesService.findReferences as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (_type: string, slug: string) => {
        if (slug === 'd') throw new Error('index gone');
        presentWhenAsked.push(rows().some((w) => w.slug === slug));
        return slug === 'c'
          ? [{ pagePath: 'modules/m21-briefs.md' }, { pagePath: 'modules/m21-briefs.md' }, { pagePath: 'index.md' }]
          : [];
      },
    );
    const result = await tool(deps, 'delete_entities').handler({ type: 'widget', slugs: ['c', 'widget-ghost', 'd', 'c'] });
    const r = results(result);
    expect(r[0]).toEqual({
      deleted: true,
      brokenReferences: [
        { pagePath: 'modules/m21-briefs.md', count: 2 },
        { pagePath: 'index.md', count: 1 },
      ],
    });
    expect(r[1]).toMatchObject({ code: 'NOT_FOUND' });
    expect(r[2]).toEqual({ error: 'index gone', code: 'INTERNAL' });
    expect(r[3]).toMatchObject({ code: 'NOT_FOUND' });
    expect(presentWhenAsked[0]).toBe(true);
    expect(rows().map((w) => w.slug)).toEqual(['d', 'widget-existing']);
    expect(deps.ws.broadcast).toHaveBeenCalledWith({ kind: 'entity:changed', entityType: 'widget', slug: 'c', action: 'delete' });
  });
});
