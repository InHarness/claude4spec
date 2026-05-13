import type Database from 'better-sqlite3';

const FIRST_H1_RE = /^#\s+(.+?)\s*$/m;

export function backfillPlanTitles(db: Database.Database): number {
  const rows = db
    .prepare(`SELECT id, content FROM plan WHERE title IS NULL`)
    .all() as Array<{ id: number; content: string }>;

  if (rows.length === 0) return 0;

  const update = db.prepare(`UPDATE plan SET title = ? WHERE id = ?`);
  let updated = 0;
  for (const row of rows) {
    const m = row.content.match(FIRST_H1_RE);
    if (!m) continue;
    const title = m[1]!.trim();
    if (!title) continue;
    update.run(title, row.id);
    updated++;
  }
  return updated;
}
