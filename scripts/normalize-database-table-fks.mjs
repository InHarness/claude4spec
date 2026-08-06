#!/usr/bin/env node
/**
 * ONE-TIME ADOPTION PASS — normalise `columns[].fk.table` to the target's slug.
 *
 * `database-table.columns[].fk.table` is declared `ref: 'database-table'`, and
 * the host resolves a ref by SLUG. Real corpora are inconsistent about what they
 * put there: mostly the slug (`dto`), but sometimes the target's SQL table NAME
 * (`chat_thread`, where the slug is `chat-thread`). The name form has two
 * consequences and neither is loud — it warns on every write, and a rename of
 * the target never repoints it, because the rename walk matches on slug.
 *
 * Measured across the two corpora this was written for: 9 of 12 fks in app-spec
 * and 15 of 22 in zbieram-kaucje did not resolve, and EVERY one of them was a
 * pure `_`→`-` transliteration of a slug that exists in the same project.
 *
 * THE RULE, and its one deliberate limit: rewrite `fk.table` to its kebab form
 * IF AND ONLY IF the kebab form matches an existing slug in the same project.
 * Anything else is left exactly as it is — a value that resolves to nothing
 * either way is a genuinely broken reference, and this script's job is to fix a
 * spelling convention, not to guess at intent or to silence a real warning.
 *
 * Idempotent by construction: a second run finds nothing to change, because a
 * value that already resolves is never a candidate.
 *
 * Usage:
 *   node scripts/normalize-database-table-fks.mjs <project-dir> [--write]
 *
 * Dry by default. It prints what it WOULD change and exits 0; `--write` is the
 * only thing that touches a file, because this edits a different repository from
 * the one it ships in.
 */

import fs from 'node:fs';
import path from 'node:path';

const ENTITIES = '.claude4spec/entities/database-table';

function usage(msg) {
  console.error(`${msg}\n\nUsage: node scripts/normalize-database-table-fks.mjs <project-dir> [--write]`);
  process.exit(2);
}

/**
 * The rewrite, as a pure function over one project's files — exported so the
 * test drives THIS and not a re-implementation of it.
 *
 * @param {Record<string, unknown>} files slug → parsed entity
 * @returns {{ changes: Array<{slug: string, column: string, from: string, to: string}>, next: Record<string, unknown> }}
 */
export function normalizeFks(files) {
  const slugs = new Set(Object.keys(files));
  const changes = [];
  const next = {};

  for (const [slug, entity] of Object.entries(files)) {
    const columns = Array.isArray(entity.columns) ? entity.columns : null;
    if (!columns) {
      next[slug] = entity;
      continue;
    }

    let touched = false;
    const rewritten = columns.map((column) => {
      const table = column?.fk?.table;
      if (typeof table !== 'string' || !table) return column;
      // Already resolves — not a candidate, which is what makes this idempotent.
      if (slugs.has(table)) return column;
      const kebab = table.replace(/_/g, '-');
      // No such slug either way: a real dangling ref. Leave it, and let it warn.
      if (kebab === table || !slugs.has(kebab)) return column;

      touched = true;
      changes.push({ slug, column: column.name ?? '?', from: table, to: kebab });
      return { ...column, fk: { ...column.fk, table: kebab } };
    });

    next[slug] = touched ? { ...entity, columns: rewritten } : entity;
  }

  return { changes, next };
}

function main() {
  const [dir, ...rest] = process.argv.slice(2);
  if (!dir) usage('Missing <project-dir>.');
  const write = rest.includes('--write');

  const root = path.resolve(dir, ENTITIES);
  if (!fs.existsSync(root)) usage(`No ${ENTITIES} under ${path.resolve(dir)}.`);

  const files = {};
  const raw = {};
  for (const f of fs.readdirSync(root).filter((n) => n.endsWith('.json'))) {
    const slug = f.replace(/\.json$/, '');
    raw[slug] = fs.readFileSync(path.join(root, f), 'utf-8');
    files[slug] = JSON.parse(raw[slug]);
  }

  const { changes, next } = normalizeFks(files);

  if (!changes.length) {
    console.log(`${path.resolve(dir)}: nothing to normalise (${Object.keys(files).length} tables).`);
    return;
  }

  for (const c of changes) {
    console.log(`  ${c.slug}.${c.column}: fk.table ${c.from} → ${c.to}`);
  }
  console.log(`${changes.length} reference(s) in ${new Set(changes.map((c) => c.slug)).size} table(s).`);

  if (!write) {
    console.log('\nDry run. Re-run with --write to apply.');
    return;
  }

  const touched = new Set(changes.map((c) => c.slug));
  for (const slug of touched) {
    /**
     * Written with the same 2-space + trailing-newline shape the entity store
     * uses, so the diff shows the fk lines and nothing else.
     */
    fs.writeFileSync(path.join(root, `${slug}.json`), `${JSON.stringify(next[slug], null, 2)}\n`);
  }
  console.log(`\nWrote ${touched.size} file(s).`);
}

// Only run when invoked directly — the test imports `normalizeFks`.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
