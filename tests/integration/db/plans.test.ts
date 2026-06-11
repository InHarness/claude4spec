import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../helpers/test-db.js';
import { PlanService } from '../../../src/server/services/plan.js';
import { ChatService } from '../../../src/server/services/chat.js';
import { ANCHOR_PATTERN_SOURCE } from '../../../src/shared/anchor-pattern.js';
import type { WsEmitter } from '../../../src/server/ws/project-emitter.js';

const noopWs: WsEmitter = { broadcast: () => {} };
const ANCHOR_RE = new RegExp(ANCHOR_PATTERN_SOURCE);
const HEADING_RE = /^(#{2,4})\s+(.+?)\s*$/;

function seedThread(db: Database.Database, id: string): void {
  db.prepare(`INSERT INTO chat_thread (id) VALUES (?)`).run(id);
}

function storedContent(db: Database.Database, threadId: string): string {
  const row = db
    .prepare(
      `SELECT p.content AS content
         FROM plan p JOIN chat_thread t ON t.plan_id = p.id
        WHERE t.id = ?`,
    )
    .get(threadId) as { content: string };
  return row.content;
}

describe('PlanService anchor injection', () => {
  let db: Database.Database;
  let service: PlanService;

  beforeEach(() => {
    db = createTestDb();
    service = new PlanService(db, noopWs, new ChatService(db));
  });

  it('[ac:ac-anchor-injection-w-nowych-headingach-pla] injects an anchor before every new plan heading on save, never duplicating an existing one', () => {
    seedThread(db, 'thread-1');

    // Pierwszy zapis: dwa nagłówki bez kotwic — injection musi je dodać przed zapisem.
    service.update({
      threadId: 'thread-1',
      action: 'replace',
      content: '## First section\n\nbody text\n\n### Nested section\n\nmore body',
      changedBy: 'agent',
    });

    const saved = storedContent(db, 'thread-1');
    const lines = saved.split('\n');
    const headingLines = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => HEADING_RE.test(line));

    expect(headingLines).toHaveLength(2);
    // Każdy nagłówek poprzedzony świeżo wstrzykniętą kotwicą.
    for (const { i } of headingLines) {
      expect(i).toBeGreaterThan(0);
      expect(ANCHOR_RE.test(lines[i - 1]!)).toBe(true);
    }

    // Drugi zapis tej samej treści (z już obecnymi kotwicami) nie dubluje kotwic.
    service.update({
      threadId: 'thread-1',
      action: 'replace',
      content: saved,
      changedBy: 'user',
    });

    const resaved = storedContent(db, 'thread-1');
    const anchorCount = resaved
      .split('\n')
      .filter((line) => ANCHOR_RE.test(line)).length;
    expect(anchorCount).toBe(2);
  });
});
