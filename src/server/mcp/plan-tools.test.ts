import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { buildPlanToolsServer } from './plan-tools.js';
import { PlanService } from '../services/plan.js';
import { ChatService } from '../services/chat.js';
import { MarkdownFileStore } from '../services/pages.js';
import { FileSerializer } from '../services/file-serializer.js';
import { FileVersionService } from '../services/file-version.js';
import { PagesFrontmatterIndexer } from '../services/pages-frontmatter-indexer.js';
import { FileWatchRuntime } from '../fs/watcher.js';
import { artifactSource, boundWriter } from '../fs/sources.js';
import { systemRootId } from '../../shared/root-kinds.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import { CATALOG } from '../operations/catalog.js';
import { registerCoreOperations } from '../operations/core-operations.js';
import { artifactAddressingShape } from '../operations/addressing.js';
import { DEFAULT_BUDGET_CHARS } from '../discovery/budget.js';
import matter from 'gray-matter';
import { PLAN_TOOL_RECORDS } from '../../../tests/helpers/plan-tool-records.js';
import { expectToolMatchesToolRecord } from '../../../tests/helpers/write-tool-records.js';

/**
 * 0.2.43 — `update_plan` over its MCP adapter.
 *
 * The engine has its own tests (`services/plan-write.test.ts`) and so does the
 * service (`tests/integration/db/plans.test.ts`). What is asserted here is what
 * only the ADAPTER can get wrong: that a variant the caller did NOT send stays
 * absent all the way to the validator (a default would make every call carry
 * two), that `results` reaches the wire, and that a refusal keeps the recovery
 * information — `currentHash`, `details` — instead of flattening to a code.
 */

const noopWs: WsEmitter = { broadcast: () => {} };

describe('plan-tools — update_plan', () => {
  let cwd: string;
  let db: Database.Database;
  let client: Client;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-plan-tools-'));
    db = createTestDb();
    const plansPages = new MarkdownFileStore({ cwd, dir: 'plans', rootId: systemRootId('plans'), kind: 'plans' });
    await plansPages.ensureRoot();
    const runtime = new FileWatchRuntime({ fsEvents: false });
    runtime.mountSource({ source: artifactSource('plan'), dir: plansPages.root, scope: 'context:test' });
    const watch = runtime.scoped('context:test');
    const plansSerializer = new FileSerializer(plansPages);
    const pageVersions = new FileVersionService(db, plansSerializer);
    const chatService = new ChatService(db);
    const service = new PlanService({
      plansPages,
      plansWatcher: boundWriter(watch, artifactSource('plan')),
      plansSerializer,
      pageVersions,
      chatService,
      frontmatterIndexer: new PagesFrontmatterIndexer(new Map([[systemRootId('plans'), plansPages]]), noopWs),
      ws: noopWs,
    });
    db.prepare(`INSERT INTO chat_thread (id) VALUES (?)`).run('t-1');

    const { server } = buildPlanToolsServer({ threadId: 't-1', planService: service, pageVersions });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    db.close();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  async function call(name: string, args: Record<string, unknown>) {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ type: string; text?: string }>)[0]?.text ?? '{}';
    return { isError: res.isError === true, body: JSON.parse(text) as Record<string, any> };
  }

  /** Creates the plan and returns its anchors plus the hash arming the next call. */
  async function createPlan(): Promise<{ anchors: string[]; hash: string }> {
    const created = await call('update_plan', {
      title: 'Tool plan',
      content: '## Alpha\n\nalpha body\n\n## Beta\n\nbeta body\n',
      changeSummary: 'create',
    });
    expect(created.isError).toBe(false);
    const read = await call('get_plan', {});
    const body = read.body.plan.content as string;
    return {
      anchors: [...body.matchAll(/<!-- anchor: ([a-z0-9]{8}) -->/g)].map((m) => m[1]!),
      hash: created.body.hash as string,
    };
  }

  it('no longer declares a top-level action, anchor or heading', async () => {
    const { tools } = await client.listTools();
    const props = tools.find((t) => t.name === 'update_plan')!.inputSchema.properties!;
    expect(Object.keys(props).sort()).toEqual(
      ['changeSummary', 'content', 'edits', 'expectedHash', 'textEdits', 'title'].sort(),
    );
  });

  it('0.2.98 — the thread mount lists exactly six tools, create_plan first-class among them', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['create_plan', 'get_plan', 'update_plan', 'list_plan_versions', 'get_plan_version', 'mark_plan_applied'].sort(),
    );
    const createProps = tools.find((t) => t.name === 'create_plan')!.inputSchema;
    expect(Object.keys(createProps.properties!).sort()).toEqual(['content', 'title']);
    expect(createProps.required).toEqual(['title']);
  });

  it('0.2.98 — create_plan founds a NEW carrier thread, answers { path, hash, threads } and never echoes content', async () => {
    const content = '## Only\n\nsecret-marker body\n';
    const res = await call('create_plan', { title: 'Direct plan', content });
    expect(res.isError).toBe(false);
    expect(res.body.path).toBe('direct-plan.md');
    expect(typeof res.body.hash).toBe('string');
    expect(res.body.threads).toHaveLength(1);
    expect(res.body.threads[0]).not.toBe('t-1');
    expect(JSON.stringify(res.body)).not.toContain('secret-marker');

    // The calling thread stays planless — the plan belongs to the carrier.
    const own = await call('get_plan', {});
    expect(own.body.plan).toBeNull();

    const again = await call('create_plan', { title: 'Direct plan', content: 'other' });
    expect(again.isError).toBe(true);
    expect(again.body.code).toBe('PLAN_ALREADY_EXISTS');

    const blank = await call('create_plan', { title: 'Blank plan', content: '   ' });
    expect(blank.isError).toBe(true);
    expect(blank.body.code).toBe('INVALID_ARGUMENT');
  });

  /**
   * 0.2.100 — `rename` through the adapter. The splice itself belongs to
   * `plan-write.test.ts`; what only this level can show is the schema the tool
   * publishes and the shape of the row that comes back over the wire.
   */
  it('declares the sixth action and a heading field on edits[]', async () => {
    const { tools } = await client.listTools();
    const props = tools.find((t) => t.name === 'update_plan')!.inputSchema.properties!;
    const entry = (props.edits as any).items.properties;
    expect(entry.action.enum).toEqual(['replace', 'append', 'insert_after', 'delete', 'edit', 'rename']);
    expect(entry.heading.type).toBe('string');
  });

  it('answers a rename row with previousHeading, and leaves the key off every other row', async () => {
    const { anchors, hash } = await createPlan();
    const res = await call('update_plan', {
      expectedHash: hash,
      edits: [
        { anchor: anchors[0]!, action: 'rename', heading: 'Alpha, renamed' },
        { anchor: anchors[1]!, action: 'append', content: 'more beta\n' },
      ],
      changeSummary: 'rename one, append to the other',
    });

    expect(res.isError).toBe(false);
    expect(res.body.results[0]).toEqual({
      anchor: anchors[0],
      action: 'rename',
      affectedAnchors: expect.any(Array),
      droppedAnchors: [],
      previousHeading: 'Alpha',
    });
    // Absent over the wire, not present-and-empty.
    expect('previousHeading' in res.body.results[1]).toBe(false);

    const read = await call('get_plan', {});
    const body = read.body.plan.content as string;
    expect(body).toContain('## Alpha, renamed');
    // Level, anchor and body all survive the rename.
    expect(body).toContain(`<!-- anchor: ${anchors[0]} -->`);
    expect(body).toContain('alpha body');
  });

  it('[ac:ac-rename-w-paczce-update-plan-na-anchor] answers SECTION_NOT_FOUND for an anchor the plan does not carry', async () => {
    const { hash } = await createPlan();
    const before = ((await call('get_plan', {})).body.plan.content as string);

    const res = await call('update_plan', {
      expectedHash: hash,
      edits: [{ anchor: 'zzzz9999', action: 'rename', heading: 'Nowhere' }],
      changeSummary: 'rename a section that is not there',
    });

    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('SECTION_NOT_FOUND');
    // NEVER an append at the end: a rename with an unresolved target has no
    // second reading, and writing the heading somewhere else is a different act.
    const after = ((await call('get_plan', {})).body.plan.content as string);
    expect(after).toBe(before);
    expect(after).not.toContain('Nowhere');
  });

  it('refuses a call that names two variants, and one that names none', async () => {
    const both = await call('update_plan', {
      title: 'x',
      content: 'a',
      textEdits: [{ find: 'a', replaceWith: 'b' }],
      changeSummary: 's',
    });
    expect(both.isError).toBe(true);
    expect(both.body.code).toBe('INVALID_ARGUMENT');

    const neither = await call('update_plan', { title: 'x', changeSummary: 's' });
    expect(neither.isError).toBe(true);
    expect(neither.body.code).toBe('INVALID_ARGUMENT');
  });

  it('answers a batch with one results row per edit, carrying the anchors it dropped', async () => {
    const { anchors, hash } = await createPlan();
    const res = await call('update_plan', {
      expectedHash: hash,
      edits: [
        { anchor: anchors[0]!, action: 'edit', textEdits: [{ find: 'alpha body', replaceWith: 'ALPHA' }] },
        { anchor: anchors[1]!, action: 'delete' },
      ],
      changeSummary: 'edit one, drop the other',
    });
    expect(res.isError).toBe(false);
    expect(res.body.results).toEqual([
      {
        anchor: anchors[0],
        action: 'edit',
        affectedAnchors: expect.any(Array),
        droppedAnchors: [],
        replacements: 1,
      },
      {
        anchor: anchors[1],
        action: 'delete',
        affectedAnchors: expect.any(Array),
        droppedAnchors: [anchors[1]],
      },
    ]);
    // Echo-free: the plan's text is not in the answer.
    expect(Object.keys(res.body).sort()).toEqual(['hash', 'path', 'results', 'version']);
  });

  it('keeps the normalization diagnosis in the FIND_NOT_FOUND envelope', async () => {
    const { anchors, hash } = await createPlan();
    const res = await call('update_plan', {
      expectedHash: hash,
      edits: [
        { anchor: anchors[0]!, action: 'edit', textEdits: [{ find: 'alpha    body', replaceWith: 'x' }] },
      ],
      changeSummary: 'mis-transcribed spaces',
    });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('FIND_NOT_FOUND');
    expect(res.body.details[0].matchesAfterWhitespaceNormalization).toBe(1);
  });

  it('keeps the current hash in the PLAN_CONFLICT envelope, so the retry has something to arm with', async () => {
    const { hash } = await createPlan();
    await call('update_plan', { expectedHash: hash, content: '## Moved on\n', changeSummary: 'first' });
    const stale = await call('update_plan', {
      expectedHash: hash,
      content: '## Too late\n',
      changeSummary: 'second',
    });
    expect(stale.isError).toBe(true);
    expect(stale.body.code).toBe('PLAN_CONFLICT');
    expect(stale.body.currentHash).toBeTruthy();
    expect(stale.body.currentHash).not.toBe(hash);
  });
});


