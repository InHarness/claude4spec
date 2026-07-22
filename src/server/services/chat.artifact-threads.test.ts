import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ChatService } from './chat.js';
import { DomainError } from './tags.js';

/**
 * 0.1.139 M05: `ChatService.listThreadsByArtifact` — the single query behind
 * `GET /api/artifacts/:kind/:path/threads` for every artifact kind. These cases
 * pin the parts the brief made binding: the column whitelist, and a projection
 * that reports `hasSystemPrompt`/`messageCount` without dragging the
 * `initial_system_prompt` blob or a `GROUP BY` into the result.
 */
describe('ChatService.listThreadsByArtifact', () => {
  let db: Database.Database;
  let chat: ChatService;

  const seedThread = (
    id: string,
    cols: {
      title?: string | null;
      contextType?: string;
      briefPath?: string | null;
      planPath?: string | null;
      parentThreadId?: string | null;
      planMode?: number;
      systemPrompt?: string | null;
      ago?: string;
    } = {},
  ): void => {
    db.prepare(
      `INSERT INTO chat_thread
         (id, title, context_type, brief_path, plan_path, parent_thread_id, plan_mode,
          initial_system_prompt, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', ?))`,
    ).run(
      id,
      cols.title ?? id,
      cols.contextType ?? 'chat',
      cols.briefPath ?? null,
      cols.planPath ?? null,
      cols.parentThreadId ?? null,
      cols.planMode ?? 0,
      cols.systemPrompt ?? null,
      cols.ago ?? '+0 hour',
    );
  };

  const seedMessages = (threadId: string, n: number): void => {
    for (let i = 0; i < n; i++) {
      db.prepare(
        `INSERT INTO chat_message (thread_id, role, content, created_at)
         VALUES (?, 'user', ?, datetime('now'))`,
      ).run(threadId, `m${i}`);
    }
  };

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    chat = new ChatService(db);
  });

  afterEach(() => db.close());

  it('rejects a threadColumn outside the whitelist instead of interpolating it', () => {
    expect(() =>
      chat.listThreadsByArtifact({
        // The one fragment that reaches SQL unbound — a caller must not be able
        // to steer it from a request.
        threadColumn: "id = id OR ''" as never,
        path: 'anything',
      }),
    ).toThrow(DomainError);
  });

  it('orders by updated_at DESC, excludes transagent bankas, and flags only the freshest row', () => {
    seedThread('older', { planPath: 'p.md', ago: '-2 hour' });
    seedThread('newer', { planPath: 'p.md' });
    seedThread('banka', { planPath: 'p.md', parentThreadId: 'newer' });

    const rows = chat.listThreadsByArtifact({ threadColumn: 'plan_path', path: 'p.md' });

    expect(rows.map((r) => r.id)).toEqual(['newer', 'older']);
    expect(rows.map((r) => r.isLast)).toEqual([true, false]);
  });

  it('counts messages per row and carries hasSystemPrompt without the prompt itself', () => {
    seedThread('with-prompt', { planPath: 'p.md', systemPrompt: 'x'.repeat(1000), planMode: 1 });
    seedThread('bare', { planPath: 'p.md', ago: '-1 hour' });
    seedMessages('with-prompt', 3);

    const rows = chat.listThreadsByArtifact({ threadColumn: 'plan_path', path: 'p.md' });

    expect(rows[0]).toMatchObject({
      id: 'with-prompt',
      planMode: true,
      messageCount: 3,
      hasSystemPrompt: true,
    });
    expect(rows[1]).toMatchObject({ id: 'bare', planMode: false, messageCount: 0, hasSystemPrompt: false });
    // The blob stays out of the projection entirely — not merely unread.
    expect(rows[0]).not.toHaveProperty('initialSystemPrompt');
  });

  it('is heterogeneous for plan (any context_type may attach) and keyed only by the reference column', () => {
    seedThread('as-chat', { planPath: 'p.md', contextType: 'chat' });
    seedThread('as-ask', { planPath: 'p.md', contextType: 'ask', ago: '-1 hour' });
    seedThread('other-plan', { planPath: 'other.md' });

    const rows = chat.listThreadsByArtifact({ threadColumn: 'plan_path', path: 'p.md' });

    expect(rows.map((r) => r.contextType).sort()).toEqual(['ask', 'chat']);
  });

  it('resolves brief threads through the same query via brief_path', () => {
    seedThread('b1', { contextType: 'brief', briefPath: 'v1-to-v2.md' });
    seedThread('p1', { planPath: 'v1-to-v2.md' });

    const rows = chat.listThreadsByArtifact({ threadColumn: 'brief_path', path: 'v1-to-v2.md' });

    expect(rows.map((r) => r.id)).toEqual(['b1']);
  });

  it('orders ties deterministically so paging cannot repeat or skip a row', () => {
    // `updated_at` is whole-second, so a burst of attaches shares a timestamp.
    // Without the `id` tiebreaker SQLite may order the tie group differently
    // per statement, and a pager would see one thread twice and another never.
    for (const id of ['t-a', 't-b', 't-c', 't-d']) seedThread(id, { planPath: 'p.md' });

    const all = chat.listThreadsByArtifact({ threadColumn: 'plan_path', path: 'p.md' });
    const paged = [
      ...chat.listThreadsByArtifact({ threadColumn: 'plan_path', path: 'p.md', limit: 2 }),
      ...chat.listThreadsByArtifact({ threadColumn: 'plan_path', path: 'p.md', limit: 2, offset: 2 }),
    ];

    expect(paged.map((r) => r.id)).toEqual(all.map((r) => r.id));
    expect(new Set(paged.map((r) => r.id)).size).toBe(4);
  });

  it('pages with limit/offset, marking isLast only on the first page', () => {
    seedThread('a', { planPath: 'p.md' });
    seedThread('b', { planPath: 'p.md', ago: '-1 hour' });
    seedThread('c', { planPath: 'p.md', ago: '-2 hour' });

    const page1 = chat.listThreadsByArtifact({ threadColumn: 'plan_path', path: 'p.md', limit: 2 });
    const page2 = chat.listThreadsByArtifact({
      threadColumn: 'plan_path',
      path: 'p.md',
      limit: 2,
      offset: 2,
    });

    expect(page1.map((r) => r.id)).toEqual(['a', 'b']);
    expect(page2.map((r) => r.id)).toEqual(['c']);
    expect(page2[0]!.isLast).toBe(false);
  });
});
