/**
 * L9 byte-identity gate for `endpoint` and `dto`.
 *
 * The brief's acceptance criterion for moving these two types into the
 * `c4s-plugin-api-contracts` envelope is that serialization stays BYTE-identical
 * — same serializer, same attribute order, same `snapshot()` shape — because
 * every registration path ends in the same registry slot and a release cut
 * before the move must diff clean against one cut after it.
 *
 * So the goldens are captured here, against the host-registered modules, BEFORE
 * the code moves. The envelope's own suite asserts the same bytes afterwards.
 * If a "cleanup" during the move touches an expression like
 * `((entity.data.summary as string) ?? '') || null`, this is what catches it.
 *
 * Fixtures deliberately include the shapes most likely to be normalized away:
 * a NULL status_code, an endpoint with no links at all, a unicode slug, a DTO
 * carrying examples, and every one of the five view projections.
 */

import { compositionOf } from '../../shared/plugin-host/composition.js';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../../../tests/helpers/test-app.js';
import { canonicalize } from './snapshot.js';
import { genericEntity } from './generic.js';
import type { ViewKind, ViewSet } from './types.js';

const GOLDEN_DIR = path.join(import.meta.dirname, '__goldens__');
const VIEWS: ViewKind[] = [
  'inline_mention',
  'single_element',
  'element_list_item',
  'tagged_list_item',
  'detail',
];

/**
 * 2.0.0 tier K — built through REST, not through `requireService`.
 *
 * Neither type registers a service any more; the generated `/api/{type}s`
 * routes are the write door, and driving the fixture through them is also
 * closer to what produced these goldens in the first place. Slugs are passed
 * EXPLICITLY: the golden compares by slug, and two of these names do not
 * slugify to the name the golden knows (`ZamówienieDto` → `order-dto`).
 */
async function buildFixture() {
  const app = await createTestApp();
  const post = async (path: string, body: unknown) => {
    const res = await request(app.app).post(path).send(body);
    if (res.status !== 201) {
      throw new Error(`fixture: POST ${path} → ${res.status} ${JSON.stringify(res.body)}`);
    }
  };

  await post('/api/dtos', {
    slug: 'user-dto',
    title: 'UserDto',
    description: 'A user',
    fields: [
      { name: 'id', type: 'string', required: true },
      { name: 'email', type: 'string', required: false, description: 'contact' },
    ],
    examples: [{ name: 'minimal', value: { id: '1', email: null } }],
  });
  // Unicode + diacritics in the CONTENT (slugs are ASCII kebab by contract) —
  // any re-encoding on the way through the move shows up here.
  await post('/api/dtos', {
    slug: 'order-dto',
    title: 'ZamówienieDto',
    description: 'Zamówienie — pozycja',
    // `required` is now MANDATORY on the REST path — the retired router validated
    // nothing, so these two fixtures could omit it. See the declaration.
    fields: [{ name: 'nr', type: 'number', required: false }],
  });
  await post('/api/dtos', {
    slug: 'error-dto',
    title: 'ErrorDto',
    fields: [{ name: 'message', type: 'string', required: false }],
  });

  await post('/api/endpoints', {
    slug: 'get-users',
    method: 'GET',
    path: '/users',
    summary: 'List users',
  });
  await post('/api/endpoints/get-users/dtos', { dtoSlug: 'user-dto', relation: 'response', statusCode: 200 });
  await post('/api/endpoints/get-users/dtos', { dtoSlug: 'error-dto', relation: 'response', statusCode: 404 });
  // relation with a NULL status_code — the column is nullable and the sort key
  // includes it, so a coercion to 0 or '' would reorder the snapshot.
  await post('/api/endpoints/get-users/dtos', { dtoSlug: 'order-dto', relation: 'request', statusCode: null });

  // No links at all: `linked_dtos: []` must not collapse to undefined.
  await post('/api/endpoints', { slug: 'post-ping', method: 'POST', path: '/ping', summary: '' });

  return app;
}

function projections(app: Awaited<ReturnType<typeof buildFixture>>) {
  const reader = app.rawReader;
  const out: Record<string, unknown> = {};

  for (const type of ['endpoint', 'dto']) {
    const module = app.host.getEntity(type);
    if (!module) throw new Error(`fixture: type '${type}' is not registered`);
    const serializer = module.serializer as Record<string, unknown>;
    const views = serializer.views as ViewSet<unknown> | undefined;
    const slugs = (
      app.db.prepare(`SELECT slug FROM ${compositionOf(module).mainTable} ORDER BY slug`).all() as Array<{ slug: string }>
    ).map((r) => r.slug);

    out[`${type}.payloadVersion`] = module.payloadVersion;
    for (const slug of slugs) {
      const raw = app.rawReader.getEntity(type, slug);
      if (!raw) throw new Error(`fixture: ${type} '${slug}' vanished`);

      /**
       * 0.2.9 — through `host.snapshot`, because there is no per-type slot left
       * to call. The envelope it attaches is wall-clock, so it is stripped
       * rather than golden'd; its presence is covered by `snapshot-parity`.
       */
      const { createdAt: _c, updatedAt: _u, ...snap } = app.host.snapshot(type, raw, reader) as Record<
        string,
        unknown
      >;
      out[`${type}/${slug}/snapshot`] = canonicalize(snap);
      for (const view of VIEWS) {
        const fn = views?.[view];
        /**
         * 2.0.0 tier K — falls back to `genericEntity` instead of recording
         * `null`.
         *
         * The golden's job is "what does a client receive for this view", and
         * that answer does not become empty when a type stops COMPUTING the
         * view — the host shapes the row instead, and the client is served
         * either way. Recording `null` would have quietly turned item 57's view
         * collapse (five computed views down to two) into 175 deleted lines of
         * coverage for shapes that are still very much on the wire.
         *
         * The SCHEMA is passed, as `SerializationEngine` does. Without it
         * `genericEntity` short-circuits its column→field re-keying, so the
         * golden recorded a snake_case shape the engine never emits — and a
         * regression in `byFieldName` (the very bug the tier-L fixture exists to
         * catch) would have left every golden green.
         *
         * NOT canonicalized: view projections are handed to the client as-is, so
         * their key order is part of the contract in a way the snapshot's is not.
         */
        out[`${type}/${slug}/${view}`] = fn
          ? fn(raw, reader)
          : genericEntity(raw, view, module.data?.schema);
      }
    }
  }
  return out;
}

describe('L9 serialization goldens — endpoint + dto', () => {
  it('matches the committed goldens byte for byte', async () => {
    const app = await buildFixture();
    try {
      const actual = JSON.stringify(projections(app), null, 2) + '\n';
      const file = path.join(GOLDEN_DIR, 'api-contracts.json');

      if (process.env.UPDATE_GOLDENS === '1') {
        fs.mkdirSync(GOLDEN_DIR, { recursive: true });
        fs.writeFileSync(file, actual);
      }
      expect(fs.readFileSync(file, 'utf-8')).toBe(actual);
    } finally {
      app.cleanup();
    }
  });
});
