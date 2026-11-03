/**
 * 2.1.65 — the rules the pattern record `get-api-entities-type-slug-content-field`
 * carries for `GET /api/entities/:type/:slug/content/:field` (M13 `tnpe8kzk`).
 *
 * - The REST rendering of the core operation `get_field_content` (M39): the host
 *   serves it per field flagged `contentBearing`, cross-cutting over `:type`, so
 *   no plugin router is needed for it.
 * - A type with two such fields has two addressable contents under the same
 *   pattern.
 * - `:field` outside the schema, or without the flag → `404`.
 * - The route only reads. Writing the field goes through the ordinary entity
 *   update (`PATCH /api/<pathPrefix>/:slug`): the field stays part of the input
 *   schema.
 */

import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { PluginManifest } from '../../../src/shared/plugin-host/manifest.js';
import { createPluginTestApp, type PluginTestApp } from '../../helpers/plugin-test-setup.js';

const SLUG_ENDPOINT = 'get-api-entities-type-slug-content-field';

/** A type with TWO content-bearing fields and one ordinary field, and no router of its own. */
function folioManifest(): PluginManifest {
  return {
    name: '@acme/c4s-plugin-folios',
    version: '1.0.0',
    hostApiVersion: '^2.0.0',
    contributes: {
      entities: [
        {
          type: 'folio',
          data: {
            schema: {
              title: { type: 'string', required: true, maxLength: 200 },
              summary: { type: 'string' },
              body: { type: 'string', contentBearing: true },
              appendix: { type: 'string', contentBearing: true },
            },
          },
          slugPattern: [{ op: 'slugify', field: 'title' }],
          payloadVersion: 1,
          label: 'Folio',
          labelPlural: 'Folios',
          pathPrefix: '/folios',
          systemPrompt: { roleNoun: 'folio', mcpToolsLine: 'folio-tools: none' },
        },
      ],
    },
  };
}

const BODY = 'The body of the folio — read through the generic content route.';
const APPENDIX = 'Appendix A: a second content-bearing field of the same type.';

describe(`[entity:${SLUG_ENDPOINT}] GET /api/entities/:type/:slug/content/:field`, () => {
  const opened: PluginTestApp[] = [];
  afterEach(async () => {
    for (const t of opened.splice(0)) await t.cleanup();
  });

  async function openWithFolio(): Promise<{ t: PluginTestApp; slug: string }> {
    const t = await createPluginTestApp([folioManifest()]);
    opened.push(t);
    const created = await request(t.app)
      .post(`${t.baseUrl}/folios`)
      .send({ title: 'First folio', summary: 'short', body: BODY, appendix: APPENDIX });
    expect(created.status).toBe(201);
    return { t, slug: created.body.data.slug as string };
  }

  const contentUrl = (t: PluginTestApp, type: string, slug: string, field: string) =>
    `${t.baseUrl}/entities/${type}/${slug}/content/${field}`;

  it(`[entity:${SLUG_ENDPOINT}] answers 200 with the field's content for a contentBearing field — a type with two such fields has two contents under the same pattern`, async () => {
    const { t, slug } = await openWithFolio();

    const body = await request(t.app).get(contentUrl(t, 'folio', slug, 'body'));
    expect(body.status).toBe(200);
    expect(body.body).toEqual({
      type: 'folio',
      slug,
      field: 'body',
      content: BODY,
      bytes: Buffer.byteLength(BODY, 'utf8'),
    });

    const appendix = await request(t.app).get(contentUrl(t, 'folio', slug, 'appendix'));
    expect(appendix.status).toBe(200);
    expect(appendix.body).toMatchObject({ type: 'folio', slug, field: 'appendix', content: APPENDIX });
  }, 60_000);

  it(`[entity:${SLUG_ENDPOINT}] a :field outside the schema is 404, naming the covered fields`, async () => {
    const { t, slug } = await openWithFolio();
    const res = await request(t.app).get(contentUrl(t, 'folio', slug, 'nonexistent'));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(String(res.body.hint)).toMatch(/body/);
  }, 60_000);

  it(`[entity:${SLUG_ENDPOINT}] a :field in the schema but without the contentBearing flag is 404`, async () => {
    const { t, slug } = await openWithFolio();
    for (const field of ['summary', 'title']) {
      const res = await request(t.app).get(contentUrl(t, 'folio', slug, field));
      expect({ field, status: res.status }).toEqual({ field, status: 404 });
    }
  }, 60_000);

  it(`[entity:${SLUG_ENDPOINT}] the route only reads — a write verb on it changes nothing; the field is written by the ordinary entity update`, async () => {
    const { t, slug } = await openWithFolio();

    for (const verb of ['put', 'post', 'patch', 'delete'] as const) {
      const res = await request(t.app)[verb](contentUrl(t, 'folio', slug, 'body')).send({ content: 'overwritten' });
      expect({ verb, ok: res.status >= 200 && res.status < 300 }).toEqual({ verb, ok: false });
    }
    expect((await request(t.app).get(contentUrl(t, 'folio', slug, 'body'))).body.content).toBe(BODY);

    // The field stays part of the input schema: the generated update writes it.
    const updated = await request(t.app).patch(`${t.baseUrl}/folios/${slug}`).send({ body: 'Rewritten body.' });
    expect(updated.status).toBe(200);
    expect((await request(t.app).get(contentUrl(t, 'folio', slug, 'body'))).body.content).toBe('Rewritten body.');
  }, 60_000);
});
