/**
 * The read→write round trip of an annotation hint, which is the one asymmetry in
 * this type that a reader has no reason to suspect and that 46 other tests missed.
 *
 * SQLite has no boolean, so the host stores a declared hint as an integer and the
 * REST read hands it back that way. The generated INPUT schema, derived from the
 * same declaration, demands a real boolean and rejects a number outright. So the
 * obvious thing — read a tool, change one field, send it back — is a 400 on a
 * field the author never touched.
 *
 * The panel autosaves, which turned that into "the first edit to any field of a
 * tool with a declared hint silently fails". `read-shape.test.ts` already pins
 * that the three states survive the READ; these pin the other direction.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, type TestApp } from '../../../tests/helpers/test-app.js';
import { toWritableHint } from '../src/entity/mcp-tool/frontend/summary.js';

describe('toWritableHint', () => {
  /** The whole point: a number in, a boolean out, value preserved. */
  it('turns the wire integers into real booleans', () => {
    expect(toWritableHint(1)).toBe(true);
    expect(toWritableHint(0)).toBe(false);
  });

  it('passes real booleans through unchanged', () => {
    expect(toWritableHint(true)).toBe(true);
    expect(toWritableHint(false)).toBe(false);
  });

  /**
   * THE ARM THAT MUST NOT BE "TIDIED UP". Coercing absent to `false` would send a
   * declaration the server never made — the exact collapse the schema refuses by
   * leaving these columns nullable.
   */
  it('keeps an undeclared hint undeclared rather than declaring it false', () => {
    expect(toWritableHint(null)).toBeNull();
    expect(toWritableHint(undefined)).toBeNull();
  });
});

describe('mcp-tool — editing a tool that declares a hint', () => {
  let t: TestApp;
  const base = {
    name: 'read_page',
    server: 'claude4spec',
    description: 'Read one specification page by path.',
    readOnlyHint: true,
    destructiveHint: false,
  };

  beforeEach(async () => {
    t = await createTestApp();
    await request(t.app).post('/api/mcp-tools').send(base).expect(201);
  });
  afterEach(() => t.cleanup());

  const read = async () => {
    const res = await request(t.app).get('/api/mcp-tools/claude4spec-read-page').expect(200);
    return res.body.data as Record<string, unknown>;
  };

  /**
   * The failure, stated as a fact about the API rather than about the panel: this
   * is what an author gets for echoing back what they were just given.
   */
  it('rejects the hint spelling that the read hands back, when it is a number', async () => {
    const tool = await read();
    // Only meaningful while the transport really is an integer; if the host ever
    // starts returning booleans the round trip is safe and this test retires.
    if (typeof tool.readOnlyHint !== 'number') return;

    const res = await request(t.app)
      .patch('/api/mcp-tools/claude4spec-read-page')
      .send({ description: 'Read one page, by path.', readOnlyHint: tool.readOnlyHint });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/readOnlyHint/);
  });

  /** And the fix: the same edit, with the hints put through `toWritableHint`. */
  it('accepts the same edit once the hints are normalised, preserving all three states', async () => {
    const tool = await read();

    await request(t.app)
      .patch('/api/mcp-tools/claude4spec-read-page')
      .send({
        description: 'Read one page, by path.',
        readOnlyHint: toWritableHint(tool.readOnlyHint as 0 | 1),
        destructiveHint: toWritableHint(tool.destructiveHint as 0 | 1),
        idempotentHint: toWritableHint(tool.idempotentHint as null),
        openWorldHint: toWritableHint(tool.openWorldHint as null),
      })
      .expect(200);

    const after = await read();
    expect(after.description).toBe('Read one page, by path.');
    // Declared true, declared false and undeclared all came back out the way they
    // went in — the edit touched the description and nothing else.
    expect(Boolean(after.readOnlyHint)).toBe(true);
    expect(after.destructiveHint == null).toBe(false);
    expect(Boolean(after.destructiveHint)).toBe(false);
    expect(after.idempotentHint == null).toBe(true);
    expect(after.openWorldHint == null).toBe(true);
  });
});
