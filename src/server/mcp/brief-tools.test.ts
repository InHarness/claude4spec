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

  /**
   * 2.1.13 — the M21 row gives `internal: direct` to six operations, and only
   * four of them are RENDERED there: `mark_brief_implemented` is not a position
   * of brief-tools for a recorded reason (the `brief` profile does not expose it),
   * and `list_briefs`' internal cell is a declaration without a rendering, so
   * written in M21 `01ytpznn`. The criterion counts renderings, not cells.
   */
  const DECLARED_NOT_RENDERED_INTERNALLY = ['list_briefs', 'mark_brief_implemented'];

  it('[ac:ac-kazda-operacja-briefu-renderowana-w-k] every brief operation rendered in `internal` is a brief-tools tool, and their count equals the tools mounted on a brief thread', async () => {
    registerCoreOperations();
    const internalDirectBriefOps = CATALOG.listForChannel('internal')
      .filter((op) => op.opClass === 'brief' && op.name.includes('brief'))
      .map((op) => op.name)
      .sort();
    // The two declared-but-unrendered cells are exactly the recorded ones…
    for (const name of DECLARED_NOT_RENDERED_INTERNALLY) expect(internalDirectBriefOps, name).toContain(name);
    // …and `create_brief` is not internal at all (n/a, with its reason).
    expect(internalDirectBriefOps).not.toContain('create_brief');
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

  it('[entity:brief-tools-get-brief] get_brief on brief-tools: `range` (object, optional) with the entity\'s description, readOnlyHint only, the entity\'s description (path sentence aside — dev-0001); `path` required on the threadless mount — and the logic: thread-resolved address, content + frontmatter + hash, unknown path and a window past the file refused with the operation\'s codes', async () => {
    const int = await toolOf(internal, 'get_brief');
    const ext = await toolOf(external, 'get_brief');
    // ASSUMPTION:dev-0001 — the thread mount has no `path` (closed over from chat_thread.brief_path).
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
    for (const sentence of [
      "Read the brief this thread is anchored in — content, frontmatter and hash.",
      "This is the ONLY way to the brief's content: the system prompt carries the brief's path and frontmatter, never its body and never its hash.",
      'For a long brief, or when a response comes back truncated, read it in windows with `range`.',
      'The returned `hash` is what arms `expectedHash` on the next `update_brief`, so this read is the entry point of every write.',
      'Call it before editing, and again after a system reminder says the file changed underneath you.',
    ]) {
      expect(int.description).toContain(sentence);
    }

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

  // ── katalog-operacji-m21 rows ────────────────────────────────────────────

  it('[entity:katalog-operacji-m21#get_brief] the row: project, direct in all four channels, no effects, idempotent, `path` + read window `range?` (no internal default declared), echo-free; BRIEF_NOT_FOUND + INVALID_ARGUMENT', async () => {
    const op = CATALOG.require('get_brief');
    expect(op.scope).toBe('project');
    expect(op.mediation).toBe('direct');
    expect(op.opClass).toBe('brief');
    for (const channel of ['internal', 'cli', 'mcp', 'rest'] as const) expect(op.channels[channel].kind, channel).toBe('direct');
    expect(op.sideEffects).toEqual(['none']);
    expect(op.idempotent).toBe(true);
    expect([...op.errorCodes].sort()).toEqual(['BRIEF_NOT_FOUND', 'INVALID_ARGUMENT']);
    expect(Object.keys(op.inputSchema).sort()).toEqual(['path', 'range']);
    // The row no longer declares an internal default from the thread.
    expect(JSON.stringify(op.inputSchema.path!.description ?? '')).not.toMatch(/default|thread/i);
    // explicit-addressing: every external channel requires `path`.
    for (const channel of ['cli', 'mcp', 'rest'] as const) expect(artifactAddressingShape('brief', channel)).toBe('required');
    expect((await toolOf(external, 'get_brief')).inputSchema.required).toEqual(['path']);
    // cli rendering: `c4s get-brief` names this operation, server-delegating.
    expect(getBriefCommand).toMatchObject({ operation: 'get_brief', executionMode: 'server-delegating' });
    expect(getBriefCommand.errorCodes).toEqual(expect.arrayContaining(['BRIEF_NOT_FOUND', 'INVALID_ARGUMENT']));

    expect((await call(external, 'get_brief', { path: 'nope.md' })).body.code).toBe('BRIEF_NOT_FOUND');
    expect((await call(external, 'get_brief', { path: '  ' })).body.code).toBe('BRIEF_NOT_FOUND');
    expect((await call(external, 'get_brief', { path: briefPath, range: { start: 999, end: 1000 } })).body.code).toBe('INVALID_ARGUMENT');
    // echo-free read: the answer is the record, no envelope noise.
    const ok = await call(external, 'get_brief', { path: briefPath });
    expect(Object.keys(ok.body).sort()).toEqual(['body', 'content', 'frontmatter', 'hash', 'path']);
  });

  it('[entity:katalog-operacji-m21#list_briefs] the row: project, direct in all four channels (internal declared without a brief-tools rendering), no effects, idempotent, filter `implemented` + paging `limit`/`offset` with total counted after the filter; VALIDATION', async () => {
    const op = CATALOG.require('list_briefs');
    expect(op.scope).toBe('project');
    expect(op.mediation).toBe('direct');
    expect(op.opClass).toBe('brief');
    for (const channel of ['internal', 'cli', 'mcp', 'rest'] as const) expect(op.channels[channel].kind, channel).toBe('direct');
    expect(op.sideEffects).toEqual(['none']);
    expect(op.idempotent).toBe(true);
    expect([...op.errorCodes]).toEqual(['VALIDATION']);
    expect(Object.keys(op.inputSchema).sort()).toEqual(['implemented', 'limit', 'offset']);
    // No brief-tools tool renders it (M21 01ytpznn: a declaration without a rendering).
    expect(await mountedNames(internal)).not.toContain('list_briefs');
    expect(await mountedNames(external)).not.toContain('list_briefs');
    expect(listBriefsCommand).toMatchObject({ operation: 'list_briefs', executionMode: 'server-delegating' });

    // The operation's function: the filter, then the list on the release axis.
    await service.updateFrontmatter({ path: briefPath, patch: { implemented: true }, changedBy: 'user' });
    await bigBrief();
    expect(service.listBriefs().map((b) => b.path).sort()).toEqual(['v1-to-v2-big.md', 'v1-to-v2.md']);
    expect(service.listBriefs({ implemented: true }).map((b) => b.path)).toEqual(['v1-to-v2.md']);
    expect(service.listBriefs({ implemented: false }).map((b) => b.path)).toEqual(['v1-to-v2-big.md']);
  });

  it('[entity:katalog-operacji-m21#update_brief] the row: direct in all four channels, file+db+ui-notify, not idempotent (append), literal content, `path` + anchor/heading, mandatory expectedHash guard; BRIEF_NOT_FOUND, BRIEF_CONFLICT, IMMUTABLE_FIELD, VALIDATION', async () => {
    const op = CATALOG.require('update_brief');
    expect(op.scope).toBe('project');
    expect(op.mediation).toBe('direct');
    for (const channel of ['internal', 'cli', 'mcp', 'rest'] as const) expect(op.channels[channel].kind, channel).toBe('direct');
    expect([...op.sideEffects].sort()).toEqual(['db', 'file', 'ui-notify']);
    expect(op.idempotent).toBe(false);
    // ASSUMPTION:dev-0011 — the differential shape is kept beside the literal one.
    expect(op.contentInput).toBe('literal+diff');
    expect(op.errorCodes).toEqual(expect.arrayContaining(['BRIEF_NOT_FOUND', 'BRIEF_CONFLICT', 'IMMUTABLE_FIELD', 'VALIDATION']));
    expect(op.errorCodes).not.toContain('NOT_FOUND');
    expect(Object.keys(op.inputSchema)).toEqual(expect.arrayContaining(['path', 'action', 'content', 'anchor', 'heading', 'expectedHash']));
    expect(op.inputSchema.expectedHash!.isOptional()).toBe(false);
    expect((await toolOf(external, 'update_brief')).inputSchema.required).toEqual(expect.arrayContaining(['path', 'expectedHash']));

    const unknown = await call(external, 'update_brief', { path: 'nope.md', action: 'append', content: 'x', expectedHash: 'h' });
    expect(unknown.body.code).toBe('BRIEF_NOT_FOUND');
    const missingHash = await call(internal, 'update_brief', { action: 'append', content: 'x', expectedHash: ' ' });
    expect(missingHash.body.code).toBe('VALIDATION');
    const stale = await call(internal, 'update_brief', { action: 'append', content: 'x', expectedHash: 'f'.repeat(64) });
    expect(stale.body.code).toBe('BRIEF_CONFLICT');
    // A frontmatter change through the content write is IMMUTABLE_FIELD (rest rendering's function).
    const { hash, content } = await service.getBrief(briefPath, { full: true });
    await expect(
      service.updateContent({ path: briefPath, content: content.replace('from_release: v1', 'from_release: v0'), expectedHash: hash, changedBy: 'user' }),
    ).rejects.toMatchObject({ code: 'IMMUTABLE_FIELD' });
    // `append` is not idempotent: two calls, two fragments; the answer is { newHash } only.
    const a = await call(internal, 'update_brief', { action: 'append', content: 'twice', expectedHash: hash });
    expect(Object.keys(a.body)).toEqual(['newHash']);
    await call(internal, 'update_brief', { action: 'append', content: 'twice', expectedHash: a.body.newHash });
    expect((await fileBytes(briefPath)).match(/twice/g)).toHaveLength(2);
  });

  it('[entity:katalog-operacji-m21#mark_brief_implemented] the row: registered, direct in all four channels (no brief-tools tool — the brief profile does not expose it), file+db+ui-notify, idempotent, no content input, `path`; BRIEF_NOT_FOUND + IMMUTABLE_FIELD', async () => {
    const op = CATALOG.require('mark_brief_implemented');
    expect(op.scope).toBe('project');
    expect(op.mediation).toBe('direct');
    expect(op.opClass).toBe('brief');
    for (const channel of ['internal', 'cli', 'mcp', 'rest'] as const) expect(op.channels[channel].kind, channel).toBe('direct');
    expect([...op.sideEffects].sort()).toEqual(['db', 'file', 'ui-notify']);
    expect(op.idempotent).toBe(true);
    expect(op.contentInput).toBe('n/a');
    expect([...op.errorCodes].sort()).toEqual(['BRIEF_NOT_FOUND', 'IMMUTABLE_FIELD']);
    expect(Object.keys(op.inputSchema).sort()).toEqual(['implemented', 'path']);
    expect(op.inputSchema.path!.isOptional()).toBe(false);
    // Not a position of brief-tools on either mount.
    expect(await mountedNames(internal)).not.toContain('mark_brief_implemented');
    expect(await mountedNames(external)).not.toContain('mark_brief_implemented');
    // cli rendering: `c4s mark-brief-implemented` renders THIS operation.
    expect(markBriefImplementedCommand).toMatchObject({ operation: 'mark_brief_implemented', executionMode: 'server-delegating' });
    expect(markBriefImplementedCommand.errorCodes).toEqual(expect.arrayContaining(['BRIEF_NOT_FOUND', 'IMMUTABLE_FIELD']));

    // The function behind the cli/rest renderings.
    const before = service.listVersions(briefPath).length;
    const marked = await service.updateFrontmatter({ path: briefPath, patch: { implemented: true }, changedBy: 'user' });
    expect(marked.frontmatter.implemented).toBe(true);
    expect(await fileBytes(briefPath)).toMatch(/implemented: true/);
    expect(service.listVersions(briefPath).length).toBe(before + 1);
    // Idempotent: the repeat writes nothing and records no version.
    const bytes = await fileBytes(briefPath);
    await service.updateFrontmatter({ path: briefPath, patch: { implemented: true }, changedBy: 'user' });
    expect(await fileBytes(briefPath)).toBe(bytes);
    expect(service.listVersions(briefPath).length).toBe(before + 1);
    // The body is untouched (a long brief is not cut to the response budget by the flag write).
    const big = await bigBrief();
    const bigBefore = matter(await fileBytes(big)).content;
    await service.updateFrontmatter({ path: big, patch: { implemented: true }, changedBy: 'user' });
    const bigAfter = matter(await fileBytes(big));
    expect(bigAfter.data.implemented).toBe(true);
    expect(bigAfter.content).toBe(bigBefore);
    await expect(
      service.updateFrontmatter({ path: 'nope.md', patch: { implemented: true }, changedBy: 'user' }),
    ).rejects.toMatchObject({ code: 'BRIEF_NOT_FOUND' });
  });

  it('[entity:katalog-operacji-m21#list_brief_versions] the row: direct internal/mcp/rest (cli n/a — dev-0004), no effects, idempotent, `path` + history window limit/offset, metadata only; BRIEF_NOT_FOUND for an unknown path, never an empty list', async () => {
    const op = CATALOG.require('list_brief_versions');
    expect(op.scope).toBe('project');
    expect(op.mediation).toBe('direct');
    expect(op.opClass).toBe('brief');
    expect(op.channels.internal.kind).toBe('direct');
    expect(op.channels.mcp.kind).toBe('direct');
    expect(op.channels.rest.kind).toBe('direct');
    // ASSUMPTION:dev-0004 — M21 L14 names no brief-history command.
    expect(op.channels.cli.kind).toBe('na');
    expect(op.sideEffects).toEqual(['none']);
    expect(op.idempotent).toBe(true);
    expect([...op.errorCodes]).toEqual(['BRIEF_NOT_FOUND']);
    expect(Object.keys(op.inputSchema).sort()).toEqual(['limit', 'offset', 'path']);
    expect(props(await toolOf(internal, 'list_brief_versions'))).toEqual(['limit', 'offset']);
    const ext = await toolOf(external, 'list_brief_versions');
    expect(props(ext)).toEqual(['limit', 'offset', 'path']);
    expect(ext.inputSchema.required).toEqual(['path']);

    const first = await call(internal, 'get_brief', {});
    await call(internal, 'update_brief', { action: 'append', content: 'second', expectedHash: first.body.hash });
    const all = await call(external, 'list_brief_versions', { path: briefPath });
    expect(all.body.total).toBe(2);
    expect(all.body.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    expect(JSON.stringify(all.body)).not.toContain('alpha body');
    const page = await call(internal, 'list_brief_versions', { offset: 1, limit: 1 });
    expect(page.body.versions.map((v: { version: number }) => v.version)).toEqual([2]);
    expect(page.body.total).toBe(2);
    const unknown = await call(external, 'list_brief_versions', { path: 'nope.md' });
    expect(unknown.isError).toBe(true);
    expect(unknown.body.code).toBe('BRIEF_NOT_FOUND');
  });

  it('[entity:katalog-operacji-m21#get_brief_version] the row: direct internal/mcp/rest (cli n/a — dev-0004), no effects, idempotent, `(path, version)`; BRIEF_NOT_FOUND for an unknown path, a version off the history INVALID_ARGUMENT with the range (dev-0003)', async () => {
    const op = CATALOG.require('get_brief_version');
    expect(op.scope).toBe('project');
    expect(op.mediation).toBe('direct');
    expect(op.opClass).toBe('brief');
    expect(op.channels.internal.kind).toBe('direct');
    expect(op.channels.mcp.kind).toBe('direct');
    expect(op.channels.rest.kind).toBe('direct');
    expect(op.channels.cli.kind).toBe('na');
    expect(op.sideEffects).toEqual(['none']);
    expect(op.idempotent).toBe(true);
    expect([...op.errorCodes].sort()).toEqual(['BRIEF_NOT_FOUND', 'INVALID_ARGUMENT']);
    expect(Object.keys(op.inputSchema).sort()).toEqual(['path', 'version']);
    expect(props(await toolOf(internal, 'get_brief_version'))).toEqual(['version']);
    const ext = await toolOf(external, 'get_brief_version');
    expect(props(ext)).toEqual(['path', 'version']);
    expect([...(ext.inputSchema.required ?? [])].sort()).toEqual(['path', 'version']);

    const v1 = await call(external, 'get_brief_version', { path: briefPath, version: 1 });
    expect(v1.isError).toBe(false);
    expect(v1.body.version).toBe(1);
    expect(JSON.stringify(v1.body)).toContain('alpha body');
    const off = await call(internal, 'get_brief_version', { version: 7 });
    expect(off.isError).toBe(true);
    expect(off.body.code).toBe('INVALID_ARGUMENT');
    expect(off.body.hint).toContain('1..1');
    expect((await call(external, 'get_brief_version', { path: 'nope.md', version: 1 })).body.code).toBe('BRIEF_NOT_FOUND');
  });

  it('[entity:katalog-operacji-m21#create_brief] the row: direct, internal n/a with its reason, cli/mcp/rest direct, file+db+ui-notify, not idempotent, literal content, addressed by the release window; BRIEF_SAME_RELEASE + VALIDATION', async () => {
    const op = CATALOG.require('create_brief');
    expect(op.scope).toBe('project');
    expect(op.mediation).toBe('direct');
    expect(op.channels.internal.kind).toBe('na');
    expect((op.channels.internal as { reason: string }).reason).toMatch(/anchored in one artifact/);
    for (const channel of ['cli', 'mcp', 'rest'] as const) expect(op.channels[channel].kind, channel).toBe('direct');
    expect([...op.sideEffects].sort()).toEqual(['db', 'file', 'ui-notify']);
    expect(op.idempotent).toBe(false);
    expect(op.contentInput).toBe('literal');
    expect([...op.errorCodes].sort()).toEqual(['BRIEF_SAME_RELEASE', 'VALIDATION']);
    expect(Object.keys(op.inputSchema).sort()).toEqual(['content', 'fromReleaseName', 'roots', 'suffix', 'toReleaseName']);
    // No brief-tools tool mints a brief.
    expect(await mountedNames(internal)).not.toContain('create_brief');
    expect(await mountedNames(external)).not.toContain('create_brief');

    // Not idempotent: each call mints a new brief (a collision is settled by `suffix`).
    const again = await service.createBrief({ fromReleaseName: 'v1', toReleaseName: 'v2', content: 'body\n', suffix: 'two' });
    expect(again.briefPath).not.toBe(briefPath);
    expect(again.hash).toBe(sha256(await fileBytes(again.briefPath)));
    await expect(service.createBrief({ fromReleaseName: 'v1', toReleaseName: 'v1' })).rejects.toMatchObject({ code: 'BRIEF_SAME_RELEASE' });
    await expect(service.createBrief({ fromReleaseName: 'v1', toReleaseName: 'v2', content: '  \n' })).rejects.toMatchObject({ code: 'VALIDATION' });
    // A window naming a release that does not exist is an invalid input — VALIDATION, not a leaked RELEASE_NOT_FOUND.
    await expect(service.createBrief({ fromReleaseName: 'ghost', toReleaseName: 'v2' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(service.createBrief({ fromReleaseName: 'v1', toReleaseName: 'ghost' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
