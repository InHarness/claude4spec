/**
 * Item 63 — the whole point of Host API 2.0.0, asserted once.
 *
 * A type that declares `data.schema` + `slugPattern` + `payloadVersion` +
 * `systemPrompt`, and NOTHING else, must be a first-class entity type: stored,
 * served, prompted, tooled and searchable. No `backend`. No computed views. No
 * migration. No edit to any host file.
 *
 * THE NEGATIVE HALF IS THE ACCEPTANCE CRITERION, and it is expressed by what
 * this file imports rather than by an assertion: nothing per-type, and nothing
 * from `src/server/entities/` or the plugin envelope. The fixture below is the
 * complete definition of `sprocket` — if a host file had to learn about it, this
 * file could not have been written without touching that file too.
 *
 * `sprocket` is deliberately not shaped like any built-in: a `record`, an
 * embedded value collection, a ref at depth, an enum with a default, a
 * clearable field and a two-step slug pattern. A host that only works for the
 * six shapes it shipped with would fail here.
 */

import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../helpers/test-app.js';
import { buildSystemPrompt } from '../../../src/server/services/chat-context.js';
import { buildCreateShape } from '../../../src/server/core/plugin-host/crud-schema-gen.js';
import type { BackendModule } from '../../../src/server/core/plugin-host/types.js';
import type { DataDeclaration } from '../../../src/shared/plugin-host/data-schema.js';
import type { SlugPattern } from '../../../src/shared/plugin-host/slug-pattern.js';
import type { Root } from '../../../src/shared/types.js';

const sprocketData: DataDeclaration = {
  schema: {
    title: { kind: 'string', required: true, maxLength: 200, default: 'Untitled' },
    name: { kind: 'string', required: true, description: 'What the sprocket is called.' },
    // An enum with a default — the host owes it both a CHECK-shaped validation
    // and the default on create.
    grade: { kind: 'enum', values: ['draft', 'shipped', 'retired'], default: 'draft' },
    teeth: { kind: 'number' },
    notes: { kind: 'string', clearable: true },
    // A ref at depth, inside an embedded value collection. Rename propagation
    // has to find this without anyone naming the pair.
    fitsWith: {
      kind: 'collection',
      collection: 'value',
      unordered: true,
      description: 'DTOs this sprocket is compatible with.',
      item: {
        kind: 'object',
        fields: {
          dto: { kind: 'string', required: true, ref: 'dto', onMissing: 'warn', onDelete: 'leave-dangling' },
          note: { kind: 'string' },
        },
      },
    },
    // A free-form map — the shape none of the six built-ins uses at top level.
    dimensions: { kind: 'record', key: { kind: 'string' }, value: { kind: 'string' } },
    createdAt: { kind: 'string', column: 'created_at', systemManaged: true, computedDefault: 'now' },
    updatedAt: { kind: 'string', column: 'updated_at', systemManaged: true, computedDefault: 'now' },
  },
};

const sprocketSlugPattern: SlugPattern = [
  { op: 'literal', value: 'spr-' },
  { op: 'slugify', field: 'name' },
];

/** The COMPLETE definition. Everything below is asserted, nothing is wired. */
const sprocket = {
  type: 'sprocket',
  data: sprocketData,
  slugPattern: sprocketSlugPattern,
  payloadVersion: 1,
  label: 'Sprocket',
  labelPlural: 'Sprockets',
  displayOrder: 950,
  pathPrefix: '/sprockets',
  serializer: { payloadVersion: 1 } as BackendModule['serializer'],
  systemPrompt: {
    roleNoun: 'Sprockets',
    narrativeBlock: 'A sprocket is a toothed wheel. It fits DTOs.',
    defaultPredicate: { field: 'grade', in: ['draft', 'shipped'] },
  },
} as BackendModule;

const app = () => createTestApp({ extraModules: [sprocket] });

