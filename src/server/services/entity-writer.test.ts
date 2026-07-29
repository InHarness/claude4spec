/**
 * 0.2.2 (brief items 7/8) — `EntityWriter` collapses seven per-type methods into
 * ONE generic `upsert(type, …)` dispatched by `host.getEntityService(type)` and
 * driven by shape.
 *
 * Two behaviours here are the actual point of the change, not incidental:
 *   - a type the host has NEVER heard of gets a write door as long as it
 *     registered a service (before, only the hardcoded seven could be restored);
 *   - a type with NO service is a reported SKIP, not a throw.
 */

import { describe, expect, it, vi } from 'vitest';
import { HostEntityWriter } from './entity-writer.js';
import { DomainError } from './tags.js';
import type { PluginHost } from '../core/plugin-host/types.js';
import type { TagsService } from './tags.js';

function hostWith(services: Record<string, unknown>): PluginHost {
  return {
    getEntityService: (type: string) => (services[type] ?? null) as never,
    requireService: (type: string) => {
      const s = services[type];
      if (!s) throw new Error(`entity service for type '${type}' not registered`);
      return s as never;
    },
    entityExists: (type: string, slug: string) => {
      const s = services[type] as { getBySlug?: (s: string) => unknown } | undefined;
      return s?.getBySlug ? s.getBySlug(slug) != null : false;
    },
  } as unknown as PluginHost;
}

const tags = { assignTags: vi.fn() } as unknown as TagsService;

describe('HostEntityWriter.upsert — generic dispatch', () => {
  it('drives the resolved service by shape and normalizes the canonical `entity` key', () => {
    const upsert = vi.fn(() => ({ entity: { slug: 'a' }, op: 'created' as const }));
    const writer = new HostEntityWriter(hostWith({ widget: { upsert } }), tags);

    expect(writer.upsert('widget', 'a', { x: 1 }, 'user')).toEqual({
      entity: { slug: 'a' },
      op: 'created',
    });
    // The write-path options are the writer's, not the caller's.
    expect(upsert).toHaveBeenCalledWith('a', { x: 1 }, 'user', { capture: true, writeFile: false });
  });

  it('gives a type the host has never heard of the same write door as a built-in', () => {
    // The pre-0.2.2 limitation this removes: a plugin type outside the hardcoded
    // seven had NO restore path at all.
    const upsert = vi.fn(() => ({ entity: { slug: 's1' }, op: 'updated' as const }));
    const writer = new HostEntityWriter(hostWith({ spreadsheet: { upsert } }), tags);
    expect(writer.upsert('spreadsheet', 's1', {}, 'agent')?.op).toBe('updated');
  });

  it('normalizes a legacy per-type payload key structurally, without naming it', () => {
    // `database-table` ships externally and still returns `.dbTable`. The rule is
    // "the single key that is not op/warnings", not an allowlist of key names.
    const upsert = vi.fn(() => ({ dbTable: { slug: 'users' }, op: 'created' as const }));
    const writer = new HostEntityWriter(hostWith({ 'database-table': { upsert } }), tags);
    expect(writer.upsert('database-table', 'users', {}, 'user')).toEqual({
      entity: { slug: 'users' },
      op: 'created',
    });
  });

  it('passes warnings through', () => {
    const upsert = () => ({ uiView: { slug: 'v' }, op: 'updated' as const, warnings: ['dangling'] });
    const writer = new HostEntityWriter(hostWith({ 'ui-view': { upsert } }), tags);
    expect(writer.upsert('ui-view', 'v', {}, 'user')).toEqual({
      entity: { slug: 'v' },
      op: 'updated',
      warnings: ['dangling'],
    });
  });

  it('surfaces the whole object when the payload key is ambiguous', () => {
    const upsert = () => ({ a: 1, b: 2, op: 'created' as const });
    const writer = new HostEntityWriter(hostWith({ odd: { upsert } }), tags);
    // Better an inspectable object than a silently-wrong arbitrary pick.
    expect(writer.upsert('odd', 'x', {}, 'user')?.entity).toEqual({ a: 1, b: 2, op: 'created' });
  });

  it('honours capture: false on the index-rebuild path', () => {
    const upsert = vi.fn(() => ({ entity: {}, op: 'created' as const }));
    const writer = new HostEntityWriter(hostWith({ ac: { upsert } }), tags, { capture: false });
    writer.upsert('ac', 'a', {}, 'user');
    expect(upsert).toHaveBeenCalledWith('a', {}, 'user', { capture: false, writeFile: false });
  });

  it('returns null — a reported SKIP, not a throw — when the type has no service', () => {
    const writer = new HostEntityWriter(hostWith({}), tags);
    expect(writer.upsert('ghost', 'g', {}, 'user')).toBeNull();
  });

  it('returns null when the service exists but exposes no upsert facade', () => {
    const writer = new HostEntityWriter(hostWith({ readonly: { getBySlug: () => null } }), tags);
    expect(writer.upsert('readonly', 'r', {}, 'user')).toBeNull();
  });
});

