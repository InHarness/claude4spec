/**
 * 0.2.4 — the boot backfill, exercised against a REAL git repository.
 *
 * The defect this file exists for was invisible to every other kind of test:
 * `git log --name-status` prints paths relative to the work-tree top level no
 * matter what `cwd` or pathspec it is given, so a cwd-relative lookup key
 * matches only when the project happens to BE the repo root. Every environment
 * used during development had that shape, so the git rung silently never fired
 * anywhere else and every entity fell through to `mtime` — which on a fresh
 * clone is the checkout time, i.e. a fabricated value, committed, and different
 * again for the next person to clone.
 *
 * So the subdirectory layout is the case worth writing down.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backfillEntityTimestamps } from './entity-timestamp-backfill.js';
import { readSystemFields } from '../serialization/system-fields.js';
import type { EntityStore } from '../services/entity-store.js';

const ENTITIES_DIR = '.claude4spec/entities';

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
}

/** Minimal `EntityStore` surface — the backfill only reads files and writes them back. */
function storeFor(projectDir: string): EntityStore {
  const root = path.join(projectDir, ENTITIES_DIR);
  return {
    root,
    listAll: () =>
      fs
        .readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .flatMap((d) =>
          fs
            .readdirSync(path.join(root, d.name))
            .filter((f) => f.endsWith('.json'))
            .map((f) => ({
              type: d.name,
              slug: f.slice(0, -'.json'.length),
              relPath: `${d.name}/${f}`,
            })),
        ),
    readRel: (relPath: string) => JSON.parse(fs.readFileSync(path.join(root, relPath), 'utf-8')),
    write: (type: string, slug: string, data: unknown) =>
      fs.writeFileSync(path.join(root, type, `${slug}.json`), `${JSON.stringify(data, null, 2)}\n`),
  } as unknown as EntityStore;
}

function seedEntity(projectDir: string, slug: string, body: unknown): void {
  const dir = path.join(projectDir, ENTITIES_DIR, 'ac');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${slug}.json`), `${JSON.stringify(body, null, 2)}\n`);
}

describe('backfillEntityTimestamps', () => {
  let repo: string;
  let db: Database.Database;

  beforeEach(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-backfill-')));
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'test');
    db = new Database(':memory:');
    db.exec(
      `CREATE TABLE entity_version (entity_type TEXT, entity_slug TEXT, created_at TEXT)`,
    );
  });
  afterEach(() => {
    db.close();
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('finds git history when the project is a SUBDIRECTORY of the repo', () => {
    // The layout the cwd-relative key silently failed on.
    const projectDir = path.join(repo, 'packages', 'spec');
    seedEntity(projectDir, 'from-git', { slug: 'from-git', text: 'x' });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'seed');

    const report = backfillEntityTimestamps(db, storeFor(projectDir), projectDir, ENTITIES_DIR);

    expect(report.written).toBe(1);
    expect(report.byRung.git).toBe(1);
    expect(report.byRung.mtime).toBe(0);
    expect(report.byRung.placeholder).toBe(0);
  });

  it('still finds git history when the project IS the repo root', () => {
    seedEntity(repo, 'at-root', { slug: 'at-root', text: 'x' });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'seed');

    const report = backfillEntityTimestamps(db, storeFor(repo), repo, ENTITIES_DIR);
    expect(report.byRung.git).toBe(1);
  });

  it('prefers the project’s own entity_version history over git', () => {
    seedEntity(repo, 'versioned', { slug: 'versioned', text: 'x' });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'seed');
    db.prepare(`INSERT INTO entity_version VALUES (?,?,?)`).run('ac', 'versioned', '2020-01-01 00:00:00');
    db.prepare(`INSERT INTO entity_version VALUES (?,?,?)`).run('ac', 'versioned', '2021-06-01 00:00:00');

    backfillEntityTimestamps(db, storeFor(repo), repo, ENTITIES_DIR);

    const stamp = readSystemFields(JSON.parse(
      fs.readFileSync(path.join(repo, ENTITIES_DIR, 'ac', 'versioned.json'), 'utf-8'),
    ));
    expect(stamp).toEqual({
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2021-06-01T00:00:00.000Z',
    });
  });

  it('never leaves createdAt after updatedAt', () => {
    seedEntity(repo, 'clamped', { slug: 'clamped', text: 'x' });
    db.prepare(`INSERT INTO entity_version VALUES (?,?,?)`).run('ac', 'clamped', '2026-01-01 00:00:00');

    backfillEntityTimestamps(db, storeFor(repo), repo, ENTITIES_DIR);

    const stamp = readSystemFields(JSON.parse(
      fs.readFileSync(path.join(repo, ENTITIES_DIR, 'ac', 'clamped.json'), 'utf-8'),
    ))!;
    expect(stamp.createdAt <= stamp.updatedAt).toBe(true);
  });

  it('is idempotent — a second run finds nothing to do', () => {
    seedEntity(repo, 'once', { slug: 'once', text: 'x' });
    const store = storeFor(repo);
    const first = backfillEntityTimestamps(db, store, repo, ENTITIES_DIR);
    expect(first.written).toBe(1);

    const second = backfillEntityTimestamps(db, store, repo, ENTITIES_DIR);
    expect(second.written).toBe(0);
  });

  it('converges even when a file cannot carry the envelope', () => {
    // A serializer may return an array snapshot; `attachSystemFields` passes
    // those through untouched. Such a file is not a candidate — treating it as
    // one made `candidates.length` permanently non-zero, so the early return
    // never fired and every boot re-spawned the whole `git log` pass forever.
    seedEntity(repo, 'array-shaped', [1, 2, 3]);
    seedEntity(repo, 'normal', { slug: 'normal', text: 'x' });

    const store = storeFor(repo);
    const first = backfillEntityTimestamps(db, store, repo, ENTITIES_DIR);
    expect(first.written).toBe(1); // only the stampable one

    const second = backfillEntityTimestamps(db, store, repo, ENTITIES_DIR);
    expect(second.written).toBe(0);
    // The real assertion: nothing is left to do, so the pass short-circuits
    // before any git spawn on every subsequent boot.
    expect(second.byRung).toEqual({ entity_version: 0, git: 0, mtime: 0, placeholder: 0 });
  });
});
