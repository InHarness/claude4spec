/**
 * 0.2.2 — the guard standing between `restoreSpec` and mass deletion of a type.
 *
 * Widening restoreSpec's order from four hardcoded core types to every ACTIVE
 * module (the fix for `ac`/`design-system`/`diagram` never being restored) also
 * switches on its destructive delete-extras pass for those types. Restoring a
 * release cut before `ac` existed would otherwise find zero target slugs and
 * delete every AC in the project.
 *
 * The first attempt guarded on "does the release have version rows for this
 * type", which over-corrected: it also disabled the pass for the four types that
 * already worked, so a release legitimately holding zero DTOs stopped deleting
 * DTOs added afterwards. These tests pin the discriminator that tells those two
 * situations apart — the distinction the row-count check structurally cannot make.
 */

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { typeExistedAtRelease } from './release.js';

let db: Database.Database;

/** A release row with an explicit creation time. Returns its surrogate id. */
function release(name: string, createdAt: string): number {
  const info = db
    .prepare(
      `INSERT INTO spec_release (name, slug, description, created_by, created_at)
       VALUES (?, ?, 'test release', 'user', ?)`,
    )
    .run(name, name, createdAt);
  return Number(info.lastInsertRowid);
}

/** One entity_version row for `type` at `createdAt`. */
function version(type: string, slug: string, createdAt: string, releaseId: number | null = null) {
  db.prepare(
    `INSERT INTO entity_version
       (entity_type, entity_slug, version, data, changed_by, created_at, release_id, op)
     VALUES (?, ?, 1, '{}', 'user', ?, ?, 'create')`,
  ).run(type, slug, createdAt, releaseId);
}

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
});
afterEach(() => db.close());

describe('typeExistedAtRelease', () => {
  it('false when the type has NO history at all — the release predates it', () => {
    const v1 = release('v1', '2026-01-01T00:00:00.000Z');
    // `ac` was introduced long after v1 was cut.
    version('ac', 'ac-1', '2026-06-01T00:00:00.000Z');
    expect(typeExistedAtRelease(db, 'ac', v1)).toBe(false);
  });

  it('true when the type existed but the release legitimately held ZERO of them', () => {
    // THE case the previous row-count guard got wrong: dto history predates v1,
    // so v1 genuinely asserts "no DTOs" and a restore must delete later ones.
    version('dto', 'early-dto', '2025-12-01T00:00:00.000Z');
    const v1 = release('v1', '2026-01-01T00:00:00.000Z');
    expect(typeExistedAtRelease(db, 'dto', v1)).toBe(true);
  });

  it('distinguishes the two cases within one database', () => {
    version('dto', 'early-dto', '2025-12-01T00:00:00.000Z');
    const v1 = release('v1', '2026-01-01T00:00:00.000Z');
    version('ac', 'ac-1', '2026-06-01T00:00:00.000Z');

    expect(typeExistedAtRelease(db, 'dto', v1)).toBe(true); // delete-extras runs
    expect(typeExistedAtRelease(db, 'ac', v1)).toBe(false); // delete-extras skipped
  });

  it('counts history regardless of whether it was captured INTO that release', () => {
    // release_id NULL — an ordinary un-released mutation. It still proves the
    // type existed, which is the only question being asked here.
    version('endpoint', 'e1', '2025-11-01T00:00:00.000Z', null);
    const v1 = release('v1', '2026-01-01T00:00:00.000Z');
    expect(typeExistedAtRelease(db, 'endpoint', v1)).toBe(true);
  });

  it('history created exactly at the release timestamp counts as existing', () => {
    const at = '2026-01-01T00:00:00.000Z';
    version('dto', 'd1', at);
    const v1 = release('v1', at);
    expect(typeExistedAtRelease(db, 'dto', v1)).toBe(true);
  });

  it('true for a null releaseId — the unbounded "current" snapshot covers everything', () => {
    expect(typeExistedAtRelease(db, 'anything', null)).toBe(true);
  });

  it('false for a type with no rows whatsoever', () => {
    const v1 = release('v1', '2026-01-01T00:00:00.000Z');
    expect(typeExistedAtRelease(db, 'never-seen', v1)).toBe(false);
  });

  it('does not throw for an unknown release id', () => {
    version('dto', 'd1', '2026-01-01T00:00:00.000Z');
    // COALESCE falls back to the row's own created_at, so an id that resolves to
    // no release degrades to "the type has history", never to a crash mid-restore.
    expect(() => typeExistedAtRelease(db, 'dto', 999999)).not.toThrow();
  });

  it('works for a plugin-contributed type the host never hardcoded', () => {
    version('use-case', 'uc-1', '2025-12-01T00:00:00.000Z');
    const v1 = release('v1', '2026-01-01T00:00:00.000Z');
    expect(typeExistedAtRelease(db, 'use-case', v1)).toBe(true);
  });
});