describe('HostEntityWriter — deprecated per-type shims', () => {
  it('delegates to the generic path', () => {
    const upsert = vi.fn(() => ({ entity: { slug: 'e1' }, op: 'created' as const }));
    const writer = new HostEntityWriter(hostWith({ endpoint: { upsert } }), tags);
    expect(writer.upsertEndpoint('e1', {} as never, 'user').op).toBe('created');
    expect(upsert).toHaveBeenCalledOnce();
  });

  it('still THROWS on a missing service, unlike the generic path', () => {
    // Their callers are pre-0.2.2 restore slots with no null branch: handing them
    // null would read as "written" and lose the entity silently.
    const writer = new HostEntityWriter(hostWith({}), tags);
    expect(() => writer.upsertDatabaseTable('t', {} as never, 'user')).toThrow(DomainError);
  });
});

describe('HostEntityWriter.delete — generic, no per-type switch', () => {
  it('deletes through the resolved service', () => {
    const remove = vi.fn();
    const writer = new HostEntityWriter(
      hostWith({ widget: { getBySlug: () => ({ slug: 'a' }), remove } }),
      tags,
    );
    expect(writer.delete('widget' as never, 'a', 'user')).toEqual({ deleted: true });
    expect(remove).toHaveBeenCalledWith('a', 'user');
  });

  it('reports deleted:false for an absent row', () => {
    const writer = new HostEntityWriter(
      hostWith({ widget: { getBySlug: () => null, remove: vi.fn() } }),
      tags,
    );
    expect(writer.delete('widget' as never, 'missing', 'user')).toEqual({ deleted: false });
  });

  it('reports deleted:false — never throws — for a type with no service', () => {
    const writer = new HostEntityWriter(hostWith({}), tags);
    expect(writer.delete('ghost' as never, 'g', 'user')).toEqual({ deleted: false });
  });
});

describe('HostEntityWriter.syncEndpointDtos', () => {
  it('warns instead of throwing when the endpoint service is absent', () => {
    const writer = new HostEntityWriter(hostWith({}), tags);
    const result = writer.syncEndpointDtos('e', []);
    expect(result).toEqual({
      linked: 0,
      unlinked: 0,
      warnings: [`entity service for type 'endpoint' not registered`],
    });
  });

  it('links missing and unlinks extras, idempotently', () => {
    const linkDto = vi.fn();
    const unlinkDto = vi.fn();
    const writer = new HostEntityWriter(
      hostWith({
        endpoint: {
          getBySlug: () => ({
            dtos: [{ dtoSlug: 'stale', relation: 'response', statusCode: 200 }],
          }),
          linkDto,
          unlinkDto,
        },
      }),
      tags,
    );

    const result = writer.syncEndpointDtos('e', [
      { dtoSlug: 'wanted', relation: 'request' as never, statusCode: null },
    ]);

    expect(result).toMatchObject({ linked: 1, unlinked: 1, warnings: [] });
    // Unlink runs FIRST so a UNIQUE constraint can't reject the new link.
    expect(unlinkDto.mock.invocationCallOrder[0]).toBeLessThan(linkDto.mock.invocationCallOrder[0]!);
  });
});
