import { FIXTURE_DATA, FIXTURE_SLUG_PATTERN } from '../../../tests/helpers/fixture-module.js';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { buildEntityTools, type EntityToolsDeps } from './entity-tools.js';
import { DomainError } from '../services/tags.js';
import type { EntityCrudService } from '../core/plugin-host/entity-crud-service.js';
import type { BackendModule, ProjectPluginHost } from '../core/plugin-host/types.js';

interface Widget {
  slug: string;
  name: string;
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
    serializer: {} as BackendModule['serializer'],
    systemPrompt: {
      roleNoun: 'Widgets',
    },
    backend: {
      crud: { createSchema: { name: z.string() } },
    },
    ...overrides,
  };
}

function fakeWidgetService(): EntityCrudService<Widget> {
  const store = new Map<string, Widget>([['widget-existing', { slug: 'widget-existing', name: 'existing' }]]);
  return {
    create(data) {
      const { name } = data as { name: string };
      if (name === 'dup') throw new DomainError('SLUG_CONFLICT', `slug already exists`);
      const slug = `widget-${name}`;
      store.set(slug, { slug, name });
      return { slug };
    },
    get(slug) {
      return store.get(slug) ?? null;
    },
    update(slug, data) {
      const current = store.get(slug);
      if (!current) throw new DomainError('NOT_FOUND', `widget '${slug}' not found`);
      const { newSlug, ...rest } = data as { newSlug?: string; name?: string };
      const nextSlug = newSlug ?? slug;
      const updated = { ...current, ...rest, slug: nextSlug };
      if (nextSlug !== slug) store.delete(slug);
      store.set(nextSlug, updated);
      return { slug: nextSlug };
    },
    delete(slug) {
      if (!store.has(slug)) throw new DomainError('NOT_FOUND', `widget '${slug}' not found`);
      store.delete(slug);
    },
    list: vi.fn(() => {
      const items = Array.from(store.values());
      return { items, total: items.length };
    }),
    search: vi.fn((query: string) => {
      const items = Array.from(store.values()).filter((w) => w.name.includes(query));
      return { items, total: items.length };
    }),
  };
}

/**
 * Builds fake deps with `widget` (active, CRUD), `no-crud` (active, no backend.crud),
 * `inactive` (registered but inactive). `extraActive` modules are registered AND made
 * active — used by the describe-isolation tests to inject a type whose schema can't be
 * serialized, without disturbing tests that assert the exact active-type set.
 */
function fakeDeps(extraActive: BackendModule[] = []): { deps: EntityToolsDeps; service: EntityCrudService<Widget> } {
  const service = fakeWidgetService();
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
    getEntityService: (type) => (type === 'widget' ? service : null),
    snapshot: () => ({}) as never,
    restore: () => ({}) as never,
    diff: () => ({}) as never,
    clearMcpFactories: () => {},
  };

  const deps: EntityToolsDeps = {
    host,
    reader: {
      getEntity: (_type: string, slug: string) => service.get(slug),
      getEntities: (_type: string, slugs: string[]) => {
        const items = slugs.map((slug) => service.get(slug)).filter((e): e is Widget => e != null);
        const missing = slugs.filter((slug) => service.get(slug) == null);
        return { items, missing };
      },
    } as unknown as EntityToolsDeps['reader'],
    // M39: the read path goes through the discovery core. The stub projects the
    // same fake service, so these tests keep asserting what this server is
    // responsible for — forwarding `filters` to the service — rather than
    // re-testing the core's serialization.
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
          searchableFields: [`${type}.name`],
        })),
      }),
      getEntities: ({ type, slugs }: { type: string; slugs: string[] }) => ({
        type,
        view: 'detail',
        results: slugs.map((slug) => ({ slug, entity: service.get(slug) ?? null })),
      }),
      /**
       * Projects the same fake store, and honours `mode` — the real core does.
       * A stub that answered `mode: "hits"` regardless would let a handler
       * ignore the parameter and still pass, which is the bug these tests are
       * here to catch now that search routes through the core by default.
       */
      searchEntities: ({ type, query, mode }: { type: string; query: string; mode?: 'hits' | 'count' }) => {
        const hits = service.list().items.filter((w) => (w as Widget).name.includes(query));
        const searchedFields = [`${type}.name`];
        if (mode === 'count') return { mode: 'count', total: hits.length, searchedFields };
        return {
          mode: 'hits',
          items: hits.map((w) => ({ slug: (w as Widget).slug, score: 1, data: w })),
          total: hits.length,
          hasMore: false,
          searchedFields,
        };
      },
    } as unknown as EntityToolsDeps['discovery'],
    db: {} as EntityToolsDeps['db'],
    ws: { broadcast: vi.fn() },
    referencesService: {
      findReferences: vi.fn().mockResolvedValue([]),
      propagateSlugChange: vi.fn().mockResolvedValue({ changed: [] }),
    } as unknown as EntityToolsDeps['referencesService'],
  };

  return { deps, service };
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
    expect(parse(result)).toMatchObject({ error: { code: 'INVALID_TYPE' } });
  });

  it('INACTIVE_TYPE for a registered-but-inactive type', async () => {
    const { deps } = fakeDeps();
    const result = await tool(deps, 'list_entities').handler({ type: 'inactive' });
    expect(result.isError).toBe(true);
    expect(parse(result)).toMatchObject({ error: { code: 'INACTIVE_TYPE' } });
  });

  it('CRUD_NOT_SUPPORTED for an active type with no backend.crud', async () => {
    const { deps } = fakeDeps();
    const result = await tool(deps, 'list_entities').handler({ type: 'no-crud' });
    expect(result.isError).toBe(true);
    expect(parse(result)).toMatchObject({ error: { code: 'CRUD_NOT_SUPPORTED' } });
  });
});

