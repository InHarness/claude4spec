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
    table: 'widget',
    label: 'Widget',
    labelPlural: 'Widgets',
    displayOrder: 1,
    slugFrom: () => 'widget-x',
    pathPrefix: '/widgets',
    serializer: {} as BackendModule['serializer'],
    systemPrompt: {
      roleNoun: 'Widgets',
      countStat: { placeholder: 'widgetCount', sqlQuery: 'SELECT 0', label: 'widgets' },
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
    registry: {
      serializeEntity: (_type, _view, entity) => ({ data: entity, fallback: false }),
      describe: () => ({ type: 'widget', version: '1.0.0', views: ['detail'], schemas: {} }),
    } as unknown as EntityToolsDeps['registry'],
    reader: {
      getEntity: (_type: string, slug: string) => service.get(slug),
      getEntities: (_type: string, slugs: string[]) => {
        const items = slugs.map((slug) => service.get(slug)).filter((e): e is Widget => e != null);
        const missing = slugs.filter((slug) => service.get(slug) == null);
        return { items, missing };
      },
    } as unknown as EntityToolsDeps['reader'],
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

  it('search_entities forwards `filters` through to service.search(query, opts) untouched', async () => {
    const { deps, service } = fakeDeps();
    await tool(deps, 'search_entities').handler({ type: 'widget', query: 'a', filters: { status: 'all' } });
    expect(service.search).toHaveBeenCalledWith('a', expect.objectContaining({ filters: { status: 'all' } }));
  });
});

describe('entity-tools: describe_entity_type', () => {
  it('reports crudSupported/searchSupported per type', async () => {
    const { deps } = fakeDeps();
    const result = await tool(deps, 'describe_entity_type').handler({ type: 'widget' });
    const { types } = parse(result) as { types: Array<Record<string, unknown>> };
    expect(types).toHaveLength(1);
    expect(types[0]).toMatchObject({ type: 'widget', crudSupported: true, searchSupported: true });
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
});
