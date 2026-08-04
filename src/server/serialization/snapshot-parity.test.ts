/**
 * The gate for tier B PR2: what a type's snapshot LOOKS LIKE must not change
 * when the host starts generating it.
 *
 * Six hand-written `snapshot` implementations are being replaced by one derived
 * from `data.schema`. The derived one is keyed by DECLARED FIELD NAMES, and the
 * whole bet of this commit is that five of the six already emit exactly that —
 * so the entity files on disk do not move, and a release cut before the change
 * diffs clean against one cut after it.
 *
 * A bet is not an argument, so this file is the proof. The golden is captured
 * BEFORE the generator exists, through `host.snapshot` — the chokepoint both the
 * old dispatch and the new one go through — and must still match afterwards.
 * `endpoint` is the one type expected to move (it leaks junction COLUMN
 * spellings, `linked_dtos`/`dto_slug`/`status_code`, into the file, and coerces
 * `summary: '' → null` against its own declaration); its golden diff IS the
 * reviewable artifact of the `payloadVersion: 1 → 2` migration, which is why it
 * is captured here beside the five that must not move rather than trusted to a
 * reviewer's eye on a 3000-line diff.
 *
 * Regenerate deliberately, never reflexively: `UPDATE_GOLDENS=1 npx vitest run
 * src/server/serialization/snapshot-parity.test.ts`. A diff in any of the five
 * unbumped types means an entity file shape changed with no upgrade chain to
 * carry it — data loss on the next rebuild, not a stale fixture.
 */

import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.js';
import { compositionOf } from '../../shared/plugin-host/composition.js';
import { canonicalize } from './snapshot.js';

const GOLDEN = path.join(import.meta.dirname, '__goldens__', 'snapshot-parity.json');

/** Every type with a `data.schema`, in the order their snapshots are captured. */
const TYPES = ['ac', 'design-system', 'diagram', 'dto', 'endpoint', 'ui-view'] as const;

/**
 * Seeded through the REST surface rather than the services, so the fixture goes
 * through the same validation, slug allocation and junction writes a user's
 * create does. Shapes are picked for what normalizes away silently: an embedded
 * value collection with a ref (`ac.verifies`), a nested collection whose item
 * order is AUTHORED and must not be sorted (`design-system.groups[].tokens`), a
 * `clearable` field left unset (`ui-view.designSystemSlug`), an enum on its
 * default (`diagram.format`), a transient input (`diagram.caption`), a NULL
 * `status_code` in the junction, and an endpoint with no links at all.
 */
