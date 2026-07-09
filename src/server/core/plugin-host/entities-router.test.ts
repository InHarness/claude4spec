import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { entitiesRouter } from './entities-router.js';
import type { ProjectPluginHost } from './types.js';
import type { VersionService } from '../../services/versions.js';
import type { TagsService } from '../../services/tags.js';
import type { EntityStore } from '../../services/entity-store.js';
import type { RawEntityReader } from '../../domain/raw-entity-reader.js';
import type { VersionDetail } from '../../../shared/entities.js';

/**
 * M13/M34: `GET /:type/:slug/versions/:from/diff/:to` — only exercises the
 * new route; other `entitiesRouter` deps are unused stubs (mirrors
 * config.route.test.ts's minimal-stub style).
 */
describe('GET /:type/:slug/versions/:from/diff/:to', () => {
  const detail = (version: number, data: unknown, serializerVersion?: string | null): VersionDetail => ({
    entityType: 'endpoint',
    entitySlug: 'my-slug',
    version,
    data,
    changedBy: 'user',
    changeSummary: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...(serializerVersion !== undefined ? { serializerVersion } : {}),
  });

  function app(opts: { getVersion: VersionService['getVersion']; diff: ProjectPluginHost['diff'] }) {
    const host = {
      getAvailable: () => true,
      entityExists: () => true,
      diff: opts.diff,
    } as unknown as ProjectPluginHost;
    const versions = { getVersion: opts.getVersion } as unknown as VersionService;
    const tags = {} as unknown as TagsService;
    const store = {} as unknown as EntityStore;
    const reader = {} as unknown as RawEntityReader;
    const router = entitiesRouter(host, tags, versions, store, reader);
    return express().use(express.json()).use('/api/entities', router);
  }

  it('404s when the "from" version does not exist', async () => {
    const server = app({
      getVersion: (_t, _s, v) => (v === 1 ? detail(1, { a: 1 }) : null),
      diff: vi.fn(),
    });
    const res = await request(server).get('/api/entities/endpoint/my-slug/versions/2/diff/1');
    expect(res.status).toBe(404);
  });

  it('404s when the "to" version does not exist', async () => {
    const server = app({
      getVersion: (_t, _s, v) => (v === 1 ? detail(1, { a: 1 }) : null),
      diff: vi.fn(),
    });
    const res = await request(server).get('/api/entities/endpoint/my-slug/versions/1/diff/2');
    expect(res.status).toBe(404);
  });

  it('fetches both versions and passes their .data to host.diff in (from, to) order', async () => {
    const diff = vi.fn().mockReturnValue({
      type: 'endpoint',
      slug: 'my-slug',
      op: 'modified',
      raw: { added: {}, removed: {}, changed: { 'name': { from: 'a', to: 'b' } } },
    });
    const server = app({
      getVersion: (_t, _s, v) => (v === 1 ? detail(1, { name: 'a' }) : detail(2, { name: 'b' })),
      diff,
    });
    const res = await request(server).get('/api/entities/endpoint/my-slug/versions/1/diff/2');
    expect(res.status).toBe(200);
    expect(diff).toHaveBeenCalledWith('endpoint', { name: 'a' }, { name: 'b' }, 'my-slug');
    expect(res.body).toEqual({
      type: 'endpoint',
      slug: 'my-slug',
      op: 'modified',
      raw: { added: {}, removed: {}, changed: { name: { from: 'a', to: 'b' } } },
    });
  });

  it('omits changes/raw from the response when host.diff does not return them (noop)', async () => {
    const diff = vi.fn().mockReturnValue({ type: 'endpoint', slug: 'my-slug', op: 'noop' });
    const server = app({
      getVersion: (_t, _s, v) => detail(v, { name: 'same' }),
      diff,
    });
    const res = await request(server).get('/api/entities/endpoint/my-slug/versions/1/diff/2');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ type: 'endpoint', slug: 'my-slug', op: 'noop' });
  });

  it('flags _serializerVersionMismatch when the two captured versions span a serializer upgrade', async () => {
    const diff = vi.fn().mockReturnValue({ type: 'endpoint', slug: 'my-slug', op: 'modified', changes: { x: 1 } });
    const server = app({
      getVersion: (_t, _s, v) =>
        v === 1 ? detail(1, { name: 'a' }, '1.0.0') : detail(2, { name: 'b' }, '1.1.0'),
      diff,
    });
    const res = await request(server).get('/api/entities/endpoint/my-slug/versions/1/diff/2');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: 'endpoint',
      slug: 'my-slug',
      op: 'modified',
      changes: { x: 1 },
      _serializerVersionMismatch: { type: 'endpoint', from: '1.0.0', to: '1.1.0' },
    });
  });

  it('omits _serializerVersionMismatch when both versions share the same serializer version', async () => {
    const diff = vi.fn().mockReturnValue({ type: 'endpoint', slug: 'my-slug', op: 'modified', changes: { x: 1 } });
    const server = app({
      getVersion: (_t, _s, v) => detail(v, { name: v === 1 ? 'a' : 'b' }, '1.0.0'),
      diff,
    });
    const res = await request(server).get('/api/entities/endpoint/my-slug/versions/1/diff/2');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ type: 'endpoint', slug: 'my-slug', op: 'modified', changes: { x: 1 } });
  });
});