describe('entity-tools: batch partial-success', () => {
  it('create_entities: one SLUG_CONFLICT does not roll back the others, envelope preserves input order', async () => {
    const { deps } = fakeDeps();
    const result = await tool(deps, 'create_entities').handler({
      type: 'widget',
      items: [{ name: 'a' }, { name: 'dup' }, { name: 'b' }],
    });
    expect(result.isError).toBeUndefined();
    const { results } = parse(result) as { results: Array<Record<string, unknown>> };
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ slug: 'widget-a' });
    expect(results[1]).toMatchObject({ code: 'SLUG_CONFLICT' });
    expect(results[2]).toEqual({ slug: 'widget-b' });
  });

  it('delete_entities: one NOT_FOUND does not block the others', async () => {
    const { deps, service } = fakeDeps();
    service.create({ name: 'c' }); // -> widget-c
    const result = await tool(deps, 'delete_entities').handler({
      type: 'widget',
      slugs: ['widget-c', 'widget-ghost'],
    });
    const { results } = parse(result) as { results: Array<Record<string, unknown>> };
    expect(results[0]).toMatchObject({ deleted: true });
    expect(results[1]).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('entity-tools: update_entities rename', () => {
  it('newSlug renames; result.slug is the NEW slug; propagateSlugChange is called', async () => {
    const { deps } = fakeDeps();
    const result = await tool(deps, 'update_entities').handler({
      type: 'widget',
      updates: [{ slug: 'widget-existing', data: { name: 'renamed' }, newSlug: 'widget-renamed' }],
    });
    const { results } = parse(result) as { results: Array<Record<string, unknown>> };
    expect(results[0]).toEqual({ slug: 'widget-renamed' });
    expect(deps.referencesService.propagateSlugChange).toHaveBeenCalledWith(
      'widget',
      'widget-existing',
      'widget-renamed',
    );
  });
});

describe('entity-tools: filters escape hatch (list_entities/search_entities)', () => {
  it('list_entities forwards `filters` through to service.list(opts) untouched', async () => {
    const { deps, service } = fakeDeps();
    await tool(deps, 'list_entities').handler({ type: 'widget', filters: { status: 'all', kind: 'edge-case' } });
    expect(service.list).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { status: 'all', kind: 'edge-case' } }),
    );
  });

  /**
   * `filters` used to be forwarded to `service.search(query, opts)` — and
   * dropped there: the one service with a custom `search` takes only
   * `{limit, offset}`, and the core path takes no filters at all. Forwarding an
   * argument nobody reads is indistinguishable, from the caller's side, from
   * applying it.
   */
  it('search_entities REFUSES `filters` rather than accepting one nobody applies', async () => {
    const { deps, service } = fakeDeps();
    const result = await tool(deps, 'search_entities').handler({
      type: 'widget',
      query: 'a',
      filters: { status: 'all' },
    });
    expect(result.isError).toBe(true);
    expect(parse(result)).toMatchObject({ error: { code: 'INVALID_ARGUMENT' } });
    expect(service.search).not.toHaveBeenCalled();
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
    expect(parse(result)).toMatchObject({ error: { code: 'INVALID_TYPE' } });
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
    const { deps, service } = fakeDeps();
    const result = await tool(deps, 'search_entities').handler({
      type: 'widget',
      query: 'existing',
      fields: ['name'],
    });
    expect(service.search).not.toHaveBeenCalled();
    expect(parse(result)).toMatchObject({ searchedFields: ['widget.name'] });
  });

  /**
   * 0.2.4 removed the per-type escape hatch. `searchedFields` is a promise about
   * what was CONSULTED, and a service ranking over columns the host cannot see
   * could only keep that promise by echoing a second declaration back. One
   * derivation, one ranking, one answer — so a service that still ships a
   * `search` method is simply never reached.
   */
  it('never delegates to a service `search`, even when the type has one', async () => {
    const { deps, service } = fakeDeps();
    const result = await tool(deps, 'search_entities').handler({ type: 'widget', query: 'existing' });
    expect(service.search).not.toHaveBeenCalled();
    // Answered by the core, whose searchedFields is exactly what it searched.
    expect(parse(result)).toMatchObject({ searchedFields: ['widget.name'] });
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
    expect(types[0]!.searchableFields).toEqual(expect.arrayContaining(['name']));
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
    expect(types.find((t) => t.type === 'no-crud')?.crudSupported).toBe(false);
  });

  // A module whose createSchema contains a type z.toJSONSchema() cannot represent
  // (BigInt) — a stand-in for the real-world foreign/undefined schema node that used to
  // crash the whole handler with `Cannot read properties of undefined (reading 'def')`.
  const badSchemaModule = () =>
    widgetModule({ type: 'bad-schema', backend: { crud: { createSchema: { amount: z.bigint() } } } });

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

  // A module whose createSchema throws during the zod-object BUILD (property access),
  // not at serialization time — exercises the inner guard's "wraps both the build and
  // the toJSONSchema call" claim, a path the BigInt (serialize-time) cases don't reach.
  const buildThrowModule = () => {
    const crud: Record<string, unknown> = {};
    Object.defineProperty(crud, 'createSchema', {
      enumerable: true,
      get() {
        throw new Error('boom-build');
      },
    });
    return widgetModule({ type: 'build-throw', backend: { crud } as BackendModule['backend'] });
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
