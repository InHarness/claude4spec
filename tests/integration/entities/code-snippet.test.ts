/**
 * The `code-snippet` type, exercised through the doors it actually has.
 *
 * The module under test is the REAL contribution from
 * `plugins/c4s-plugin-code-snippets` — imported, not re-declared. That matters:
 * a fixture copy would let the package's schema drift while these stayed green,
 * and the whole claim of this type is that the declaration IS the implementation.
 *
 * The AC markers live here rather than in the package's own suite because
 * `scripts/ac-coverage.mjs` walks `src/` and `tests/` only.
 *
 * The browser-observable criteria (card render, chip click, broken state,
 * collapse) are in `tests/e2e/code-snippet.test.ts` — they need a DOM.
 */

import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../helpers/test-app.js';
import { buildSystemPrompt } from '../../../src/server/services/chat-context.js';
import { diffEntity, snapshotEntity } from '../../../src/server/serialization/snapshot.js';
import { codeSnippetEntity } from '../../../plugins/c4s-plugin-code-snippets/src/entity/code-snippet/index.js';
import type { BackendModule } from '../../../src/server/core/plugin-host/types.js';
import type { Root } from '../../../src/shared/types.js';

const codeSnippet = codeSnippetEntity as unknown as BackendModule;
const app = () => createTestApp({ extraModules: [codeSnippet] });

type T = Awaited<ReturnType<typeof app>>;

const post = (t: T, body: Record<string, unknown>) =>
  request(t.app).post('/api/code-snippets').send(body);

/**
 * The type's own row out of `describe_entity_type` — read through the discovery
 * core the external MCP surface is built on, i.e. exactly what an agent sees.
 */
const described = (t: T) => {
  const core = t.mcpSurfaceDeps('chat').reader.discovery!;
  return core.describeTypes({ types: ['code-snippet'] }).types[0]!;
};

const SAMPLE = 'export const x = 1;\nexport const y = 2;';

describe('code-snippet — schema and write path', () => {
  it('[ac:ac-pusty-code-jest-odrzucany] refuses an empty code field', async () => {
    const t = await app();
    try {
      expect((await post(t, { title: 'Empty', code: '' })).status).toBe(400);
      expect((await post(t, { title: 'Missing' })).status).toBe(400);
      // and accepts a non-empty one, so the rejection is about emptiness
      expect((await post(t, { title: 'Fine', code: 'a' })).status).toBe(201);
    } finally {
      t.cleanup();
    }
  });

  it('[ac:ac-limit-10-000-znakow-na-polu-code-jest] enforces 10000 at the boundary, with no silent truncation', async () => {
    const t = await app();
    try {
      const exact = 'a'.repeat(10000);
      const ok = await post(t, { title: 'Exact', code: exact });
      expect(ok.status).toBe(201);
      // The whole value came back — a cap that truncated would pass a length
      // check on the request and quietly store 10000 of 10001 characters.
      const stored = await request(t.app).get(`/api/code-snippets/${ok.body.data.slug}`);
      expect(stored.body.data.code).toHaveLength(10000);
      expect(stored.body.data.code).toBe(exact);

      expect((await post(t, { title: 'Over', code: 'a'.repeat(10001) })).status).toBe(400);
    } finally {
      t.cleanup();
    }
  });

  it('[ac:ac-wartosc-language-jest-normalizowana-p] lower-cases and aliases language on write', async () => {
    const t = await app();
    try {
      const cases: Array<[string | undefined, string]> = [
        ['TypeScript', 'typescript'],
        ['ts', 'typescript'],
        ['TS', 'typescript'],
        ['sh', 'bash'],
        ['ZSH', 'bash'],
        ['YML', 'yaml'],
        ['', 'text'],
        [undefined, 'text'],
      ];
      for (const [input, expected] of cases) {
        const res = await post(t, {
          title: `L ${String(input)}`,
          code: 'x',
          ...(input === undefined ? {} : { language: input }),
        });
        expect(res.status, `language=${String(input)}`).toBe(201);
        expect(res.body.data.language, `language=${String(input)}`).toBe(expected);
      }

      // and on the PATCH door too, not only on create
      const created = await post(t, { title: 'Patchable', code: 'x', language: 'text' });
      const patched = await request(t.app)
        .patch(`/api/code-snippets/${created.body.data.slug}`)
        .send({ language: 'PY' });
      expect(patched.body.data.language).toBe('python');
    } finally {
      t.cleanup();
    }
  });

  it('[ac:ac-nieznany-jezyk-degraduje-do-plaintext] stores an unknown language folded, without refusing', async () => {
    const t = await app();
    try {
      const res = await post(t, { title: 'Exotic', code: 'x', language: 'COBOL' });
      expect(res.status).toBe(201);
      expect(res.body.data.language).toBe('cobol');
    } finally {
      t.cleanup();
    }
  });

  it('[ac:ac-slug-pochodzi-z-title-tylko-przy-twor] derives the slug at create only; rename goes through newSlug', async () => {
    const t = await app();
    try {
      const created = await post(t, { title: 'Entity Contribution Manifest', code: SAMPLE });
      expect(created.body.data.slug).toBe('entity-contribution-manifest');

      // Editing the title does NOT move the slug — nothing pointing at it breaks.
      const retitled = await request(t.app)
        .patch('/api/code-snippets/entity-contribution-manifest')
        .send({ title: 'A Completely Different Name' });
      expect(retitled.status).toBe(200);
      expect(retitled.body.data.slug).toBe('entity-contribution-manifest');
      expect(retitled.body.data.title).toBe('A Completely Different Name');

      // Renaming is explicit, and it moves the entity.
      const renamed = await request(t.app)
        .patch('/api/code-snippets/entity-contribution-manifest')
        .send({ newSlug: 'manifest-shape' });
      expect(renamed.body.data.slug).toBe('manifest-shape');
      expect((await request(t.app).get('/api/code-snippets/entity-contribution-manifest')).status).toBe(404);
    } finally {
      t.cleanup();
    }
  });

  it('[ac:ac-kolizja-tytulow-daje-sufiks-nie-blad] suffixes a duplicate title instead of refusing it', async () => {
    const t = await app();
    try {
      const first = await post(t, { title: 'Manifest', code: 'a' });
      const second = await post(t, { title: 'Manifest', code: 'b' });
      const third = await post(t, { title: 'Manifest', code: 'c' });

      expect([first.status, second.status, third.status]).toEqual([201, 201, 201]);
      expect(first.body.data.slug).toBe('manifest');
      expect(second.body.data.slug).toBe('manifest-2');
      expect(third.body.data.slug).toBe('manifest-3');
      // Neither write reported a conflict — duplicate titles are normal here.
      for (const r of [second, third]) expect(r.body.error).toBeUndefined();
    } finally {
      t.cleanup();
    }
  });
});

