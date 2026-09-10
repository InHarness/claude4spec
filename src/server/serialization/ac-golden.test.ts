/**
 * L9 byte-identity gate for `ac`.
 *
 * The acceptance criterion for moving `ac` into the `c4s-plugin-ac` envelope is
 * that serialization stays BYTE-identical — same snapshot shape, same record
 * shape, same attribute order — because every registration path ends in the same
 * registry slot, and a release cut before the move must diff clean against one
 * cut after it.
 *
 * Sibling of `frontend-mockups-golden.test.ts` / `api-contracts-golden.test.ts`,
 * written for the same reason and captured the same way: against the
 * host-registered module, BEFORE the code moves, so the very same file is what
 * proves the move was inert. It drives the fixture through REST, which is
 * registration-path agnostic, so the test does not move with the module.
 *
 * Fixtures deliberately include the shapes most likely to be normalized away:
 * an empty `verifies[]`, a verify pointing at a slug that does not exist
 * (`onMissing: 'warn'` / `onDelete: 'leave-dangling'` — a dangling ref must
 * survive serialization rather than being scrubbed), a verify pointing at a TYPE
 * the host has never heard of (the polymorphic `ref: '$type'` arm), both `kind`
 * arms, both `status` arms, a `verifies[]` authored in a shuffled order (the
 * collection is `unordered`, so two ACs verifying the same set must snapshot
 * identically), and a `title` at the full 500-character bound.
 */

import { compositionOf } from '../../shared/plugin-host/composition.js';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../../../tests/helpers/test-app.js';
import { canonicalize } from './snapshot.js';
import { genericEntity } from './generic.js';

const GOLDEN_DIR = path.join(import.meta.dirname, '__goldens__');

/**
 * Built through REST, not through `requireService` — `ac` registers no service
 * (tier K deleted `AcService`), and the generated `/api/acs` routes are the
 * write door.
 *
 * Slugs are passed EXPLICITLY: the golden compares by slug, and slugified prose
 * would make the golden's keys hostage to the slug grammar rather than to
 * serialization, which is what this file is about.
 */
async function buildFixture() {
  const app = await createTestApp();
  const post = async (p: string, body: unknown) => {
    const res = await request(app.app).post(p).send(body);
    if (res.status !== 201) {
      throw new Error(`fixture: POST ${p} → ${res.status} ${JSON.stringify(res.body)}`);
    }
  };

  // A diagram to be the one verify target that actually resolves. `diagram` is
  // the type that STAYS built in directly, so it is available on every
  // registration path this golden might be run under.
  await post('/api/diagrams', {
    slug: 'flow-checkout',
    title: 'FlowCheckout',
    source: 'graph TD; a-->b;',
  });

  // The ordinary shape: a requirement, active, one resolvable verify.
  await post('/api/acs', {
    slug: 'ac-koszyk-sumuje-pozycje',
    title: 'Koszyk sumuje pozycje i pokazuje wynik w nagłówku.',
    kind: 'requirement',
    status: 'active',
    verifies: [{ type: 'diagram', slug: 'flow-checkout' }],
  });

  // Empty collection: `verifies: []` must not collapse to undefined.
  await post('/api/acs', {
    slug: 'ac-bez-powiazan',
    title: 'Kryterium bez powiązań.',
    kind: 'edge-case',
    verifies: [],
  });

  /**
   * TWO dangling arms in one entity.
   *
   * `never-existed` is a slug of a REGISTERED type that has no such entity;
   * `not-a-type` is a type the host has never heard of, which the polymorphic
   * `ref: '$type'` permits. `onMissing: 'warn'` / `onDelete: 'leave-dangling'`
   * mean both are kept as authored — a serializer that scrubbed unresolvable
   * refs would silently drop them, and this is the fixture that says so.
   */
  await post('/api/acs', {
    slug: 'ac-wiszace-referencje',
    title: 'Kryterium wskazujące na to, czego nie ma.',
    status: 'deprecated',
    verifies: [
      { type: 'diagram', slug: 'never-existed' },
      { type: 'not-a-type', slug: 'whatever' },
    ],
  });

  /**
   * The `unordered: true` arm. Same SET as the entity above, authored in the
   * reverse order — the two must snapshot to the same `verifies` sequence, or
   * the collection is not unordered in practice.
   */
  await post('/api/acs', {
    slug: 'ac-te-same-referencje-inna-kolejnosc',
    title: 'Te same referencje, odwrotna kolejność zapisu.',
    status: 'deprecated',
    verifies: [
      { type: 'not-a-type', slug: 'whatever' },
      { type: 'diagram', slug: 'never-existed' },
    ],
  });

  // The full 500-character bound — the width the type widened to in 0.2.51, and
  // the one a transport must not truncate.
  await post('/api/acs', {
    slug: 'ac-tytul-na-pelnej-granicy',
    title: 'x'.repeat(500),
    verifies: [],
  });

  return app;
}

function projections(app: Awaited<ReturnType<typeof buildFixture>>) {
  const reader = app.rawReader;
  const out: Record<string, unknown> = {};

  const type = 'ac';
  const module = app.host.getEntity(type);
  if (!module) throw new Error(`fixture: type '${type}' is not registered`);
  const slugs = (
    app.db
      .prepare(`SELECT slug FROM ${compositionOf(module).mainTable} ORDER BY slug`)
      .all() as Array<{ slug: string }>
  ).map((r) => r.slug);

  out[`${type}.payloadVersion`] = module.payloadVersion;
  for (const slug of slugs) {
    const raw = app.rawReader.getEntity(type, slug);
    if (!raw) throw new Error(`fixture: ${type} '${slug}' vanished`);

    // The stamp envelope is wall-clock, so it is stripped rather than golden'd;
    // its presence is covered by `snapshot-parity`.
    const { createdAt: _c, updatedAt: _u, ...snap } = app.host.snapshot(type, raw, reader) as Record<
      string,
      unknown
    >;
    out[`${type}/${slug}/snapshot`] = canonicalize(snap);
    // NOT canonicalized: a record is handed to the client as-is, so its key
    // order is part of the contract in a way the snapshot's is not. The SCHEMA
    // and the READER are passed exactly as `SerializationEngine` passes them.
    out[`${type}/${slug}/record`] = genericEntity(raw, module.data?.schema, reader);
  }
  return out;
}

describe('L9 serialization goldens — ac', () => {
  it('matches the committed goldens byte for byte', async () => {
    const app = await buildFixture();
    try {
      const actual = JSON.stringify(projections(app), null, 2) + '\n';
      const file = path.join(GOLDEN_DIR, 'ac.json');

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
