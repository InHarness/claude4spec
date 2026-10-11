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
 * `create_plan` belonging to its carrier thread, and the seven rows of
 * `katalog-operacji-m10`, over BOTH mounts of the real server: the thread mount
 * (`internal`, thread `t-1`) and the threadless one (`target: 'explicit'`, the
 * external `mcp` rendering — "spoza aplikacji").
 */
describe('plan-tools — M10 thread isolation and the plan catalog rows (2.1.13)', () => {
  let cwd: string;
  let db: Database.Database;
  let service: PlanService;
  let plansRoot: string;
  let internal: Client;
  let external: Client;

  beforeAll(() => {
    registerCoreOperations();
  });

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-plan-iso-'));
    db = createTestDb();
    const plansPages = new MarkdownFileStore({ cwd, dir: 'plans', rootId: systemRootId('plans'), kind: 'plans' });
    await plansPages.ensureRoot();
    plansRoot = plansPages.root;
    const runtime = new FileWatchRuntime({ fsEvents: false });
    runtime.mountSource({ source: artifactSource('plan'), dir: plansPages.root, scope: 'context:test' });
    const watch = runtime.scoped('context:test');
    const plansSerializer = new FileSerializer(plansPages);
    const pageVersions = new FileVersionService(db, plansSerializer);
    service = new PlanService({
      plansPages,
      plansWatcher: boundWriter(watch, artifactSource('plan')),
      plansSerializer,
      pageVersions,
      chatService: new ChatService(db),
      frontmatterIndexer: new PagesFrontmatterIndexer(new Map([[systemRootId('plans'), plansPages]]), noopWs),
      ws: noopWs,
    });
    db.prepare(`INSERT INTO chat_thread (id) VALUES (?)`).run('t-1');
    db.prepare(`INSERT INTO chat_thread (id) VALUES (?)`).run('t-2');

    const connect = async (target?: 'explicit'): Promise<Client> => {
      const { server } = buildPlanToolsServer({
        threadId: target ? 'mcp-external' : 't-1',
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
  const planFiles = async () => (await fs.readdir(plansRoot)).filter((f) => f.endsWith('.md')).sort();

  /** A plan pinned to `t-1` through the internal mount (the first update_plan creates and pins it). */
  async function pinPlanToT1(content = '## Alpha\n\nalpha body\n\n## Beta\n\nbeta body\n') {
    const created = await call(internal, 'update_plan', { title: 'Pinned plan', content, changeSummary: 'create' });
    expect(created.isError).toBe(false);
    return created.body as { path: string; hash: string; version: number };
  }

  // ── mcp-tool entities ────────────────────────────────────────────────────

  it('[entity:plan-tools-get-plan] get_plan: only `range` in the schema (no path, no threadId), no hints, the thread-scoped description — and the logic: thread-resolved, null when nothing is pinned, window, refusal past the end, budget with a range hint', async () => {
    const tool = await toolOf(internal, 'get_plan');
    expect(props(tool)).toEqual(['range']);
    expect(tool.inputSchema.required ?? []).toEqual([]);
    expect(tool.annotations?.readOnlyHint).toBeUndefined();
    expect(tool.annotations?.destructiveHint).toBeUndefined();
    expect(tool.annotations?.idempotentHint).toBeUndefined();
    expect(tool.annotations?.openWorldHint).toBeUndefined();
    expect(tool.description).toBe(
      "Get the current plan for this thread — latest content, version and hash. Returns null when the thread has no plan yet. This is the ONLY way to the plan's content: the system prompt carries the plan's path and version, never its body. Use it to inspect plan state before updating, especially when a system reminder notes the plan was edited in another thread. The returned `hash` is what arms `expectedHash` on the next `update_plan`, so this read is the entry point of every write. For a long plan, or when a response comes back truncated, read it in windows with `range`.",
    );

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
    const fileLines = (await fs.readFile(path.join(plansRoot, created.path), 'utf-8')).split('\n');
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

  it('[entity:plan-tools-get-plan] a plan over the response budget comes back truncated: true with a truncationHint pointing at `range`', async () => {
    const line = 'x'.repeat(60);
    const big = Array.from({ length: Math.ceil(DEFAULT_BUDGET_CHARS / 30) }, (_, i) => `${i} ${line}`).join('\n');
    await pinPlanToT1(`## Big\n\n${big}\n`);
    const read = await call(internal, 'get_plan', {});
    expect(read.isError).toBe(false);
    expect(read.body.plan.truncated).toBe(true);
    expect(read.body.plan.truncationHint).toMatch(/range/);
    expect((read.body.plan.content as string).length).toBeLessThan(big.length);
  });

  it('[entity:plan-tools-create-plan] create_plan: title (required) + content (optional), no path / threadId, no hints, the carrier-thread description — and the logic: slug once from slugify(title), three effects in one call, refusals leave none of them', async () => {
    const tool = await toolOf(internal, 'create_plan');
    expect(props(tool)).toEqual(['content', 'title']);
    expect(tool.inputSchema.required).toEqual(['title']);
    expect(tool.annotations?.readOnlyHint).toBeUndefined();
    expect(tool.annotations?.destructiveHint).toBeUndefined();
    expect(tool.annotations?.idempotentHint).toBeUndefined();
    expect(tool.annotations?.openWorldHint).toBeUndefined();
    expect(tool.description).toBe(
      'Create a new plan file from a title and a ready body, and get its address back. Use it when you already know what the plan should say — you have read the code and hold the content, not a question. The plan is created together with a carrier thread that grounds its provenance; no turn is started in that thread, so run one yourself if you want the plan worked on. This is not how you edit a plan. The new plan belongs to its carrier thread, not to this one, so you cannot read or edit it from here — hand the returned path to whoever will work on it. To write the plan of this thread, use update_plan, with title on the first call.',
    );
    const schemaProps = tool.inputSchema.properties as Record<string, { description?: string }>;
    expect(schemaProps.title!.description).toContain('immutable afterwards');
    expect(schemaProps.content!.description).toContain('Blank or whitespace-only is refused');

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
    const bytes = await fs.readFile(path.join(plansRoot, 'wire-contract-migration.md'), 'utf-8');
    expect(bytes).toContain('move the DTOs');
    expect(res.body.hash).toBe(crypto.createHash('sha256').update(bytes, 'utf-8').digest('hex'));
    // The content is not echoed back.
    expect(JSON.stringify(res.body)).not.toContain('move the DTOs');
  });

  it('[ac:ac-create-plan-z-title-ktorego-slugify-t] a title whose slugify(title) points at an existing plan → PLAN_ALREADY_EXISTS, no suffixed slug and nothing appended to the existing file', async () => {
    const first = await call(external, 'create_plan', { title: 'Direct plan', content: 'original body\n' });
    expect(first.isError).toBe(false);
    const original = await fs.readFile(path.join(plansRoot, 'direct-plan.md'), 'utf-8');
    const threadsBefore = threadCount();

    // A different title with the same slug.
    const clash = await call(external, 'create_plan', { title: 'DIRECT  Plan', content: 'intruder body\n' });
    expect(clash.isError).toBe(true);
    expect(clash.body.code).toBe('PLAN_ALREADY_EXISTS');
    expect(await planFiles()).toEqual(['direct-plan.md']);
    const after = await fs.readFile(path.join(plansRoot, 'direct-plan.md'), 'utf-8');
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

  // ── katalog-operacji-m10 rows ────────────────────────────────────────────

  it('[entity:katalog-operacji-m10#get_plan] the row: project, direct; internal/mcp/rest direct, cli n/a with its reason; no effects; idempotent; `path` + `range` window (absent path internally — isolation); PLAN_NOT_FOUND only for an unknown external path, INVALID_ARGUMENT for a window past the end', async () => {
    const op = CATALOG.require('get_plan');
    expect(op.scope).toBe('project');
    expect(op.mediation).toBe('direct');
    expect(op.opClass).toBe('plan');
    expect(op.channels.internal.kind).toBe('direct');
    expect(op.channels.mcp.kind).toBe('direct');
    expect(op.channels.rest.kind).toBe('direct');
    expect(op.channels.cli).toMatchObject({ kind: 'na' });
    expect((op.channels.cli as { reason: string }).reason).toMatch(/agent in a thread and the user in the UI/);
    expect(op.sideEffects).toEqual(['none']);
    expect(op.idempotent).toBe(true);
    expect([...op.errorCodes].sort()).toEqual(['INVALID_ARGUMENT', 'PLAN_NOT_FOUND']);
    expect(Object.keys(op.inputSchema).sort()).toEqual(['path', 'range']);

    // explicit-addressing: required externally, absent in internal (M10 declares isolation).
    expect(artifactAddressingShape('plan', 'internal')).toBe('absent');
    expect(artifactAddressingShape('plan', 'mcp')).toBe('required');
    expect(props(await toolOf(internal, 'get_plan'))).toEqual(['range']);
    const ext = await toolOf(external, 'get_plan');
    expect(props(ext)).toEqual(['path', 'range']);
    expect(ext.inputSchema.required).toEqual(['path']);

    // Nothing pinned is `plan: null` (a state of the thread, not an address).
    expect((await call(internal, 'get_plan', {})).body).toEqual({ plan: null });
    // An unknown external path is PLAN_NOT_FOUND.
    const unknown = await call(external, 'get_plan', { path: 'no-such-plan.md' });
    expect(unknown.isError).toBe(true);
    expect(unknown.body.code).toBe('PLAN_NOT_FOUND');
    // A known external path reads the plan; a window past the end is INVALID_ARGUMENT.
    const created = await pinPlanToT1();
    const got = await call(external, 'get_plan', { path: created.path });
    expect(got.body.plan.path).toBe(created.path);
    const past = await call(external, 'get_plan', { path: created.path, range: { start: 999, end: 1000 } });
    expect(past.body.code).toBe('INVALID_ARGUMENT');
  });

  it('[entity:katalog-operacji-m10#update_plan] the row: direct, cli n/a, file+db+ui-notify, conditional idempotence (false), literal+diff, `path` (absent internally), the nine error codes; PLAN_NOT_FOUND for an unknown external path, PLAN_CONFLICT for a stale hash', async () => {
    const op = CATALOG.require('update_plan');
    expect(op.scope).toBe('project');
    expect(op.mediation).toBe('direct');
    expect(op.channels.internal.kind).toBe('direct');
    expect(op.channels.mcp.kind).toBe('direct');
    expect(op.channels.rest.kind).toBe('direct');
    expect(op.channels.cli.kind).toBe('na');
    expect((op.channels.cli as { reason: string }).reason).toMatch(/agent in a thread and the user in the UI/);
    expect([...op.sideEffects].sort()).toEqual(['db', 'file', 'ui-notify']);
    expect(op.idempotent).toBe(false);
    expect(op.contentInput).toBe('literal+diff');
    expect([...op.errorCodes].sort()).toEqual(
      [
        'PLAN_CONFLICT',
        'PLAN_NOT_FOUND',
        'SECTION_NOT_FOUND',
        'AMBIGUOUS_ANCHOR',
        'FIND_NOT_FOUND',
        'MATCH_COUNT_MISMATCH',
        'MISSING_TITLE',
        'IMMUTABLE_FIELD',
        'INVALID_ARGUMENT',
      ].sort(),
    );
    expect(props(await toolOf(internal, 'update_plan'))).not.toContain('path');
    const ext = await toolOf(external, 'update_plan');
    expect(props(ext)).toContain('path');
    expect(ext.inputSchema.required).toEqual(expect.arrayContaining(['path', 'changeSummary']));

    const unknown = await call(external, 'update_plan', {
      path: 'no-such-plan.md',
      content: 'x',
      expectedHash: 'abc',
      changeSummary: 's',
    });
    expect(unknown.body.code).toBe('PLAN_NOT_FOUND');
    expect(await planFiles()).toEqual([]);

    const created = await pinPlanToT1();
    await call(internal, 'update_plan', { expectedHash: created.hash, content: '## New\n', changeSummary: 'one' });
    const stale = await call(external, 'update_plan', {
      path: created.path,
      expectedHash: created.hash,
      content: '## Stale\n',
      changeSummary: 'two',
    });
    expect(stale.body.code).toBe('PLAN_CONFLICT');
  });

  it('[entity:katalog-operacji-m10#list_plan_versions] the row: direct, cli n/a, no effects, idempotent, `path` + limit/offset window (absent path internally); oldest first; nothing pinned lists nothing; PLAN_NOT_FOUND for an unknown external path', async () => {
    const op = CATALOG.require('list_plan_versions');
    expect(op.scope).toBe('project');
    expect(op.mediation).toBe('direct');
    expect(op.opClass).toBe('plan');
    expect(op.channels.internal.kind).toBe('direct');
    expect(op.channels.mcp.kind).toBe('direct');
    expect(op.channels.rest.kind).toBe('direct');
    expect(op.channels.cli.kind).toBe('na');
    expect((op.channels.cli as { reason: string }).reason).toMatch(/agent in a thread and the user in the UI/);
    expect(op.sideEffects).toEqual(['none']);
    expect(op.idempotent).toBe(true);
    expect([...op.errorCodes].sort()).toEqual(['INVALID_ARGUMENT', 'PLAN_NOT_FOUND']);
    expect(Object.keys(op.inputSchema).sort()).toEqual(['limit', 'offset', 'path']);

    expect(props(await toolOf(internal, 'list_plan_versions'))).toEqual(['limit', 'offset']);
    const ext = await toolOf(external, 'list_plan_versions');
    expect(props(ext)).toEqual(['limit', 'offset', 'path']);
    expect(ext.inputSchema.required).toEqual(['path']);

    expect((await call(internal, 'list_plan_versions', {})).body).toEqual({ versions: [], total: 0 });
    expect((await call(external, 'list_plan_versions', { path: 'no-such-plan.md' })).body.code).toBe('PLAN_NOT_FOUND');

    const created = await pinPlanToT1();
    await call(internal, 'update_plan', { expectedHash: created.hash, content: '## Second\n', changeSummary: 'two' });
    const all = await call(internal, 'list_plan_versions', {});
    expect(all.body.total).toBe(2);
    expect(all.body.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    const window = await call(external, 'list_plan_versions', { path: created.path, offset: 1, limit: 1 });
    expect(window.body.versions.map((v: { version: number }) => v.version)).toEqual([2]);
    expect(window.body.total).toBe(2);
  });

  it('[entity:katalog-operacji-m10#get_plan_version] the row: direct, cli n/a, no effects, idempotent, `(path, version)` (absent path internally); PLAN_NOT_FOUND for an unknown external path, INVALID_ARGUMENT for a version off the axis', async () => {
    const op = CATALOG.require('get_plan_version');
    expect(op.scope).toBe('project');
    expect(op.mediation).toBe('direct');
    expect(op.opClass).toBe('plan');
    expect(op.channels.internal.kind).toBe('direct');
    expect(op.channels.mcp.kind).toBe('direct');
    expect(op.channels.rest.kind).toBe('direct');
    expect(op.channels.cli.kind).toBe('na');
    expect((op.channels.cli as { reason: string }).reason).toMatch(/agent in a thread and the user in the UI/);
    expect(op.sideEffects).toEqual(['none']);
    expect(op.idempotent).toBe(true);
    expect([...op.errorCodes].sort()).toEqual(['INVALID_ARGUMENT', 'PLAN_NOT_FOUND']);
    expect(Object.keys(op.inputSchema).sort()).toEqual(['path', 'version']);

    const int = await toolOf(internal, 'get_plan_version');
    expect(props(int)).toEqual(['version']);
    const ext = await toolOf(external, 'get_plan_version');
    expect(props(ext)).toEqual(['path', 'version']);
    expect([...(ext.inputSchema.required ?? [])].sort()).toEqual(['path', 'version']);

    // Nothing pinned: no versions to read.
    expect((await call(internal, 'get_plan_version', { version: 1 })).body.code).toBe('INVALID_ARGUMENT');
    expect((await call(external, 'get_plan_version', { path: 'no-such-plan.md', version: 1 })).body.code).toBe('PLAN_NOT_FOUND');

    const created = await pinPlanToT1('## Only\n\nfirst body\n');
    const v1 = await call(external, 'get_plan_version', { path: created.path, version: 1 });
    expect(v1.isError).toBe(false);
    expect(v1.body.version).toBe(1);
    expect(JSON.stringify(v1.body)).toContain('first body');
    const off = await call(internal, 'get_plan_version', { version: 7 });
    expect(off.isError).toBe(true);
    expect(off.body.code).toBe('INVALID_ARGUMENT');
  });

  it('[entity:katalog-operacji-m10#mark_plan_applied] the row: direct, cli n/a, rest direct, file+ui-notify, idempotent, no content input, `path` (absent internally); one-way; PLAN_NOT_FOUND for an unknown external path, INVALID_ARGUMENT otherwise', async () => {
    const op = CATALOG.require('mark_plan_applied');
    expect(op.scope).toBe('project');
    expect(op.mediation).toBe('direct');
    expect(op.channels.internal.kind).toBe('direct');
    expect(op.channels.mcp.kind).toBe('direct');
    expect(op.channels.rest.kind).toBe('direct');
    expect(op.channels.cli.kind).toBe('na');
    expect((op.channels.cli as { reason: string }).reason).toMatch(/in a thread, not at a terminal/);
    expect([...op.sideEffects].sort()).toEqual(['file', 'ui-notify']);
    expect(op.idempotent).toBe(true);
    expect(op.contentInput).toBe('n/a');
    expect([...op.errorCodes].sort()).toEqual(['INVALID_ARGUMENT', 'PLAN_NOT_FOUND']);
    expect(Object.keys(op.inputSchema).sort()).toEqual(['applied', 'path']);

    expect(props(await toolOf(internal, 'mark_plan_applied'))).toEqual(['applied']);
    const ext = await toolOf(external, 'mark_plan_applied');
    expect(props(ext)).toEqual(['applied', 'path']);
    expect([...(ext.inputSchema.required ?? [])].sort()).toEqual(['applied', 'path']);

    // Nothing pinned → INVALID_ARGUMENT (not PLAN_NOT_FOUND: no path was given).
    expect((await call(internal, 'mark_plan_applied', { applied: true })).body.code).toBe('INVALID_ARGUMENT');
    expect((await call(external, 'mark_plan_applied', { path: 'no-such-plan.md', applied: true })).body.code).toBe(
      'PLAN_NOT_FOUND',
    );

    const created = await pinPlanToT1();
    expect((await call(internal, 'mark_plan_applied', { applied: false })).body.code).toBe('INVALID_ARGUMENT');
    const marked = await call(internal, 'mark_plan_applied', { applied: true });
    expect(marked.body).toEqual({ path: created.path, applied: true });
    const bytes = await fs.readFile(path.join(plansRoot, created.path), 'utf-8');
    expect(bytes).toMatch(/applied: true/);
    // Idempotent: a repeat writes nothing; no new version either way.
    const again = await call(external, 'mark_plan_applied', { path: created.path, applied: true });
    expect(again.body).toEqual({ path: created.path, applied: true });
    expect(await fs.readFile(path.join(plansRoot, created.path), 'utf-8')).toBe(bytes);
    expect((await call(internal, 'get_plan', {})).body.plan.currentVersion).toBe(1);
  });

  it('[entity:katalog-operacji-m10#create_plan] the row: full four-channel parity, file+db, not idempotent, literal content, no address (the plan has none yet — no explicit-addressing), PLAN_ALREADY_EXISTS + INVALID_ARGUMENT', async () => {
    const op = CATALOG.require('create_plan');
    expect(op.scope).toBe('project');
    expect(op.mediation).toBe('direct');
    expect(op.opClass).toBe('plan');
    for (const channel of ['internal', 'cli', 'mcp', 'rest'] as const) {
      expect(op.channels[channel].kind, channel).toBe('direct');
    }
    expect([...op.sideEffects].sort()).toEqual(['db', 'file']);
    expect(op.idempotent).toBe(false);
    expect(op.contentInput).toBe('literal');
    expect([...op.errorCodes].sort()).toEqual(['INVALID_ARGUMENT', 'PLAN_ALREADY_EXISTS']);
    expect(Object.keys(op.inputSchema).sort()).toEqual(['content', 'title']);
    // No addressing parameter on either mount: the address comes back as the result.
    expect(props(await toolOf(internal, 'create_plan'))).toEqual(['content', 'title']);
    expect(props(await toolOf(external, 'create_plan'))).toEqual(['content', 'title']);

    const made = await call(internal, 'create_plan', { title: 'Row plan', content: 'body\n' });
    expect(made.body.path).toBe('row-plan.md');
    expect((await call(internal, 'create_plan', { title: 'Row plan', content: 'body\n' })).body.code).toBe('PLAN_ALREADY_EXISTS');
    expect((await call(internal, 'create_plan', { title: 'Empty plan', content: ' ' })).body.code).toBe('INVALID_ARGUMENT');
  });

  it('[entity:katalog-operacji-m10#execute_plan] the row: human-mediated, internal/cli/mcp n/a (user-initiated, review open), rest direct; db+ui-notify, not idempotent; addressed by planId; PLAN_NOT_FOUND for an unknown plan — and no plan tool renders it', async () => {
    const op = CATALOG.require('execute_plan');
    expect(op.scope).toBe('project');
    expect(op.mediation).toBe('human-mediated');
    expect(op.opClass).toBe('plan');
    for (const channel of ['internal', 'cli', 'mcp'] as const) {
      expect(op.channels[channel].kind, channel).toBe('na');
      expect((op.channels[channel] as { reason: string }).reason, channel).toMatch(/user-initiated/);
      expect((op.channels[channel] as { reason: string }).reason, channel).toMatch(/review of this classification is open/);
    }
    expect(op.channels.rest.kind).toBe('direct');
    expect([...op.sideEffects].sort()).toEqual(['db', 'ui-notify']);
    expect(op.idempotent).toBe(false);
    expect([...op.errorCodes].sort()).toEqual(['INVALID_ARGUMENT', 'PLAN_NOT_FOUND']);
    expect(Object.keys(op.inputSchema)).toEqual(['planId']);

    for (const client of [internal, external]) {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).not.toContain('execute_plan');
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
