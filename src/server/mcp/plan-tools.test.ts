import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createTestDb } from '../../../tests/helpers/test-db.js';
import { buildPlanToolsServer } from './plan-tools.js';
import { PlanService } from '../services/plan.js';
import { ChatService } from '../services/chat.js';
import { PagesService } from '../services/pages.js';
import { FileSerializer } from '../services/file-serializer.js';
import { FileVersionService } from '../services/file-version.js';
import { PagesFrontmatterIndexer } from '../services/pages-frontmatter-indexer.js';
import { FileWatchRuntime } from '../fs/watcher.js';
import { artifactSource, boundWriter } from '../fs/sources.js';
import { PLAN_ROOT_MARKER } from '../../shared/types.js';
import type { WsEmitter } from '../ws/project-emitter.js';

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
    const plansPages = new PagesService(cwd, 'plans', PLAN_ROOT_MARKER);
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
      frontmatterIndexer: new PagesFrontmatterIndexer(new Map([[PLAN_ROOT_MARKER, plansPages]]), noopWs),
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
