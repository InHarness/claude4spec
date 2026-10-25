import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import type Database from 'better-sqlite3';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { buildBriefToolsServer } from './brief-tools.js';
import { BriefService, ConflictError, type BriefServiceDeps } from '../services/brief.js';
import { DomainError } from '../services/tags.js';
import { CATALOG } from '../operations/catalog.js';
import { registerCoreOperations } from '../operations/core-operations.js';
import { BRIEF_ALLOWED_PLUGIN_MCP, mcpServerSetForProfile } from '../operations/profiles.js';
import { toolAdmittedByProfile } from '../operations/profile-gate.js';
import { artifactAddressingShape } from '../operations/addressing.js';
import { CONTEXT_TYPE_REGISTRY, subagentsFor } from '../services/chat-context.js';
import { ChatService } from '../services/chat.js';
import { MarkdownFileStore } from '../services/pages.js';
import { FileSerializer } from '../services/file-serializer.js';
import { FileVersionService } from '../services/file-version.js';
import { PagesFrontmatterIndexer } from '../services/pages-frontmatter-indexer.js';
import { DIRECT_FILESYSTEM_DENY_GROUPS, resolveAgentToolGroups } from '../services/agent-tool-posture.js';
import { FileWatchRuntime } from '../fs/watcher.js';
import { artifactSource, boundWriter } from '../fs/sources.js';
import { systemRootId } from '../../shared/root-kinds.js';
import { DEFAULT_BUDGET_CHARS } from '../discovery/budget.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import type { ProjectPluginHost } from '../core/plugin-host/types.js';
import { BRIEF_TOOL_RECORDS } from '../../../tests/helpers/brief-tool-records.js';
import { expectToolMatchesToolRecord } from '../../../tests/helpers/write-tool-records.js';
import { getBriefCommand } from '../../bin/c4s/commands/get-brief.js';
import { listBriefsCommand } from '../../bin/c4s/commands/list-briefs.js';
import { markBriefImplementedCommand } from '../../bin/c4s/commands/mark-brief-implemented.js';

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
        if (p !== 'b.md') throw new DomainError('BRIEF_NOT_FOUND', `brief '${p}' not found`);
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
      // The addressed reads check existence first (BRIEF_NOT_FOUND), as the
      // real service does; a version off the history is INVALID_ARGUMENT.
      listVersionsAddressed: async (p: string) => {
        if (p !== 'b.md') throw new DomainError('BRIEF_NOT_FOUND', `brief '${p}' not found`);
        return [
          { version: 2, op: 'update' },
          { version: 1, op: 'create' },
        ];
      },
      getVersionAddressed: async (p: string, v: number) => {
        if (p !== 'b.md') throw new DomainError('BRIEF_NOT_FOUND', `brief '${p}' not found`);
        if (v !== 1) throw new DomainError('INVALID_ARGUMENT', `version ${v} is not in the history of brief '${p}'`, 'available versions: 1..2');
        return { version: 1, content: 'old' };
      },
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
    expect(both.body.code).toBe('VALIDATION');
    const neither = await call('update_brief', { path: 'b.md', expectedHash: HASH });
    expect(neither.body.code).toBe('VALIDATION');
    expect(written).toEqual([]);
  });

  it('lists versions oldest first and reads one snapshot', async () => {
    const list = await call('list_brief_versions', { path: 'b.md' });
    expect(list.body.total).toBe(2);
    expect(list.body.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);

    const v1 = await call('get_brief_version', { path: 'b.md', version: 1 });
    expect(v1.body.content).toBe('old');

    const missing = await call('get_brief_version', { path: 'b.md', version: 9 });
    expect(missing.body.code).toBe('INVALID_ARGUMENT');

    const unknown = await call('list_brief_versions', { path: 'nope.md' });
    expect(unknown.body.code).toBe('BRIEF_NOT_FOUND');
  });

  it('answers an unknown path with BRIEF_NOT_FOUND on get_brief_version too, not "that version is missing"', async () => {
    // The version lookup returns null for a brief that does not exist, so
    // without the existence check the caller with a near-miss filename is sent
    // looking through a history instead of being handed the real paths.
    const res = await call('get_brief_version', { path: 'nope.md', version: 1 });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('BRIEF_NOT_FOUND');
  });

  it('refuses anchor/heading alongside textEdits instead of dropping them in silence', async () => {
    const res = await call('update_brief', {
      path: 'b.md',
      expectedHash: HASH,
      anchor: 'aaaaaaaa',
      textEdits: [{ find: 'alpha', replaceWith: 'A' }],
    });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('VALIDATION');
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

  it('update_brief on brief-tools, both mounts (stubbed service): the description and parameters (action, content, textEdits, anchor, heading, expectedHash, changeSummary — no `path` on the thread mount, required on the threadless one), write hints; exactly one input shape, both or neither VALIDATION before the file is touched; `{ newHash }` for an action, `{ newHash, replacements }` for textEdits', async () => {
    const explicit = await connect(BODY, 'explicit');
    const thread = await connect(BODY, 'thread');
    const tool = async (client: Client) => (await client.listTools()).tools.find((t) => t.name === 'update_brief')!;

    const ext = await tool(explicit.client);
    const int = await tool(thread.client);
    expect(ext).toBeDefined();
    expect(int).toBeDefined();
    const entityParams = ['action', 'content', 'textEdits', 'anchor', 'heading', 'expectedHash', 'changeSummary'];
    // Thread mount: exactly the entity's parameters — no `path` (M21 thread isolation).
    expect(Object.keys(int.inputSchema.properties!).sort()).toEqual([...entityParams].sort());
    expect(int.inputSchema.required ?? []).toEqual(['expectedHash']);
    // Threadless mount (external `mcp`): plus a REQUIRED `path`.
    expect(Object.keys(ext.inputSchema.properties!).sort()).toEqual([...entityParams, 'path'].sort());
    expect([...(ext.inputSchema.required ?? [])].sort()).toEqual(['expectedHash', 'path']);
    expect((ext.inputSchema.properties!.path as { description?: string }).description).toContain(
      'relative to the briefs root (.claude4spec/briefs)',
    );
    const p = int.inputSchema.properties as Record<string, { type?: string; enum?: string[]; description?: string }>;
    expect(p.action!.enum).toEqual(['replace', 'append', 'insert_after_section']);
    expect(p.content!.type).toBe('string');
    expect(p.textEdits!.type).toBe('array');
    expect(p.action!.description).toBe(
      'ACTION SHAPE: what to do with `content` — swap the addressed range, add at the end, or insert after an addressed section. Required together with `content`; forbidden with `textEdits`.',
    );
    expect(p.content!.description).toBe(
      'ACTION SHAPE: full text this edit contributes — write the range out. Required together with `action`; forbidden with `textEdits`.',
    );
    expect(p.textEdits!.description).toBe(
      'DIFFERENTIAL SHAPE: `[{ find, replaceWith, expectedMatches? }]` applied to the whole brief. `find` is literal, byte for byte; `expectedMatches` omitted means exactly one hit, a number means exactly that many, `"all"` means every occurrence. Mutually exclusive with `action` and `content`.',
    );
    expect(p.anchor!.description).toBe('Section anchor to address for `insert_after_section`. Unknown anchor degrades to append-at-end with a warning.');
    expect(p.heading!.description).toBe('Heading text to address for `insert_after_section`, as an alternative to `anchor`.');
    expect(p.expectedHash!.description).toBe('sha256 of the brief as you last read it. Missing → VALIDATION; mismatch → BRIEF_CONFLICT carrying the current hash.');
    expect(p.changeSummary!.description).toBe('One-line description of what this edit changes, recorded with the version.');
    // The entity's description, verbatim, on the thread mount.
    expect(int.description).toBe(
      'Edit the brief of this thread — there is no `path` parameter and no way to reach another brief. TWO INPUT SHAPES, EXACTLY ONE PER CALL (both, or neither, is invalid):\n- by action — `action` + `content`: `replace` swaps the addressed range, `append` adds at the end, `insert_after_section` places new content after a section you address by `anchor` or by `heading`. You pass the full text of the range in `content`.\n- differential — `textEdits`: literal substitutions over the whole brief, without resending the untouched text. Use it for a few sentences anywhere; use `action` + `content` to write or genuinely rewrite a range.\n\n`find` matches BYTE FOR BYTE — no regex, no whitespace normalisation. `expectedMatches` OMITTED MEANS EXACTLY ONE match; pass a number, or `"all"` for every occurrence. All patterns are counted on the brief as it was BEFORE the write, so substitutions do not cascade.\n\n`expectedHash` is MANDATORY. Pass the hash you got from `get_brief`; omitting it is a validation error, not silent permission to overwrite. The brief is edited in parallel by this thread, by a human in the UI and by an implementer agent in the terminal, so last-write-wins would lose someone\'s work without a trace.\n\nAn `anchor` that no longer resolves does not fail the call — the content is appended at the end and the answer says so. A heading inside a code block is never a target, and a `heading` matching several headings lands after the first of them, with a warning in the answer.\n\nFrontmatter is not editable here; only `implemented` is mutable at all, and it has its own route.',
    );
    expect(ext.description).toContain('`path`');
    expect(ext.description).toContain('expectedHash');
    // Hints: a write, not idempotent; the others unset.
    for (const t of [int, ext]) {
      expect(t.annotations?.readOnlyHint).toBe(false);
      expect(t.annotations?.idempotentHint).toBe(false);
      expect(t.annotations?.destructiveHint).toBeUndefined();
      expect(t.annotations?.openWorldHint).toBeUndefined();
    }

    // Logic — the input shape is settled before the file is touched.
    const both = await thread.update({ action: 'append', content: 'x', textEdits: [{ find: 'first target', replaceWith: 'X' }] });
    expect(both.body.code).toBe('VALIDATION');
    const neither = await thread.update({});
    expect(neither.body.code).toBe('VALIDATION');
    const half = await thread.update({ action: 'append' });
    expect(half.body.code).toBe('VALIDATION');
    expect(thread.written).toEqual([]);

    // The answer is `{ newHash }` for an action — never the brief…
    const res = await thread.update({ action: 'replace', content: '# New\n' });
    expect(res.body).toEqual({ newHash: '8'.repeat(64) });
    // …and `{ newHash, replacements }` for textEdits, with an optional changeSummary.
    const diff = await thread.update({
      textEdits: [{ find: 'other body', replaceWith: 'OTHER' }],
      changeSummary: 'rename the other body',
    });
    expect(diff.isError).toBe(false);
    expect(diff.body).toEqual({ newHash: '8'.repeat(64), replacements: 1 });
    expect(bodyOf(thread.written[1]!)).toContain('OTHER');
    expect(bodyOf(thread.written[1]!)).not.toContain('other body');
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

  /**
   * 2.1.13 — the M21 row gives `internal: direct` to six operations, and only
   * four of them are RENDERED there: `mark_brief_implemented` is not a position
   * of brief-tools for a recorded reason (the `brief` profile does not expose it),
   * and `list_briefs`' internal cell is a declaration without a rendering, so
   * written in M21 `01ytpznn`. The criterion counts renderings, not cells.
   *
   * 2.1.18 (M21 `01ytpznn`) — `list_briefs` IS rendered in `internal` now, but on
   * `transagent-tools` in a top-level `chat` thread, never in a brief thread (and
   * its class is `read`, so the operations are picked by name, not by class).
   *
   * 2.1.26 — `mark_brief_implemented`'s record makes its `internal` cell `n/a`
   * (with its reason), so it is no longer an internal cell at all; `list_briefs`
   * is the one internal brief operation rendered outside a brief thread.
   */
  const DECLARED_NOT_RENDERED_INTERNALLY = ['list_briefs'];

  it('[ac:ac-kazda-operacja-briefu-renderowana-w-k] every brief operation rendered in `internal` in a brief thread is a brief-tools tool, and their count equals the tools mounted on a brief thread', async () => {
    registerCoreOperations();
    const internalDirectBriefOps = CATALOG.listForChannel('internal')
      .filter((op) => op.name.includes('brief'))
      .map((op) => op.name)
      .sort();
    // The two cells not rendered in a brief thread are exactly the recorded ones…
    for (const name of DECLARED_NOT_RENDERED_INTERNALLY) expect(internalDirectBriefOps, name).toContain(name);
    // …and `create_brief` / `mark_brief_implemented` are not internal at all (n/a, with their reasons).
    expect(internalDirectBriefOps).not.toContain('create_brief');
    expect(internalDirectBriefOps).not.toContain('mark_brief_implemented');
    const internalBriefOps = internalDirectBriefOps.filter((n) => !DECLARED_NOT_RENDERED_INTERNALLY.includes(n));

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
    // 2.1.18 (M21 `m21ctxreg`): a brief thread has no transagent-tools, so no second
    // surface renders a brief operation there.
    expect(CONTEXT_TYPE_REGISTRY.brief.mcp.transagentTools).toBe(false);
  });
});

/**
 * 2.1.13 — `get_brief`'s read window and budget, the seven rows of
 * `katalog-operacji-m21`, and the brief-thread criteria, over a REAL
 * `BriefService` (file store, `file_version`, frontmatter index, chat threads)
 * and BOTH mounts of the server: the thread mount (`internal`) and the
 * threadless one (`target: 'explicit'`, the external `mcp` rendering).
 */
describe('brief-tools — the get_brief window and the brief catalog rows (2.1.13)', () => {
  const noopWs: WsEmitter = { broadcast: () => {} };
  const KNOWN_RELEASES = ['v1', 'v2'];
  let cwd: string;
  let db: Database.Database;
  let service: BriefService;
  let chat: ChatService;
  let briefsRoot: string;
  let briefPath: string;
  let threadId: string;
  let internal: Client;
  let external: Client;

  const BODY = ['# Brief: v1 → v2', '', '<!-- anchor: aaaa1111 -->', '## Alpha', '', 'alpha body', '', '<!-- anchor: bbbb2222 -->', '## Beta', '', 'beta body', ''].join('\n');

  async function connect(ctx: Parameters<typeof buildBriefToolsServer>[0]): Promise<Client> {
    const { server } = buildBriefToolsServer(ctx);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return client;
  }

  beforeAll(() => {
    registerCoreOperations();
  });

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-brief-rows-'));
    db = createTestDb();
    const briefsPages = new MarkdownFileStore({ cwd, dir: 'briefs', rootId: systemRootId('briefs'), kind: 'briefs' });
    await briefsPages.ensureRoot();
    briefsRoot = briefsPages.root;
    const runtime = new FileWatchRuntime({ fsEvents: false });
    runtime.mountSource({ source: artifactSource('brief'), dir: briefsPages.root, scope: 'context:test' });
    const briefsSerializer = new FileSerializer(briefsPages);
    chat = new ChatService(db);
    service = new BriefService({
      briefsPages,
      briefsWatcher: boundWriter(runtime.scoped('context:test'), artifactSource('brief')),
      briefsSerializer,
      pageVersions: new FileVersionService(db, briefsSerializer),
      chatService: chat,
      releaseService: {
        getLatestReleaseName: () => 'v2',
        getRelease: (name: string) => {
          if (!KNOWN_RELEASES.includes(name)) throw new DomainError('RELEASE_NOT_FOUND', `release '${name}' not found`);
          return { name };
        },
        releaseRankByName: () => new Map(KNOWN_RELEASES.map((n, i) => [n, i])),
      } as unknown as BriefServiceDeps['releaseService'],
      frontmatterIndexer: new PagesFrontmatterIndexer(new Map([[systemRootId('briefs'), briefsPages]]), noopWs),
      ws: noopWs,
    });
    ({ briefPath } = await service.createBrief({ fromReleaseName: 'v1', toReleaseName: 'v2', content: BODY }));
    ({ threadId } = service.createThreadForBrief({ path: briefPath, name: 'first thread' }));
    internal = await connect({ threadId, briefPath, briefService: service });
    external = await connect({ briefService: service, target: 'explicit' });
  });

  afterEach(async () => {
    db.close();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  async function call(client: Client, name: string, args: Record<string, unknown>) {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
    return { isError: res.isError === true, body: JSON.parse(text) as Record<string, any> };
  }

  async function toolOf(client: Client, name: string) {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === name);
    expect(tool, name).toBeDefined();
    return tool!;
  }

  const props = (tool: { inputSchema: { properties?: Record<string, unknown> } }) =>
    Object.keys(tool.inputSchema.properties ?? {}).sort();
  const fileBytes = (p: string) => fs.readFile(path.join(briefsRoot, p), 'utf-8');
  const sha256 = (s: string) => crypto.createHash('sha256').update(s, 'utf-8').digest('hex');
  const mountedNames = async (client: Client) => (await client.listTools()).tools.map((t) => t.name).sort();

  /** A brief bigger than the response budget, created through the service. */
  async function bigBrief(): Promise<string> {
    const line = 'x'.repeat(60);
    const body = Array.from({ length: Math.ceil(DEFAULT_BUDGET_CHARS / 30) }, (_, i) => `${i} ${line}`).join('\n');
    return (await service.createBrief({ fromReleaseName: 'v1', toReleaseName: 'v2', content: `# Big\n\n${body}\n`, suffix: 'big' })).briefPath;
  }

  // ── mcp-tool entity ──────────────────────────────────────────────────────

  it('get_brief on brief-tools, both mounts: `range` (object, optional) with the entity\'s description, readOnlyHint only, the entity\'s description verbatim; no `path` on the thread mount (M21 thread isolation), `path` required on the threadless mount — and the logic: thread-resolved address, content + frontmatter + hash, unknown path and a window past the file refused with the operation\'s codes', async () => {
    const int = await toolOf(internal, 'get_brief');
    const ext = await toolOf(external, 'get_brief');
    // The thread mount has no `path` at all: M21 declares thread isolation (01ytpznn).
    expect(artifactAddressingShape('brief', 'internal')).toBe('absent');
    expect(props(int)).toEqual(['range']);
    expect(int.inputSchema.required ?? []).toEqual([]);
    expect(props(ext)).toEqual(['path', 'range']);
    expect(ext.inputSchema.required).toEqual(['path']);
    for (const tool of [int, ext]) {
      const range = (tool.inputSchema.properties as Record<string, { type?: string; description?: string }>).range!;
      expect(range.type).toBe('object');
      expect(range.description).toBe(
        'Line window { start, end }, 1-based and inclusive. Use it to read a long brief in parts or to fetch the rest after a truncated response. A start past the end of the file is refused with the file size.',
      );
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBeUndefined();
      expect(tool.annotations?.idempotentHint).toBeUndefined();
      expect(tool.annotations?.openWorldHint).toBeUndefined();
    }
    expect(int.description).toBe(
      "Read the brief this thread is anchored in — content, frontmatter and hash. This is the ONLY way to the brief's content: the system prompt carries the brief's path and frontmatter, never its body and never its hash. There is no `path` parameter: the tool is scoped to the brief of this thread and cannot reach another one. For a long brief, or when a response comes back truncated, read it in windows with `range`. The returned `hash` is what arms `expectedHash` on the next `update_brief`, so this read is the entry point of every write. Call it before editing, and again after a system reminder says the file changed underneath you.",
    );
    // A `path` sent to the thread mount is not a way out of the thread's brief.
    const other = await service.createBrief({ fromReleaseName: 'v1', toReleaseName: 'v2', content: '# Other\n\nother brief\n', suffix: 'other' });
    const pinned = await call(internal, 'get_brief', { path: other.briefPath });
    expect(pinned.body.path).toBe(briefPath);
    expect(pinned.body.content).not.toContain('other brief');

    // No `path` is not an error: the thread's brief is resolved.
    const read = await call(internal, 'get_brief', {});
    expect(read.isError).toBe(false);
    const bytes = await fileBytes(briefPath);
    expect(read.body.path).toBe(briefPath);
    expect(read.body.content).toBe(bytes);
    expect(read.body.body).toContain('alpha body');
    expect(read.body.frontmatter).toMatchObject({ type: 'brief', from_release: 'v1', to_release: 'v2', implemented: false });
    expect(read.body.hash).toBe(sha256(bytes));

    // An unknown path → BRIEF_NOT_FOUND, with the real briefs in the hint.
    const unknown = await call(external, 'get_brief', { path: 'no-such-brief.md' });
    expect(unknown.isError).toBe(true);
    expect(unknown.body.code).toBe('BRIEF_NOT_FOUND');
    expect(unknown.body.hint).toContain(briefPath);

    // A window past the end of the file → INVALID_ARGUMENT stating the size.
    const lines = bytes.split('\n').length;
    const past = await call(internal, 'get_brief', { range: { start: lines + 3, end: lines + 9 } });
    expect(past.isError).toBe(true);
    expect(past.body.code).toBe('INVALID_ARGUMENT');
    expect(past.body.error).toContain(`has ${lines} lines`);
    // A malformed window (end before start) is refused the same way.
    expect((await call(internal, 'get_brief', { range: { start: 5, end: 2 } })).body.code).toBe('INVALID_ARGUMENT');
  });

  it('list_brief_versions on brief-tools, both mounts: the description verbatim, readOnlyHint only, no `path` on the thread mount (the row\'s limit/offset window only), `path` required on the threadless mount — and the logic: metadata only, never content; an unknown path is BRIEF_NOT_FOUND', async () => {
    const int = await toolOf(internal, 'list_brief_versions');
    const ext = await toolOf(external, 'list_brief_versions');
    expect(int.description).toBe(
      'List the version history of the brief — metadata only, never content. Use it to see what changed and when before pulling a specific snapshot with `get_brief_version`. There is no `path` parameter: the tool addresses the brief of this thread only.',
    );
    expect(props(int)).not.toContain('path');
    expect(props(int)).toEqual(['limit', 'offset']);
    expect(int.inputSchema.required ?? []).toEqual([]);
    expect(props(ext)).toEqual(['limit', 'offset', 'path']);
    expect(ext.inputSchema.required).toEqual(['path']);
    for (const tool of [int, ext]) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBeUndefined();
      expect(tool.annotations?.idempotentHint).toBeUndefined();
      expect(tool.annotations?.openWorldHint).toBeUndefined();
    }

    const first = await call(internal, 'get_brief', {});
    await call(internal, 'update_brief', { action: 'append', content: 'second edit', expectedHash: first.body.hash });
    // A `path` sent to the thread mount does not leave the thread's brief.
    const other = await service.createBrief({ fromReleaseName: 'v1', toReleaseName: 'v2', content: '# Other\n', suffix: 'other' });
    const history = await call(internal, 'list_brief_versions', { path: other.briefPath });
    expect(history.isError).toBe(false);
    expect(history.body.total).toBe(2);
    expect(history.body.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    // Metadata only — no snapshot content.
    expect(JSON.stringify(history.body)).not.toContain('alpha body');
    expect(JSON.stringify(history.body)).not.toContain('second edit');
    const unknown = await call(external, 'list_brief_versions', { path: 'nope.md' });
    expect(unknown.isError).toBe(true);
    expect(unknown.body.code).toBe('BRIEF_NOT_FOUND');
  });

  it('get_brief_version on brief-tools, both mounts: the description verbatim, readOnlyHint only, `version` (number, required) with the entity\'s description and no `path` on the thread mount, `path` required on the threadless mount — and the logic: a pure read of one snapshot that leaves the live file untouched; an unknown path is BRIEF_NOT_FOUND, a version off the history a validation error with the available range', async () => {
    const int = await toolOf(internal, 'get_brief_version');
    const ext = await toolOf(external, 'get_brief_version');
    expect(int.description).toBe(
      'Read one historical snapshot of the brief, addressed by version number from `list_brief_versions`. Use it to see what the brief said before an edit — it does not restore anything and does not touch the live file. There is no `path` parameter: the tool addresses the brief of this thread only.',
    );
    expect(props(int)).toEqual(['version']);
    expect(int.inputSchema.required).toEqual(['version']);
    const version = (int.inputSchema.properties as Record<string, { type?: string; description?: string }>).version!;
    expect(['number', 'integer']).toContain(version.type);
    expect(version.description).toBe('Version number, from list_brief_versions.');
    expect(props(ext)).toEqual(['path', 'version']);
    expect([...(ext.inputSchema.required ?? [])].sort()).toEqual(['path', 'version']);
    for (const tool of [int, ext]) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBeUndefined();
      expect(tool.annotations?.idempotentHint).toBeUndefined();
      expect(tool.annotations?.openWorldHint).toBeUndefined();
    }

    const first = await call(internal, 'get_brief', {});
    await call(internal, 'update_brief', { action: 'replace', content: '# Rewritten\n', expectedHash: first.body.hash });
    const live = await fileBytes(briefPath);
    const v1 = await call(internal, 'get_brief_version', { version: 1 });
    expect(v1.isError).toBe(false);
    expect(v1.body.version).toBe(1);
    expect(JSON.stringify(v1.body)).toContain('alpha body');
    // Not a restore: the live file is untouched, and no version was added.
    expect(await fileBytes(briefPath)).toBe(live);
    expect((await call(internal, 'list_brief_versions', {})).body.total).toBe(2);
    const off = await call(internal, 'get_brief_version', { version: 9 });
    expect(off.isError).toBe(true);
    expect(off.body.code).toBe('INVALID_ARGUMENT');
    expect(off.body.hint).toContain('1..2');
    expect((await call(external, 'get_brief_version', { path: 'nope.md', version: 1 })).body.code).toBe('BRIEF_NOT_FOUND');
  });

  // ── 2.1.26 mcp-tool records: the thread mount and its explicit twins ─────

  /** The registered declarations of one mount, as the host holds them (raw zod shapes). */
  const declaredOf = (ctx: Parameters<typeof buildBriefToolsServer>[0]) => buildBriefToolsServer(ctx).tools;
  const threadDeclared = () => declaredOf({ threadId, briefPath, briefService: service });
  const explicitDeclared = () => declaredOf({ briefService: service, target: 'explicit' });
  const recordOf = (slug: string) => {
    const record = BRIEF_TOOL_RECORDS[slug];
    expect(record, slug).toBeDefined();
    return record!;
  };
  /** A file in the briefs root whose frontmatter is not a brief's. */
  async function notABrief(): Promise<string> {
    await fs.writeFile(path.join(briefsRoot, 'not-a-brief.md'), '---\ntype: page\ntitle: x\n---\n# A page\n', 'utf-8');
    return 'not-a-brief.md';
  }

  it('[entity:brief-tools-get-brief] brief-tools · get_brief (thread mount): the record\'s name, description, `range` only (no `path`), readOnlyHint — the thread\'s brief fixed at build time, a missing file BRIEF_NOT_FOUND, a non-brief file BRIEF_INVALID_FRONTMATTER, a non-integer window, a start below 1, an end before the start or a start past the file INVALID_ARGUMENT, the content cut at 25 000 characters with the frontmatter still parsed from the whole file', async () => {
    expectToolMatchesToolRecord(threadDeclared().find((t) => t.name === 'get_brief'), recordOf('brief-tools-get-brief'));

    // The brief is the thread's, fixed when the server was built: a `path` does not move it.
    const other = await service.createBrief({ fromReleaseName: 'v1', toReleaseName: 'v2', content: '# Other\n\nother brief\n', suffix: 'other' });
    const pinned = await call(internal, 'get_brief', { path: other.briefPath });
    expect(pinned.body.path).toBe(briefPath);
    expect(pinned.body.content).not.toContain('other brief');
    const read = await call(internal, 'get_brief', {});
    const bytes = await fileBytes(briefPath);
    expect(read.isError).toBe(false);
    expect(Object.keys(read.body).sort()).toEqual(['body', 'content', 'frontmatter', 'hash', 'path']);
    expect(read.body.content).toBe(bytes);
    expect(read.body.body).toBe(matter(bytes).content);
    expect(read.body.hash).toBe(sha256(bytes));

    // Window refusals, each INVALID_ARGUMENT from the operation (not a transport error).
    const lines = bytes.split('\n').length;
    for (const range of [{ start: 1.5, end: 3 }, { start: 0, end: 3 }, { start: 5, end: 2 }, { start: lines + 2, end: lines + 5 }]) {
      const refused = await call(internal, 'get_brief', { range });
      expect(refused.isError, JSON.stringify(range)).toBe(true);
      expect(refused.body.code, JSON.stringify(range)).toBe('INVALID_ARGUMENT');
    }

    // The 25 000-character content budget; the frontmatter is parsed from the whole file.
    const big = await bigBrief();
    const bigThread = await connect({ threadId, briefPath: big, briefService: service });
    const cut = await call(bigThread, 'get_brief', {});
    expect(cut.body.truncated).toBe(true);
    expect(cut.body.truncationHint).toContain('range');
    expect(cut.body.content.length).toBe(25_000);
    expect(cut.body.frontmatter).toMatchObject({ type: 'brief', from_release: 'v1', to_release: 'v2' });
    expect(cut.body.hash).toBe(sha256(await fileBytes(big)));

    // A file that is not a brief, and a thread whose brief is gone.
    const notBrief = await connect({ threadId, briefPath: await notABrief(), briefService: service });
    expect((await call(notBrief, 'get_brief', {})).body.code).toBe('BRIEF_INVALID_FRONTMATTER');
    await fs.rm(path.join(briefsRoot, briefPath));
    const gone = await call(internal, 'get_brief', {});
    expect(gone.isError).toBe(true);
    expect(gone.body.code).toBe('BRIEF_NOT_FOUND');
  });

  it('[entity:brief-tools-get-brief-explicit] brief-tools · get_brief (explicit): the record\'s name, description, required `path` + `range`, readOnlyHint — an empty `path` refused BRIEF_NOT_FOUND like an unknown one (real paths in the hint), a non-brief file BRIEF_INVALID_FRONTMATTER, and the frontmatter parsed from the whole file when a window comes back', async () => {
    expectToolMatchesToolRecord(explicitDeclared().find((t) => t.name === 'get_brief'), recordOf('brief-tools-get-brief-explicit'));

    for (const empty of ['', '   ']) {
      const refused = await call(external, 'get_brief', { path: empty });
      expect(refused.isError).toBe(true);
      expect(refused.body.code).toBe('BRIEF_NOT_FOUND');
    }
    const unknown = await call(external, 'get_brief', { path: 'no-such-brief.md' });
    expect(unknown.body.code).toBe('BRIEF_NOT_FOUND');
    expect(unknown.body.hint).toContain(briefPath);
    expect((await call(external, 'get_brief', { path: await notABrief() })).body.code).toBe('BRIEF_INVALID_FRONTMATTER');

    const bytes = await fileBytes(briefPath);
    const lines = bytes.split('\n');
    const window = await call(external, 'get_brief', { path: briefPath, range: { start: lines.length - 3, end: lines.length - 2 } });
    expect(window.isError).toBe(false);
    expect(window.body.content).toBe(lines.slice(lines.length - 4, lines.length - 2).join('\n'));
    expect(window.body.frontmatter).toMatchObject({ type: 'brief', from_release: 'v1', to_release: 'v2', implemented: false });
    // The hash is the WHOLE file's, also for a window.
    expect(window.body.hash).toBe(sha256(bytes));
  });

  it('[entity:brief-tools-update-brief] brief-tools · update_brief (thread mount): the record\'s name, description, parameters without `path`, write hints — VALIDATION before the file is read (empty hash, both shapes or neither, anchor/heading with textEdits, action without content or content without action), a stale hash BRIEF_CONFLICT with the current hash and content, `replace` swapping the whole body, insert_after_section without a target MISSING_TARGET, the frontmatter kept, an `agent` version and a `briefs:changed` event', async () => {
    expectToolMatchesToolRecord(threadDeclared().find((t) => t.name === 'update_brief'), recordOf('brief-tools-update-brief'));

    // The VALIDATION refusals come before the file is read: a thread whose brief does not exist still gets them.
    const ghost = await connect({ threadId, briefPath: 'ghost.md', briefService: service });
    const refusals: Array<Record<string, unknown>> = [
      { action: 'append', content: 'x', expectedHash: '  ' },
      { action: 'append', content: 'x', textEdits: [{ find: 'a', replaceWith: 'b' }], expectedHash: 'h' },
      { expectedHash: 'h' },
      { textEdits: [{ find: 'a', replaceWith: 'b' }], anchor: 'aaaa1111', expectedHash: 'h' },
      { textEdits: [{ find: 'a', replaceWith: 'b' }], heading: 'Alpha', expectedHash: 'h' },
      { action: 'append', expectedHash: 'h' },
      { content: 'x', expectedHash: 'h' },
    ];
    for (const args of refusals) expect((await call(ghost, 'update_brief', args)).body.code, JSON.stringify(args)).toBe('VALIDATION');
    expect((await call(ghost, 'update_brief', { action: 'append', content: 'x', expectedHash: 'h' })).body.code).toBe('BRIEF_NOT_FOUND');

    const before = await fileBytes(briefPath);
    const stale = await call(internal, 'update_brief', { action: 'append', content: 'x', expectedHash: 'f'.repeat(64) });
    expect(stale.body.code).toBe('BRIEF_CONFLICT');
    expect(stale.body.currentHash).toBe(sha256(before));
    expect(stale.body.currentContent).toBe(before);
    expect(await fileBytes(briefPath)).toBe(before);

    const target = await call(internal, 'update_brief', { action: 'insert_after_section', content: 'x', expectedHash: sha256(before) });
    expect(target.body.code).toBe('MISSING_TARGET');

    const events: Array<{ kind: string; path?: string; origin?: string }> = [];
    (service as unknown as { deps: { ws: WsEmitter } }).deps.ws = { broadcast: (e: unknown) => events.push(e as never) };
    const replaced = await call(internal, 'update_brief', { action: 'replace', content: '# Rewritten\n\nonly this\n', expectedHash: sha256(before) });
    expect(replaced.isError).toBe(false);
    expect(Object.keys(replaced.body)).toEqual(['newHash']);
    const after = await fileBytes(briefPath);
    expect(replaced.body.newHash).toBe(sha256(after));
    // `replace` is the whole body; the frontmatter is the file's, unchanged.
    expect(matter(after).content).toBe('# Rewritten\n\nonly this\n');
    expect(matter(after).data).toEqual(matter(before).data);
    const latest = service.listVersions(briefPath)[0]!;
    expect(latest.changedBy).toBe('agent');
    expect(service.listVersions(briefPath)).toHaveLength(2);
    expect(events).toContainEqual(expect.objectContaining({ kind: 'briefs:changed', path: briefPath }));
  });

  it('[entity:brief-tools-update-brief-explicit] brief-tools · update_brief (explicit): the record\'s name, description, parameters with a required `path`, write hints — VALIDATION before the file is read, a stale hash BRIEF_CONFLICT with the current hash and content checked before the edits apply, the frontmatter kept', async () => {
    expectToolMatchesToolRecord(explicitDeclared().find((t) => t.name === 'update_brief'), recordOf('brief-tools-update-brief-explicit'));

    // Before the file is read: an unknown path still gets VALIDATION for a malformed call.
    for (const args of [
      { path: 'ghost.md', action: 'append', content: 'x', expectedHash: ' ' },
      { path: 'ghost.md', action: 'append', expectedHash: 'h' },
      { path: 'ghost.md', textEdits: [{ find: 'a', replaceWith: 'b' }], anchor: 'aaaa1111', expectedHash: 'h' },
      { path: 'ghost.md', expectedHash: 'h' },
    ]) {
      expect((await call(external, 'update_brief', args)).body.code, JSON.stringify(args)).toBe('VALIDATION');
    }
    const before = await fileBytes(briefPath);
    // Checked before the edits: a `find` that matches nothing is answered by the conflict, not FIND_NOT_FOUND.
    const stale = await call(external, 'update_brief', {
      path: briefPath,
      textEdits: [{ find: 'NOT IN THE BRIEF', replaceWith: 'x' }],
      expectedHash: 'f'.repeat(64),
    });
    expect(stale.body.code).toBe('BRIEF_CONFLICT');
    expect(stale.body.currentHash).toBe(sha256(before));
    expect(stale.body.currentContent).toBe(before);

    const ok = await call(external, 'update_brief', {
      path: briefPath,
      textEdits: [{ find: 'beta body', replaceWith: 'BETA' }],
      expectedHash: sha256(before),
    });
    expect(ok.body).toEqual({ newHash: sha256(await fileBytes(briefPath)), replacements: 1 });
    expect(matter(await fileBytes(briefPath)).data).toEqual(matter(before).data);
  });

  it('[entity:brief-tools-list-brief-versions] brief-tools · list_brief_versions (thread mount): the record\'s name, description, `limit` / `offset` (integers, no `path`), readOnlyHint — the thread\'s brief checked to exist first, `{ versions, total }` oldest first without content, every version from `offset` without `limit`, offset 0 by default', async () => {
    expectToolMatchesToolRecord(
      threadDeclared().find((t) => t.name === 'list_brief_versions'),
      recordOf('brief-tools-list-brief-versions'),
    );
    const first = await call(internal, 'get_brief', {});
    const second = await call(internal, 'update_brief', { action: 'append', content: 'second edit', expectedHash: first.body.hash });
    await call(internal, 'update_brief', { action: 'append', content: 'third edit', expectedHash: second.body.newHash });

    const all = await call(internal, 'list_brief_versions', {});
    expect(Object.keys(all.body).sort()).toEqual(['total', 'versions']);
    expect(all.body.total).toBe(3);
    expect(all.body.versions.map((v: { version: number }) => v.version)).toEqual([1, 2, 3]);
    expect(JSON.stringify(all.body)).not.toContain('alpha body');
    expect(JSON.stringify(all.body)).not.toContain('third edit');
    // No `limit` → everything from `offset`.
    expect((await call(internal, 'list_brief_versions', { offset: 1 })).body.versions.map((v: { version: number }) => v.version)).toEqual([2, 3]);
    expect((await call(internal, 'list_brief_versions', { limit: 1 })).body.versions.map((v: { version: number }) => v.version)).toEqual([1]);

    const ghost = await connect({ threadId, briefPath: 'ghost.md', briefService: service });
    const missing = await call(ghost, 'list_brief_versions', {});
    expect(missing.isError).toBe(true);
    expect(missing.body.code).toBe('BRIEF_NOT_FOUND');
  });

  it('[entity:brief-tools-list-brief-versions-explicit] brief-tools · list_brief_versions (explicit): the record\'s name, description, required `path` + `limit` / `offset`, readOnlyHint — existence checked before the history (an unknown path is BRIEF_NOT_FOUND, never an empty list), every version from `offset` without `limit`', async () => {
    expectToolMatchesToolRecord(
      explicitDeclared().find((t) => t.name === 'list_brief_versions'),
      recordOf('brief-tools-list-brief-versions-explicit'),
    );
    const first = await call(external, 'get_brief', { path: briefPath });
    await call(external, 'update_brief', { path: briefPath, action: 'append', content: 'second', expectedHash: first.body.hash });
    const all = await call(external, 'list_brief_versions', { path: briefPath });
    expect(all.body).toMatchObject({ total: 2 });
    expect(all.body.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    expect((await call(external, 'list_brief_versions', { path: briefPath, offset: 1 })).body.versions.map((v: { version: number }) => v.version)).toEqual([2]);
    const unknown = await call(external, 'list_brief_versions', { path: 'nope.md' });
    expect(unknown.isError).toBe(true);
    expect(unknown.body.code).toBe('BRIEF_NOT_FOUND');
    expect(unknown.body.versions).toBeUndefined();
  });

  it('[entity:brief-tools-get-brief-version] brief-tools · get_brief_version (thread mount): the record\'s name, description, `version` (integer, required, no `path`), readOnlyHint — the thread\'s brief, a missing file BRIEF_NOT_FOUND, a number off the history (0 included) INVALID_ARGUMENT with 1..N in the hint, the snapshot with its metadata and `data`, the live file untouched', async () => {
    expectToolMatchesToolRecord(
      threadDeclared().find((t) => t.name === 'get_brief_version'),
      recordOf('brief-tools-get-brief-version'),
    );
    const first = await call(internal, 'get_brief', {});
    await call(internal, 'update_brief', { action: 'replace', content: '# Rewritten\n', expectedHash: first.body.hash });
    const live = await fileBytes(briefPath);
    const v1 = await call(internal, 'get_brief_version', { version: 1 });
    expect(v1.isError).toBe(false);
    expect(v1.body).toMatchObject({ path: briefPath, version: 1, op: 'create' });
    expect(v1.body.data.content).toContain('alpha body');
    expect(await fileBytes(briefPath)).toBe(live);
    expect((await call(internal, 'list_brief_versions', {})).body.total).toBe(2);
    for (const version of [0, 9]) {
      const off = await call(internal, 'get_brief_version', { version });
      expect(off.body.code, String(version)).toBe('INVALID_ARGUMENT');
      expect(off.body.hint, String(version)).toContain('1..2');
    }
    const ghost = await connect({ threadId, briefPath: 'ghost.md', briefService: service });
    expect((await call(ghost, 'get_brief_version', { version: 1 })).body.code).toBe('BRIEF_NOT_FOUND');
  });

  it('[entity:brief-tools-get-brief-version-explicit] brief-tools · get_brief_version (explicit): the record\'s name, description, required `path` + `version` (integer), readOnlyHint — a number off the history INVALID_ARGUMENT with 1..N in the hint, an unknown path BRIEF_NOT_FOUND', async () => {
    expectToolMatchesToolRecord(
      explicitDeclared().find((t) => t.name === 'get_brief_version'),
      recordOf('brief-tools-get-brief-version-explicit'),
    );
    const v1 = await call(external, 'get_brief_version', { path: briefPath, version: 1 });
    expect(v1.isError).toBe(false);
    expect(v1.body.version).toBe(1);
    expect(v1.body.data.content).toContain('alpha body');
    const off = await call(external, 'get_brief_version', { path: briefPath, version: 4 });
    expect(off.body.code).toBe('INVALID_ARGUMENT');
    expect(off.body.hint).toContain('1..1');
    expect((await call(external, 'get_brief_version', { path: 'nope.md', version: 1 })).body.code).toBe('BRIEF_NOT_FOUND');
  });

  // ── criteria ─────────────────────────────────────────────────────────────

  it('[ac:ac-get-brief-ma-okno-odczytu-range-i-jaw] get_brief({ path, range }) returns the named line window of a brief that has no section index, and a brief over the response budget read without range comes back truncated: true with a truncationHint pointing at range', async () => {
    const bytes = await fileBytes(briefPath);
    const lines = bytes.split('\n');
    const alpha = lines.indexOf('alpha body') + 1;
    const beta = lines.indexOf('beta body') + 1;
    const windowed = await call(external, 'get_brief', { path: briefPath, range: { start: alpha, end: beta } });
    expect(windowed.isError).toBe(false);
    expect(windowed.body.content).toBe(lines.slice(alpha - 1, beta).join('\n'));
    expect(windowed.body.content.startsWith('alpha body')).toBe(true);
    expect(windowed.body.content.endsWith('beta body')).toBe(true);
    // The hash stays the WHOLE file's, so the window still arms update_brief.
    expect(windowed.body.hash).toBe(sha256(bytes));
    expect(windowed.body.truncated).toBeUndefined();

    const big = await bigBrief();
    const whole = await fileBytes(big);
    const over = await call(external, 'get_brief', { path: big });
    expect(over.isError).toBe(false);
    expect(over.body.truncated).toBe(true);
    expect(over.body.truncationHint).toMatch(/range/);
    expect((over.body.content as string).length).toBeLessThan(whole.length);
    // Following the hint — a window — reads the rest.
    const tail = await call(external, 'get_brief', { path: big, range: { start: 3, end: 5 } });
    expect(tail.isError).toBe(false);
    expect(tail.body.truncated).toBeUndefined();
    expect(tail.body.content).toBe(whole.split('\n').slice(2, 5).join('\n'));
  });

  it('[ac:ac-w-trybie-editorial-nowy-watek-przeciw] a new thread against the same brief gets the current content through get_brief, MCPReleaseDiff through release_diff and the version history, and applies its changes incrementally through update_brief (replace / append / insert_after_section)', async () => {
    // The first thread edits the brief.
    const first = await call(internal, 'get_brief', {});
    const edited = await call(internal, 'update_brief', {
      action: 'append',
      content: '## Gamma\n\nfirst thread wrote this',
      expectedHash: first.body.hash,
    });
    expect(edited.isError).toBe(false);

    // A NEW thread against the same brief (editorial mode).
    const { threadId: second } = service.createThreadForBrief({ path: briefPath, name: 'editorial' });
    expect(second).not.toBe(threadId);
    const editorial = await connect({ threadId: second, briefPath, briefService: service });

    // Current content — including the first thread's edit.
    const current = await call(editorial, 'get_brief', {});
    expect(current.isError).toBe(false);
    expect(current.body.content).toContain('first thread wrote this');
    expect(current.body.hash).toBe(edited.body.newHash);

    // Version history: the creation and the first thread's edit.
    const history = await call(editorial, 'list_brief_versions', {});
    expect(history.body.total).toBe(2);
    expect(history.body.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    const v1 = await call(editorial, 'get_brief_version', { version: 1 });
    expect(JSON.stringify(v1.body)).not.toContain('first thread wrote this');

    // MCPReleaseDiff: a brief thread mounts release-tools (the release-only plugin
    // pool) and its profile admits release_diff; the diff-explore subagent reads it.
    expect(CONTEXT_TYPE_REGISTRY.brief.mcp.pluginServers).toBe('release-only');
    expect(BRIEF_ALLOWED_PLUGIN_MCP.has('release-tools')).toBe(true);
    expect(toolAdmittedByProfile('brief', 'release_diff')).toBe(true);
    expect(CATALOG.require('release_diff').opClass).toBe('read');

    // Incremental edits, each armed with the previous answer's hash.
    const inserted = await call(editorial, 'update_brief', {
      action: 'insert_after_section',
      anchor: 'aaaa1111',
      content: '### Alpha detail\n\ninserted after alpha',
      expectedHash: current.body.hash,
    });
    expect(inserted.isError).toBe(false);
    expect(inserted.body.warning).toBeUndefined();
    const appended = await call(editorial, 'update_brief', {
      action: 'append',
      content: '## Delta\n\nappended at the end',
      expectedHash: inserted.body.newHash,
    });
    expect(appended.isError).toBe(false);
    let bytes = await fileBytes(briefPath);
    expect(bytes.indexOf('inserted after alpha')).toBeGreaterThan(bytes.indexOf('alpha body'));
    expect(bytes.indexOf('inserted after alpha')).toBeLessThan(bytes.indexOf('## Beta'));
    expect(bytes.trimEnd().endsWith('appended at the end')).toBe(true);
    expect(bytes).toContain('first thread wrote this');
    const replaced = await call(editorial, 'update_brief', {
      action: 'replace',
      content: '# Brief: v1 → v2\n\nrewritten narrative\n',
      expectedHash: appended.body.newHash,
    });
    expect(replaced.isError).toBe(false);
    bytes = await fileBytes(briefPath);
    expect(bytes).toContain('rewritten narrative');
    expect(bytes).not.toContain('alpha body');
    // Frontmatter survives every edit; each edit is a version.
    expect(bytes).toMatch(/from_release: v1/);
    expect((await call(editorial, 'list_brief_versions', {})).body.total).toBe(5);
    // A stale hash (the one before the replace) bounces.
    const stale = await call(editorial, 'update_brief', { action: 'append', content: 'x', expectedHash: appended.body.newHash });
    expect(stale.body.code).toBe('BRIEF_CONFLICT');
  });

  it('[ac:ac-rownoczesne-update-brief-z-wielu-watk] concurrent update_brief from several editorial threads resolves first-write-wins on expectedHash — the loser gets tool_result.error BRIEF_CONFLICT and recovers through get_brief plus a retry', async () => {
    const { threadId: tA } = service.createThreadForBrief({ path: briefPath, name: 'editorial A' });
    const { threadId: tB } = service.createThreadForBrief({ path: briefPath, name: 'editorial B' });
    const a = await connect({ threadId: tA, briefPath, briefService: service });
    const b = await connect({ threadId: tB, briefPath, briefService: service });

    // Both threads read the same state, so both hold the same hash.
    const readA = await call(a, 'get_brief', {});
    const readB = await call(b, 'get_brief', {});
    expect(readA.body.hash).toBe(readB.body.hash);
    const versionsBefore = (await call(a, 'list_brief_versions', {})).body.total as number;

    // First write wins.
    const won = await call(a, 'update_brief', { action: 'append', content: 'thread A wrote first', expectedHash: readA.body.hash });
    expect(won.isError).toBe(false);
    // The second, armed with the same (now stale) hash, is refused — a tool error, not a silent overwrite.
    const lost = await call(b, 'update_brief', { action: 'append', content: 'thread B wrote second', expectedHash: readB.body.hash });
    expect(lost.isError).toBe(true);
    expect(lost.body.code).toBe('BRIEF_CONFLICT');
    expect(lost.body.currentHash).toBe(won.body.newHash);
    let bytes = await fileBytes(briefPath);
    expect(bytes).toContain('thread A wrote first');
    expect(bytes).not.toContain('thread B wrote second');

    // The loser recovers: get_brief returns the winner's state and hash, the retry lands on top of it.
    const reread = await call(b, 'get_brief', {});
    expect(reread.body.hash).toBe(won.body.newHash);
    expect(reread.body.content).toContain('thread A wrote first');
    const retried = await call(b, 'update_brief', { action: 'append', content: 'thread B wrote second', expectedHash: reread.body.hash });
    expect(retried.isError).toBe(false);
    bytes = await fileBytes(briefPath);
    expect(bytes).toContain('thread A wrote first');
    expect(bytes).toContain('thread B wrote second');
    expect((await call(a, 'list_brief_versions', {})).body.total).toBe(versionsBefore + 2);

    // Truly simultaneous calls with the same hash: exactly one write lands, the other is BRIEF_CONFLICT.
    const hash = (await call(a, 'get_brief', {})).body.hash as string;
    const results = await Promise.all([
      call(a, 'update_brief', { action: 'append', content: 'race from A', expectedHash: hash }),
      call(b, 'update_brief', { action: 'append', content: 'race from B', expectedHash: hash }),
    ]);
    const winners = results.filter((r) => !r.isError);
    const losers = results.filter((r) => r.isError);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]!.body.code).toBe('BRIEF_CONFLICT');
    expect(losers[0]!.body.currentHash).toBe(winners[0]!.body.newHash);
    bytes = await fileBytes(briefPath);
    const aLanded = bytes.includes('race from A');
    const bLanded = bytes.includes('race from B');
    expect(aLanded !== bLanded).toBe(true);
    expect(sha256(bytes)).toBe(winners[0]!.body.newHash);
    expect((await call(a, 'list_brief_versions', {})).body.total).toBe(versionsBefore + 3);
  });

  it('[ac:ac-wpis-rejestru-kontekstow-dla-brief-ni] a brief thread has no filesystem built-ins — denied as tool groups of the turn, which the context registry does not declare — and the brief content arrives through get_brief, in the tool result', async () => {
    // The registry row declares no deny groups of its own: only the built-in axis.
    const row = CONTEXT_TYPE_REGISTRY.brief as unknown as Record<string, unknown>;
    expect(Object.keys(row).some((k) => /deny|disallow/i.test(k))).toBe(false);
    expect(CONTEXT_TYPE_REGISTRY.brief.builtinTools).toBe('none');

    // The denial is the turn's tool-group gating: the full direct-filesystem set,
    // whether the project's "Block direct file access" flag is on or off.
    // ASSUMPTION:dev-0005 — the criterion says the mechanism is the flag alone and
    // that diff-explore has Read with the flag unchecked; M21 m21ctxreg (2.1.13)
    // strips every built-in from a brief thread, Read included.
    for (const flag of [true, false]) {
      await fs.mkdir(path.join(cwd, '.claude4spec'), { recursive: true });
      await fs.writeFile(
        path.join(cwd, '.claude4spec', 'config.json'),
        JSON.stringify({ agent: { disableDirectFilesystemAccess: flag } }),
      );
      const groups = resolveAgentToolGroups({ cwd, planMode: false, builtinTools: CONTEXT_TYPE_REGISTRY.brief.builtinTools });
      for (const g of DIRECT_FILESYSTEM_DENY_GROUPS) expect(groups, `flag=${flag}`).toContain(g);
    }
    // A chat thread with the flag off keeps them — the brief's denial is not the project's.
    expect(resolveAgentToolGroups({ cwd, planMode: false, builtinTools: CONTEXT_TYPE_REGISTRY.chat.builtinTools })).toEqual([]);

    // diff-explore, the brief's subagent, names no built-in at all.
    const [diffExplore] = subagentsFor('brief', { listEntities: () => [] } as unknown as ProjectPluginHost, true);
    expect(diffExplore!.name).toBe('diff-explore');
    expect(diffExplore!.tools!.every((t) => t.startsWith('mcp__'))).toBe(true);
    expect(diffExplore!.tools).not.toContain('Read');

    // The content is handed over in-memory, in the result of get_brief.
    const read = await call(internal, 'get_brief', {});
    expect(read.body.content).toBe(await fileBytes(briefPath));
  });

  // ── spec-operation records (2.1.26) ──────────────────────────────────────
  //
  // The seven M21 operations, as their `spec-operation` records declare them at
  // 2.1.26 (they replace the rows of the `katalog-operacji-m21` table the page
  // embedded until 2.1.25): name, scope, mediation, the four channel cells (an
  // `n/a` carrying the record's `powody` verbatim), effects, idempotence,
  // content input, exactly the record's `kodyBledow`, and `renderings` exactly
  // its `narzedzia` — each named mcp-tool record resolved to `<server>.<tool>`.

  type Cell = { kind: 'direct' } | { kind: 'na'; reason: string };
  const D: Cell = { kind: 'direct' };

  function expectOperationRecord(record: {
    nazwa: string;
    channels: Record<'internal' | 'cli' | 'mcp' | 'rest', Cell>;
    efekty: string[];
    idempotencja: boolean | 'conditional';
    opisTresci: 'literal' | 'literal+diff' | 'n/a' | undefined;
    kodyBledow: string[];
    narzedzia: Partial<Record<'internal' | 'mcp', string[]>>;
  }) {
    const op = CATALOG.require(record.nazwa);
    expect(op.name).toBe(record.nazwa);
    expect(op.scope).toBe('project');
    expect(op.mediation).toBe('direct');
    for (const channel of ['internal', 'cli', 'mcp', 'rest'] as const) {
      expect(op.channels[channel], `${record.nazwa}.${channel}`).toEqual(record.channels[channel]);
    }
    expect([...op.sideEffects].sort()).toEqual([...record.efekty].sort());
    expect(op.idempotent).toBe(record.idempotencja);
    expect(op.contentInput).toBe(record.opisTresci);
    expect(new Set(op.errorCodes).size).toBe(op.errorCodes.length);
    expect([...op.errorCodes].sort()).toEqual([...record.kodyBledow].sort());
    const expected: Partial<Record<'internal' | 'mcp', string[]>> = {};
    for (const [channel, slugs] of Object.entries(record.narzedzia) as Array<['internal' | 'mcp', string[]]>) {
      expected[channel] = slugs.map((slug) => `${recordOf(slug).server}.${recordOf(slug).name}`);
    }
    expect(op.renderings ?? {}).toEqual(expected);
    return op;
  }

  it('[entity:get-brief] get_brief as its record declares it: project, direct, all four channels direct, no effects, idempotent, `path` + read window `range?`, codes BRIEF_NOT_FOUND, INVALID_ARGUMENT, BRIEF_INVALID_FRONTMATTER, rendered by brief-tools · get_brief (internal thread mount, mcp explicit) — a non-brief file BRIEF_INVALID_FRONTMATTER, a window past the end INVALID_ARGUMENT with the file size, content over the response budget truncated: true with a truncationHint pointing at the line window', async () => {
    const op = expectOperationRecord({
      nazwa: 'get_brief',
      channels: { internal: D, cli: D, mcp: D, rest: D },
      efekty: ['none'],
      idempotencja: true,
      opisTresci: undefined,
      kodyBledow: ['BRIEF_NOT_FOUND', 'INVALID_ARGUMENT', 'BRIEF_INVALID_FRONTMATTER'],
      narzedzia: { internal: ['brief-tools-get-brief'], mcp: ['brief-tools-get-brief-explicit'] },
    });
    expect(op.opClass).toBe('brief');
    expect(Object.keys(op.inputSchema).sort()).toEqual(['path', 'range']);
    // explicit-addressing: every external channel requires `path`; the internal
    // rendering carries none (M21 thread isolation).
    for (const channel of ['cli', 'mcp', 'rest'] as const) expect(artifactAddressingShape('brief', channel)).toBe('required');
    expect(artifactAddressingShape('brief', 'internal')).toBe('absent');
    expect((await toolOf(external, 'get_brief')).inputSchema.required).toEqual(['path']);
    expect(props(await toolOf(internal, 'get_brief'))).not.toContain('path');
    // cli rendering: `c4s get-brief` names this operation, server-delegating.
    expect(getBriefCommand).toMatchObject({ operation: 'get_brief', executionMode: 'server-delegating' });

    // The behaviour, in the owning core function.
    await expect(service.getBrief(await notABrief())).rejects.toMatchObject({ code: 'BRIEF_INVALID_FRONTMATTER' });
    const lines = (await fileBytes(briefPath)).split('\n').length;
    await expect(service.getBrief(briefPath, { range: { start: lines + 1, end: lines + 4 } })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      message: expect.stringContaining(`has ${lines} lines`),
    });
    await expect(service.getBrief('nope.md')).rejects.toMatchObject({ code: 'BRIEF_NOT_FOUND' });
    // echo-free read: the answer is the brief, no envelope noise.
    const ok = await call(external, 'get_brief', { path: briefPath });
    expect(Object.keys(ok.body).sort()).toEqual(['body', 'content', 'frontmatter', 'hash', 'path']);

    // 2.1.48 — content over the response budget comes back cut, flagged
    // `truncated: true`, with a `truncationHint` pointing at the line window.
    const big = await bigBrief();
    const whole = await fileBytes(big);
    const lastLine = whole.trimEnd().split('\n').at(-1)!;
    const cut = await call(external, 'get_brief', { path: big });
    expect(cut.isError).toBe(false);
    expect(cut.body.truncated).toBe(true);
    expect(cut.body.truncationHint).toMatch(/range: \{ start: \d+, end: \d+ \}/);
    expect(cut.body.content).not.toContain(lastLine);
    expect(cut.body.hash).toBe(sha256(whole));
  });

  it('[entity:list-briefs] list_briefs as its record declares it: project, direct, mcp n/a with the record\'s reason, the rest direct, no effects, idempotent, filter `implemented` + paging `limit`/`offset`, code VALIDATION, rendered by transagent-tools · list_briefs in internal only (never by brief-tools) — the list on the release axis', async () => {
    const op = expectOperationRecord({
      nazwa: 'list_briefs',
      channels: {
        internal: D,
        cli: D,
        mcp: {
          kind: 'na',
          reason:
            'serwer zewnętrzny nie niesie narzędzia: lista briefów jest powierzchnią użytkownika (UI, `c4s list-briefs`, trasa REST), a agentowo renderuje ją wyłącznie `transagent-tools` orkiestratora wątku `chat`',
        },
        rest: D,
      },
      efekty: ['none'],
      idempotencja: true,
      opisTresci: undefined,
      kodyBledow: ['VALIDATION'],
      narzedzia: { internal: ['transagent-tools-list-briefs'] },
    });
    // A read: the class `chat` admits, where its rendering lives.
    expect(op.opClass).toBe('read');
    expect(Object.keys(op.inputSchema).sort()).toEqual(['implemented', 'limit', 'offset']);
    expect(await mountedNames(internal)).not.toContain('list_briefs');
    expect(await mountedNames(external)).not.toContain('list_briefs');
    expect(listBriefsCommand).toMatchObject({ operation: 'list_briefs', executionMode: 'server-delegating' });

    // The operation's function: the filter, then the list on the release axis.
    await service.updateFrontmatter({ path: briefPath, patch: { implemented: true }, changedBy: 'user' });
    await bigBrief();
    await service.createBrief({ fromReleaseName: 'v2', toReleaseName: null, content: '# Open\n' });
    // Newest cycle first: the brief open from v2 sits above the v1 → v2 briefs.
    expect(service.listBriefs()[0]!.path).toBe('v2-to-next.md');
    expect(service.listBriefs().map((b) => b.path).sort()).toEqual(['v1-to-v2-big.md', 'v1-to-v2.md', 'v2-to-next.md']);
    expect(service.listBriefs({ implemented: true }).map((b) => b.path)).toEqual(['v1-to-v2.md']);
    expect(service.listBriefs({ implemented: false }).map((b) => b.path).sort()).toEqual(['v1-to-v2-big.md', 'v2-to-next.md']);
  });

  it('[entity:update-brief] update_brief as its record declares it: project, direct, cli n/a with the record\'s reason, the rest direct, file+db+ui-notify, conditionally idempotent, content described both ways, required guard, codes BRIEF_NOT_FOUND, BRIEF_CONFLICT, VALIDATION, INVALID_ARGUMENT, IMMUTABLE_FIELD, MISSING_TARGET, FIND_NOT_FOUND, MATCH_COUNT_MISMATCH, BRIEF_INVALID_FRONTMATTER, rendered by brief-tools · update_brief (internal thread mount, mcp explicit) — exactly one shape, a missing hash VALIDATION, `replace` idempotent by content while `append` is not, an immutable frontmatter field IMMUTABLE_FIELD, `implemented` immutable for the agent', async () => {
    const op = expectOperationRecord({
      nazwa: 'update_brief',
      channels: {
        internal: D,
        cli: { kind: 'na', reason: 'Komendy nie zaprojektowano: komendy briefu tworzą, czytają i oznaczają brief, ale go nie edytują.' },
        mcp: D,
        rest: D,
      },
      efekty: ['file', 'db', 'ui-notify'],
      idempotencja: 'conditional',
      opisTresci: 'literal+diff',
      kodyBledow: [
        'BRIEF_NOT_FOUND',
        'BRIEF_CONFLICT',
        'VALIDATION',
        'INVALID_ARGUMENT',
        'IMMUTABLE_FIELD',
        'MISSING_TARGET',
        'FIND_NOT_FOUND',
        'MATCH_COUNT_MISMATCH',
        'BRIEF_INVALID_FRONTMATTER',
      ],
      narzedzia: { internal: ['brief-tools-update-brief'], mcp: ['brief-tools-update-brief-explicit'] },
    });
    expect(Object.keys(op.inputSchema).sort()).toEqual(
      ['action', 'anchor', 'changeSummary', 'content', 'expectedHash', 'heading', 'path', 'textEdits'],
    );
    // `guard: wymagany`.
    expect(op.inputSchema.expectedHash!.isOptional()).toBe(false);
    expect(props(await toolOf(internal, 'update_brief'))).not.toContain('path');

    // Exactly one input shape: both, neither, or half the action shape → VALIDATION, and the file is not touched.
    const untouched = await fileBytes(briefPath);
    const { hash: h0 } = await service.getBrief(briefPath, { full: true });
    const both = await call(internal, 'update_brief', { action: 'append', content: 'x', textEdits: [{ find: 'alpha body', replaceWith: 'A' }], expectedHash: h0 });
    expect(both.body.code).toBe('VALIDATION');
    expect((await call(internal, 'update_brief', { expectedHash: h0 })).body.code).toBe('VALIDATION');
    expect((await call(internal, 'update_brief', { content: 'x', expectedHash: h0 })).body.code).toBe('VALIDATION');
    expect((await call(internal, 'update_brief', { action: 'append', content: 'x', expectedHash: ' ' })).body.code).toBe('VALIDATION');
    expect(await fileBytes(briefPath)).toBe(untouched);
    expect(service.listVersions(briefPath)).toHaveLength(1);

    // `replace` is idempotent by content…
    const r1 = await call(internal, 'update_brief', { action: 'replace', content: '# Same\n\nsame body\n', expectedHash: h0 });
    const afterFirst = await fileBytes(briefPath);
    const r2 = await call(internal, 'update_brief', { action: 'replace', content: '# Same\n\nsame body\n', expectedHash: r1.body.newHash });
    expect(r2.body.newHash).toBe(r1.body.newHash);
    expect(await fileBytes(briefPath)).toBe(afterFirst);
    // …`append` is not: two calls, two fragments.
    const a = await call(internal, 'update_brief', { action: 'append', content: 'twice', expectedHash: r2.body.newHash });
    await call(internal, 'update_brief', { action: 'append', content: 'twice', expectedHash: a.body.newHash });
    expect((await fileBytes(briefPath)).match(/twice/g)).toHaveLength(2);

    // An immutable frontmatter field, and `implemented` for the agent, are IMMUTABLE_FIELD.
    const { hash, content } = await service.getBrief(briefPath, { full: true });
    await expect(
      service.updateContent({ path: briefPath, content: content.replace('from_release: v1', 'from_release: v0'), expectedHash: hash, changedBy: 'user' }),
    ).rejects.toMatchObject({ code: 'IMMUTABLE_FIELD' });
    await expect(
      service.updateContent({ path: briefPath, content: content.replace('implemented: false', 'implemented: true'), expectedHash: hash, changedBy: 'agent' }),
    ).rejects.toMatchObject({ code: 'IMMUTABLE_FIELD' });
    expect((await call(external, 'update_brief', { path: 'nope.md', action: 'append', content: 'x', expectedHash: 'h' })).body.code).toBe('BRIEF_NOT_FOUND');
  });

  it('[entity:mark-brief-implemented] mark_brief_implemented as its record declares it: project, direct, internal n/a with the record\'s reason (no brief-tools tool), cli/rest direct, mcp n/a, file+db+ui-notify, idempotent, no content input, `path`, codes BRIEF_NOT_FOUND, IMMUTABLE_FIELD, BRIEF_INVALID_FRONTMATTER, no renderings — only the flag changes, a repeat is a no-op without a version, a non-brief file BRIEF_INVALID_FRONTMATTER, an unknown path BRIEF_NOT_FOUND', async () => {
    const op = expectOperationRecord({
      nazwa: 'mark_brief_implemented',
      channels: {
        internal: {
          kind: 'na',
          reason:
            'operacja deklaruje fakt o kodzie w repozytorium docelowym, którego wątek nie widzi, więc serwer briefu celowo jej nie niesie; znacznik ustawia implementer w terminalu albo użytkownik w UI',
        },
        cli: D,
        mcp: {
          kind: 'na',
          reason:
            'serwer zewnętrzny nie niesie narzędzia: znacznik ustawia implementer w terminalu (`c4s mark-brief-implemented`) albo użytkownik w UI, a połączenie zewnętrzne w profilu `brief` widzi tylko odczyt, edycję i wersje briefu',
        },
        rest: D,
      },
      efekty: ['file', 'db', 'ui-notify'],
      idempotencja: true,
      opisTresci: 'n/a',
      kodyBledow: ['BRIEF_NOT_FOUND', 'IMMUTABLE_FIELD', 'BRIEF_INVALID_FRONTMATTER'],
      narzedzia: {},
    });
    expect(op.opClass).toBe('brief');
    expect(Object.keys(op.inputSchema).sort()).toEqual(['implemented', 'path']);
    expect(op.inputSchema.path!.isOptional()).toBe(false);
    // Not a position of brief-tools on either mount.
    expect(await mountedNames(internal)).not.toContain('mark_brief_implemented');
    expect(await mountedNames(external)).not.toContain('mark_brief_implemented');
    expect(markBriefImplementedCommand).toMatchObject({ operation: 'mark_brief_implemented', executionMode: 'server-delegating' });

    // The function behind the cli/rest renderings: only the flag changes.
    const before = service.listVersions(briefPath).length;
    const bodyBefore = matter(await fileBytes(briefPath)).content;
    const marked = await service.updateFrontmatter({ path: briefPath, patch: { implemented: true }, changedBy: 'user' });
    expect(marked.frontmatter.implemented).toBe(true);
    expect(matter(await fileBytes(briefPath)).content).toBe(bodyBefore);
    expect(service.listVersions(briefPath).length).toBe(before + 1);
    // A repeat at the value the file holds: no write, no version.
    const bytes = await fileBytes(briefPath);
    await service.updateFrontmatter({ path: briefPath, patch: { implemented: true }, changedBy: 'user' });
    expect(await fileBytes(briefPath)).toBe(bytes);
    expect(service.listVersions(briefPath).length).toBe(before + 1);
    // Another frontmatter key is refused IMMUTABLE_FIELD by the M36 family guard
    // in front of this function (asserted on the rest rendering, artifacts.test.ts).
    await expect(
      service.updateFrontmatter({ path: await notABrief(), patch: { implemented: true }, changedBy: 'user' }),
    ).rejects.toMatchObject({ code: 'BRIEF_INVALID_FRONTMATTER' });
    await expect(
      service.updateFrontmatter({ path: 'nope.md', patch: { implemented: true }, changedBy: 'user' }),
    ).rejects.toMatchObject({ code: 'BRIEF_NOT_FOUND' });
  });

  const NO_HISTORY_COMMAND: Cell = {
    kind: 'na',
    reason: 'brak komendy `c4s` historii briefu: implementer w terminalu czyta bieżący brief, nie jego historię',
  };

  it('[entity:list-brief-versions] list_brief_versions as its record declares it: project, direct, internal/mcp/rest direct, cli n/a with the record\'s reason, no effects, idempotent, `path` + history window `limit`/`offset`, code BRIEF_NOT_FOUND, rendered by brief-tools · list_brief_versions (internal thread mount, mcp explicit)', async () => {
    const op = expectOperationRecord({
      nazwa: 'list_brief_versions',
      channels: { internal: D, cli: NO_HISTORY_COMMAND, mcp: D, rest: D },
      efekty: ['none'],
      idempotencja: true,
      opisTresci: undefined,
      kodyBledow: ['BRIEF_NOT_FOUND'],
      narzedzia: { internal: ['brief-tools-list-brief-versions'], mcp: ['brief-tools-list-brief-versions-explicit'] },
    });
    expect(Object.keys(op.inputSchema).sort()).toEqual(['limit', 'offset', 'path']);
    const unknown = await call(external, 'list_brief_versions', { path: 'nope.md' });
    expect(unknown.isError).toBe(true);
    expect(unknown.body.code).toBe('BRIEF_NOT_FOUND');
    const page = await call(internal, 'list_brief_versions', { offset: 0, limit: 1 });
    expect(page.body).toMatchObject({ total: 1 });
  });

  it('[entity:get-brief-version] get_brief_version as its record declares it: project, direct, internal/mcp/rest direct, cli n/a with the record\'s reason, no effects, idempotent, `(path, version)`, codes BRIEF_NOT_FOUND, INVALID_ARGUMENT, rendered by brief-tools · get_brief_version (internal thread mount, mcp explicit) — a version off the history INVALID_ARGUMENT with the available range', async () => {
    const op = expectOperationRecord({
      nazwa: 'get_brief_version',
      channels: { internal: D, cli: NO_HISTORY_COMMAND, mcp: D, rest: D },
      efekty: ['none'],
      idempotencja: true,
      opisTresci: undefined,
      kodyBledow: ['BRIEF_NOT_FOUND', 'INVALID_ARGUMENT'],
      narzedzia: { internal: ['brief-tools-get-brief-version'], mcp: ['brief-tools-get-brief-version-explicit'] },
    });
    expect(Object.keys(op.inputSchema).sort()).toEqual(['path', 'version']);
    await expect(service.getVersionAddressed(briefPath, 7)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      hint: expect.stringContaining('1..1'),
    });
    await expect(service.getVersionAddressed('nope.md', 1)).rejects.toMatchObject({ code: 'BRIEF_NOT_FOUND' });
  });

  it('[entity:create-brief] create_brief as its record declares it: project, direct, internal and mcp n/a with the record\'s reasons, cli/rest direct, file+db+ui-notify, not idempotent, literal content, codes BRIEF_SAME_RELEASE, VALIDATION, no renderings — blank content, a window without ends, an empty end name, an unknown release or roots on an open window VALIDATION; the operation writes the brief file only and opens no thread (no thread row, no thread list in its answer); the service answers path, hash and both ends', async () => {
    const op = expectOperationRecord({
      nazwa: 'create_brief',
      channels: {
        internal: {
          kind: 'na',
          reason:
            'tura wątku `brief` jest zakotwiczona w jednym artefakcie i pisze jego treść; powołanie kolejnego briefu nie jest czynnością autora briefu',
        },
        cli: D,
        mcp: {
          kind: 'na',
          reason:
            'serwer zewnętrzny nie niesie narzędzia: powołanie briefu jest powierzchnią użytkownika (UI, `c4s create-brief`, trasa REST), a połączenie zewnętrzne w profilu `brief` widzi tylko operacje na istniejącym briefie',
        },
        rest: D,
      },
      efekty: ['file', 'db', 'ui-notify'],
      idempotencja: false,
      opisTresci: 'literal',
      kodyBledow: ['BRIEF_SAME_RELEASE', 'VALIDATION'],
      narzedzia: {},
    });
    expect(Object.keys(op.inputSchema).sort()).toEqual(['content', 'fromReleaseName', 'roots', 'suffix', 'toReleaseName']);
    expect(await mountedNames(internal)).not.toContain('create_brief');
    expect(await mountedNames(external)).not.toContain('create_brief');

    // 2.1.27 — the operation writes the brief file only: no thread is opened,
    // and its answer carries no thread list (the initial thread is the REST
    // route's composition, pinned by `[entity:post-api-briefs]`).
    const threadRows = () => (db.prepare('SELECT COUNT(*) AS n FROM chat_thread').get() as { n: number }).n;
    const threadsBefore = threadRows();
    // The service answers the path, the hash and both ends of the window as resolved.
    const again = await service.createBrief({ toReleaseName: null, content: 'body\n' });
    expect(threadRows()).toBe(threadsBefore);
    expect(
      chat.listThreadsByArtifact({ threadColumn: 'brief_path', path: again.briefPath, limit: 20, offset: 0 }),
    ).toEqual([]);
    expect(again).not.toHaveProperty('threads');
    expect(Object.keys(again).sort()).toEqual(['briefPath', 'fromReleaseName', 'hash', 'toReleaseName']);
    expect(again).toMatchObject({ fromReleaseName: 'v2', toReleaseName: null });
    expect(again.hash).toBe(sha256(await fileBytes(again.briefPath)));
    await expect(service.createBrief({ fromReleaseName: 'v1', toReleaseName: ' v1 ' })).rejects.toMatchObject({ code: 'BRIEF_SAME_RELEASE' });
    for (const opts of [
      { fromReleaseName: 'v1', toReleaseName: 'v2', content: '  \n' },
      { fromReleaseName: null, toReleaseName: null },
      { fromReleaseName: ' ', toReleaseName: 'v2' },
      { fromReleaseName: 'ghost', toReleaseName: 'v2' },
      { fromReleaseName: 'v1', toReleaseName: 'ghost' },
      { fromReleaseName: 'v1', toReleaseName: null, roots: ['pages'] },
    ]) {
      await expect(service.createBrief(opts), JSON.stringify(opts)).rejects.toMatchObject({ code: 'VALIDATION' });
    }
  });
});
