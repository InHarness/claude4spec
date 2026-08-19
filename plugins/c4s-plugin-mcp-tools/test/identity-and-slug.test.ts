/**
 * The identity rules of `mcp-tool` — the ones a reader is most likely to guess
 * wrong, because for this type the slug and the wire name look like the same
 * thing and are not.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.js';

const base = {
  name: 'read_page',
  server: 'claude4spec',
  description: 'Read one specification page by path.',
};

describe('mcp-tool — slug and title', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  const slugs = () =>
    (t.db.prepare('SELECT slug FROM mcp_tool ORDER BY slug').all() as Array<{ slug: string }>).map(
      (r) => r.slug,
    );

  it('slugifies both halves and joins them with a dash', async () => {
    await t.crud.create('mcp-tool', { ...base, server: 'Claude 4 Spec' }, 'user');
    expect(slugs()).toEqual(['claude-4-spec-read-page']);
  });

  /**
   * An EXPLICIT slug always wins over the pattern. The pattern is a convenience
   * for the common case, not a naming policy the caller has to work around.
   */
  it('lets an explicit slug at create beat the pattern', async () => {
    await t.crud.create('mcp-tool', { ...base, slug: 'legacy-name' }, 'user');
    expect(slugs()).toEqual(['legacy-name']);
  });

  /**
   * THE RULE MOST LIKELY TO SURPRISE. The pattern runs once, at create. Renaming
   * the tool on the wire does not rename the entity, so every reference to it
   * keeps resolving; closing the gap is an explicit `newSlug`, which carries
   * reference propagation with it.
   */
  it('does not move the slug when `name` is edited', async () => {
    await t.crud.create('mcp-tool', base, 'user');
    await t.crud.update('mcp-tool', 'claude4spec-read-page', { name: 'read_document' }, 'user');

    expect(slugs()).toEqual(['claude4spec-read-page']);
    const row = t.db
      .prepare('SELECT name, title FROM mcp_tool WHERE slug = ?')
      .get('claude4spec-read-page') as { name: string; title: string };
    expect(row.name).toBe('read_document');
    // The title was DERIVED at create and does not follow either — a value that
    // silently tracks another value is one nobody can cite.
    expect(row.title).toBe('claude4spec · read_page');
  });

  it('moves the slug when an explicit `newSlug` asks for it', async () => {
    await t.crud.create('mcp-tool', base, 'user');
    // `newSlug` rides INSIDE the payload, as a sibling of the fields rather than
    // one of them — the same split `update_entities` makes.
    await t.crud.update(
      'mcp-tool',
      'claude4spec-read-page',
      { name: 'read_document', newSlug: 'claude4spec-read-document' },
      'user',
    );
    expect(slugs()).toEqual(['claude4spec-read-document']);
  });

  /**
   * A duplicate `(server, name)` is TWO DESCRIPTIONS OF ONE TOOL, so it is
   * refused rather than suffixed. `spreadsheet` opts into `slugConflict: 'suffix'`
   * because two sheets sharing a title is ordinary; two tools sharing a server
   * and a name is not, and a `-2` would file the mistake as a catalogue entry.
   */
  it('refuses a duplicate (server, name) instead of suffixing it', async () => {
    await t.crud.create('mcp-tool', base, 'user');
    await expect(
      t.crud.create('mcp-tool', { ...base, description: 'A second description.' }, 'user'),
    ).rejects.toThrow(/SLUG_CONFLICT|already exists/i);
    expect(slugs()).toEqual(['claude4spec-read-page']);
  });
});

/**
 * The generated input schema is applied at the OUTER doors — the REST router and
 * `entity-tools` — and NOT at the internal `crud` facade beneath them. That
 * asymmetry is the design: the inner door is what restore and the index rebuild
 * write through, and they have to accept the corpus as it already is. So these
 * go through HTTP, which is where an author's write actually lands.
 */
describe('mcp-tool — the limits that must be loud', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(() => t.cleanup());

  it('refuses a create with no description rather than storing a blank contract', async () => {
    const { description: _omitted, ...withoutDescription } = base;
    const res = await request(t.app).post('/api/mcp-tools').send(withoutDescription);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/description/i);
  });

  /**
   * `logic` over its cap is a VALIDATION ERROR, never a silent truncation. The
   * cap is deliberate discipline — logic that will not fit signals a tool doing
   * too much — and quietly cutting it would destroy the author's text while
   * appearing to accept it.
   */
  it('refuses over-long logic instead of truncating it', async () => {
    const tooLong = await request(t.app)
      .post('/api/mcp-tools')
      .send({ ...base, logic: 'x'.repeat(1001) });
    expect(tooLong.status).toBe(400);

    const ok = await request(t.app)
      .post('/api/mcp-tools')
      .send({ ...base, logic: 'x'.repeat(1000) });
    expect(ok.status).toBe(201);
    const row = t.db
      .prepare('SELECT logic FROM mcp_tool WHERE slug = ?')
      .get('claude4spec-read-page') as { logic: string };
    expect(row.logic).toHaveLength(1000);
  });
});
