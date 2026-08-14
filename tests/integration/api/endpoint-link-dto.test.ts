import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from '../../helpers/test-app.js';

/**
 * Item 58 — `link_dto`/`unlink_dto` as collection writes.
 *
 * These two routes are the only per-type REST handlers that survived tier K, and
 * the only place in the tier where logic was REWRITTEN rather than deleted:
 * `EndpointService.linkDto` wrote the `endpoint_dto` junction with its own
 * `INSERT OR IGNORE` and two `DELETE` variants, and now the whole verb is
 * "read `linkedDtos`, add or drop one entry, write the array back through the
 * host". So the behaviour it used to guarantee is pinned here rather than
 * assumed to have come along for the ride.
 */
describe('endpoint ↔ dto links (generic collection writes)', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
    await request(t.app).post('/api/dtos').send({ slug: 'user-dto', title: 'UserDto', fields: [] });
    await request(t.app).post('/api/dtos').send({ slug: 'error-dto', title: 'ErrorDto', fields: [] });
    await request(t.app)
      .post('/api/endpoints')
      .send({ slug: 'get-users', method: 'GET', path: '/users', summary: 'List users' });
  });
  afterEach(() => t.cleanup());

  const link = (body: unknown) => request(t.app).post('/api/endpoints/get-users/dtos').send(body);
  /**
   * Read back through the endpoint's `single_element` view, which is what a
   * client sees. Note the THREE spellings of one field this tier leaves in
   * place: the declaration calls it `linkedDtos[].dto`, the junction column
   * calls it `dto_slug`, and this view calls it `dtos[].dtoSlug`. Asserting on
   * the view's is deliberate — it is the contract the detail panel reads.
   */
  const links = async () =>
    (await request(t.app).get('/api/endpoints/get-users')).body.data.dtos as Array<{
      dtoSlug: string;
      relation: string;
      statusCode: number | null;
    }>;

  it('links a DTO, and reports it on the endpoint', async () => {
    const res = await link({ dtoSlug: 'user-dto', relation: 'response', statusCode: 200 });
    expect(res.status).toBe(201);
    /**
     * The response is an ACKNOWLEDGEMENT, not the endpoint. Returning the whole
     * entity made this route a second spelling of `GET /api/endpoints/:slug`
     * that had to keep agreeing with it by hand, in a plugin, untested.
     */
    expect(res.body).toEqual({ linked: true });

    expect(await links()).toMatchObject([{ dtoSlug: 'user-dto', relation: 'response', statusCode: 200 }]);
  });

  it('is idempotent — the same link twice is one link', async () => {
    await link({ dtoSlug: 'user-dto', relation: 'response', statusCode: 200 });
    expect((await link({ dtoSlug: 'user-dto', relation: 'response', statusCode: 200 })).status).toBe(201);
    expect(await links()).toHaveLength(1);
  });

  it('distinguishes links by status code, not just by dto and relation', async () => {
    await link({ dtoSlug: 'user-dto', relation: 'response', statusCode: 200 });
    await link({ dtoSlug: 'error-dto', relation: 'response', statusCode: 404 });
    await link({ dtoSlug: 'error-dto', relation: 'response', statusCode: 500 });
    expect(await links()).toHaveLength(3);
  });

  it('unlinks one status code and leaves its siblings alone', async () => {
    await link({ dtoSlug: 'error-dto', relation: 'response', statusCode: 404 });
    await link({ dtoSlug: 'error-dto', relation: 'response', statusCode: 500 });

    const res = await request(t.app).delete(
      '/api/endpoints/get-users/dtos/error-dto/response?statusCode=404',
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unlinked: true });
    expect(await links()).toMatchObject([{ dtoSlug: 'error-dto', relation: 'response', statusCode: 500 }]);
  });

  it('omitting statusCode removes every link for that dto and relation', async () => {
    await link({ dtoSlug: 'error-dto', relation: 'response', statusCode: 404 });
    await link({ dtoSlug: 'error-dto', relation: 'response', statusCode: 500 });
    await link({ dtoSlug: 'user-dto', relation: 'request' });

    await request(t.app).delete('/api/endpoints/get-users/dtos/error-dto/response').expect(200);
    expect(await links()).toMatchObject([{ dtoSlug: 'user-dto', relation: 'request', statusCode: null }]);
  });

  /**
   * The one hand-written rule that outlived the service. `relation` is an enum
   * on the field, so "is this a real relation" is the declaration's job; "a
   * request body carries no status code" relates two fields to each other, which
   * no single field can express.
   */
  it('refuses a request relation carrying a status code', async () => {
    const res = await link({ dtoSlug: 'user-dto', relation: 'request', statusCode: 200 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
    expect(await links()).toEqual([]);
  });

  it('404s for a missing endpoint or a missing dto, rather than writing a dangling link', async () => {
    expect(
      (await request(t.app).post('/api/endpoints/ghost/dtos').send({ dtoSlug: 'user-dto', relation: 'request' }))
        .status,
    ).toBe(404);
    expect((await link({ dtoSlug: 'ghost-dto', relation: 'request' })).status).toBe(404);
    expect(await links()).toEqual([]);
  });

  it('still requires dtoSlug and relation', async () => {
    expect((await link({ relation: 'request' })).status).toBe(400);
    expect((await link({ dtoSlug: 'user-dto' })).status).toBe(400);
  });
});