describe('code-snippet — read, search, delta, snapshot', () => {
  it('[ac:ac-pole-code-jest-emitowane-w-kazdym-gen] emits full code in a generic read, with no content fields', async () => {
    const t = await app();
    try {
      await post(t, { title: 'Readable', code: SAMPLE, language: 'ts' });

      // `code` is not contentBearing, so nothing is withheld and there is no
      // second operation handing the body over.
      expect(described(t).contentFields).toEqual([]);

      const got = await request(t.app).get('/api/code-snippets/readable');
      expect(got.body.data.code).toBe(SAMPLE);
      // no `hasCode` / `codeBytes` placeholders — those are the withheld shape
      expect(got.body.data.hasCode).toBeUndefined();
      expect(got.body.data.codeBytes).toBeUndefined();
    } finally {
      t.cleanup();
    }
  });

  it('[ac:ac-tresc-code-jest-przeszukiwalna-przez] keeps code in searchableFields', async () => {
    const t = await app();
    try {
      // The ONLY thing that removes a field from search is `contentBearing`;
      // there is no exclusion by length. This is the pay-off for not flagging it.
      expect(described(t).searchableFields).toContain('code');
    } finally {
      t.cleanup();
    }
  });

  it('[ac:ac-zmiana-code-daje-field-changed-z-from] diffs code as field_changed with from/to, never opaque', async () => {
    const t = await app();
    try {
      await post(t, { title: 'Diffable', code: 'const a = 1;' });
      await request(t.app).patch('/api/code-snippets/diffable').send({ code: 'const a = 2;' });

      /*
       * `diffEntity` is the delta ENGINE — the closed `DiffOp` dictionary the
       * type's contract is written in. `versionService.diff` is the version
       * UI's flat `path/from/to` view over the same change, so asserting there
       * would pass whether or not the field had degraded to opaque, which is
       * precisely the distinction this criterion is about.
       */
      const versions = t.versionService.listVersions('code-snippet', 'diffable');
      expect(versions.length).toBeGreaterThanOrEqual(2);
      const [newer, older] = versions; // listVersions is newest-first

      const before = t.versionService.getVersion('code-snippet', 'diffable', older!.version);
      const after = t.versionService.getVersion('code-snippet', 'diffable', newer!.version);
      const delta = diffEntity(t.host, 'code-snippet', before!.data as never, after!.data as never);
      const ops = delta.changes as unknown as Array<Record<string, unknown>>;

      // The dictionary keys an op by `path`, not `field`.
      const codeOp = ops.find((o) => o.path === 'code');
      expect(codeOp?.op).toBe('field_changed');
      expect(codeOp?.from).toBe('const a = 1;');
      expect(codeOp?.to).toBe('const a = 2;');
      // The thing this type declines `contentBearing` in order to avoid.
      expect(ops.some((o) => o.op === 'field_changed_opaque')).toBe(false);
    } finally {
      t.cleanup();
    }
  });

  it('[ac:ac-snapshot-niesie-pelne-code-przy-pusty] snapshots the literal code, deterministically, at payloadVersion 1', async () => {
    const t = await app();
    try {
      await post(t, { title: 'Snapshotted', code: SAMPLE, language: 'TS', filename: 'src/x.ts' });

      const entity = t.rawReader.getEntity('code-snippet' as never, 'snapshotted');
      const once = snapshotEntity(t.host, 'code-snippet', entity, t.rawReader);
      const twice = snapshotEntity(t.host, 'code-snippet', entity, t.rawReader);
      // Bit-identical, which is the condition for a clean file diff.
      expect(JSON.stringify(once)).toBe(JSON.stringify(twice));

      const snap = once as unknown as Record<string, unknown>;
      expect(snap.code).toBe(SAMPLE);
      expect(snap.language).toBe('typescript');
      expect(snap.filename).toBe('src/x.ts');
      expect(Array.isArray(snap.tags)).toBe(true);
      // `caption` is a property of a REFERENCE and must never appear here.
      expect(snap.caption).toBeUndefined();

      expect(codeSnippetEntity.payloadVersion).toBe(1);
      expect(codeSnippetEntity.payloadUpgrades).toBeUndefined();
    } finally {
      t.cleanup();
    }
  });
});

