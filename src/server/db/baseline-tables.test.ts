import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASELINE_TABLES, COLLISION_EXEMPT_TABLES } from './baseline-tables.js';

const BASELINE_SQL = path.join(import.meta.dirname, 'migrations/000_baseline.sql');

describe('BASELINE_TABLES', () => {
  it('matches the tables 000_baseline.sql actually creates', () => {
    const db = new Database(':memory:');
    try {
      db.exec(fs.readFileSync(BASELINE_SQL, 'utf-8'));
      const actual = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{
          name: string;
        }>
      ).map((r) => r.name);

      expect([...BASELINE_TABLES].sort()).toEqual(actual.sort());
    } finally {
      db.close();
    }
  });

  it('claims no entity table — those are owned by the contributing modules', () => {
    for (const t of ['endpoint', 'dto', 'endpoint_dto', 'ui_view', 'ac', 'design_system', 'diagram']) {
      expect(BASELINE_TABLES.has(t)).toBe(false);
    }
  });

  it('exempts only tables it also claims', () => {
    for (const t of COLLISION_EXEMPT_TABLES) expect(BASELINE_TABLES.has(t)).toBe(true);
  });
});
