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
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../../../tests/helpers/test-app.js';
import { canonicalize } from './snapshot.js';
import type { ViewKind, ViewSet } from './types.js';

const GOLDEN_DIR = path.join(import.meta.dirname, '__goldens__');
const VIEWS: ViewKind[] = [
  'inline_mention',
  'single_element',
  'element_list_item',
  'tagged_list_item',
  'detail',
];

type Upsertable = {
  upsert(slug: string, input: unknown, actor: string): unknown;
  linkDto?(endpointSlug: string, dtoSlug: string, relation: string, statusCode?: number | null): void;
};

async function buildFixture() {
  const app = await createTestApp();
  const dto = app.host.requireService('dto') as Upsertable;
  const endpoint = app.host.requireService('endpoint') as Upsertable;

  dto.upsert(
    'user-dto',
    {
      name: 'UserDto',
      description: 'A user',
      fields: [
        { name: 'id', type: 'string', required: true },
        { name: 'email', type: 'string', required: false, description: 'contact' },
      ],
      examples: [{ name: 'minimal', value: { id: '1', email: null } }],
    },
    'user',
  );
  // Unicode + diacritics in the CONTENT (slugs are ASCII kebab by contract) —
  // any re-encoding on the way through the move shows up here.
  dto.upsert(
    'order-dto',
    { name: 'ZamówienieDto', description: 'Zamówienie — pozycja', fields: [{ name: 'nr', type: 'number' }] },
    'user',
  );
  dto.upsert('error-dto', { name: 'ErrorDto', fields: [{ name: 'message', type: 'string' }] }, 'user');

  endpoint.upsert('get-users', { method: 'GET', path: '/users', summary: 'List users' }, 'user');
  endpoint.linkDto?.('get-users', 'user-dto', 'response', 200);
  endpoint.linkDto?.('get-users', 'error-dto', 'response', 404);
  // relation with a NULL status_code — the column is nullable and the sort key
  // includes it, so a coercion to 0 or '' would reorder the snapshot.
  endpoint.linkDto?.('get-users', 'order-dto', 'request', null);

  // No links at all: `linked_dtos: []` must not collapse to undefined.
  endpoint.upsert('post-ping', { method: 'POST', path: '/ping', summary: '' }, 'user');

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

      out[`${type}/${slug}/snapshot`] = canonicalize(
        (serializer.snapshot as (e: unknown, r: unknown) => unknown)(raw, reader),
      );
      for (const view of VIEWS) {
        const fn = views?.[view];
        // NOT canonicalized: view projections are handed to the client as-is, so
        // their key order is part of the contract in a way the snapshot's is not.
        out[`${type}/${slug}/${view}`] = fn ? fn(raw, reader) : null;
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
