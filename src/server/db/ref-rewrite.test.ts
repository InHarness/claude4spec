/**
 * The generic rename rewrite (0.2.9, brief item 24).
 *
 * Three hand-written `onEntityRenamed` hooks are replaced by one rule read off
 * the `ref` flags, so the cases worth pinning are the three PHYSICAL shapes a
 * reference can have — they look identical in the declaration and could not be
 * more different in SQL — plus the two ways a naive implementation gets the
 * polymorphic `$type` ref wrong.
 *
 * The `$type` shape below is a FIXTURE, and its real-declaration twin lives in
 * `plugins/c4s-plugin-ac/test/ref-rewrite.test.ts`.
 *
 * Until 0.2.80 this file read the real `acData`, on the argument that pinning
 * the case to a fixture would let the declaration drift out from under it. That
 * argument still holds — which is why the case went WITH the declaration when
 * `ac` moved into its envelope, rather than being downgraded. What stays here is
 * the generic rule: a polymorphic `ref: '$type'` inside an embedded-JSON
 * collection, whatever type happens to declare one. The host has to get that
 * right for a shape no built-in type has any more.
 */

import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { applyProjection, type ProjectableModule } from './projection.js';
import { declaresRefs, rewriteRefsForRename } from './ref-rewrite.js';

/** A parent whose reference sits in a column on its own row. */
const viewer: ProjectableModule = {
  type: 'viewer',
  data: {
    schema: {
      title: { type: 'string', required: true, maxLength: 200, default: 'Untitled' },
      themeSlug: { type: 'string', ref: 'theme', onMissing: 'warn', onDelete: 'leave-dangling' },
    },
  },
};

/** A parent whose reference sits in a projection table of its own. */
const route: ProjectableModule = {
  type: 'route',
  data: {
    schema: {
      title: { type: 'string', required: true, maxLength: 200, default: 'Untitled' },
      payloads: {
        type: 'collection',
        collection: 'value',
        keyFields: ['shape', 'relation'],
        item: {
          type: 'object',
          fields: {
            shape: { type: 'string', required: true, ref: 'shape', column: 'shape_slug' },
            relation: { type: 'enum', values: ['request', 'response'], required: true },
          },
        },
      },
    },
  },
};

/**
 * The shapes that carry a `ref` on a node with NO FIELD NAME of its own — a
 * collection item and a record value — plus one nested two levels down. Each is
 * admitted by `declaresRefs`, so each has to be rewritable, or a rename reports
 * success having changed nothing.
 */
const roster: ProjectableModule = {
  type: 'roster',
  data: {
    schema: {
      title: { type: 'string', required: true, maxLength: 200, default: 'Untitled' },
      // Embedded JSON: `["user-dto", "order-dto"]`.
      members: {
        type: 'collection',
        collection: 'value',
        item: { type: 'string', ref: 'shape', onDelete: 'leave-dangling' },
      },
      // Embedded JSON: `{"primary": "user-dto"}` — the ref is the record VALUE.
      byRole: { type: 'record', key: { type: 'string' }, value: { type: 'string', ref: 'shape' } },
      // Embedded JSON, ref nested two levels below the field.
      meta: {
        type: 'object',
        fields: { owner: { type: 'object', fields: { shape: { type: 'string', ref: 'shape' } } } },
      },
    },
  },
};

/** The referenced types, so the generated FKs have something to point at. */
const theme: ProjectableModule = { type: 'theme', data: { schema: { title: { type: 'string', required: true, maxLength: 200, default: 'Untitled' } } } };
const shape: ProjectableModule = { type: 'shape', data: { schema: { title: { type: 'string', required: true, maxLength: 200, default: 'Untitled' } } } };
/**
 * The polymorphic shape: a value collection of `{type, slug}` pairs where the
 * ref's TARGET TYPE is the sibling field rather than a fixed name.
 *
 * Mirrors `ac.verifies[]`, which is where the shape came from and still the only
 * declaration in the repo that has it — see the note at the top of this file on
 * why the real one is exercised in that envelope's own suite.
 */
