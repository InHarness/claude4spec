import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from '../../helpers/test-app.js';
import { canonicalize } from '../../../src/server/serialization/snapshot.js';

describe('entity snapshot serialization', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  it('[ac:ac-dwa-kolejne-snapshot-tej-samej-niezm] two consecutive snapshots of the same unchanged entity are byte-identical, free of DB ids and raw audit columns, with stably sorted arrays', async () => {
    // tags and linked dtos created deliberately out of alphabetical order
    const dtoSlugsCreated: string[] = [];
    for (const name of ['ZetaDto', 'AlphaDto']) {
      const res = await request(t.app).post('/api/dtos').send({ name, fields: [] });
      expect(res.status).toBe(201);
      dtoSlugsCreated.push(res.body.slug);
    }
    const created = await request(t.app)
      .post('/api/endpoints')
      .send({ method: 'GET', path: '/api/users', summary: 'list users', tags: ['zeta', 'alpha'] });
    expect(created.status).toBe(201);
    const slug = created.body.slug;
    for (const dtoSlug of dtoSlugsCreated) {
      const link = await request(t.app)
        .post(`/api/endpoints/${slug}/dtos`)
        .send({ dtoSlug, relation: 'response', statusCode: 200 });
      expect(link.status).toBe(201);
    }

    const raw = t.rawReader.getEntity('endpoint', slug);
    expect(raw).not.toBeNull();
    const first = t.host.snapshot('endpoint', raw, t.rawReader);
    const second = t.host.snapshot('endpoint', t.rawReader.getEntity('endpoint', slug), t.rawReader);

    // byte-identical canonical JSON (git-diff determinism)
    const firstJson = JSON.stringify(canonicalize(first));
    const secondJson = JSON.stringify(canonicalize(second));
    expect(secondJson).toBe(firstJson);

    // No DB ids, and no RAW audit columns — `created_at`/`updated_at` are index
    // implementation detail and must never reach the file.
    expect(firstJson).not.toMatch(/"id":/);
    expect(firstJson).not.toMatch(/"created_at":/);
    expect(firstJson).not.toMatch(/"updated_at":/);

    /**
     * 0.2.4 inverts the other half of this assertion. `createdAt`/`updatedAt`
     * used to be banned from a snapshot because the DB minted them on every
     * index pass, which made two snapshots of an unchanged entity differ — the
     * very determinism this test defends. Now the FILE owns them and the
     * columns are its verbatim projection, so they are stable across snapshots
     * and belong in the file. The determinism check above is what proves it:
     * it ran before these two lines and passed with the envelope present.
     */
    const stamped = first as { createdAt?: unknown; updatedAt?: unknown };
    expect(typeof stamped.createdAt).toBe('string');
    expect(typeof stamped.updatedAt).toBe('string');
    expect(stamped.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);

    // arrays sorted stably despite reversed insertion order
    const snap = first as { tags: string[]; linked_dtos: Array<{ dtoSlug?: string; dto_slug?: string }> };
    expect(snap.tags).toEqual([...snap.tags].sort());
    const dtoSlugs = snap.linked_dtos.map((d) => d.dtoSlug ?? d.dto_slug);
    expect(dtoSlugs).toEqual([...dtoSlugs].sort());
  });
});
