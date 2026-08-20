import { beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildBriefToolsServer } from './brief-tools.js';
import { ConflictError, type BriefService } from '../services/brief.js';
import { DomainError } from '../services/tags.js';

/**
 * The concurrency guard on `update_brief`, which the tool declared and did not
 * have.
 *
 * `expectedHash: input.expectedHash ?? current.hash` substituted the hash read
 * moments earlier whenever the caller omitted one, so the comparison inside
 * `BriefService.updateContent` compared a value against itself and could never
 * fail. `BRIEF_CONFLICT` was unreachable through this channel: two agents
 * editing one brief overwrote each other with no signal at all.
 *
 * The service is stubbed rather than built: what is under test is which hash the
 * ADAPTER forwards, and a real `BriefService` needs a watcher, a db, a chat
 * service and a release service to answer that same question.
 */
describe('update_brief — the guard is the operation\'s, not the caller\'s discipline', () => {
  let forwarded: Array<string | undefined>;
  let client: Client;
  const STORED_HASH = 'a'.repeat(64);

  beforeEach(async () => {
    forwarded = [];
    const briefService = {
      getBrief: async () => ({
        path: 'b.md',
        frontmatter: { type: 'brief' },
        body: '# Brief\n\nbody\n',
        content: '---\ntype: brief\n---\n# Brief\n\nbody\n',
        hash: STORED_HASH,
      }),
      updateContent: async (opts: { expectedHash?: string }) => {
        forwarded.push(opts.expectedHash);
        if (opts.expectedHash !== STORED_HASH) {
          throw new ConflictError('BRIEF_CONFLICT', 'brief changed since last read', STORED_HASH, 'current');
        }
        return { newHash: 'b'.repeat(64) };
      },
    } as unknown as BriefService;

    const { server } = buildBriefToolsServer({ briefService, target: 'explicit' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  async function update(args: Record<string, unknown>) {
    const res = await client.callTool({
      name: 'update_brief',
      arguments: { brief: 'b.md', action: 'append', content: 'more', ...args },
    });
    const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
    return { isError: res.isError === true, body: JSON.parse(text) as Record<string, any> };
  }

  it('refuses a call that offers no hash at all, instead of inventing one', async () => {
    // `expectedHash` is a required parameter now, so the schema turns this away
    // before the handler runs — which is also what advertises it as mandatory in
    // the tool definition the agent reads.
    const res = await client.callTool({
      name: 'update_brief',
      arguments: { brief: 'b.md', action: 'append', content: 'more' },
    });
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '';
    expect(text).toMatch(/expectedHash/i);
    // The decisive assertion: the write never happened. Under the old fallback
    // this same call reached the service with a hash that always matched.
    expect(forwarded).toEqual([]);
  });

  it('refuses VALIDATION for a present-but-empty hash, which the schema cannot catch', async () => {
    const res = await update({ expectedHash: '   ' });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('VALIDATION');
    expect(res.body.error).toMatch(/expectedHash is required/i);
    expect(res.body.hint).toMatch(/get_brief/);
    expect(forwarded).toEqual([]);
  });

  it('makes BRIEF_CONFLICT reachable — a stale hash is forwarded verbatim and bounces', async () => {
    const res = await update({ expectedHash: 'c'.repeat(64) });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('BRIEF_CONFLICT');
    // The remedy travels with the refusal: re-read, re-apply, pass this back.
    expect(res.body.currentHash).toBe(STORED_HASH);
    expect(forwarded).toEqual(['c'.repeat(64)]);
  });

  it('two writers racing on one brief: the second is refused rather than silently winning', async () => {
    const bothRead = STORED_HASH;
    const first = await update({ expectedHash: bothRead });
    expect(first.isError).toBe(false);
    expect(first.body.newHash).toBe('b'.repeat(64));

    // The second writer still holds the hash it read before the first landed.
    // The stub's stored hash has not moved, so this stands in for the real
    // service's comparison against a brief that has: the point is that the
    // adapter no longer rewrites the caller's hash on the way through.
    const second = await update({ expectedHash: 'stale'.padEnd(64, '0') });
    expect(second.isError).toBe(true);
    expect(second.body.code).toBe('BRIEF_CONFLICT');
  });

  it('accepts the hash it was given and answers with only the new one', async () => {
    const res = await update({ expectedHash: STORED_HASH });
    expect(res.isError).toBe(false);
    expect(Object.keys(res.body)).toEqual(['newHash']);
  });

  /**
   * Brief `0-2-35-to-next` item 6 — M21 (anchor `lwiojpht`) declares three
   * outcomes for this operation, and the production failure delivered a FOURTH
   * one the contract never named: nothing at all. Whatever happens, the caller
   * gets a payload it can act on; "completed with no output" is not an outcome.
   */
  it('answers every declared outcome with a payload — never with nothing', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['success', { expectedHash: STORED_HASH }],
      ['conflict', { expectedHash: 'stale'.padEnd(64, '0') }],
      ['validation', { expectedHash: '   ' }],
    ];
    for (const [label, args] of cases) {
      const res = await client.callTool({
        name: 'update_brief',
        arguments: { brief: 'b.md', action: 'append', content: 'more', ...args },
      });
      const blocks = res.content as Array<{ type: string; text?: string }>;
      expect(blocks.length, `${label}: no content block`).toBeGreaterThan(0);
      const text = blocks[0]?.text ?? '';
      expect(text.trim(), `${label}: empty content block`).not.toBe('');
      const body = JSON.parse(text) as Record<string, unknown>;
      // Either the success payload or a named code — never an empty object.
      expect(Object.keys(body).length, `${label}: empty payload`).toBeGreaterThan(0);
      expect(body.newHash ?? body.code, `${label}: neither newHash nor code`).toBeDefined();
    }
  });
});

/**
 * 0.2.40 — `get_brief` gains the artifact family's read window.
 *
 * The hole it closes: a brief larger than the response budget had no second way
 * to be read. Pages have one (`list_sections` + `get_sections`), but a brief
 * never enters `section_index`, so without `range` the tail of a large brief was
 * simply unreachable through the only channel allowed to read it.
 */
describe('get_brief — the read window (0.2.40)', () => {
  const FILE = ['---', 'type: brief', '---', '# Brief', '', 'alpha', 'beta', 'gamma'].join('\n');
  let seenRange: unknown;
  let client: Client;

  beforeEach(async () => {
    seenRange = 'NOT_CALLED';
    const briefService = {
      getBrief: async (path: string, opts?: { range?: { start: number; end: number } }) => {
        seenRange = opts?.range;
        const range = opts?.range;
        const lines = FILE.split('\n');
        if (range && range.start > lines.length) {
          throw new DomainError(
            'INVALID_ARGUMENT',
            `range starts at line ${range.start} but brief '${path}' has ${lines.length} lines`,
          );
        }
        const content = range ? lines.slice(range.start - 1, range.end).join('\n') : FILE;
        return { path, frontmatter: { type: 'brief' }, body: content, content, hash: 'h'.repeat(64) };
      },
    } as unknown as BriefService;

    const { server } = buildBriefToolsServer({ briefService, target: 'explicit' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  async function get(args: Record<string, unknown>) {
    const res = await client.callTool({ name: 'get_brief', arguments: args });
    const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
    return { isError: res.isError === true, body: JSON.parse(text) as Record<string, any> };
  }

  it('[ac:ac-get-brief-ma-okno-odczytu-range-i-jaw] forwards range and returns the window — no sectionIndexed gate refuses it', () => {
    return get({ path: 'b.md', range: { start: 6, end: 7 } }).then(({ isError, body }) => {
      expect(isError).toBe(false);
      expect(seenRange).toEqual({ start: 6, end: 7 });
      expect(body.content).toBe('alpha\nbeta');
    });
  });

  it('[ac:ac-rodzina-odczytu-artefaktu-wspolna-tak] a range past the end of the file refuses with INVALID_ARGUMENT stating the size', async () => {
    const { isError, body } = await get({ path: 'b.md', range: { start: 900, end: 999 } });
    expect(isError).toBe(true);
    expect(body.code).toBe('INVALID_ARGUMENT');
    expect(body.error).toContain('8 lines');
  });

  it('omitting range reads the whole brief, as it always did', async () => {
    const { isError, body } = await get({ path: 'b.md' });
    expect(isError).toBe(false);
    expect(seenRange).toBeUndefined();
    expect(body.content).toBe(FILE);
  });

  /**
   * The catalog row and every other channel have always called this field
   * `path`; only the MCP rendering called it `brief`. `path` is now what the
   * schema advertises, and `brief` keeps working so no existing caller breaks.
   */
  it('accepts `path`, and still accepts the legacy `brief` alias', async () => {
    expect((await get({ path: 'b.md' })).isError).toBe(false);
    expect((await get({ brief: 'b.md' })).isError).toBe(false);
    const { isError, body } = await get({});
    expect(isError).toBe(true);
    expect(body.code).toBe('VALIDATION');
  });
});