const criterion: ProjectableModule = {
  type: 'criterion',
  data: {
    schema: {
      title: { type: 'string', required: true, maxLength: 500 },
      verifies: {
        type: 'collection',
        collection: { kind: 'value', identity: ['type', 'slug'] },
        unordered: true,
        item: {
          type: 'object',
          fields: {
            type: { type: 'string', required: true },
            slug: {
              type: 'string',
              required: true,
              ref: '$type',
              onMissing: 'warn',
              onDelete: 'leave-dangling',
            },
          },
        },
      },
    },
  },
};

function projectDb(modules: ProjectableModule[]): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applyProjection(db, modules);
  return db;
}

describe('rewriteRefsForRename', () => {
  it('repoints a scalar ref on the entity row and reports the row it changed', () => {
    const db = projectDb([theme, viewer]);
    try {
      db.prepare("INSERT INTO theme (slug, title) VALUES ('dark', 'Dark')").run();
      db.prepare("INSERT INTO viewer (slug, title, theme_slug) VALUES ('v1', 'V1', 'dark')").run();
      db.prepare("INSERT INTO viewer (slug, title, theme_slug) VALUES ('v2', 'V2', NULL)").run();

      db.prepare("UPDATE theme SET slug = 'midnight' WHERE slug = 'dark'").run();
      expect(rewriteRefsForRename(db, viewer, 'theme', 'dark', 'midnight')).toEqual(['v1']);

      expect(db.prepare('SELECT theme_slug FROM viewer WHERE slug = ?').get('v1')).toEqual({
        theme_slug: 'midnight',
      });
      expect(db.prepare('SELECT theme_slug FROM viewer WHERE slug = ?').get('v2')).toEqual({
        theme_slug: null,
      });
    } finally {
      db.close();
    }
  });

  it('reports the parents of a ref held in a projection table, after ON UPDATE CASCADE moved it', () => {
    // The generated FK has already rewritten the column by the time this runs —
    // which is exactly why the endpoint hook it replaces did no UPDATE and only
    // collected slugs. The rewrite must still name those parents, or their FILES
    // keep the old slug forever while the index looks correct.
    const db = projectDb([shape, route]);
    try {
      db.prepare("INSERT INTO shape (slug, title) VALUES ('user', 'User')").run();
      db.prepare("INSERT INTO route (slug, title) VALUES ('get-users', 'GET /users')").run();
      db.prepare(
        "INSERT INTO route_payloads (route_slug, shape_slug, relation) VALUES ('get-users', 'user', 'response')",
      ).run();

      db.prepare("UPDATE shape SET slug = 'account' WHERE slug = 'user'").run();
      expect(db.prepare('SELECT shape_slug FROM route_payloads').get()).toEqual({ shape_slug: 'account' });

      expect(rewriteRefsForRename(db, route, 'shape', 'user', 'account')).toEqual(['get-users']);
    } finally {
      db.close();
    }
  });

  it('rewrites a $type ref inside an embedded-JSON collection', () => {
    const db = projectDb([criterion]);
    try {
      const insert = db.prepare('INSERT INTO criterion (slug, title, verifies) VALUES (?, ?, ?)');
      insert.run('ac-1', 'A', JSON.stringify([{ type: 'endpoint', slug: 'get-users' }]));
      insert.run('ac-2', 'B', JSON.stringify([{ type: 'dto', slug: 'get-users' }]));
      insert.run('ac-3', 'C', JSON.stringify([{ type: 'endpoint', slug: 'other' }]));

      expect(rewriteRefsForRename(db, criterion, 'endpoint', 'get-users', 'list-users')).toEqual(['ac-1']);

      // Only the entry whose SIBLING type matches moves. `ac-2` names the same
      // slug under a different type, and collapsing the two is the bug the
      // discriminator exists to prevent.
      expect(db.prepare('SELECT verifies FROM criterion WHERE slug = ?').get('ac-1')).toEqual({
        verifies: JSON.stringify([{ type: 'endpoint', slug: 'list-users' }]),
      });
      expect(db.prepare('SELECT verifies FROM criterion WHERE slug = ?').get('ac-2')).toEqual({
        verifies: JSON.stringify([{ type: 'dto', slug: 'get-users' }]),
      });
      expect(db.prepare('SELECT verifies FROM criterion WHERE slug = ?').get('ac-3')).toEqual({
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
    const db = projectDb([criterion]);
    try {
      db.prepare('INSERT INTO criterion (slug, title, verifies) VALUES (?, ?, ?)').run(
        'ac-1',
        'A',
        JSON.stringify([{ type: 'endpoint', slug: 'get-users-legacy' }]),
      );
      expect(rewriteRefsForRename(db, criterion, 'endpoint', 'get-users', 'list-users')).toEqual([]);
      expect(db.prepare('SELECT verifies FROM criterion WHERE slug = ?').get('ac-1')).toEqual({
        verifies: JSON.stringify([{ type: 'endpoint', slug: 'get-users-legacy' }]),
      });
    } finally {
      db.close();
    }
  });

  it('is a no-op for a type that references nothing of the renamed type', () => {
    const db = projectDb([theme, viewer]);
    try {
      db.prepare("INSERT INTO viewer (slug, title, theme_slug) VALUES ('v1', 'V1', 'dark')").run();
      expect(rewriteRefsForRename(db, viewer, 'diagram', 'dark', 'midnight')).toEqual([]);
      expect(db.prepare('SELECT theme_slug FROM viewer WHERE slug = ?').get('v1')).toEqual({
        theme_slug: 'dark',
      });
    } finally {
      db.close();
    }
  });

  it('rewrites a ref carried by a collection ITEM, which has no field name', () => {
    // `declaresRefs` admits this shape, so the listener runs — and a walker that
    // only looks at an object's named fields finds nothing to change and reports
    // success. The reference then rots permanently.
    const db = projectDb([shape, roster]);
    try {
      db.prepare("INSERT INTO shape (slug, title) VALUES ('user', 'User')").run();
      db.prepare('INSERT INTO roster (slug, title, members, by_role, meta) VALUES (?, ?, ?, ?, ?)').run(
        'r1',
        'R1',
        JSON.stringify(['user', 'other']),
        JSON.stringify({ primary: 'user' }),
        JSON.stringify({ owner: { shape: 'user' } }),
      );

      expect(rewriteRefsForRename(db, roster, 'shape', 'user', 'account')).toEqual(['r1']);

      const row = db.prepare('SELECT members, by_role, meta FROM roster WHERE slug = ?').get('r1') as {
        members: string;
        by_role: string;
        meta: string;
      };
      expect(JSON.parse(row.members)).toEqual(['account', 'other']);
      expect(JSON.parse(row.by_role)).toEqual({ primary: 'account' });
      expect(JSON.parse(row.meta)).toEqual({ owner: { shape: 'account' } });
    } finally {
      db.close();
    }
  });

  it('is a no-op when the slug did not actually change', () => {
    const db = projectDb([theme, viewer]);
    try {
      db.prepare("INSERT INTO viewer (slug, title, theme_slug) VALUES ('v1', 'V1', 'dark')").run();
      expect(rewriteRefsForRename(db, viewer, 'theme', 'dark', 'dark')).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe('declaresRefs', () => {
  it('is true for a ref at any depth, and false for a schema with none', () => {
    expect(declaresRefs(viewer)).toBe(true); // scalar, top level
    expect(declaresRefs(route)).toBe(true); // inside a collection item
    expect(declaresRefs(criterion)).toBe(true); // `$type`, inside a collection item
    expect(declaresRefs(roster)).toBe(true); // on a collection item / record value
    expect(declaresRefs(theme)).toBe(false);
    expect(declaresRefs({ type: 'schemaless' })).toBe(false);
  });
});
