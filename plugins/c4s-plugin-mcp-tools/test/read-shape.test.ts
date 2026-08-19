/**
 * What the REST router actually hands the frontend.
 *
 * The panel's three-state hint control and the `params[]` editor both read this
 * payload directly, and both have a silent failure mode if its shape differs
 * from the row's: a hint arriving as the integer `0` is FALSY, so any `if (hint)`
 * would render a declared `false` as "not declared", and a `params` arriving as a
 * JSON string rather than an array would render an empty parameter list without
 * erroring. Neither shows up in a unit test of the components, so it is pinned
 * here, at the boundary where the shape is decided.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.js';

describe('mcp-tool — the shape the frontend reads', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
    await request(t.app)
      .post('/api/mcp-tools')
      .send({
        name: 'read_page',
        server: 'claude4spec',
        description: 'Read one specification page by path.',
        params: [
          { name: 'path', type: 'string', required: true, description: 'Page path.' },
          { name: 'section', type: 'string' },
        ],
        returns: 'The page body as markdown.',
        // One hint declared TRUE, one declared FALSE, two left undeclared - all
        // three states present in a single record.
        readOnlyHint: true,
        destructiveHint: false,
        logic: 'Resolve the path, refuse anything escaping the root, then read.',
        tags: ['srv-claude4spec'],
      })
      .expect(201);
  });
  afterEach(() => t.cleanup());

  const read = async () => {
    const res = await request(t.app).get('/api/mcp-tools/claude4spec-read-page').expect(200);
    return res.body.data as Record<string, unknown>;
  };

  it('returns params as a real array of objects, not as a JSON string', async () => {
    const tool = await read();
    expect(Array.isArray(tool.params)).toBe(true);
    expect(tool.params).toHaveLength(2);
    expect((tool.params as Array<{ name: string }>)[0].name).toBe('path');
  });

  /**
   * THE ONE THAT WOULD BITE SILENTLY. Whatever the transport spelling of the
   * declared `false` is, it must be DISTINGUISHABLE from the undeclared hints -
   * and a renderer must not reach that conclusion with a truthiness check.
   */
  it('keeps all three hint states distinguishable over the wire', async () => {
    const tool = await read();
    expect(tool.readOnlyHint).toBeTruthy();
    // Declared false: present, and not null/undefined.
    expect(tool.destructiveHint == null).toBe(false);
    expect(Boolean(tool.destructiveHint)).toBe(false);
    // Undeclared: nullish, which is what "the server declares nothing" means.
    expect(tool.idempotentHint == null).toBe(true);
    expect(tool.openWorldHint == null).toBe(true);
  });

  it('carries logic in the ordinary read, with no second operation to call', async () => {
    const tool = await read();
    expect(tool.logic).toMatch(/refuse anything escaping/);
    // A `contentBearing` field would surface as these instead of the value.
    expect(tool).not.toHaveProperty('hasLogic');
    expect(tool).not.toHaveProperty('logicBytes');
  });

  /** The list groups on this, so it has to be on the payload the list reads. */
  it('carries the mirror tag on the list payload', async () => {
    const res = await request(t.app).get('/api/mcp-tools').expect(200);
    const [tool] = res.body.data as Array<{ tags?: string[] }>;
    expect(tool.tags).toContain('srv-claude4spec');
  });

  it('derives the title without being asked for one', async () => {
    expect((await read()).title).toBe('claude4spec · read_page');
  });
});