describe('code-snippet — envelope and system prompt', () => {
  it('[ac:ac-koperta-wnosi-pelen-vertical-slice-ty] gets projection, routes, CRUD and delta from the declaration alone', async () => {
    const t = await app();
    try {
      // No `backend` slot — the negative half of the claim.
      expect('backend' in codeSnippetEntity).toBe(false);

      const cols = (
        t.db.prepare('PRAGMA table_info(code_snippet)').all() as Array<{ name: string; notnull: number; dflt_value: unknown }>
      );
      expect(cols.map((c) => c.name)).toEqual([
        'slug',
        'title',
        'language',
        'filename',
        'code',
        'created_at',
        'updated_at',
      ]);
      // The declared default reached the DDL, so an absent language is filled here.
      expect(String(cols.find((c) => c.name === 'language')?.dflt_value)).toContain('text');

      // No caption column: the field does not exist, so there is nothing to project.
      expect(cols.some((c) => c.name === 'caption')).toBe(false);

      const created = await post(t, { title: 'Sliced', code: SAMPLE });
      expect(created.status).toBe(201);
      expect((await request(t.app).get('/api/code-snippets')).status).toBe(200);
      expect((await request(t.app).delete('/api/code-snippets/sliced')).status).toBeLessThan(300);
    } finally {
      t.cleanup();
    }
  });

  it('[ac:ac-typ-pojawia-sie-w-bloku-entities-syst] appears in the prompt with its roleNoun and no MCP server line', async () => {
    const t = await app();
    try {
      const prompt = buildSystemPrompt({
        host: t.host,
        projectName: 'My Spec',
        cwd: t.cwd,
        roots: [] as Root[],
        currentPagePath: null,
        currentPageBody: null,
        pageCount: 0,
        entityCounts: { 'code-snippet': 2 },
        tagCount: 0,
        sectionCount: 0,
      });

      // The narrative row carries the threshold — the one rule no validator can
      // enforce, so it reaches the agent here or it reaches it nowhere.
      expect(prompt).toContain('<entity type="code-snippet">');
      expect(prompt).toMatch(/20 lines/);
      // 0.2.50: no per-type count attribute. It was frozen at turn 1 and nothing
      // in the prompt branched on it; `list_entities({ mode: 'count' })` answers
      // the question with a current number.
      expect(prompt).not.toContain('code-snippet="2"');
      // The type is embeddable, so it belongs to the embed type union.
      expect(prompt).toMatch(/(^|\|)code-snippet(\||[^-\w])/);
      // No custom MCP server line: the package contributes no server of its own.
      expect(prompt).not.toMatch(/code-snippet-tools/);
    } finally {
      t.cleanup();
    }
  });

  it('[ac:ac-typ-jest-ukryty-brak-listingu-i-brak] is hidden — no sidebar tab, no routes, no detail panel, no row slot', async () => {
    // Hidden-ness is what the OMISSIONS mean; the backend contribution carries
    // no frontend slots at all, and the frontend module declares only the three
    // a hidden type may have.
    const { codeSnippetFrontendModule } = await import(
      '../../../plugins/c4s-plugin-code-snippets/src/entity/code-snippet/frontend/module.js'
    );
    expect(codeSnippetFrontendModule.sidebarTab).toBeUndefined();
    expect(codeSnippetFrontendModule.routes).toBeUndefined();
    expect(codeSnippetFrontendModule.detailPanel).toBeUndefined();
    // Missing `renderRow` is what makes <element_list/> and <tagged_list/>
    // unsupported embedding paths BY CONTRACT.
    expect(codeSnippetFrontendModule.renderRow).toBeUndefined();
    // and the overlay a hidden type owes, since a chip has nowhere to navigate
    expect(codeSnippetFrontendModule.renderOverlay).toBeTypeOf('function');
    expect(codeSnippetFrontendModule.renderChip).toBeTypeOf('function');
    expect(codeSnippetFrontendModule.renderCard).toBeTypeOf('function');
    expect(await codeSnippetFrontendModule.listByTags({ tags: ['x'], filter: 'or' })).toEqual([]);
  });
});