/**
 * 2.1.13 — M10 thread isolation (`m10mcp00`), the `get_plan` window and budget,
 * `create_plan` belonging to its carrier thread, over BOTH mounts of the real
 * server: the thread mount (`internal`, thread `t-1`) and the threadless one
 * (`target: 'explicit'`, the external `mcp` rendering — "spoza aplikacji").
 *
 * 2.1.26 — the M10 page no longer embeds the `katalog-operacji-m10` sheet: the
 * eight plan operations are `spec-operation` records, and each mount's tools are
 * `mcp-tool` records (`plan-tools-<tool>` for the thread mount,
 * `plan-tools-<tool>-explicit` for the threadless one). Both are asserted below,
 * one tagged test per record.
 */
describe('plan-tools — M10 thread isolation, the plan tools and the plan operations (2.1.26)', () => {
  let cwd: string;
  let db: Database.Database;
  let service: PlanService;
  let pageVersions: FileVersionService;
  let indexer: PagesFrontmatterIndexer;
  let plansRoot: string;
  let internal: Client;
  let external: Client;
  let connect: (target?: 'explicit', threadId?: string) => Promise<Client>;
  let events: Array<Record<string, unknown>>;

  beforeAll(() => {
    registerCoreOperations();
  });

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-plan-iso-'));
    db = createTestDb();
    events = [];
    const ws: WsEmitter = { broadcast: (event) => { events.push(event as unknown as Record<string, unknown>); } };
    const plansPages = new MarkdownFileStore({ cwd, dir: 'plans', rootId: systemRootId('plans'), kind: 'plans' });
    await plansPages.ensureRoot();
    plansRoot = plansPages.root;
    const runtime = new FileWatchRuntime({ fsEvents: false });
    runtime.mountSource({ source: artifactSource('plan'), dir: plansPages.root, scope: 'context:test' });
    const watch = runtime.scoped('context:test');
    const plansSerializer = new FileSerializer(plansPages);
    pageVersions = new FileVersionService(db, plansSerializer);
    indexer = new PagesFrontmatterIndexer(new Map([[systemRootId('plans'), plansPages]]), noopWs);
    service = new PlanService({
      plansPages,
      plansWatcher: boundWriter(watch, artifactSource('plan')),
      plansSerializer,
      pageVersions,
      chatService: new ChatService(db),
      frontmatterIndexer: indexer,
      ws,
    });
    db.prepare(`INSERT INTO chat_thread (id) VALUES (?)`).run('t-1');
    db.prepare(`INSERT INTO chat_thread (id) VALUES (?)`).run('t-2');

    connect = async (target?: 'explicit', threadId = 't-1'): Promise<Client> => {
      const { server } = buildPlanToolsServer({
        threadId: target ? 'mcp-external' : threadId,
        ...(target ? { target } : {}),
        planService: service,
        pageVersions,
      });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'test-client', version: '0.0.0' });
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      return client;
    };
    internal = await connect();
    external = await connect('explicit');
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

  const threadCount = () => (db.prepare(`SELECT COUNT(*) AS n FROM chat_thread`).get() as { n: number }).n;
  const versionRowCount = () => (db.prepare(`SELECT COUNT(*) AS n FROM file_version`).get() as { n: number }).n;
  const planFiles = async () => (await fs.readdir(plansRoot)).filter((f) => f.endsWith('.md')).sort();
  const fileOf = (rel: string) => fs.readFile(path.join(plansRoot, rel), 'utf-8');
  const planEvents = () => events.filter((e) => e.kind === 'plan:updated');

  /** A plan pinned to `t-1` through the internal mount (the first update_plan creates and pins it). */
  async function pinPlanToT1(content = '## Alpha\n\nalpha body\n\n## Beta\n\nbeta body\n') {
    const created = await call(internal, 'update_plan', { title: 'Pinned plan', content, changeSummary: 'create' });
    expect(created.isError).toBe(false);
    return created.body as { path: string; hash: string; version: number };
  }

  /** Pin `t-1` to a path directly — e.g. one whose file is gone. */
  const pinT1To = (rel: string) => db.prepare(`UPDATE chat_thread SET plan_path = ? WHERE id = 't-1'`).run(rel);

  /** Overwrite a pinned plan with a file that is not a plan (`type` other than `plan`). */
  const makeNotAPlan = (rel: string) => fs.writeFile(path.join(plansRoot, rel), '---\ntype: note\ntitle: Not a plan\n---\n# Note\n', 'utf-8');

  /** A plan file dropped on disk by hand (no version row), indexed so the list sees it. */
  async function handPlan(rel: string, title: string, createdAt: string) {
    await fs.writeFile(
      path.join(plansRoot, rel),
      `---\ntype: plan\ntitle: ${title}\ncreated_at: '${createdAt}'\n---\n# ${title}\n`,
      'utf-8',
    );
    await indexer.indexPage(systemRootId('plans'), rel);
  }

  /** The registered declaration of a mounted tool, for the record matcher. */
  async function declOf(target: 'thread' | 'explicit', name: string) {
    const { tools } = buildPlanToolsServer({
      threadId: target === 'explicit' ? 'mcp-external' : 't-1',
      ...(target === 'explicit' ? { target } : {}),
      planService: service,
      pageVersions,
    });
    return tools!.find((t) => t.name === name);
  }

  // ── behaviour of the thread mount (2.1.13) ───────────────────────────────

  it('get_plan on the thread mount: only `range` in the schema (no path, no threadId) — thread-resolved, null when nothing is pinned, window, refusal past the end', async () => {
    const tool = await toolOf(internal, 'get_plan');
    expect(props(tool)).toEqual(['range']);
    expect(tool.inputSchema.required ?? []).toEqual([]);

    // No plan pinned → `plan: null`, not an error.
    const none = await call(internal, 'get_plan', {});
    expect(none.isError).toBe(false);
    expect(none.body).toEqual({ plan: null });

    const created = await pinPlanToT1();
    const read = await call(internal, 'get_plan', {});
    expect(read.isError).toBe(false);
    expect(Object.keys(read.body.plan).sort()).toEqual(
      ['applied', 'content', 'createdAt', 'currentVersion', 'hash', 'path', 'title', 'updatedAt'].sort(),
    );
    expect(read.body.plan).not.toHaveProperty('threadId');
    expect(read.body.plan.path).toBe(created.path);
    expect(read.body.plan.title).toBe('Pinned plan');
    expect(read.body.plan.applied).toBe(false);
    expect(read.body.plan.currentVersion).toBe(1);
    expect(read.body.plan.hash).toBe(created.hash);
    expect(read.body.plan.content).toContain('alpha body');

    // Window: 1-based inclusive line range over the file.
    const fileLines = (await fileOf(created.path)).split('\n');
    const alphaLine = fileLines.findIndex((l) => l === 'alpha body') + 1;
    const windowed = await call(internal, 'get_plan', { range: { start: alphaLine, end: alphaLine } });
    expect(windowed.isError).toBe(false);
    expect(windowed.body.plan.content).toBe('alpha body');
    // The hash stays the digest of the whole plan.
    expect(windowed.body.plan.hash).toBe(created.hash);

    // A window starting past the end of the file is refused with the file size.
    const past = await call(internal, 'get_plan', { range: { start: fileLines.length + 5, end: fileLines.length + 9 } });
    expect(past.isError).toBe(true);
    expect(past.body.code).toBe('INVALID_ARGUMENT');
    expect(past.body.error).toContain(`has ${fileLines.length} lines`);
  });

  it('get_plan: a plan over the response budget comes back truncated: true with a truncationHint pointing at `range`', async () => {
    const line = 'x'.repeat(60);
    const big = Array.from({ length: Math.ceil(DEFAULT_BUDGET_CHARS / 30) }, (_, i) => `${i} ${line}`).join('\n');
    await pinPlanToT1(`## Big\n\n${big}\n`);
    const read = await call(internal, 'get_plan', {});
    expect(read.isError).toBe(false);
    expect(read.body.plan.truncated).toBe(true);
    expect(read.body.plan.truncationHint).toMatch(/range/);
    expect((read.body.plan.content as string).length).toBeLessThan(big.length);
  });

  it('create_plan on the thread mount: title (required) + content (optional), no path / threadId — slug once from slugify(title), three effects in one call, refusals leave none of them', async () => {
    const tool = await toolOf(internal, 'create_plan');
    expect(props(tool)).toEqual(['content', 'title']);
    expect(tool.inputSchema.required).toEqual(['title']);

    const before = threadCount();
    const res = await call(internal, 'create_plan', { title: 'Carrier Owned Plan', content: '## Body\n\ntext\n' });
    expect(res.isError).toBe(false);
    expect(res.body.path).toBe('carrier-owned-plan.md');
    expect(res.body.threads).toHaveLength(1);
    // Three effects: the file, version 1 on file_version, a top-level generic carrier thread bound by plan_path.
    expect(await planFiles()).toEqual(['carrier-owned-plan.md']);
    expect((await service.getByAddress('carrier-owned-plan.md')).currentVersion).toBe(1);
    expect(threadCount()).toBe(before + 1);
    const carrier = db
      .prepare(`SELECT plan_path, parent_thread_id, context_type FROM chat_thread WHERE id = ?`)
      .get(res.body.threads[0]) as { plan_path: string; parent_thread_id: string | null; context_type: string };
    expect(carrier).toEqual({ plan_path: 'carrier-owned-plan.md', parent_thread_id: null, context_type: 'chat' });

    // The plan belongs to the carrier, not to the calling thread: the caller's
    // get_plan stays null, and a `path` it tries to pass is not in the schema.
    expect((await call(internal, 'get_plan', {})).body).toEqual({ plan: null });
    expect((await call(internal, 'get_plan', { path: 'carrier-owned-plan.md' })).body).toEqual({ plan: null });
    expect(db.prepare(`SELECT plan_path FROM chat_thread WHERE id = 't-1'`).get()).toEqual({ plan_path: null });

    // A blank title is refused with the operation's code, and nothing is created.
    const blankTitle = await call(internal, 'create_plan', { title: '   ', content: 'x' });
    expect(blankTitle.isError).toBe(true);
    expect(blankTitle.body.code).toBe('INVALID_ARGUMENT');
    expect(await planFiles()).toEqual(['carrier-owned-plan.md']);
    expect(threadCount()).toBe(before + 1);
  });

  // ── criteria (create_plan) ───────────────────────────────────────────────

  it('[ac:ac-create-plan-z-content-pusta-po-trim-z] content blank after trim → INVALID_ARGUMENT, and after the refusal there is neither a plan file nor a carrier thread', async () => {
    const before = threadCount();
    const res = await call(external, 'create_plan', { title: 'Blank Body', content: '  \n\t  \n' });
    expect(res.isError).toBe(true);
    expect(res.body.code).toBe('INVALID_ARGUMENT');
    expect(await planFiles()).toEqual([]);
    await expect(fs.access(path.join(plansRoot, 'blank-body.md'))).rejects.toThrow();
    expect(threadCount()).toBe(before);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM chat_thread WHERE plan_path = 'blank-body.md'`).get()).toEqual({ n: 0 });
  });

  it('[ac:ac-create-plan-z-title-i-niepusta-conten] founding a plan from outside the app creates a file named from the title and answers with its address and the hash of its content', async () => {
    const res = await call(external, 'create_plan', { title: 'Wire Contract Migration', content: '## Phase A\n\nmove the DTOs\n' });
    expect(res.isError).toBe(false);
    expect(res.body.path).toBe('wire-contract-migration.md');
    expect(await planFiles()).toEqual(['wire-contract-migration.md']);
    const bytes = await fileOf('wire-contract-migration.md');
    expect(bytes).toContain('move the DTOs');
    expect(res.body.hash).toBe(crypto.createHash('sha256').update(bytes, 'utf-8').digest('hex'));
    // The content is not echoed back.
    expect(JSON.stringify(res.body)).not.toContain('move the DTOs');
  });

  it('[ac:ac-create-plan-z-title-ktorego-slugify-t] a title whose slugify(title) points at an existing plan → PLAN_ALREADY_EXISTS, no suffixed slug and nothing appended to the existing file', async () => {
    const first = await call(external, 'create_plan', { title: 'Direct plan', content: 'original body\n' });
    expect(first.isError).toBe(false);
    const original = await fileOf('direct-plan.md');
    const threadsBefore = threadCount();

    // A different title with the same slug.
    const clash = await call(external, 'create_plan', { title: 'DIRECT  Plan', content: 'intruder body\n' });
    expect(clash.isError).toBe(true);
    expect(clash.body.code).toBe('PLAN_ALREADY_EXISTS');
    expect(await planFiles()).toEqual(['direct-plan.md']);
    const after = await fileOf('direct-plan.md');
    expect(after).toBe(original);
    expect(after).not.toContain('intruder body');
    expect(threadCount()).toBe(threadsBefore);
  });

  it('[ac:ac-create-plan-zaklada-razem-z-plikiem-w] founding a plan from outside the app founds, together with the file, the thread in which the plan will be discussed', async () => {
    const before = threadCount();
    const res = await call(external, 'create_plan', { title: 'Discussed plan', content: '## Intent\n\nx\n' });
    expect(res.isError).toBe(false);
    expect(res.body.threads).toHaveLength(1);
    expect(threadCount()).toBe(before + 1);
    const row = db
      .prepare(`SELECT id, plan_path, parent_thread_id FROM chat_thread WHERE id = ?`)
      .get(res.body.threads[0]) as { id: string; plan_path: string; parent_thread_id: string | null };
    expect(row.plan_path).toBe(res.body.path);
    expect(row.parent_thread_id).toBeNull();
    expect(await planFiles()).toEqual([res.body.path]);
  });

  it('[ac:ac-watek-zalozony-przy-powolaniu-planu-s] the thread founded with the plan starts empty — founding runs no turn in it', async () => {
    const res = await call(external, 'create_plan', { title: 'Quiet plan', content: '## Intent\n\nx\n' });
    expect(res.isError).toBe(false);
    const carrierId = res.body.threads[0] as string;
    expect(db.prepare(`SELECT COUNT(*) AS n FROM chat_message WHERE thread_id = ?`).get(carrierId)).toEqual({ n: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM chat_message`).get()).toEqual({ n: 0 });
  });

  // ── mcp-tool records (2.1.26) ────────────────────────────────────────────
  //
  // Each registered tool against its record (`tests/helpers/plan-tool-records.ts`):
  // name, description verbatim, parameters with type / requiredness / description,
  // exactly the record's (empty) hints — then the behaviour its `logic` states.

  /** create_plan's shared logic: `.md` slug path, refusals, the three effects together, no turn. */
  async function expectCreatePlanLogic(client: Client) {
    const files0 = await planFiles();
    const threads0 = threadCount();
    const versions0 = versionRowCount();

    const res = await call(client, 'create_plan', { title: 'Logic Plan', content: '## Body\n\ntext\n' });
    expect(res.isError).toBe(false);
    expect(Object.keys(res.body).sort()).toEqual(['hash', 'path', 'threads']);
    // The path is the title's slug with `.md`.
    expect(res.body.path).toBe('logic-plan.md');
    expect(res.body.hash).toBe(crypto.createHash('sha256').update(await fileOf('logic-plan.md'), 'utf-8').digest('hex'));
    expect(res.body.threads).toHaveLength(1);
    expect(await planFiles()).toEqual([...files0, 'logic-plan.md'].sort());
    expect(threadCount()).toBe(threads0 + 1);
    expect(versionRowCount()).toBe(versions0 + 1);
    // No turn starts.
    expect(db.prepare(`SELECT COUNT(*) AS n FROM chat_message`).get()).toEqual({ n: 0 });

    // A taken path is refused, not suffixed.
    const taken = await call(client, 'create_plan', { title: 'Logic  plan', content: 'other\n' });
    expect(taken.body.code).toBe('PLAN_ALREADY_EXISTS');
    // A missing content is refused like an empty one, although the schema marks it optional.
    expect((await call(client, 'create_plan', { title: 'No Content' })).body.code).toBe('INVALID_ARGUMENT');
    expect((await call(client, 'create_plan', { title: 'Empty Content', content: '' })).body.code).toBe('INVALID_ARGUMENT');
    expect(await planFiles()).toEqual([...files0, 'logic-plan.md'].sort());
    expect(threadCount()).toBe(threads0 + 1);

    // A write error undoes all three: no file, no version row, no carrier thread.
    const realIndex = indexer.indexPage.bind(indexer);
    indexer.indexPage = async () => {
      throw new Error('disk full');
    };
    try {
      const failed = await call(client, 'create_plan', { title: 'Doomed Plan', content: '## Body\n\nx\n' });
      expect(failed.isError).toBe(true);
    } finally {
      indexer.indexPage = realIndex;
    }
    expect(await planFiles()).toEqual([...files0, 'logic-plan.md'].sort());
    expect(threadCount()).toBe(threads0 + 1);
    expect(versionRowCount()).toBe(versions0 + 1);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM chat_thread WHERE plan_path = 'doomed-plan.md'`).get()).toEqual({ n: 0 });
  }

  it('[entity:plan-tools-create-plan] plan-tools · create_plan (thread mount): the record\'s name, description, title (required) + content (optional), no hints — `{ path, hash, threads }`, the path the slug with `.md`, a taken path PLAN_ALREADY_EXISTS, a missing content INVALID_ARGUMENT, file + first version + carrier thread together and undone together, no turn; the plan belongs to its carrier, not to the caller', async () => {
    expectToolMatchesToolRecord(await declOf('thread', 'create_plan'), PLAN_TOOL_RECORDS['plan-tools-create-plan']!);
    await expectCreatePlanLogic(internal);
    // The calling thread stays planless.
    expect((await call(internal, 'get_plan', {})).body).toEqual({ plan: null });
  });

  it('[entity:plan-tools-create-plan-explicit] plan-tools · create_plan (explicit): the record\'s name, description, title (required) + content (optional), no hints — the same logic on the threadless mount, and the returned path and hash are what update_plan takes there', async () => {
    expectToolMatchesToolRecord(await declOf('explicit', 'create_plan'), PLAN_TOOL_RECORDS['plan-tools-create-plan-explicit']!);
    await expectCreatePlanLogic(external);
    const made = await call(external, 'create_plan', { title: 'Hand On', content: '## A\n\na\n' });
    const edited = await call(external, 'update_plan', {
      path: made.body.path,
      expectedHash: made.body.hash,
      content: '## A\n\nb\n',
      changeSummary: 'edit',
    });
    expect(edited.isError).toBe(false);
    expect(edited.body.path).toBe('hand-on.md');
  });

  it('[entity:plan-tools-get-plan] plan-tools · get_plan (thread mount): the record\'s name, description, `range` only, no hints — `{ plan: null }` with nothing pinned, NOT_FOUND for a pinned file that is gone, PLAN_INVALID_FRONTMATTER for a non-plan, INVALID_ARGUMENT for a non-integer window, a start below 1, an end before the start or a start past the end, content cut at 25 000 characters, the hash of the whole file under a window', async () => {
    expectToolMatchesToolRecord(await declOf('thread', 'get_plan'), PLAN_TOOL_RECORDS['plan-tools-get-plan']!);

    expect((await call(internal, 'get_plan', {})).body).toEqual({ plan: null });
    const created = await pinPlanToT1('## Alpha\n\nalpha body\n\n## Beta\n\nbeta body\n');
    const read = await call(internal, 'get_plan', {});
    expect(Object.keys(read.body)).toEqual(['plan']);
    // `content` is the body without frontmatter.
    expect(read.body.plan.content).not.toContain('type: plan');
    for (const range of [{ start: 1.5, end: 3 }, { start: 0, end: 2 }, { start: 4, end: 2 }, { start: 999, end: 1000 }]) {
      const bad = await call(internal, 'get_plan', { range });
      expect(bad.body.code, JSON.stringify(range)).toBe('INVALID_ARGUMENT');
    }
    const windowed = await call(internal, 'get_plan', { range: { start: 1, end: 2 } });
    expect(windowed.body.plan.hash).toBe(created.hash);

    // The budget: 25 000 characters of content.
    const big = 'y'.repeat(80) + '\n';
    const update = await call(internal, 'update_plan', {
      expectedHash: created.hash,
      content: `## Big\n\n${big.repeat(400)}`,
      changeSummary: 'big',
    });
    expect(update.isError).toBe(false);
    const cut = await call(internal, 'get_plan', {});
    expect(cut.body.plan.truncated).toBe(true);
    expect((cut.body.plan.content as string).length).toBeLessThanOrEqual(25_000);
    expect(cut.body.plan.hash).toBe(update.body.hash);

    await makeNotAPlan(created.path);
    expect((await call(internal, 'get_plan', {})).body.code).toBe('PLAN_INVALID_FRONTMATTER');
    pinT1To('gone.md');
    expect((await call(internal, 'get_plan', {})).body.code).toBe('NOT_FOUND');
  });

  it('[entity:plan-tools-get-plan-explicit] plan-tools · get_plan (explicit): the record\'s name, description, `path` (required) + `range`, no hints — `{ plan }` of the named plan, an empty path INVALID_ARGUMENT with a hint to take one from list_plans, an unknown path PLAN_NOT_FOUND', async () => {
    expectToolMatchesToolRecord(await declOf('explicit', 'get_plan'), PLAN_TOOL_RECORDS['plan-tools-get-plan-explicit']!);

    const empty = await call(external, 'get_plan', { path: '' });
    expect(empty.body.code).toBe('INVALID_ARGUMENT');
    expect(empty.body.hint).toMatch(/list_plans/);
    expect((await call(external, 'get_plan', { path: 'no-such-plan.md' })).body.code).toBe('PLAN_NOT_FOUND');

    const created = await pinPlanToT1();
    const read = await call(external, 'get_plan', { path: created.path });
    expect(Object.keys(read.body)).toEqual(['plan']);
    expect(Object.keys(read.body.plan).sort()).toEqual(
      ['applied', 'content', 'createdAt', 'currentVersion', 'hash', 'path', 'title', 'updatedAt'].sort(),
    );
    expect(read.body.plan).toMatchObject({ path: created.path, title: 'Pinned plan', applied: false, currentVersion: 1, hash: created.hash });
  });

  it('[entity:plan-tools-get-plan-version] plan-tools · get_plan_version (thread mount): the record\'s name, description, `version` (integer, required) only, no hints — a planless thread INVALID_ARGUMENT with an update_plan hint, NOT_FOUND for a pinned file that is gone, PLAN_INVALID_FRONTMATTER for a non-plan, a number off the history (0 included) INVALID_ARGUMENT with the available range', async () => {
    expectToolMatchesToolRecord(await declOf('thread', 'get_plan_version'), PLAN_TOOL_RECORDS['plan-tools-get-plan-version']!);

    const none = await call(internal, 'get_plan_version', { version: 1 });
    expect(none.body.code).toBe('INVALID_ARGUMENT');
    expect(none.body.hint).toMatch(/update_plan/);

    const created = await pinPlanToT1('## Only\n\nfirst body\n');
    const v1 = await call(internal, 'get_plan_version', { version: 1 });
    expect(v1.isError).toBe(false);
    expect(v1.body).toMatchObject({ path: created.path, version: 1, op: 'create' });
    expect(v1.body.data.content).toContain('first body');
    for (const version of [0, 7]) {
      const off = await call(internal, 'get_plan_version', { version });
      expect(off.body.code, String(version)).toBe('INVALID_ARGUMENT');
      expect(off.body.hint).toContain('1 to 1');
    }
    await makeNotAPlan(created.path);
    expect((await call(internal, 'get_plan_version', { version: 1 })).body.code).toBe('PLAN_INVALID_FRONTMATTER');
    pinT1To('gone.md');
    expect((await call(internal, 'get_plan_version', { version: 1 })).body.code).toBe('NOT_FOUND');
  });

  it('[entity:plan-tools-get-plan-version-explicit] plan-tools · get_plan_version (explicit): the record\'s name, description, `path` + `version` (integer), both required, no hints — the snapshot of the named plan, a number off the history INVALID_ARGUMENT with the available range, an unknown path PLAN_NOT_FOUND', async () => {
    expectToolMatchesToolRecord(await declOf('explicit', 'get_plan_version'), PLAN_TOOL_RECORDS['plan-tools-get-plan-version-explicit']!);

    expect((await call(external, 'get_plan_version', { path: 'no-such-plan.md', version: 1 })).body.code).toBe('PLAN_NOT_FOUND');
    const created = await pinPlanToT1('## Only\n\nfirst body\n');
    await call(internal, 'update_plan', { expectedHash: created.hash, content: '## Only\n\nsecond body\n', changeSummary: 'two' });
    const v2 = await call(external, 'get_plan_version', { path: created.path, version: 2 });
    expect(v2.body).toMatchObject({ path: created.path, version: 2, op: 'update', changeSummary: 'two' });
    expect(v2.body.data.content).toContain('second body');
    const off = await call(external, 'get_plan_version', { path: created.path, version: 3 });
    expect(off.body.code).toBe('INVALID_ARGUMENT');
    expect(off.body.hint).toContain('1 to 2');
  });

  it('[entity:plan-tools-list-plan-versions] plan-tools · list_plan_versions (thread mount): the record\'s name, description, `limit` / `offset` (integers, optional), no hints — a planless thread `{ versions: [], total: 0 }`, NOT_FOUND for a pinned file that is gone, PLAN_INVALID_FRONTMATTER for a non-plan, oldest first, every version from `offset` without a `limit`, default offset 0', async () => {
    expectToolMatchesToolRecord(await declOf('thread', 'list_plan_versions'), PLAN_TOOL_RECORDS['plan-tools-list-plan-versions']!);

    expect((await call(internal, 'list_plan_versions', {})).body).toEqual({ versions: [], total: 0 });
    let hash = (await pinPlanToT1('## A\n\none\n')).hash;
    for (const n of ['two', 'three']) {
      hash = (await call(internal, 'update_plan', { expectedHash: hash, content: `## A\n\n${n}\n`, changeSummary: n })).body.hash;
    }
    const all = await call(internal, 'list_plan_versions', {});
    expect(Object.keys(all.body).sort()).toEqual(['total', 'versions']);
    expect(all.body.total).toBe(3);
    expect(all.body.versions.map((v: { version: number }) => v.version)).toEqual([1, 2, 3]);
    // Metadata only.
    for (const v of all.body.versions as Array<Record<string, unknown>>) expect(v).not.toHaveProperty('data');
    const fromOne = await call(internal, 'list_plan_versions', { offset: 1 });
    expect(fromOne.body.versions.map((v: { version: number }) => v.version)).toEqual([2, 3]);
    expect(fromOne.body.total).toBe(3);

    const planPath = (await call(internal, 'get_plan', {})).body.plan.path as string;
    await makeNotAPlan(planPath);
    expect((await call(internal, 'list_plan_versions', {})).body.code).toBe('PLAN_INVALID_FRONTMATTER');
    pinT1To('gone.md');
    expect((await call(internal, 'list_plan_versions', {})).body.code).toBe('NOT_FOUND');
  });

  it('[entity:plan-tools-list-plan-versions-explicit] plan-tools · list_plan_versions (explicit): the record\'s name, description, `path` (required) + `limit` / `offset`, no hints — `{ versions, total }` of the named plan, oldest first, every version from `offset` without a `limit`, an unknown path PLAN_NOT_FOUND', async () => {
    expectToolMatchesToolRecord(await declOf('explicit', 'list_plan_versions'), PLAN_TOOL_RECORDS['plan-tools-list-plan-versions-explicit']!);

    expect((await call(external, 'list_plan_versions', { path: 'no-such-plan.md' })).body.code).toBe('PLAN_NOT_FOUND');
    const created = await pinPlanToT1('## A\n\none\n');
    await call(internal, 'update_plan', { expectedHash: created.hash, content: '## A\n\ntwo\n', changeSummary: 'two' });
    const all = await call(external, 'list_plan_versions', { path: created.path });
    expect(all.body.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    expect(all.body.versions[0]).toMatchObject({ path: created.path, version: 1, op: 'create', changedBy: 'agent' });
    expect(all.body.total).toBe(2);
    const window = await call(external, 'list_plan_versions', { path: created.path, offset: 1, limit: 1 });
    expect(window.body.versions.map((v: { version: number }) => v.version)).toEqual([2]);
    expect(window.body.total).toBe(2);
  });

  it('[entity:plan-tools-list-plans-explicit] plan-tools · list_plans (explicit): the record\'s name, description, `search` (optional), no hints — `{ plans }` rows of path, title and last change, most recently changed first, `search` a case-insensitive substring of title or path, the last change the last version\'s time or, without versions, the frontmatter created_at; the thread mount has no list', async () => {
    expectToolMatchesToolRecord(await declOf('explicit', 'list_plans'), PLAN_TOOL_RECORDS['plan-tools-list-plans-explicit']!);
    expect(await declOf('thread', 'list_plans')).toBeUndefined();

    const made = await call(external, 'create_plan', { title: 'Fresh Plan', content: '## A\n\na\n' });
    await handPlan('hand-old.md', 'Hand Old', '2020-01-02T03:04:05.000Z');
    await handPlan('hand-newer.md', 'Hand Newer', '2021-06-07T08:09:10.000Z');

    const all = await call(external, 'list_plans', {});
    expect(Object.keys(all.body)).toEqual(['plans']);
    expect(all.body.plans.map((p: { path: string }) => p.path)).toEqual([made.body.path, 'hand-newer.md', 'hand-old.md']);
    for (const row of all.body.plans as Array<Record<string, unknown>>) expect(Object.keys(row).sort()).toEqual(['path', 'title', 'updatedAt']);
    // Without a version, the last change is the frontmatter's created_at.
    expect(all.body.plans[2]).toEqual({ path: 'hand-old.md', title: 'Hand Old', updatedAt: '2020-01-02T03:04:05.000Z' });
    // With one, it is the last version's time.
    expect(all.body.plans[0].updatedAt).toBe(pageVersions.getLatestForPath(made.body.path, undefined, service.rootId)!.createdAt);

    expect((await call(external, 'list_plans', { search: 'HAND' })).body.plans.map((p: { path: string }) => p.path)).toEqual([
      'hand-newer.md',
      'hand-old.md',
    ]);
    expect((await call(external, 'list_plans', { search: 'D-OL' })).body.plans.map((p: { path: string }) => p.path)).toEqual(['hand-old.md']);
  });

  it('[entity:plan-tools-mark-plan-applied] plan-tools · mark_plan_applied (thread mount): the record\'s name, description, `applied` (required) only, no hints — `applied: false` INVALID_ARGUMENT with the UI toggle in the hint, a planless thread INVALID_ARGUMENT, a flag already set writes nothing and emits nothing, otherwise a frontmatter-only write by the agent of the calling thread, no new version, `plan:updated` with the unchanged version number', async () => {
    expectToolMatchesToolRecord(await declOf('thread', 'mark_plan_applied'), PLAN_TOOL_RECORDS['plan-tools-mark-plan-applied']!);

    expect((await call(internal, 'mark_plan_applied', { applied: true })).body.code).toBe('INVALID_ARGUMENT');
    const created = await pinPlanToT1();
    const off = await call(internal, 'mark_plan_applied', { applied: false });
    expect(off.body.code).toBe('INVALID_ARGUMENT');
    expect(off.body.hint).toMatch(/UI|plan page/);

    const before = await fileOf(created.path);
    const versions = versionRowCount();
    events.length = 0;
    const marked = await call(internal, 'mark_plan_applied', { applied: true });
    expect(marked.body).toEqual({ path: created.path, applied: true });
    const after = await fileOf(created.path);
    expect(after).toMatch(/applied: true/);
    // Frontmatter only: the body is untouched, and no version is captured.
    expect(matterBody(after).trim()).toBe(matterBody(before).trim());
    expect(versionRowCount()).toBe(versions);
    expect(planEvents()).toEqual([
      { kind: 'plan:updated', planPath: created.path, threadId: 't-1', version: 1, changedBy: 'agent' },
    ]);

    // Already set: no write, no event.
    events.length = 0;
    expect((await call(internal, 'mark_plan_applied', { applied: true })).body).toEqual({ path: created.path, applied: true });
    expect(await fileOf(created.path)).toBe(after);
    expect(planEvents()).toEqual([]);
  });

  it('[entity:plan-tools-mark-plan-applied-explicit] plan-tools · mark_plan_applied (explicit): the record\'s name, description, `path` + `applied`, both required, no hints — `{ path, applied: true }`, an unknown path PLAN_NOT_FOUND before the flag is read, a repeat writes no file, no version and no event', async () => {
    expectToolMatchesToolRecord(await declOf('explicit', 'mark_plan_applied'), PLAN_TOOL_RECORDS['plan-tools-mark-plan-applied-explicit']!);

    expect((await call(external, 'mark_plan_applied', { path: 'no-such-plan.md', applied: true })).body.code).toBe('PLAN_NOT_FOUND');
    const created = await pinPlanToT1();
    expect((await call(external, 'mark_plan_applied', { path: created.path, applied: true })).body).toEqual({
      path: created.path,
      applied: true,
    });
    const bytes = await fileOf(created.path);
    const versions = versionRowCount();
    events.length = 0;
    expect((await call(external, 'mark_plan_applied', { path: created.path, applied: true })).body).toEqual({
      path: created.path,
      applied: true,
    });
    expect(await fileOf(created.path)).toBe(bytes);
    expect(versionRowCount()).toBe(versions);
    expect(planEvents()).toEqual([]);
  });

  it('[entity:plan-tools-update-plan] plan-tools · update_plan (thread mount): the record\'s name, description, its six parameters (no path), no hints — the create branch: a blank title MISSING_TITLE, the file named from the title\'s slug (`plan` when empty), a taken one suffixed -2, a `create` version, the plan pinned, expectedHash unchecked; an existing plan: a missing hash INVALID_ARGUMENT, a stale one PLAN_CONFLICT with the current hash, title without effect; one version per call, then `plan:updated`', async () => {
    expectToolMatchesToolRecord(await declOf('thread', 'update_plan'), PLAN_TOOL_RECORDS['plan-tools-update-plan']!);

    // The variant is settled before anything else: two variants → INVALID_ARGUMENT, no file.
    const two = await call(internal, 'update_plan', { title: 'X', content: 'a', textEdits: [{ find: 'a', replaceWith: 'b' }], changeSummary: 's' });
    expect(two.body.code).toBe('INVALID_ARGUMENT');
    expect((await call(internal, 'update_plan', { title: '   ', content: 'a', changeSummary: 's' })).body.code).toBe('MISSING_TITLE');
    expect(await planFiles()).toEqual([]);

    // A taken slug is suffixed on this branch (unlike create_plan).
    await call(external, 'create_plan', { title: 'Clash', content: '## A\n\na\n' });
    events.length = 0;
    const created = await call(internal, 'update_plan', {
      title: 'Clash',
      content: '## Mine\n\nmine\n',
      expectedHash: 'not-checked-on-create',
      changeSummary: 'create',
    });
    expect(created.isError).toBe(false);
    expect(created.body.path).toBe('clash-2.md');
    expect(created.body.version).toBe(1);
    expect(db.prepare(`SELECT plan_path FROM chat_thread WHERE id = 't-1'`).get()).toEqual({ plan_path: 'clash-2.md' });
    expect(pageVersions.listVersions('clash-2.md', service.rootId)[0]).toMatchObject({ op: 'create', changedBy: 'agent' });
    expect(planEvents()).toEqual([expect.objectContaining({ kind: 'plan:updated', planPath: 'clash-2.md', version: 1, changedBy: 'agent' })]);

    // A title with no slug-able character still names a file (ASSUMPTION:dev-2608 —
    // `slugify` never answers an empty slug, so the record's `plan` fallback is
    // the shared slug's non-empty `x-…` name).
    const t2 = await connect(undefined, 't-2');
    const bare = await call(t2, 'update_plan', { title: '???', content: '## A\n\na\n', changeSummary: 'create' });
    expect(bare.isError).toBe(false);
    expect(bare.body.path).toMatch(/^[a-z0-9][a-z0-9-]*\.md$/);

    // An existing plan: the guard, and title without effect.
    expect((await call(internal, 'update_plan', { content: '## B\n', changeSummary: 'no hash' })).body.code).toBe('INVALID_ARGUMENT');
    const stale = await call(internal, 'update_plan', { expectedHash: 'stale', content: '## B\n', changeSummary: 'stale' });
    expect(stale.body.code).toBe('PLAN_CONFLICT');
    expect(stale.body.currentHash).toBe(created.body.hash);
    events.length = 0;
    const second = await call(internal, 'update_plan', {
      title: 'Renamed?',
      expectedHash: created.body.hash,
      content: '## B\n\nb\n',
      changeSummary: 'second',
    });
    expect(Object.keys(second.body).sort()).toEqual(['hash', 'path', 'results', 'version']);
    expect(second.body).toMatchObject({ path: 'clash-2.md', version: 2 });
    expect(await fileOf('clash-2.md')).toMatch(/title: Clash\n/);
    expect(pageVersions.listVersions('clash-2.md', service.rootId)).toHaveLength(2);
    expect(planEvents()).toEqual([expect.objectContaining({ kind: 'plan:updated', planPath: 'clash-2.md', version: 2, changedBy: 'agent' })]);
  });

  it('[entity:plan-tools-update-plan-explicit] plan-tools · update_plan (explicit): the record\'s name, description, `path` (required) + the six parameters, no hints — an empty path INVALID_ARGUMENT with a list_plans hint, a path with no plan PLAN_NOT_FOUND listing the project\'s plans before any write, no create branch (title without effect, never MISSING_TITLE), `{ path, version, hash, results }`', async () => {
    expectToolMatchesToolRecord(await declOf('explicit', 'update_plan'), PLAN_TOOL_RECORDS['plan-tools-update-plan-explicit']!);

    const empty = await call(external, 'update_plan', { path: '', content: 'x', changeSummary: 's' });
    expect(empty.body.code).toBe('INVALID_ARGUMENT');
    expect(empty.body.hint).toMatch(/list_plans/);

    const made = await call(external, 'create_plan', { title: 'Known Plan', content: '## A\n\na\n' });
    const unknown = await call(external, 'update_plan', { path: 'no-such-plan.md', content: 'x', changeSummary: 's' });
    expect(unknown.body.code).toBe('PLAN_NOT_FOUND');
    expect(unknown.body.hint).toContain('known-plan.md');
    expect(await planFiles()).toEqual(['known-plan.md']);

    // No create branch: no title is needed and none takes effect.
    const edited = await call(external, 'update_plan', {
      path: made.body.path,
      expectedHash: made.body.hash,
      content: '## A\n\nb\n',
      changeSummary: 'edit',
    });
    expect(edited.isError).toBe(false);
    expect(Object.keys(edited.body).sort()).toEqual(['hash', 'path', 'results', 'version']);
    expect(edited.body).toMatchObject({ path: 'known-plan.md', version: 2 });
    expect(edited.body.results).toEqual([expect.objectContaining({ anchor: null, action: null })]);
    const titled = await call(external, 'update_plan', {
      path: made.body.path,
      title: 'Another Title',
      expectedHash: edited.body.hash,
      content: '## A\n\nc\n',
      changeSummary: 'titled',
    });
    expect(titled.isError).toBe(false);
    expect(await fileOf('known-plan.md')).toMatch(/title: Known Plan\n/);
    expect(await planFiles()).toEqual(['known-plan.md']);
  });

  // ── spec-operation records (2.1.26) ──────────────────────────────────────
  //
  // The eight M10 operations, as their `spec-operation` records declare them at
  // 2.1.26 (they replace the rows of the `katalog-operacji-m10` sheet the page
  // embedded until 2.1.25): name, scope, mediation, the four channel cells (an
  // `n/a` carrying the record's `powody` verbatim), effects, idempotence,
  // content input, exactly the record's `kodyBledow`, and `renderings` exactly
  // its `narzedzia` — each named mcp-tool record resolved to `<server>.<tool>`.

  type Cell = { kind: 'direct' } | { kind: 'na'; reason: string };
  const D: Cell = { kind: 'direct' };
  const PLAN_NO_CLI: Cell = { kind: 'na', reason: 'jedynym realnym wołającym jest agent w wątku albo użytkownik w UI, nie człowiek w terminalu' };
  /** 2.1.48 — the `get-plan` record's own reason. */
  const GET_PLAN_NO_CLI: Cell = { kind: 'na', reason: 'jedynym realnym wołającym jest agent w wątku, nie człowiek w terminalu' };

  function expectOperationRecord(record: {
    nazwa: string;
    mediacja?: 'direct' | 'human-mediated';
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
    expect(op.mediation).toBe(record.mediacja ?? 'direct');
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
      expected[channel] = slugs.map((slug) => {
        const tool = PLAN_TOOL_RECORDS[slug];
        expect(tool, slug).toBeDefined();
        return `${tool!.server}.${tool!.name}`;
      });
    }
    expect(op.renderings ?? {}).toEqual(expected);
    return op;
  }

  it('[entity:create-plan] create_plan as its record declares it: project, direct, all four channels direct, file+db, not idempotent, literal content, codes PLAN_ALREADY_EXISTS, INVALID_ARGUMENT, rendered by plan-tools · create_plan on both mounts — no address (the plan has none yet), the slug from the title, a taken one PLAN_ALREADY_EXISTS, an empty body INVALID_ARGUMENT, no turn; the plan belongs to its carrier thread', async () => {
    const op = expectOperationRecord({
      nazwa: 'create_plan',
      channels: { internal: D, cli: D, mcp: D, rest: D },
      efekty: ['file', 'db'],
      idempotencja: false,
      opisTresci: 'literal',
      kodyBledow: ['PLAN_ALREADY_EXISTS', 'INVALID_ARGUMENT'],
      narzedzia: { internal: ['plan-tools-create-plan'], mcp: ['plan-tools-create-plan-explicit'] },
    });
    expect(op.opClass).toBe('plan');
    expect(Object.keys(op.inputSchema).sort()).toEqual(['content', 'title']);
    expect(props(await toolOf(internal, 'create_plan'))).toEqual(['content', 'title']);
    expect(props(await toolOf(external, 'create_plan'))).toEqual(['content', 'title']);

    // The owning core function.
    const made = await service.create({ title: 'Row Plan', content: 'body\n', changedBy: 'agent' });
    expect(made.planPath).toBe('row-plan.md');
    await expect(service.create({ title: 'Row plan', content: 'x', changedBy: 'agent' })).rejects.toMatchObject({ code: 'PLAN_ALREADY_EXISTS' });
    await expect(service.create({ title: 'Empty', content: ' ', changedBy: 'agent' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(db.prepare(`SELECT plan_path FROM chat_thread WHERE id = ?`).get(made.threads[0])).toEqual({ plan_path: 'row-plan.md' });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM chat_message`).get()).toEqual({ n: 0 });
  });

  it('[entity:get-plan] get_plan as its record declares it: project, direct, internal/mcp/rest direct, cli n/a with the record\'s reason, no effects, idempotent, `path` + window `range`, codes PLAN_NOT_FOUND, INVALID_ARGUMENT, NOT_FOUND, PLAN_INVALID_FRONTMATTER, rendered by plan-tools · get_plan (internal thread mount, mcp explicit) — an unknown explicit path PLAN_NOT_FOUND, a pinned file that is gone NOT_FOUND, a non-plan PLAN_INVALID_FRONTMATTER, a window past the end INVALID_ARGUMENT, content over the response budget truncated: true with a truncationHint pointing at the line window', async () => {
    const op = expectOperationRecord({
      nazwa: 'get_plan',
      channels: { internal: D, cli: GET_PLAN_NO_CLI, mcp: D, rest: D },
      efekty: ['none'],
      idempotencja: true,
      opisTresci: undefined,
      kodyBledow: ['PLAN_NOT_FOUND', 'INVALID_ARGUMENT', 'NOT_FOUND', 'PLAN_INVALID_FRONTMATTER'],
      narzedzia: { internal: ['plan-tools-get-plan'], mcp: ['plan-tools-get-plan-explicit'] },
    });
    expect(op.opClass).toBe('plan');
    expect(Object.keys(op.inputSchema).sort()).toEqual(['path', 'range']);
    // explicit-addressing: required externally, absent in internal (M10 declares isolation).
    expect(artifactAddressingShape('plan', 'internal')).toBe('absent');
    expect(artifactAddressingShape('plan', 'mcp')).toBe('required');
    expect(props(await toolOf(internal, 'get_plan'))).toEqual(['range']);
    expect((await toolOf(external, 'get_plan')).inputSchema.required).toEqual(['path']);

    await expect(service.getByAddress('no-such-plan.md')).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });
    const created = await pinPlanToT1();
    await expect(service.getByAddress(created.path, { range: { start: 999, end: 1000 } })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await makeNotAPlan(created.path);
    await expect(service.getByThread('t-1')).rejects.toMatchObject({ code: 'PLAN_INVALID_FRONTMATTER' });
    pinT1To('gone.md');
    await expect(service.getByThread('t-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // 2.1.48 — content over the response budget comes back cut, flagged
    // `truncated: true`, with a `truncationHint` pointing at the line window.
    const big = Array.from({ length: Math.ceil(DEFAULT_BUDGET_CHARS / 30) }, (_, i) => `${i} ${'x'.repeat(60)}`).join('\n');
    const bigPlan = await service.create({ title: 'Big Read Plan', content: `${big}\nLAST LINE\n`, changedBy: 'agent' });
    const cut = await call(external, 'get_plan', { path: bigPlan.planPath });
    expect(cut.isError).toBe(false);
    expect(cut.body.plan.truncated).toBe(true);
    expect(cut.body.plan.truncationHint).toMatch(/range: \{ start: \d+, end: \d+ \}/);
    expect(cut.body.plan.content).not.toContain('LAST LINE');
  });

  it('[entity:update-plan] update_plan as its record declares it: project, direct, internal/mcp/rest direct, cli n/a with the record\'s reason, file+db+ui-notify, conditionally idempotent, content both ways, a required guard, its thirteen codes, rendered by plan-tools · update_plan (internal thread mount, mcp explicit) — the guard over the whole plan, PLAN_CONFLICT for a stale hash, PLAN_NOT_FOUND for an unknown explicit path, SECTION_NOT_FOUND / FIND_NOT_FOUND / MATCH_COUNT_MISMATCH in the batch and the substitutions, `content` idempotent by content while `append` is not', async () => {
    const op = expectOperationRecord({
      nazwa: 'update_plan',
      channels: { internal: D, cli: PLAN_NO_CLI, mcp: D, rest: D },
      efekty: ['file', 'db', 'ui-notify'],
      idempotencja: 'conditional',
      opisTresci: 'literal+diff',
      kodyBledow: [
        'PLAN_CONFLICT',
        'PLAN_NOT_FOUND',
        'SECTION_NOT_FOUND',
        'AMBIGUOUS_ANCHOR',
        'FIND_NOT_FOUND',
        'MATCH_COUNT_MISMATCH',
        'MISSING_TITLE',
        'IMMUTABLE_FIELD',
        'INVALID_ARGUMENT',
        'VALIDATION',
        'PLAN_INVALID_FRONTMATTER',
        'NOT_FOUND',
        'UNKNOWN_ARTIFACT_KIND',
      ],
      narzedzia: { internal: ['plan-tools-update-plan'], mcp: ['plan-tools-update-plan-explicit'] },
    });
    expect(Object.keys(op.inputSchema).sort()).toEqual(['changeSummary', 'content', 'edits', 'expectedHash', 'path', 'textEdits', 'title']);
    expect(props(await toolOf(internal, 'update_plan'))).not.toContain('path');
    expect((await toolOf(external, 'update_plan')).inputSchema.required).toEqual(expect.arrayContaining(['path', 'changeSummary']));

    expect((await call(external, 'update_plan', { path: 'no-such-plan.md', content: 'x', expectedHash: 'abc', changeSummary: 's' })).body.code).toBe(
      'PLAN_NOT_FOUND',
    );
    const created = await pinPlanToT1();
    const anchor = /<!-- anchor: ([a-z0-9]{8}) -->/.exec(await fileOf(created.path))![1]!;
    // A batch on one section is still guarded by the hash of the whole plan.
    const stale = await call(internal, 'update_plan', {
      expectedHash: 'f'.repeat(64),
      edits: [{ anchor, action: 'append', content: 'x\n' }],
      changeSummary: 'stale',
    });
    expect(stale.body.code).toBe('PLAN_CONFLICT');
    expect((await call(internal, 'update_plan', { expectedHash: created.hash, edits: [{ anchor: 'zzzzzzzz', action: 'delete' }], changeSummary: 's' })).body.code).toBe(
      'SECTION_NOT_FOUND',
    );
    expect((await call(internal, 'update_plan', { expectedHash: created.hash, textEdits: [{ find: 'no such text', replaceWith: 'x' }], changeSummary: 's' })).body.code).toBe(
      'FIND_NOT_FOUND',
    );
    expect((await call(internal, 'update_plan', { expectedHash: created.hash, textEdits: [{ find: 'body', replaceWith: 'x' }], changeSummary: 's' })).body.code).toBe(
      'MATCH_COUNT_MISMATCH',
    );

    // Conditional idempotence: the same `content` twice leaves the same text; `append` twice does not.
    const c1 = await call(internal, 'update_plan', { expectedHash: created.hash, content: '## Same\n\nsame\n', changeSummary: 'c1' });
    const settled = (await call(internal, 'get_plan', {})).body.plan.content as string;
    const c2 = await call(internal, 'update_plan', { expectedHash: c1.body.hash, content: settled, changeSummary: 'c2' });
    const c3 = await call(internal, 'update_plan', { expectedHash: c2.body.hash, content: settled, changeSummary: 'c3' });
    expect(c3.isError).toBe(false);
    expect(c3.body.hash).toBe(c2.body.hash);
    const sameAnchor = /<!-- anchor: ([a-z0-9]{8}) -->/.exec(await fileOf(created.path))![1]!;
    const a1 = await call(internal, 'update_plan', { expectedHash: c3.body.hash, edits: [{ anchor: sameAnchor, action: 'append', content: 'more\n' }], changeSummary: 'a1' });
    const a2 = await call(internal, 'update_plan', { expectedHash: a1.body.hash, edits: [{ anchor: sameAnchor, action: 'append', content: 'more\n' }], changeSummary: 'a2' });
    expect(a2.body.hash).not.toBe(a1.body.hash);
  });

  it('[entity:list-plans] list_plans as its record declares it: project, direct, internal/mcp/rest direct, cli n/a with the record\'s reason, no effects, idempotent, no codes, rendered by transagent-tools · list_plans in internal and by plan-tools · list_plans (explicit) in mcp, never by the thread mount — rows without content', async () => {
    const op = expectOperationRecord({
      nazwa: 'list_plans',
      channels: {
        internal: D,
        cli: { kind: 'na', reason: 'brak komendy `c4s`: jedynym realnym wołającym jest agent w wątku albo użytkownik w UI, nie człowiek w terminalu' },
        mcp: D,
        rest: D,
      },
      efekty: ['none'],
      idempotencja: true,
      opisTresci: undefined,
      kodyBledow: [],
      narzedzia: { internal: ['transagent-tools-list-plans'], mcp: ['plan-tools-list-plans-explicit'] },
    });
    // A read: the class `chat` admits, where its internal rendering lives.
    expect(op.opClass).toBe('read');
    expect(Object.keys(op.inputSchema).sort()).toEqual(['applied', 'limit', 'offset']);
    expect((await internal.listTools()).tools.map((t) => t.name)).not.toContain('list_plans');
    expect((await external.listTools()).tools.map((t) => t.name)).toContain('list_plans');

    // The operation's function: the plan set, no content in a row.
    await call(external, 'create_plan', { title: 'Listed Plan', content: '## A\n\nSECRET-BODY\n' });
    const rows = service.listPlans({ order: 'created' });
    expect(rows.map((r) => r.path)).toEqual(['listed-plan.md']);
    const listed = await call(external, 'list_plans', {});
    expect(JSON.stringify(listed.body)).not.toContain('SECRET-BODY');
  });

  it('[entity:list-plan-versions] list_plan_versions as its record declares it: project, direct, internal/mcp/rest direct, cli n/a with the record\'s reason, no effects, idempotent, `path` + window, codes PLAN_NOT_FOUND, INVALID_ARGUMENT, NOT_FOUND, PLAN_INVALID_FRONTMATTER, rendered by plan-tools · list_plan_versions (internal thread mount, mcp explicit) — oldest first, an unknown explicit path PLAN_NOT_FOUND', async () => {
    const op = expectOperationRecord({
      nazwa: 'list_plan_versions',
      channels: { internal: D, cli: PLAN_NO_CLI, mcp: D, rest: D },
      efekty: ['none'],
      idempotencja: true,
      opisTresci: undefined,
      kodyBledow: ['PLAN_NOT_FOUND', 'INVALID_ARGUMENT', 'NOT_FOUND', 'PLAN_INVALID_FRONTMATTER'],
      narzedzia: { internal: ['plan-tools-list-plan-versions'], mcp: ['plan-tools-list-plan-versions-explicit'] },
    });
    expect(op.opClass).toBe('plan');
    expect(Object.keys(op.inputSchema).sort()).toEqual(['limit', 'offset', 'path']);
    expect(props(await toolOf(internal, 'list_plan_versions'))).toEqual(['limit', 'offset']);
    expect((await toolOf(external, 'list_plan_versions')).inputSchema.required).toEqual(['path']);

    expect((await call(external, 'list_plan_versions', { path: 'no-such-plan.md' })).body.code).toBe('PLAN_NOT_FOUND');
    const created = await pinPlanToT1();
    await call(internal, 'update_plan', { expectedHash: created.hash, content: '## Second\n', changeSummary: 'two' });
    const all = await call(external, 'list_plan_versions', { path: created.path });
    expect(all.body.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
  });

  it('[entity:get-plan-version] get_plan_version as its record declares it: project, direct, internal/mcp/rest direct, cli n/a with the record\'s reason, no effects, idempotent, addressed by `(path, version)`, codes PLAN_NOT_FOUND, INVALID_ARGUMENT, rendered by plan-tools · get_plan_version (internal thread mount, mcp explicit) — an unknown path PLAN_NOT_FOUND, a version off the history INVALID_ARGUMENT', async () => {
    const op = expectOperationRecord({
      nazwa: 'get_plan_version',
      channels: { internal: D, cli: PLAN_NO_CLI, mcp: D, rest: D },
      efekty: ['none'],
      idempotencja: true,
      opisTresci: undefined,
      kodyBledow: ['PLAN_NOT_FOUND', 'INVALID_ARGUMENT'],
      narzedzia: { internal: ['plan-tools-get-plan-version'], mcp: ['plan-tools-get-plan-version-explicit'] },
    });
    expect(op.opClass).toBe('plan');
    expect(Object.keys(op.inputSchema).sort()).toEqual(['path', 'version']);
    expect(props(await toolOf(internal, 'get_plan_version'))).toEqual(['version']);
    expect([...((await toolOf(external, 'get_plan_version')).inputSchema.required ?? [])].sort()).toEqual(['path', 'version']);

    expect((await call(external, 'get_plan_version', { path: 'no-such-plan.md', version: 1 })).body.code).toBe('PLAN_NOT_FOUND');
    const created = await pinPlanToT1();
    expect((await call(external, 'get_plan_version', { path: created.path, version: 1 })).body.version).toBe(1);
    expect((await call(external, 'get_plan_version', { path: created.path, version: 2 })).body.code).toBe('INVALID_ARGUMENT');
  });

  it('[entity:mark-plan-applied] mark_plan_applied as its record declares it: project, direct, internal/mcp/rest direct, cli n/a with the record\'s reason, file+ui-notify, idempotent, no content, addressed by `path`, codes PLAN_NOT_FOUND, INVALID_ARGUMENT, NOT_FOUND, PLAN_INVALID_FRONTMATTER, rendered by plan-tools · mark_plan_applied (internal thread mount, mcp explicit) — frontmatter only, no new version, a repeat a no-op, unmarking INVALID_ARGUMENT, a planless thread INVALID_ARGUMENT, an unknown explicit path PLAN_NOT_FOUND, a pinned file that is gone NOT_FOUND, a non-plan PLAN_INVALID_FRONTMATTER', async () => {
    const op = expectOperationRecord({
      nazwa: 'mark_plan_applied',
      channels: {
        internal: D,
        cli: { kind: 'na', reason: 'jedyny realny wołający kończy wykonanie planu w wątku, nie w terminalu' },
        mcp: D,
        rest: D,
      },
      efekty: ['file', 'ui-notify'],
      idempotencja: true,
      opisTresci: 'n/a',
      kodyBledow: ['PLAN_NOT_FOUND', 'INVALID_ARGUMENT', 'NOT_FOUND', 'PLAN_INVALID_FRONTMATTER'],
      narzedzia: { internal: ['plan-tools-mark-plan-applied'], mcp: ['plan-tools-mark-plan-applied-explicit'] },
    });
    expect(Object.keys(op.inputSchema).sort()).toEqual(['applied', 'path']);
    expect(props(await toolOf(internal, 'mark_plan_applied'))).toEqual(['applied']);

    // The owning core function.
    await expect(service.setAppliedByThread('t-1', { applied: true })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(service.setAppliedByThread('t-1', { path: 'no-such-plan.md', applied: true })).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });
    const created = await pinPlanToT1();
    await expect(service.setAppliedByThread('t-1', { applied: false })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const versions = versionRowCount();
    expect(await service.setAppliedByThread('t-1', { applied: true })).toEqual({ path: created.path, applied: true });
    const bytes = await fileOf(created.path);
    expect(await service.setAppliedByThread('t-1', { applied: true })).toEqual({ path: created.path, applied: true });
    expect(await fileOf(created.path)).toBe(bytes);
    expect(versionRowCount()).toBe(versions);
    await makeNotAPlan(created.path);
    await expect(service.setAppliedByThread('t-1', { applied: true })).rejects.toMatchObject({ code: 'PLAN_INVALID_FRONTMATTER' });
    pinT1To('gone.md');
    await expect(service.setAppliedByThread('t-1', { applied: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('[entity:execute-plan] execute_plan as its record declares it: project, human-mediated, internal/cli/mcp n/a with the record\'s reason, rest direct, db+ui-notify, not idempotent, no content, addressed by `planId`, codes PLAN_NOT_FOUND, INVALID_ARGUMENT, no renderings — no plan tool renders it; each trigger opens a new thread over the plan, an unknown plan PLAN_NOT_FOUND', async () => {
    const NA: Cell = { kind: 'na', reason: 'akt user-initiated; przegląd tej klasyfikacji jest otwarty' };
    const op = expectOperationRecord({
      nazwa: 'execute_plan',
      mediacja: 'human-mediated',
      channels: { internal: NA, cli: NA, mcp: NA, rest: D },
      efekty: ['db', 'ui-notify'],
      idempotencja: false,
      opisTresci: undefined,
      kodyBledow: ['PLAN_NOT_FOUND', 'INVALID_ARGUMENT'],
      narzedzia: {},
    });
    expect(op.opClass).toBe('plan');
    expect(Object.keys(op.inputSchema)).toEqual(['planId']);
    for (const client of [internal, external]) {
      expect((await client.listTools()).tools.map((t) => t.name)).not.toContain('execute_plan');
    }

    // The rest rendering's core function (POST /api/plans/:planId/create-thread).
    await expect(service.attachThreadToPlan('no-such-plan.md')).rejects.toMatchObject({ code: 'PLAN_NOT_FOUND' });
    const created = await pinPlanToT1();
    const a = await service.attachThreadToPlan(created.path);
    const b = await service.attachThreadToPlan(created.path);
    expect(a.threadId).not.toBe(b.threadId);
    for (const id of [a.threadId, b.threadId]) {
      expect(db.prepare(`SELECT plan_path FROM chat_thread WHERE id = ?`).get(id)).toEqual({ plan_path: created.path });
    }
  });
});

/** The body of a plan file, frontmatter stripped. */
function matterBody(raw: string): string {
  return matter(raw).content;
}
