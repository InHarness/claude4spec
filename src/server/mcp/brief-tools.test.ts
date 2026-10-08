import { beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildBriefToolsServer } from './brief-tools.js';
import { ConflictError, type BriefService } from '../services/brief.js';
import { DomainError } from '../services/tags.js';
import { CATALOG } from '../operations/catalog.js';
import { registerCoreOperations } from '../operations/core-operations.js';
import { mcpServerSetForProfile } from '../operations/profiles.js';
import { CONTEXT_TYPE_REGISTRY } from '../services/chat-context.js';

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
      arguments: { path: 'b.md', action: 'append', content: 'more', ...args },
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
      arguments: { path: 'b.md', action: 'append', content: 'more' },
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

  it('makes BRIEF_CONFLICT reachable — a stale hash bounces without reaching the write', async () => {
    const res = await update({ expectedHash: 'c'.repeat(64) });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('BRIEF_CONFLICT');
    // The remedy travels with the refusal: re-read, re-apply, pass this back.
    expect(res.body.currentHash).toBe(STORED_HASH);
    /*
     * Nothing is forwarded: the comparison moved AHEAD of the edit composition,
     * as it already sat in `update_page` and `update_plan`. `updateContent`
     * still re-checks it under the write lock — that is what protects the file —
     * but reaching it only at the end meant a stale caller was answered by the
     * diff (`FIND_NOT_FOUND` against a body it never read) instead of by the
     * conflict. The assertion that matters here is the outcome above; this one
     * records that the refusal is now the adapter's own.
     */
    expect(forwarded).toEqual([]);
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
        arguments: { path: 'b.md', action: 'append', content: 'more', ...args },
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
   * 0.2.40, breaking: the field is `path`, not `brief`.
   *
   * The catalog row, REST and the CLI have always called it `path`; only this
   * rendering called it `brief`, so an agent that read the catalog wrote a call
   * the tool refused as missing an argument. It stays REQUIRED — which is why
   * the old spelling is not kept alongside it: a schema cannot say "one of
   * these two", and demoting both to optional would weaken the advertised
   * contract on the one operation that exists to stop an external connection
   * being handed a default brief.
   */
  it('requires `path`, and refuses a call that names no brief at all', async () => {
    expect((await get({ path: 'b.md' })).isError).toBe(false);
    // Refused by the SCHEMA, before the handler runs — which is the point of
    // keeping it required rather than accepting two spellings and checking one
    // of them by hand.
    const refused = await client.callTool({ name: 'get_brief', arguments: {} });
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain('path');
  });
});

/**
 * 0.2.86 — `update_brief` joins the differential mode (M43 §1.3), and the
 * thread channel gains the brief's version history.
 */
