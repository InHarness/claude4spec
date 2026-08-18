import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { entitiesRouter } from './entities-router.js';
import type { ProjectPluginHost } from './types.js';
import type { DiscoveryCore } from '../../discovery/types.js';
import type { VersionService } from '../../services/versions.js';
import type { TagsService } from '../../services/tags.js';
import type { EntityStore } from '../../services/entity-store.js';
import type { RawEntityReader } from '../../discovery/raw-entity-reader.js';
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

  function app(opts: {
    getVersion: VersionService['getVersion'];
    diff: ProjectPluginHost['diff'];
    module?: unknown;
  }) {
    const host = {
      getAvailable: () => true,
      entityExists: () => true,
      diff: opts.diff,
      // 0.2.9: the route resolves the module to upgrade both captures to the
      // current payload shape before diffing. `opts.module` omitted = a host that
      // knows no module, which upgrades nothing.
      getEntity: () => opts.module ?? null,
    } as unknown as ProjectPluginHost;
    const versions = { getVersion: opts.getVersion } as unknown as VersionService;
    const tags = {} as unknown as TagsService;
    const store = {} as unknown as EntityStore;
    const reader = {} as unknown as RawEntityReader;
    // This suite exercises the version-diff routes; the collection routes are
    // covered in `discovery/ops/collections.test.ts` against a real core.
    const discovery = {} as unknown as DiscoveryCore;
    const router = entitiesRouter(host, tags, versions, store, reader, discovery);
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
      op: 'updated',
      changes: [{ op: 'field_changed', path: 'name', from: 'a', to: 'b' }],
    });
    const server = app({
      getVersion: (_t, _s, v) => (v === 1 ? detail(1, { name: 'a' }) : detail(2, { name: 'b' })),
      diff,
    });
    const res = await request(server).get('/api/entities/endpoint/my-slug/versions/1/diff/2');
    expect(res.status).toBe(200);
    // 0.2.31 — no `slug` argument: the delta carries no identity, so the route
    // that paired the two captures is the one that names the entity.
    expect(diff).toHaveBeenCalledWith('endpoint', { name: 'a' }, { name: 'b' });
    expect(res.body).toEqual({
      type: 'endpoint',
      slug: 'my-slug',
      op: 'updated',
      changes: [{ op: 'field_changed', path: 'name', from: 'a', to: 'b' }],
    });
  });

  it('sends an empty changes list for a noop rather than omitting the key', async () => {
    const diff = vi.fn().mockReturnValue({ op: 'noop', changes: [] });
    const server = app({
      getVersion: (_t, _s, v) => detail(v, { name: 'same' }),
      diff,
    });
    const res = await request(server).get('/api/entities/endpoint/my-slug/versions/1/diff/2');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ type: 'endpoint', slug: 'my-slug', op: 'noop', changes: [] });
  });

  it('flags _serializerVersionMismatch when the two captured versions span a serializer upgrade', async () => {
    const diff = vi
      .fn()
      .mockReturnValue({ op: 'updated', changes: [{ op: 'tag_added', tag: 'x' }] });
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
      op: 'updated',
      changes: [{ op: 'tag_added', tag: 'x' }],
      _serializerVersionMismatch: { type: 'endpoint', from: '1.0.0', to: '1.1.0' },
    });
  });

  it('omits _serializerVersionMismatch when both versions share the same serializer version', async () => {
    const diff = vi
      .fn()
      .mockReturnValue({ op: 'updated', changes: [{ op: 'tag_added', tag: 'x' }] });
    const server = app({
      getVersion: (_t, _s, v) => detail(v, { name: v === 1 ? 'a' : 'b' }, '1.0.0'),
      diff,
    });
    const res = await request(server).get('/api/entities/endpoint/my-slug/versions/1/diff/2');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: 'endpoint',
      slug: 'my-slug',
      op: 'updated',
      changes: [{ op: 'tag_added', tag: 'x' }],
    });
  });

  /**
   * The fourth reader of `entity_version.data`, and the one that was missed.
   *
   * `ReleaseService` (restore and diff) and `VersionService` all upgrade their
   * captures; this route fed raw ones to `host.diff`. Two captures either side of
   * a `payloadVersion` bump describe the same entity in different SPELLINGS, so
   * the diff reported edits nobody made — and `samePayloadVersion` deliberately
   * suppresses the "schema bump" badge across the vocabulary change, so nothing
   * on screen explained where they came from.
   */
  it('upgrades BOTH captures to the current payload shape before diffing', async () => {
    const diff = vi.fn().mockReturnValue({ op: 'noop', changes: [] });
    const server = app({
      // v1 spelled it `legacy`; v2 spells it `current`.
      getVersion: (_t, _s, v) =>
        v === 1 ? detail(1, { legacy: 'x' }, '1') : detail(2, { current: 'x' }, '2'),
      diff,
      module: {
        type: 'endpoint',
        payloadVersion: 2,
        payloadUpgrades: [
          (p: unknown) => ({ current: (p as { legacy: string }).legacy }),
        ],
      },
    });

    const res = await request(server).get('/api/entities/endpoint/my-slug/versions/1/diff/2');
    expect(res.status).toBe(200);
    // The v1 capture reaches `diff` already migrated, so both sides are the same
    // shape and the entity reads as unchanged — which it is.
    expect(diff).toHaveBeenCalledWith('endpoint', { current: 'x' }, { current: 'x' });
    expect(res.body.op).toBe('noop');
  });
});
