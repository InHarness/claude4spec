/**
 * `ac.verifies[]` under the generic rename rewrite, against the REAL declaration.
 *
 * The host's `src/server/db/ref-rewrite.test.ts` covers the same shape with a
 * synthetic type, because the rule has to hold for any declaration. This file
 * exists because the ARGUMENT for reading the real one has not gone away: this
 * is the case the deleted `onEntityRenamed` hook covered, `ref: '$type'` inside
 * an embedded-JSON value collection is a shape no other declaration in the repo
 * has, and pinning it to a fixture alone would let `schema.ts` drift out from
 * under it. So the case moved WITH the declaration rather than being downgraded.
 *
 * Two ways a naive implementation gets a polymorphic ref wrong, both pinned:
 * ignoring the sibling `type` discriminator (so a rename of `endpoint/get-users`
 * also rewrites a `dto/get-users`), and treating the `LIKE` prefilter as the
 * match (so `get-users-legacy` is silently repointed).
 */

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applyProjection, type ProjectableModule } from '../../../src/server/db/projection.js';
import { declaresRefs, rewriteRefsForRename } from '../../../src/server/db/ref-rewrite.js';
import { acData } from '../src/entity/ac/schema.js';

const ac = { type: 'ac', data: acData } as unknown as ProjectableModule;

function projectDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyProjection(db, [ac] as never);
  return db;
}

describe('rewriteRefsForRename — ac.verifies', () => {
  it('rewrites only the entry whose SIBLING type matches', () => {
    const db = projectDb();
    try {
      const insert = db.prepare('INSERT INTO ac (slug, title, verifies) VALUES (?, ?, ?)');
      insert.run('ac-1', 'A', JSON.stringify([{ type: 'endpoint', slug: 'get-users' }]));
      insert.run('ac-2', 'B', JSON.stringify([{ type: 'dto', slug: 'get-users' }]));
      insert.run('ac-3', 'C', JSON.stringify([{ type: 'endpoint', slug: 'other' }]));

      expect(rewriteRefsForRename(db, ac, 'endpoint', 'get-users', 'list-users')).toEqual(['ac-1']);

      // `ac-2` names the same slug under a different type, and collapsing the
      // two is the bug the discriminator exists to prevent.
      expect(db.prepare('SELECT verifies FROM ac WHERE slug = ?').get('ac-1')).toEqual({
        verifies: JSON.stringify([{ type: 'endpoint', slug: 'list-users' }]),
      });
      expect(db.prepare('SELECT verifies FROM ac WHERE slug = ?').get('ac-2')).toEqual({
        verifies: JSON.stringify([{ type: 'dto', slug: 'get-users' }]),
      });
      expect(db.prepare('SELECT verifies FROM ac WHERE slug = ?').get('ac-3')).toEqual({
        verifies: JSON.stringify([{ type: 'endpoint', slug: 'other' }]),
      });
    } finally {
      db.close();
    }
  });

  it('leaves a row whose JSON merely CONTAINS the slug as a substring', () => {
    // The `LIKE` is a prefilter, not the match. A verifies entry pointing at
    // `get-users-legacy` contains `get-users`, and rewriting it would silently
    // repoint an unrelated reference.
    const db = projectDb();
    try {
      db.prepare('INSERT INTO ac (slug, title, verifies) VALUES (?, ?, ?)').run(
        'ac-1',
        'A',
        JSON.stringify([{ type: 'endpoint', slug: 'get-users-legacy' }]),
      );
      expect(rewriteRefsForRename(db, ac, 'endpoint', 'get-users', 'list-users')).toEqual([]);
      expect(db.prepare('SELECT verifies FROM ac WHERE slug = ?').get('ac-1')).toEqual({
        verifies: JSON.stringify([{ type: 'endpoint', slug: 'get-users-legacy' }]),
      });
    } finally {
      db.close();
    }
  });

  /**
   * The rewrite listener is registered per module whose schema declares a ref.
   * `ac` does — polymorphically, inside a collection item — so a declaration
   * that lost the flag would silently stop propagating renames.
   */
  it('the declaration advertises a ref, so the listener is registered at all', () => {
    expect(declaresRefs(ac)).toBe(true);
  });
});