describe('update_brief textEdits + brief version tools', () => {
  const HASH = 'c'.repeat(64);
  const BODY = '<!-- anchor: aaaaaaaa -->\n## One\n\nalpha beta\n\n<!-- anchor: bbbbbbbb -->\n## Two\n\nbeta gamma\n';
  let written: string[];
  let client: Client;

  beforeEach(async () => {
    written = [];
    const briefService = {
      getBrief: async (p: string) => {
        if (p !== 'b.md') throw new DomainError('NOT_FOUND', `brief '${p}' not found`);
        return {
          path: 'b.md',
          frontmatter: { type: 'brief' },
          body: BODY,
          content: `---\ntype: brief\n---\n${BODY}`,
          hash: HASH,
        };
      },
      updateContent: async (opts: { content: string }) => {
        written.push(opts.content);
        return { newHash: 'd'.repeat(64) };
      },
      listVersions: () => [
        { version: 2, op: 'update' },
        { version: 1, op: 'create' },
      ],
      getVersion: (_p: string, v: number) => (v === 1 ? { version: 1, content: 'old' } : null),
    } as unknown as BriefService;

    const { server } = buildBriefToolsServer({ briefService, target: 'explicit' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  async function call(name: string, args: Record<string, unknown>) {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
    return { isError: res.isError === true, body: JSON.parse(text) as Record<string, any> };
  }

  it('exposes exactly the four brief tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['get_brief', 'get_brief_version', 'list_brief_versions', 'update_brief'],
    );
  });

  it('applies literal substitutions and answers with the replacement count, not the content', async () => {
    const res = await call('update_brief', {
      path: 'b.md',
      expectedHash: HASH,
      textEdits: [{ find: 'beta', replaceWith: 'BETA', expectedMatches: 'all' }],
    });
    expect(res.isError).toBe(false);
    expect(res.body).toEqual({ newHash: 'd'.repeat(64), replacements: 2 });
    expect(written[0]).toContain('alpha BETA');
    expect(written[0]).toContain('BETA gamma');
    expect(written[0]).toMatch(/^---\ntype: brief\n---/);
  });

  it('refuses a count mismatch with anchor + line positions and writes nothing', async () => {
    const res = await call('update_brief', {
      path: 'b.md',
      expectedHash: HASH,
      textEdits: [{ find: 'beta', replaceWith: 'BETA' }],
    });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('MATCH_COUNT_MISMATCH');
    const positions = JSON.stringify(res.body);
    expect(positions).toContain('aaaaaaaa');
    expect(positions).toContain('bbbbbbbb');
    // Whole-file lines (3 frontmatter lines above the body) — the frame `get_brief.range` reads in.
    expect(positions).toContain('"line":7');
    expect(positions).toContain('"line":12');
    expect(written).toEqual([]);
  });

  it('refuses both input shapes at once, and neither', async () => {
    const both = await call('update_brief', {
      path: 'b.md',
      expectedHash: HASH,
      action: 'append',
      content: 'x',
      textEdits: [{ find: 'alpha', replaceWith: 'A' }],
    });
    expect(both.body.code).toBe('INVALID_ARGUMENT');
    const neither = await call('update_brief', { path: 'b.md', expectedHash: HASH });
    expect(neither.body.code).toBe('INVALID_ARGUMENT');
    expect(written).toEqual([]);
  });

  it('lists versions oldest first and reads one snapshot', async () => {
    const list = await call('list_brief_versions', { path: 'b.md' });
    expect(list.body.total).toBe(2);
    expect(list.body.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);

    const v1 = await call('get_brief_version', { path: 'b.md', version: 1 });
    expect(v1.body.content).toBe('old');

    const missing = await call('get_brief_version', { path: 'b.md', version: 9 });
    expect(missing.body.code).toBe('VERSION_NOT_FOUND');

    const unknown = await call('list_brief_versions', { path: 'nope.md' });
    expect(unknown.body.code).toBe('NOT_FOUND');
  });

  it('answers an unknown path with NOT_FOUND on get_brief_version too, not "that version is missing"', async () => {
    // The version lookup returns null for a brief that does not exist, so
    // without the existence check the caller with a near-miss filename is sent
    // looking through a history instead of being handed the real paths.
    const res = await call('get_brief_version', { path: 'nope.md', version: 1 });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('refuses anchor/heading alongside textEdits instead of dropping them in silence', async () => {
    const res = await call('update_brief', {
      path: 'b.md',
      expectedHash: HASH,
      anchor: 'aaaaaaaa',
      textEdits: [{ find: 'alpha', replaceWith: 'A' }],
    });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('INVALID_ARGUMENT');
    // The message has to say WHY: the caller believed it had scoped the
    // substitutions to one section, and a `find` is never scoped.
    expect(JSON.stringify(res.body)).toMatch(/whole body/i);
    expect(written).toEqual([]);
  });
});

/**
 * The two ways a differential write on a brief went wrong quietly.
 *
 * Both are about WHICH body the new file is composed from, and neither shows up
 * in a small fixture — which is why the fixture here is a brief big enough to be
 * windowed, and a service that moves under the caller's feet.
 */
describe('update_brief composes from the whole brief, and checks the hash first', () => {
  const HASH = 'e'.repeat(64);
  const HEAD = '## Head\n\nalpha\n';
  const TAIL = '## Tail\n\n' + 'filler line\n'.repeat(200);
  const BODY = HEAD + TAIL;
  const CONTENT = `---\ntype: brief\n---\n${BODY}`;

  async function connect(briefService: BriefService) {
    const { server } = buildBriefToolsServer({ briefService, target: 'explicit' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return async (args: Record<string, unknown>) => {
      const res = await client.callTool({ name: 'update_brief', arguments: { path: 'b.md', ...args } });
      const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
      return { isError: res.isError === true, body: JSON.parse(text) as Record<string, any> };
    };
  }

  it('reads the brief with `full`, so the text past the response budget is not deleted by the edit', async () => {
    /*
     * The bug: `getBrief` with no `full` returns a body cut to the response
     * budget while `hash` stays the whole file's. The tool composed the new file
     * out of that cut body and passed the matching hash, so the guard saw
     * nothing wrong — one successful substitution and everything past the window
     * was gone from disk.
     */
    const written: string[] = [];
    let sawFull = false;
    const briefService = {
      getBrief: async (_p: string, opts?: { full?: boolean }) => {
        if (opts?.full === true) sawFull = true;
        const body = opts?.full === true ? BODY : HEAD;
        return {
          path: 'b.md',
          frontmatter: { type: 'brief' },
          body,
          content: opts?.full === true ? CONTENT : `---\ntype: brief\n---\n${HEAD}`,
          hash: HASH,
          ...(opts?.full === true ? {} : { truncated: true, truncationHint: 'use range' }),
        };
      },
      updateContent: async (opts: { content: string }) => {
        written.push(opts.content);
        return { newHash: 'f'.repeat(64) };
      },
    } as unknown as BriefService;

    const update = await connect(briefService);
    const res = await update({
      expectedHash: HASH,
      textEdits: [{ find: 'alpha', replaceWith: 'ALPHA' }],
    });

    expect(res.isError).toBe(false);
    expect(sawFull).toBe(true);
    expect(written[0]).toContain('ALPHA');
    // The decisive assertion: the tail survived the edit.
    expect(written[0]).toContain('## Tail');
    expect(written[0]!.match(/filler line/g)).toHaveLength(200);
  });

  it('answers a stale hash with BRIEF_CONFLICT, not with a diff failure against a body it never read', async () => {
    const written: string[] = [];
    const briefService = {
      getBrief: async () => ({
        path: 'b.md',
        frontmatter: { type: 'brief' },
        // The other writer already replaced the word this caller means to edit.
        body: '## Head\n\nomega\n',
        content: '---\ntype: brief\n---\n## Head\n\nomega\n',
        hash: HASH,
      }),
      updateContent: async (opts: { content: string }) => {
        written.push(opts.content);
        return { newHash: 'f'.repeat(64) };
      },
    } as unknown as BriefService;

    const update = await connect(briefService);
    const res = await update({
      expectedHash: 'a'.repeat(64),
      textEdits: [{ find: 'alpha', replaceWith: 'ALPHA' }],
    });

    expect(res.isError).toBe(true);
    // Before the reorder this was FIND_NOT_FOUND, whose repair hint ("copy the
    // fragment verbatim") is advice for a caller that is not the problem.
    expect(res.body.code).toBe('BRIEF_CONFLICT');
    expect(written).toEqual([]);
  });
});

/**
 * 2.1.8 — `update_brief` as the mcp-tool entity records it, and the
 * `insert_after_section` addressing edge cases (M21 `m21srvct`, `01ytpznn`).
 * The service is stubbed: what is under test is the body the tool composes and
 * the answer it gives, both of which the adapter owns.
 */
describe('update_brief — entity shape and insert_after_section addressing', () => {
  const HASH = '9'.repeat(64);
  const BODY = [
    '# Brief',
    '',
    '## Target',
    '',
    'first target',
    '',
    '## Other',
    '',
    'other body',
    '',
    '## Target',
    '',
    'second target',
    '',
  ].join('\n');
  const CODE_BODY = [
    '# Brief',
    '',
    'Example:',
    '',
    '```md',
    '## Only in code',
    '```',
    '',
    '## Real',
    '',
    'real body',
    '',
  ].join('\n');

  async function connect(body: string, mode: 'thread' | 'explicit' = 'explicit') {
    const written: string[] = [];
    const briefService = {
      getBrief: async () => ({
        path: 'b.md',
        frontmatter: { type: 'brief' },
        body,
        content: `---\ntype: brief\n---\n${body}`,
        hash: HASH,
      }),
      updateContent: async (opts: { content: string }) => {
        written.push(opts.content);
        return { newHash: '8'.repeat(64) };
      },
    } as unknown as BriefService;
    const { server } = buildBriefToolsServer(
      mode === 'explicit' ? { briefService, target: 'explicit' } : { threadId: 't1', briefPath: 'b.md', briefService },
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const update = async (args: Record<string, unknown>) => {
      const res = await client.callTool({
        name: 'update_brief',
        arguments: { ...(mode === 'explicit' ? { path: 'b.md' } : {}), expectedHash: HASH, ...args },
      });
      const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
      return { isError: res.isError === true, body: JSON.parse(text) as Record<string, any> };
    };
    return { client, update, written };
  }

  /** The body part of what was written (the frontmatter block stripped). */
  const bodyOf = (file: string) => file.replace(/^---\n[\s\S]*?\n---\n/, '');

  it('[entity:brief-tools-update-brief] update_brief is on brief-tools with action/content/anchor/heading/expectedHash/path', async () => {
    const explicit = await connect(BODY, 'explicit');
    const thread = await connect(BODY, 'thread');
    const tool = async (client: Client) => (await client.listTools()).tools.find((t) => t.name === 'update_brief')!;

    const ext = await tool(explicit.client);
    const int = await tool(thread.client);
    expect(ext).toBeDefined();
    expect(int).toBeDefined();
    const entityParams = ['action', 'content', 'anchor', 'heading', 'expectedHash', 'path'];
    /**
     * ASSUMPTION:dev-0011 — the rendering carries the entity's six parameters
     * (in the `internal` channel `path` is the thread's brief, closed over, so it
     * is absent from the schema) plus the differential `textEdits` and
     * `changeSummary`; `action`/`content` are optional because `textEdits` is
     * the alternative shape. See the deviation.
     */
    expect(Object.keys(ext.inputSchema.properties!).sort()).toEqual(
      [...entityParams, 'textEdits', 'changeSummary'].sort(),
    );
    expect(Object.keys(int.inputSchema.properties!).sort()).toEqual(
      [...entityParams.filter((p) => p !== 'path'), 'textEdits', 'changeSummary'].sort(),
    );
    expect((ext.inputSchema.properties!.action as { enum?: string[] }).enum).toEqual([
      'replace',
      'append',
      'insert_after_section',
    ]);
    expect(ext.inputSchema.required ?? []).toEqual(expect.arrayContaining(['expectedHash', 'path']));
    expect(int.inputSchema.required ?? []).toEqual(['expectedHash']);
    // `path` is addressed relative to the `briefs` root, not to a config key.
    expect((ext.inputSchema.properties!.path as { description?: string }).description).toContain(
      'relative to the briefs root (.claude4spec/briefs)',
    );
    expect(ext.description).toContain('expectedHash');
    expect(ext.description).toContain('IMMUTABLE_FIELD');

    // The answer is `{ newHash }` — never the brief.
    const res = await explicit.update({ action: 'replace', content: '# New\n' });
    expect(res.body).toEqual({ newHash: '8'.repeat(64) });
  });

  it('[ac:ac-insert-after-section-z-heading-pasuja] a heading that matches only a line inside a code block appends the content at the END', async () => {
    const { update, written } = await connect(CODE_BODY);
    const res = await update({ action: 'insert_after_section', heading: 'Only in code', content: 'NEW FRAGMENT' });

    expect(res.isError).toBe(false);
    const body = bodyOf(written[0]!);
    // The code block is untouched and the fragment is the last thing in the brief.
    expect(body).toContain('```md\n## Only in code\n```');
    expect(body.trimEnd().endsWith('NEW FRAGMENT')).toBe(true);
    expect(body.indexOf('NEW FRAGMENT')).toBeGreaterThan(body.indexOf('real body'));
  });

  it('[ac:ac-insert-after-section-z-heading-pasuja-2] a heading that matches only a line inside a code block answers with a warning in the result', async () => {
    const { update } = await connect(CODE_BODY);
    const res = await update({ action: 'insert_after_section', heading: 'Only in code', content: 'NEW FRAGMENT' });

    expect(res.isError).toBe(false);
    expect(res.body.newHash).toBe('8'.repeat(64));
    expect(res.body.warning).toMatch(/heading 'Only in code' matches no section/);
    expect(res.body.warning).toMatch(/appended at the END/);
  });

  it('[ac:ac-insert-after-section-z-heading-pasuja-3] a heading matching two headings of the brief inserts after the FIRST of them', async () => {
    const { update, written } = await connect(BODY);
    const res = await update({ action: 'insert_after_section', heading: 'Target', content: 'INSERTED' });

    expect(res.isError).toBe(false);
    const body = bodyOf(written[0]!);
    const at = body.indexOf('INSERTED');
    expect(at).toBeGreaterThan(body.indexOf('first target'));
    expect(at).toBeLessThan(body.indexOf('## Other'));
    expect(at).toBeLessThan(body.indexOf('second target'));
    expect(body.match(/INSERTED/g)).toHaveLength(1);
  });

  it('[ac:ac-insert-after-section-z-heading-pasuja-4] a heading matching two headings of the brief answers with an ambiguity warning in the result', async () => {
    const { update } = await connect(BODY);
    const res = await update({ action: 'insert_after_section', heading: 'Target', content: 'INSERTED' });

    expect(res.isError).toBe(false);
    expect(res.body.warning).toMatch(/heading 'Target' matches 2 sections/);
    expect(res.body.warning).toMatch(/after the FIRST/);
  });

  it('[ac:ac-update-brief-action-insert-after-sect] an anchor that does not exist falls back to append-at-end with a warning, not an error', async () => {
    const { update, written } = await connect(BODY);
    const res = await update({ action: 'insert_after_section', anchor: 'zzzzzzzz', content: 'TAIL FRAGMENT' });

    expect(res.isError).toBe(false);
    expect(res.body.code).toBeUndefined();
    expect(res.body.warning).toMatch(/anchor 'zzzzzzzz' matches no section/);
    const body = bodyOf(written[0]!);
    expect(body.trimEnd().endsWith('TAIL FRAGMENT')).toBe(true);
    expect(body).toContain('second target');
  });
});

/**
 * M21 `01ytpznn` — the `internal` rendering of the brief operations is the
 * `brief-tools` server, mounted only on `context_type='brief'` threads, with
 * exactly as many tools as there are `mcp-tool` entities recording it.
 */
describe('brief-tools — one tool per internal brief operation', () => {
  /** The four `mcp-tool` entities with `server: brief-tools` (M21). */
  const BRIEF_TOOL_ENTITIES = [
    'brief-tools-get-brief',
    'brief-tools-update-brief',
    'brief-tools-list-brief-versions',
    'brief-tools-get-brief-version',
  ];

  it('[ac:ac-kazda-operacja-briefu-renderowana-w-k] every brief operation rendered in `internal` is a brief-tools tool, and their count equals the tools mounted on a brief thread', async () => {
    registerCoreOperations();
    const internalBriefOps = CATALOG.listForChannel('internal')
      .filter((op) => op.opClass === 'brief')
      .map((op) => op.name)
      .sort();

    // What a `context_type='brief'` thread mounts: brief-tools in thread mode.
    expect(CONTEXT_TYPE_REGISTRY.brief.mcp.briefTools).toBe(true);
    expect(mcpServerSetForProfile('brief').briefTools).toBe(true);
    const { server } = buildBriefToolsServer({
      threadId: 't1',
      briefPath: 'b.md',
      briefService: {} as unknown as BriefService,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const mounted = (await client.listTools()).tools.map((t) => t.name).sort();

    expect(mounted).toEqual(internalBriefOps);
    expect(mounted).toEqual(['get_brief', 'get_brief_version', 'list_brief_versions', 'update_brief']);
    // One entity per mounted tool — slug `brief-tools-<tool name>`.
    expect(BRIEF_TOOL_ENTITIES.length).toBe(mounted.length);
    expect(BRIEF_TOOL_ENTITIES.map((slug) => slug.replace(/^brief-tools-/, '').replace(/-/g, '_')).sort()).toEqual(mounted);
    // The other context types do not mount it.
    for (const ct of ['chat', 'patch', 'ask'] as const) {
      expect(CONTEXT_TYPE_REGISTRY[ct].mcp.briefTools, ct).toBe(false);
    }
  });
});
