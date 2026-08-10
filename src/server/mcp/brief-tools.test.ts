import { beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildBriefToolsServer } from './brief-tools.js';
import { ConflictError, type BriefService } from '../services/brief.js';

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
});