async function seed(t: TestApp): Promise<void> {
  const post = async (url: string, body: unknown) => {
    const res = await request(t.app).post(url).send(body);
    expect(res.status, `${url}: ${JSON.stringify(res.body)}`).toBeLessThan(400);
    return res.body as { slug: string };
  };

  const userDto = await post('/api/dtos', {
    name: 'UserDto',
    description: 'A user',
    fields: [
      { name: 'id', type: 'string', required: true },
      { name: 'email', type: 'string', required: false, description: 'contact' },
    ],
    examples: [{ name: 'minimal', value: { id: '1', email: null } }],
  });
  // Unicode in the CONTENT (slugs are ASCII kebab by contract) — a re-encoding
  // on the way through the generator shows up here and nowhere else.
  const orderDto = await post('/api/dtos', {
    name: 'ZamówienieDto',
    description: 'Zamówienie — pozycja',
    fields: [{ name: 'nr', type: 'number' }],
  });
  const errorDto = await post('/api/dtos', {
    name: 'ErrorDto',
    fields: [{ name: 'message', type: 'string' }],
  });

  const endpoint = await post('/api/endpoints', {
    method: 'GET',
    path: '/api/users',
    summary: 'List users',
    tags: ['alpha'],
  });
  for (const [dto, relation, statusCode] of [
    [userDto.slug, 'response', 200],
    [errorDto.slug, 'response', 404],
    // A NULL status_code: the column is nullable and it is part of the sort key,
    // so a coercion to 0 or '' would silently reorder the snapshot.
    [orderDto.slug, 'request', null],
  ] as const) {
    await post(`/api/endpoints/${endpoint.slug}/dtos`, { dtoSlug: dto, relation, statusCode });
  }
  // No links at all — `linkedDtos: []` must not collapse to undefined.
  await post('/api/endpoints', { method: 'POST', path: '/api/ping', summary: '' });

  const ac = await post('/api/acs', { text: 'the list is ordered', description: 'sorted by name' });
  // `verifies` is a value collection of polymorphic refs, and the one array the
  // brief names as needing a stable sort. Written out of order on purpose.
  const verified = await request(t.app)
    .patch(`/api/acs/${ac.slug}`)
    .send({
      verifies: [
        { type: 'endpoint', slug: endpoint.slug },
        { type: 'dto', slug: userDto.slug },
        { type: 'dto', slug: errorDto.slug },
      ],
    });
  expect(verified.status, JSON.stringify(verified.body)).toBe(200);
  expect(verified.body.verifies, 'fixture: verifies did not land').toHaveLength(3);

  await post('/api/ui-views', {
    name: 'Users',
    url: '/users/:id',
    params: [{ name: 'id', in: 'path' }],
  });

  await post('/api/design-systems', {
    name: 'Smoke DS',
    groups: [
      {
        name: 'Core',
        tier: 'primitive',
        // Scale order is MEANINGFUL and must survive verbatim. Alphabetically
        // this is xl, md, sm — so a blanket "sort every array" reorders it.
        tokens: [
          { name: 'sm', type: 'dimension', value: '4px' },
          { name: 'md', type: 'dimension', value: '8px' },
          { name: 'xl', type: 'dimension', value: '16px' },
        ],
      },
    ],
  });

  await post('/api/diagrams', { source: 'graph TD; A-->B;', caption: 'Flow' });
}

function capture(t: TestApp): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const type of TYPES) {
    const module = t.host.getEntity(type);
    if (!module) throw new Error(`fixture: type '${type}' is not registered`);
    out[`${type}.payloadVersion`] = module.payloadVersion;

    const slugs = (
      t.db
        .prepare(`SELECT slug FROM ${compositionOf(module).mainTable} ORDER BY slug`)
        .all() as Array<{ slug: string }>
    ).map((r) => r.slug);
    expect(slugs.length, `fixture: no ${type} rows`).toBeGreaterThan(0);

    for (const slug of slugs) {
      const raw = t.rawReader.getEntity(type, slug);
      if (!raw) throw new Error(`fixture: ${type} '${slug}' vanished`);
      /**
       * Through the CHOKEPOINT, not through `module.serializer.snapshot`. The
       * per-type slot is what this tier deletes; `host.snapshot` is the surface
       * that has to keep answering the same bytes across the deletion, and it is
       * also what attaches the `createdAt`/`updatedAt` envelope — so capturing
       * below it would exclude the envelope from the gate.
       */
      const snap = t.host.snapshot(type, raw, t.rawReader) as Record<string, unknown>;
      // The stamp is wall-clock, so it cannot be a golden. Its PRESENCE can.
      const { createdAt, updatedAt, ...rest } = snap;
      out[`${type}/${slug}`] = canonicalize(rest);
      out[`${type}/${slug}/_stamped`] = typeof createdAt === 'string' && typeof updatedAt === 'string';
    }
  }
  return out;
}

describe('snapshot parity across the generated-snapshot cutover', () => {
  it('every type still emits the committed snapshot shape', async () => {
    const t = await createTestApp();
    try {
      await seed(t);
      const actual = JSON.stringify(capture(t), null, 2) + '\n';

      if (process.env.UPDATE_GOLDENS === '1') {
        fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
        fs.writeFileSync(GOLDEN, actual);
      }
      expect(fs.readFileSync(GOLDEN, 'utf-8')).toBe(actual);
    } finally {
      t.cleanup();
    }
  });
});
