import type Database from 'better-sqlite3';
import { slugify } from '../services/slug.js';
import type { PagesService } from '../services/pages.js';

interface LegacyPlanRow {
  id: number;
  title: string | null;
  content: string;
  created_at: string;
}

/**
 * Searches the same candidate sequence the write-side disambiguation loop
 * uses (`${base}.md`, `${base}-2.md`, ...) for a file whose content already
 * matches `title`/`content` — that would be THIS row's own prior write from
 * an interrupted migration attempt, not a different plan that happens to
 * slugify the same way. Stops at the first candidate that doesn't exist (the
 * same point the write-side loop would use as its target), since every
 * existing candidate up to that point has already been searched.
 *
 * Body comparison trims trailing whitespace — `PagesService.write()` (via
 * gray-matter's `matter.stringify`) always appends a trailing newline, so a
 * strict `===` against the raw DB `content` (which carries none) would never
 * match even for a genuine round-trip of the exact same write.
 */
async function findExistingMigratedFile(
  plansPages: PagesService,
  base: string,
  title: string,
  content: string,
): Promise<string | null> {
  for (let attempt = 1; attempt <= 50; attempt++) {
    const candidate = attempt === 1 ? `${base}.md` : `${base}-${attempt}.md`;
    if (!(await plansPages.exists(candidate))) return null;
    const existing = await plansPages.read(candidate);
    if (existing.body.trimEnd() === content.trimEnd() && existing.frontmatter.title === title) {
      return candidate;
    }
  }
  return null;
}

/**
 * 0.1.127 (brief 0-1-126-to-0-1-127): one-time boot cutover of the Plan
 * artifact from SQLite (`plan`/`plan_version`) to `plansDir/<slug>.md` files.
 * Guarded on the `plan` table still existing — a no-op on every subsequent
 * boot (including a brand-new project, where migrations 014→047 still create
 * an empty `plan` table from scratch before this drops it once).
 *
 * Split from the numbered `.sql` migrations (see `047_plan_path.sql`, purely
 * additive) because `db/migrate.ts` only executes raw SQL in one batch before
 * any application code runs — there is no hook for the Node `fs`/`slugify`
 * work this needs. Must be called from `project-context.ts`'s `buildInner`
 * right after the `plansMount` is constructed and BEFORE the fire-and-forget
 * M36 initial-sync IIFE, so that loop's `file_version` capture picks up the
 * files written here.
 *
 * Ordering within this function matters: every plan file is written to disk
 * FIRST (outside any DB transaction — idempotent on retry, since content is
 * deterministic from the still-intact `plan` row), and only once every write
 * has succeeded does the destructive DB step run — `chat_thread.plan_path`
 * backfill, a full `chat_thread` rebuild dropping `plan_id`/
 * `last_seen_plan_version` (SQLite can't ALTER TABLE DROP COLUMN on a column
 * with a foreign key; this codebase's established precedent for dropping
 * chat_thread columns is a full rebuild — see migrations 021/029/042), then
 * `DROP TABLE plan_version; DROP TABLE plan;` — all inside one transaction, so
 * a mid-write crash leaves the legacy tables intact for a clean retry on next
 * boot rather than a half-migrated DB.
 */
