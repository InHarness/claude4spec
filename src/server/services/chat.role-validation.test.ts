import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { ChatService } from './chat.js';
import { CHAT_ROLES } from '../../shared/entities.js';
import type { ChatRole } from '../../shared/entities.js';

/**
 * 2.1.51 M05: `chat_message.role` carries no SQL CHECK — the application
 * validates it. `ChatService.addMessage` is the single write path, so the check
 * lives there.
 */
describe('ChatService.addMessage — role validated in the application', () => {
  const setup = () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare("INSERT INTO chat_thread (id) VALUES ('t1')").run();
    return { db, chat: new ChatService(db) };
  };

  it('accepts every documented role, warning included', () => {
    const { db, chat } = setup();
    expect(CHAT_ROLES).toEqual([
      'user',
      'assistant',
      'tool_use',
      'tool_result',
      'user_input_request',
      'user_input_response',
      'warning',
    ]);
    for (const role of CHAT_ROLES) expect(() => chat.addMessage('t1', role, '{}')).not.toThrow();
    db.close();
  });

  it('refuses an unknown role without writing a row', () => {
    const { db, chat } = setup();
    expect(() => chat.addMessage('t1', 'system' as ChatRole, '{}')).toThrow(/unknown chat_message role/);
    expect((db.prepare('SELECT COUNT(*) AS n FROM chat_message').get() as { n: number }).n).toBe(0);
    db.close();
  });
});