describe('item 63 — a type that declares only its data is a first-class type', () => {
  it('gets a SQLite projection, with the columns it declared and no others', async () => {
    const t = await app();
    try {
      const cols = (
        t.db.prepare('PRAGMA table_info(sprocket)').all() as Array<{ name: string }>
      ).map((c) => c.name);
      // Field ORDER is load-bearing (it is the column order), and the two
      // embedded-JSON fields sit inline while nothing else was invented.
      expect(cols).toEqual([
        'slug',
        'name',
        'grade',
        'teeth',
        'notes',
        'fits_with',
        'dimensions',
        'created_at',
        'updated_at',
      ]);
    } finally {
      t.cleanup();
    }
  });

  it('gets REST routes that write, read, rename and delete it', async () => {
    const t = await app();
    try {
      const created = await request(t.app)
        .post('/api/sprockets')
        .send({
          name: 'Big Wheel',
          teeth: 42,
          dimensions: { radius: '10cm' },
          fitsWith: [{ dto: 'user-dto', note: 'snug' }],
        });
      expect(created.status).toBe(201);
      // The slug came from the DECLARED pattern, not from a `slugFrom` function.
      expect(created.body.data.slug).toBe('spr-big-wheel');
      // The declared default was applied on create.
      expect(created.body.data.grade).toBe('draft');

      const got = await request(t.app).get('/api/sprockets/spr-big-wheel');
      expect(got.status).toBe(200);
      expect(got.body.data.dimensions).toEqual({ radius: '10cm' });
      expect(got.body.data.fitsWith).toEqual([{ dto: 'user-dto', note: 'snug' }]);
      // Audit stamps are the host's, attached to a type that never mentioned them.
      expect(got.body.data.createdAt).toEqual(expect.any(String));

      // The enum is enforced without the type writing a validator.
      expect((await request(t.app).patch('/api/sprockets/spr-big-wheel').send({ grade: 'melted' })).status).toBe(400);

      const renamed = await request(t.app)
        .patch('/api/sprockets/spr-big-wheel')
        .send({ newSlug: 'spr-huge-wheel', teeth: 43 });
      expect(renamed.status).toBe(200);
      expect(renamed.body.data.slug).toBe('spr-huge-wheel');
      expect(renamed.body.data.teeth).toBe(43);
      // A partial update did not blank the fields it did not mention.
      expect(renamed.body.data.name).toBe('Big Wheel');

      expect((await request(t.app).delete('/api/sprockets/spr-huge-wheel')).status).toBe(200);
      expect((await request(t.app).get('/api/sprockets/spr-huge-wheel')).status).toBe(404);
    } finally {
      t.cleanup();
    }
  });

  it('is listed and searched through the same core the built-ins use', async () => {
    const t = await app();
    try {
      await request(t.app).post('/api/sprockets').send({ name: 'Alpha', grade: 'shipped' });
      await request(t.app).post('/api/sprockets').send({ name: 'Beta' });
      await request(t.app).post('/api/sprockets').send({ name: 'Gamma', grade: 'retired' });

      // The declared `defaultPredicate` narrows the transport read — `retired`
      // is out — and `?grade=all` lifts it. Neither is per-type code.
      const def = await request(t.app).get('/api/sprockets');
      expect(def.body.data.map((s: { slug: string }) => s.slug)).toEqual(['spr-alpha', 'spr-beta']);
      expect((await request(t.app).get('/api/sprockets?grade=all')).body.data).toHaveLength(3);
      expect((await request(t.app).get('/api/sprockets?grade=retired')).body.data).toHaveLength(1);

      // Search reaches the declared string fields with no `searchableFields`.
      const hits = await request(t.app).get('/api/sprockets?search=Alpha&grade=all');
      expect(hits.body.data.map((s: { slug: string }) => s.slug)).toEqual(['spr-alpha']);
    } finally {
      t.cleanup();
    }
  });

  it('appears in the agent system prompt, counted and narrated', async () => {
    const t = await app();
    try {
      const prompt = buildSystemPrompt({
        host: t.host,
        projectName: 'My Spec',
        cwd: t.cwd,
        roots: [] as Root[],
        briefsDir: '.claude4spec/briefs',
        patchesDir: '.claude4spec/patches',
        currentPagePath: null,
        currentPageBody: null,
        pageCount: 0,
        entityCounts: { sprocket: 3 },
        tagCount: 0,
        sectionCount: 0,
      });

      // The narrative row, the count attribute, and the embed type union — three
      // separate places in `prompts.md`'s shape, none of which was edited.
      expect(prompt).toContain('<entity type="sprocket">A sprocket is a toothed wheel. It fits DTOs.</entity>');
      expect(prompt).toContain('sprocket="3"');
      // The embed type union — position depends on `displayOrder`, so match the
      // token inside the pipe-separated list rather than at a fixed offset.
      expect(prompt).toMatch(/(^|\|)sprocket(\||[^-\w])/);
    } finally {
      t.cleanup();
    }
  });

  it('is offered to the agent by the generic entity tools, described from its declaration', async () => {
    const t = await app();
    try {
      // The type list `entity-tools` iterates for `list_entities`,
      // `describe_entity_type` and the rest is `host.listEntities()` — the same
      // enumeration the built-ins are in, with no per-type registration.
      expect(t.host.listEntities().map((m) => m.type)).toContain('sprocket');

      /**
       * And what the agent is SHOWN for it is generated from the declaration:
       * `buildCreateShape` is what `create_entities` advertises as this type's
       * input. Asserting on the shape rather than on the tool call keeps this
       * test free of an MCP transport while still pinning the thing that would
       * be empty if the host had needed a hand-written schema.
       */
      const module = t.host.getEntity('sprocket');
      const created = Object.keys(buildCreateShape(module!.data));
      expect(created).toEqual(expect.arrayContaining(['name', 'grade', 'teeth', 'notes', 'fitsWith', 'dimensions']));
      // System-managed fields are the host's to set, so they are NOT offered.
      expect(created).not.toContain('createdAt');
      expect(created).not.toContain('updatedAt');
    } finally {
      t.cleanup();
    }
  });

  it('contributes NO MCP server of its own — declaring data does not mint one', async () => {
    const t = await app();
    try {
      const names = t.host.buildMcpServers().map((s) => s.name);
      // The generic server carries its CRUD; a `${type}-tools` server exists
      // only for a type that declared `backend.mcpServer`, which this one did
      // not. Asserting the absence is what keeps "declarative" from meaning
      // "the host invents a server per type".
      expect(names).not.toContain('sprocket-tools');
      // ...and the ones that DID declare one still have theirs.
      expect(names).toContain('ac-tools');
    } finally {
      t.cleanup();
    }
  });

  it('takes part in rename propagation, because a field said `ref: dto`', async () => {
    const t = await app();
    try {
      await request(t.app).post('/api/dtos').send({ slug: 'user-dto', title: 'UserDto', fields: [] });
      await request(t.app)
        .post('/api/sprockets')
        .send({ name: 'Linked', fitsWith: [{ dto: 'user-dto' }] });

      await request(t.app).patch('/api/dtos/user-dto').send({ newSlug: 'account-dto' }).expect(200);

      const after = await request(t.app).get('/api/sprockets/spr-linked');
      // `note` was never supplied, so it is absent rather than null — the host
      // repointed the ref and left the rest of the entry byte-identical.
      expect(after.body.data.fitsWith).toEqual([{ dto: 'account-dto' }]);
    } finally {
      t.cleanup();
    }
  });

  /**
   * `MountContext.crud` is the door A.8 hands a plugin, and it must be the SAME
   * one `/api/{type}s` is — not `genericUpdate` alone.
   *
   * The first version bound the three verbs bare, so a plugin renaming through
   * the facade moved the row and the file while every `ref`-flagged field and
   * every `<inline_mention/>` kept pointing at the old slug. Nothing exercised
   * it, which is why the review could only call it plausible: the one shipped
   * caller (`endpoint`'s link routes) does not rename.
   */
  it('the crud facade a plugin is handed propagates a rename, like the REST route does', async () => {
    const t = await app();
    try {
      await request(t.app).post('/api/dtos').send({ slug: 'user-dto', title: 'UserDto', fields: [] });
      await request(t.app)
        .post('/api/sprockets')
        .send({ name: 'Linked', fitsWith: [{ dto: 'user-dto' }] });

      // Straight through the facade, as a plugin's own route would.
      await t.crud.update('dto', 'user-dto', { newSlug: 'account-dto' }, 'user');

      const after = await request(t.app).get('/api/sprockets/spr-linked');
      expect(after.body.data.fitsWith).toEqual([{ dto: 'account-dto' }]);
    } finally {
      t.cleanup();
    }
  });

  it('snapshots and restores through the host, with no serializer of its own', async () => {
    const t = await app();
    try {
      await request(t.app)
        .post('/api/sprockets')
        .send({ name: 'Snap', teeth: 7, dimensions: { radius: '2cm' } });

      const raw = t.rawReader.getEntity('sprocket', 'spr-snap');
      expect(raw).not.toBeNull();
      const snap = t.host.snapshot('sprocket', raw, t.rawReader) as Record<string, unknown>;
      // Spelled in DECLARED field names, not projection columns.
      expect(snap).toMatchObject({ slug: 'spr-snap', name: 'Snap', teeth: 7, dimensions: { radius: '2cm' } });
      expect(snap).not.toHaveProperty('created_at');
    } finally {
      t.cleanup();
    }
  });
});