export async function backfillPlansToFilesystem(params: {
  db: Database.Database;
  plansPages: PagesService;
  backupDb: () => void;
}): Promise<void> {
  const { db, plansPages, backupDb } = params;

  const hasLegacyTable = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='plan'`)
    .get();
  if (!hasLegacyTable) return;

  backupDb();

  const rows = db
    .prepare(`SELECT id, title, content, created_at FROM plan`)
    .all() as LegacyPlanRow[];

  const slugById = new Map<number, string>();
  for (const row of rows) {
    const base = (row.title && slugify(row.title)) || `plan-${row.id}`;
    const title = row.title ?? base;

    // Idempotency on retry: a crash between this write loop and the DB
    // transaction below leaves already-written files on disk (writes aren't
    // rolled back on crash), while `plan` stays fully intact (the transaction
    // never committed) — so a retry re-processes the SAME rows. Without this
    // check, the disambiguation loop below would mistake THIS ROW'S OWN prior
    // write for a collision with a DIFFERENT plan and write a duplicate
    // `-2`-suffixed file, orphaning the original (contradicting this
    // function's documented "idempotent on retry" contract). Detect a prior
    // write by content match (title + body), not just filename existence.
    const alreadyMigrated = await findExistingMigratedFile(plansPages, base, title, row.content);
    if (alreadyMigrated) {
      slugById.set(row.id, alreadyMigrated);
      continue;
    }

    let slug = base;
    let attempt = 1;
    // Two migrated titles can slugify to the same string — disambiguate with a
    // numeric suffix (same precedent as the 0.1.119 release backfill).
    while (await plansPages.exists(`${slug}.md`)) {
      attempt++;
      if (attempt > 50) {
        throw new Error(`[plan-migration] no free slug for plan id=${row.id} after ${attempt - 1} attempts`);
      }
      slug = `${base}-${attempt}`;
    }
    await plansPages.write(`${slug}.md`, {
      frontmatter: {
        type: 'plan',
        // created_by has no source in the old `plan` table (it never tracked a
        // creator) — best-judgment default, flagged as a `missing`-kind patch.
        title,
        created_at: row.created_at,
        created_by: 'user',
      },
      body: row.content,
    });
    slugById.set(row.id, `${slug}.md`);
  }

  // migrate.ts's own comment explains why: PRAGMA foreign_keys is a no-op
  // inside a transaction, so it must be toggled around the whole batch, not
  // inside `db.transaction()`. Without this, dropping `plan` while any FK still
  // references it (the OLD chat_thread.plan_id, before the rebuild below drops
  // it) would either fail or cascade in unexpected ways.
  const fkWasOn = db.pragma('foreign_keys', { simple: true }) === 1;
  if (fkWasOn) db.pragma('foreign_keys = OFF');
  try {
    const tx = db.transaction(() => {
      const backfillPlanPath = db.prepare(`UPDATE chat_thread SET plan_path = ? WHERE plan_id = ?`);
      for (const [planId, planPath] of slugById) {
        backfillPlanPath.run(planPath, planId);
      }

      // Full column set as of migration 042 + 047's additive `plan_path`,
      // minus `plan_id`/`last_seen_plan_version` — see migration 042 for the
      // precedent this mirrors.
      db.exec(`
        CREATE TABLE chat_thread_new (
          id                               TEXT PRIMARY KEY NOT NULL,
          title                            TEXT,
          last_session_id                  TEXT,
          created_at                       TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at                       TEXT NOT NULL DEFAULT (datetime('now')),
          current_todo_items               TEXT,
          plan_mode                        INTEGER NOT NULL DEFAULT 0,
          initial_system_prompt            TEXT,
          last_usage_json                  TEXT,
          last_context_size                INTEGER,
          context_type                     TEXT NOT NULL DEFAULT 'chat',
          brief_path                       TEXT,
          patch_path                       TEXT,
          plan_path                        TEXT,
          initial_architecture_config_json TEXT,
          parent_thread_id                 TEXT REFERENCES chat_thread(id) ON DELETE CASCADE,
          spawned_by_tool_use_id           TEXT
        );

        INSERT INTO chat_thread_new (
          id, title, last_session_id, created_at, updated_at, current_todo_items,
          plan_mode, initial_system_prompt, last_usage_json, last_context_size,
          context_type, brief_path, patch_path, plan_path,
          initial_architecture_config_json, parent_thread_id, spawned_by_tool_use_id
        )
        SELECT
          id, title, last_session_id, created_at, updated_at, current_todo_items,
          plan_mode, initial_system_prompt, last_usage_json, last_context_size,
          context_type, brief_path, patch_path, plan_path,
          initial_architecture_config_json, parent_thread_id, spawned_by_tool_use_id
        FROM chat_thread;

        DROP TABLE chat_thread;
        ALTER TABLE chat_thread_new RENAME TO chat_thread;

        CREATE INDEX idx_chat_thread_brief_path ON chat_thread(brief_path) WHERE brief_path IS NOT NULL;
        CREATE INDEX idx_chat_thread_patch_path ON chat_thread(patch_path) WHERE patch_path IS NOT NULL;
        CREATE INDEX idx_chat_thread_plan_path ON chat_thread(plan_path) WHERE plan_path IS NOT NULL;
        CREATE INDEX idx_chat_thread_parent_thread_id ON chat_thread(parent_thread_id);

        DROP TABLE IF EXISTS plan_version;
        DROP TABLE IF EXISTS plan;
      `);
    });
    tx.immediate();
  } finally {
    if (fkWasOn) db.pragma('foreign_keys = ON');
  }

  console.log(`[plan-migration] migrated ${rows.length} plan(s) to filesystem storage under plansDir`);
}
