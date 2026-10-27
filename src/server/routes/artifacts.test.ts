import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { describe, it, expect, expectTypeOf, beforeEach, afterEach } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { MarkdownFileStore } from '../services/pages.js';
import { FileWatchRuntime } from '../fs/watcher.js';
import { artifactSource, boundWriter } from '../fs/sources.js';
import { FileSerializer } from '../services/file-serializer.js';
import { FileVersionService } from '../services/file-version.js';
import { PagesFrontmatterIndexer } from '../services/pages-frontmatter-indexer.js';
import { ChatService } from '../services/chat.js';
import { BriefService } from '../services/brief.js';
import { PatchService } from '../services/patch.js';
import { PlanService } from '../services/plan.js';
import { artifactsRouter } from './artifacts.js';
import { errorHandler } from './errors.js';
import { systemRootId } from '../../shared/root-kinds.js';
import type { ReleaseService } from '../services/release.js';
import type { WsEmitter } from '../ws/project-emitter.js';
import type { ArtifactFrontmatterUpdateRequest } from '../../shared/entities.js';
import { expectPatchOperationRecord } from '../../../tests/helpers/patch-tool-records.js';
import { DEFAULT_BUDGET_CHARS } from '../discovery/budget.js';

const fakeWs = { broadcast: () => {} } as unknown as WsEmitter;
/** Release names in creation order (index = rank); tests that need ranks set it. */
let releasesInCreationOrder: string[] = [];
const fakeReleaseService = {
  releaseRankByName: () => new Map(releasesInCreationOrder.map((name, i) => [name, i])),
} as unknown as ReleaseService;

describe('artifactsRouter — /api/artifacts/:kind/*', () => {
  let cwd: string;
  let db: Database.Database;
  let app: express.Express;
  let briefsSerializer: FileSerializer;
  let patchesSerializer: FileSerializer;
  let pageVersions: FileVersionService;
  let frontmatterIndexer: PagesFrontmatterIndexer;
  let plans: PlanService;
  let briefs: BriefService;
  let patches: PatchService;
  /** What the frontmatter indexer broadcast (its artifact-change events included). */
  let indexerEvents: Array<{ kind: string; path?: string }>;

  const briefsDir = 'briefs';
  const patchesDir = 'patches';
  const plansDir = 'plans';

  async function writeArtifact(
    kind: 'brief' | 'patch',
    relPath: string,
    frontmatter: Record<string, unknown>,
    body: string,
  ): Promise<void> {
    const dir = kind === 'brief' ? briefsDir : patchesDir;
    const rootId = kind === 'brief' ? systemRootId('briefs') : systemRootId('patches');
    const serializer = kind === 'brief' ? briefsSerializer : patchesSerializer;
    const abs = path.join(cwd, dir, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, matter.stringify(body, frontmatter), 'utf-8');
    await frontmatterIndexer.indexPage(rootId, relPath);
    await pageVersions.recordVersion(relPath, 'create', 'filesystem', undefined, serializer, rootId);
  }

  beforeEach(async () => {
    releasesInCreationOrder = [];
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-artifacts-test-'));
    db = new Database(':memory:');
    runMigrations(db);

    const briefsPages = new MarkdownFileStore({ cwd, dir: briefsDir, rootId: systemRootId('briefs'), kind: 'briefs' });
    await briefsPages.ensureRoot();
    const patchesPages = new MarkdownFileStore({ cwd, dir: patchesDir, rootId: systemRootId('patches'), kind: 'patches' });
    await patchesPages.ensureRoot();
    const plansPages = new MarkdownFileStore({ cwd, dir: plansDir, rootId: systemRootId('plans'), kind: 'plans' });
    await plansPages.ensureRoot();
    const watchRuntime = new FileWatchRuntime({ fsEvents: false });
    const scoped = watchRuntime.scoped('context:test');
    for (const [kind, svc] of [['brief', briefsPages], ['patch', patchesPages], ['plan', plansPages]] as const) {
      watchRuntime.mountSource({ source: artifactSource(kind), dir: svc.root, scope: 'context:test' });
    }
    const briefsWatcher = boundWriter(scoped, artifactSource('brief'));
    const patchesWatcher = boundWriter(scoped, artifactSource('patch'));
    const plansWatcher = boundWriter(scoped, artifactSource('plan'));
    briefsSerializer = new FileSerializer(briefsPages);
    patchesSerializer = new FileSerializer(patchesPages);
    const plansSerializer = new FileSerializer(plansPages);
    pageVersions = new FileVersionService(db, briefsSerializer);
    const frontmatterRoots = new Map([
      [systemRootId('briefs'), briefsPages],
      [systemRootId('patches'), patchesPages],
      [systemRootId('plans'), plansPages],
    ]);
    indexerEvents = [];
    frontmatterIndexer = new PagesFrontmatterIndexer(
      frontmatterRoots,
      { broadcast: (e: { kind: string; path?: string }) => void indexerEvents.push(e) } as unknown as WsEmitter,
      new Map([
        [systemRootId('briefs'), 'briefs:changed'],
        [systemRootId('patches'), 'patches:changed'],
        [systemRootId('plans'), 'plans:changed'],
      ] as const),
    );
    const chatService = new ChatService(db);

    const briefService = new BriefService({
      briefsPages,
      briefsWatcher,
      briefsSerializer,
      pageVersions,
      chatService,
      releaseService: fakeReleaseService,
      frontmatterIndexer,
      ws: fakeWs,
    });
    const patchService = new PatchService({
      patchesPages,
      patchesWatcher,
      patchesSerializer,
      pageVersions,
      chatService,
      frontmatterIndexer,
    });
    const planService = new PlanService({
      plansPages,
      plansWatcher,
      plansSerializer,
      pageVersions,
      chatService,
      frontmatterIndexer,
      ws: fakeWs,
    });
    plans = planService;
    briefs = briefService;
    patches = patchService;

    app = express()
      // The production body limit (src/server/index.ts): the editor's Save sends
      // the WHOLE file, and the 2.1.48 fixtures are longer than express's 100kb
      // default — under it a Save would be a 400 `entity.too.large`, not the route.
      .use(express.json({ limit: '2mb' }))
      .use(
        '/api/artifacts',
        artifactsRouter({ brief: briefService, patch: patchService, plan: planService, pageVersions, chat: chatService }),
      )
      .use(errorHandler);
  });

  afterEach(async () => {
    db.close();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('404s an unknown :kind with UNKNOWN_ARTIFACT_KIND', async () => {
    const res = await request(app).get('/api/artifacts/bogus');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('UNKNOWN_ARTIFACT_KIND');
  });

  it('[ac:ac-przy-odrzuconej-zmianie-immutable-pol] a refused immutable-field change names the field in the message; the code is the shared IMMUTABLE_FIELD for every kind', async () => {
    await writeArtifact(
      'brief',
      'v1-to-v2.md',
      { type: 'brief', from_release: 'v1', to_release: 'v2', generated_at: '2026-01-01T00:00:00.000Z', implemented: false },
      '# Brief\n',
    );
    await writeArtifact(
      'patch',
      'v1-to-v2-drift.md',
      { type: 'patch', brief: 'v1-to-v2.md', patch_kind: 'drift', created_at: '2026-01-02T00:00:00.000Z', created_by: 'implementer', applied: false },
      '# Patch — drift\n',
    );

    const briefRoots = await request(app)
      .patch('/api/artifacts/brief/v1-to-v2.md/frontmatter')
      .send({ frontmatter: { roots: ['docs'] } });
    const patchBrief = await request(app)
      .patch('/api/artifacts/patch/v1-to-v2-drift.md/frontmatter')
      .send({ frontmatter: { brief: 'other.md' } });
    const detail = await request(app).get('/api/artifacts/brief/v1-to-v2.md');
    const briefContent = await request(app)
      .put('/api/artifacts/brief/v1-to-v2.md/content')
      .send({
        content: detail.body.data.content.replace('to_release: v2', 'to_release: v3'),
        expectedHash: detail.body.data.hash,
      });

    const refusals = [
      [briefRoots, 'roots'],
      [patchBrief, 'brief'],
      [briefContent, 'to_release'],
    ] as const;
    for (const [res, field] of refusals) {
      expect(res.status, field).toBe(400);
      // One code for every kind — no BRIEF_… / PATCH_… variant …
      expect(res.body.error.code, field).toBe('IMMUTABLE_FIELD');
      // … the refused field is told by the message.
      expect(res.body.error.message, field).toContain(field);
    }
    expect(briefRoots.body.error.message).not.toContain('to_release');
    expect(briefContent.body.error.message).not.toContain('roots');
  });

  describe('brief', () => {
    beforeEach(async () => {
      await writeArtifact(
        'brief',
        'v1-to-v2.md',
        {
          type: 'brief',
          from_release: 'v1',
          to_release: 'v2',
          generated_at: '2026-01-01T00:00:00.000Z',
          implemented: false,
        },
        '# Brief: v1 -> v2\n',
      );
    });

    /**
     * 0.2.40 — the artifact read family's window, over REST.
     *
     * Channel parity is the point: the same `range` that `get_brief` takes over
     * MCP has to exist here, or a brief too large to answer in one response is
     * unreadable from every channel but one.
     */
    describe('the read window (0.2.40)', () => {
      beforeEach(async () => {
        await writeArtifact(
          'brief',
          'long.md',
          {
            type: 'brief',
            from_release: null,
            to_release: null,
            generated_at: '2026-01-01T00:00:00.000Z',
            implemented: false,
          },
          Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n',
        );
      });

      it('[ac:ac-get-brief-ma-okno-odczytu-range-i-jaw] ?view=operation&range narrows the content, and nothing gates it', async () => {
        const whole = await request(app).get('/api/artifacts/brief/long.md');
        const windowed = await request(app).get('/api/artifacts/brief/long.md?view=operation&range=1-4');

        expect(windowed.status).toBe(200);
        expect(windowed.body.data.content.split('\n')).toHaveLength(4);
        expect(windowed.body.data.content.length).toBeLessThan(whole.body.data.content.length);
      });

      it('the hash stays the WHOLE file’s, so a windowed read still arms expectedHash', async () => {
        const whole = await request(app).get('/api/artifacts/brief/long.md');
        const windowed = await request(app).get('/api/artifacts/brief/long.md?view=operation&range=5-6');
        // A hash of the window would fail every write made with it, and the
        // value itself would not say which of the two it is.
        expect(windowed.body.data.hash).toBe(whole.body.data.hash);
      });

      it('[ac:ac-rodzina-odczytu-artefaktu-wspolna-tak] a range past the end of the file refuses, stating the size', async () => {
        const res = await request(app).get('/api/artifacts/brief/long.md?view=operation&range=900-999');
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toContain('lines');
      });

      it('[ac:ac-rodzina-odczytu-artefaktu-wspolna-tak] a window opening on a `---` line is served, not re-parsed as frontmatter', async () => {
        await writeArtifact(
          'brief',
          'sep.md',
          {
            type: 'brief',
            from_release: null,
            to_release: null,
            generated_at: '2026-01-01T00:00:00.000Z',
            implemented: false,
          },
          // A thematic break, then a line that is not valid YAML. Handing this
          // window back to gray-matter read the break as an opening fence and
          // turned a valid read into a 500 out of a YAML parser.
          ['intro', '', '---', '', 'a: b: c', 'tail'].join('\n') + '\n',
        );
        const whole = await request(app).get('/api/artifacts/brief/sep.md');
        // The LAST `---` is the thematic break in the body; the first two are
        // the frontmatter fences.
        const breakLine = whole.body.data.content.split('\n').lastIndexOf('---') + 1;

        const res = await request(app).get(`/api/artifacts/brief/sep.md?view=operation&range=${breakLine}-${breakLine + 3}`);
        expect(res.status).toBe(200);
        expect(res.body.data.content.split('\n')[0]).toBe('---');
        // The body is the window itself — no line silently eaten as frontmatter.
        expect(res.body.data.body).toContain('a: b: c');
      });

      it('a malformed ?range is refused rather than ignored', async () => {
        // Ignoring it would answer with the whole file to a caller who asked
        // for a window precisely because the whole file is too much.
        const res = await request(app).get('/api/artifacts/brief/long.md?view=operation&range=nonsense');
        expect(res.status).toBe(400);
      });

      it('omitting ?view returns the whole artifact (the editor projection)', async () => {
        const res = await request(app).get('/api/artifacts/brief/long.md');
        expect(res.status).toBe(200);
        expect(res.body.data.content.split('\n').length).toBeGreaterThan(19);
        expect(res.body.data.truncated).toBeUndefined();
      });
    });

    it('GET /api/artifacts/brief lists with frontmatter + hash + updatedAt, filtered by ?implemented=', async () => {
      const all = await request(app).get('/api/artifacts/brief');
      expect(all.status).toBe(200);
      expect(all.body.data).toHaveLength(1);
      expect(all.body.data[0]).toMatchObject({
        path: 'v1-to-v2.md',
        frontmatter: { from_release: 'v1', to_release: 'v2' },
      });
      expect(typeof all.body.data[0].hash).toBe('string');
      expect(all.body.data[0].hash.length).toBeGreaterThan(0);

      const implementedOnly = await request(app).get('/api/artifacts/brief?implemented=true');
      expect(implementedOnly.body.data).toHaveLength(0);

      const pendingOnly = await request(app).get('/api/artifacts/brief?implemented=false');
      expect(pendingOnly.body.data).toHaveLength(1);
    });

    describe('the release axis (2.1.3)', () => {
      /**
       * The order is the operation's, and `c4s list-briefs` pages over it — its
       * first row is what the brief-implementer skill reads. Rank is creation
       * order, never the name: `v0.10` stands above `v0.9` even though a string
       * compare (and the old `to_release desc`) put it below.
       */
      const fm = (from: string | null, to: string | null, implemented = false) => ({
        type: 'brief',
        from_release: from,
        to_release: to,
        generated_at: '2026-01-01T00:00:00.000Z',
        implemented,
      });
      const paths = (res: request.Response) => res.body.data.map((r: { path: string }) => r.path);

      beforeEach(async () => {
        // `v1`/`v2` (the describe's fixture brief) were created before the v0.x line.
        releasesInCreationOrder = ['v1', 'v2', 'v0.8', 'v0.9', 'v0.10'];
        await writeArtifact('brief', 'h-null.md', fm(null, null), '# none\n');
        await writeArtifact('brief', 'f-108.md', fm('0-2-108', '0-2-109', true), '# tail\n');
        await writeArtifact('brief', 'e-v08.md', fm(null, 'v0.8', true), '# first\n');
        await writeArtifact('brief', 'c-open-v09.md', fm('v0.9', null), '# open 0.9\n');
        await writeArtifact('brief', 'g-71.md', fm('0-2-71', '0-2-72'), '# tail\n');
        await writeArtifact('brief', 'a-open-v010.md', fm('v0.10', null), '# open newest\n');
        await writeArtifact('brief', 'd-v09.md', fm('v0.8', 'v0.9', true), '# 0.9\n');
        await writeArtifact('brief', 'b-v010.md', fm('v0.9', 'v0.10'), '# 0.10\n');
      });

      const FULL = [
        'a-open-v010.md',
        'b-v010.md',
        'c-open-v09.md',
        'd-v09.md',
        'e-v08.md',
        'v1-to-v2.md',
        'f-108.md',
        'g-71.md',
        'h-null.md',
      ];

      it('lists newest cycle first, open windows above their from_release, unknown releases and null→null last', async () => {
        expect(paths(await request(app).get('/api/artifacts/brief'))).toEqual(FULL);
      });

      it('the implemented filter removes rows and never reorders the rest', async () => {
        const done = paths(await request(app).get('/api/artifacts/brief?implemented=true'));
        const pending = paths(await request(app).get('/api/artifacts/brief?implemented=false'));
        expect(done).toEqual(FULL.filter((p) => done.includes(p)));
        expect(pending).toEqual(FULL.filter((p) => pending.includes(p)));
        expect(done.length + pending.length).toBe(FULL.length);
      });

      it('with no releases in the DB the whole list is tail, by name descending in numeric segments', async () => {
        releasesInCreationOrder = [];
        const got = paths(await request(app).get('/api/artifacts/brief'));
        // `v0.10` > `v0.9` by numeric segments, which a string compare gets backwards.
        expect(got.indexOf('b-v010.md')).toBeLessThan(got.indexOf('d-v09.md'));
        expect(got.indexOf('f-108.md')).toBeLessThan(got.indexOf('g-71.md'));
        expect(got.at(-1)).toBe('h-null.md');
      });
    });

    it('404 on an unknown brief carries the list of real ones', async () => {
      // `assertBriefExists`, the filesystem reader this replaced, put up to ten
      // real filenames in the hint. Losing it left the caller a bare "not
      // found" — the least useful thing to say to someone who has just proved
      // they do not know the filename — and the agent reading it is forbidden
      // from looking in the repo itself.
      const res = await request(app).get('/api/artifacts/brief/no-such-brief.md');
      expect(res.status).toBe(404);
      expect(res.body.error.hint).toContain('v1-to-v2.md');
    });

    it('GET /api/artifacts/brief/:path returns detail WITHOUT a threads payload', async () => {
      // 0.1.139: threads left the detail response — they have their own paged
      // endpoint, and merging them here cost a second chat_thread scan per
      // fetch that no client read.
      await request(app).post('/api/artifacts/brief/v1-to-v2.md/threads').send({ name: 'a thread' });

      const res = await request(app).get('/api/artifacts/brief/v1-to-v2.md');
      expect(res.status).toBe(200);
      expect(res.body.data.path).toBe('v1-to-v2.md');
      expect(res.body.data.frontmatter.from_release).toBe('v1');
      expect(res.body.data.body).toContain('Brief: v1 -> v2');
      expect(res.body.data).not.toHaveProperty('threads');
    });

    it('GET /api/artifacts/brief/:path/versions lists captured versions', async () => {
      const res = await request(app).get('/api/artifacts/brief/v1-to-v2.md/versions');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].op).toBe('create');
    });

    it('PUT .../content updates on a hash match and answers echo-free: path, frontmatter, hash — no body/content', async () => {
      const detail = await request(app).get('/api/artifacts/brief/v1-to-v2.md');
      const newContent = matter.stringify('# Brief: v1 -> v2 (edited)\n', detail.body.data.frontmatter);

      const res = await request(app)
        .put('/api/artifacts/brief/v1-to-v2.md/content')
        .send({ content: newContent, expectedHash: detail.body.data.hash });

      expect(res.status).toBe(200);
      expect(Object.keys(res.body.data).sort()).toEqual(['frontmatter', 'hash', 'path']);
      expect(res.body.data.hash).not.toBe(detail.body.data.hash);
      const after = await request(app).get('/api/artifacts/brief/v1-to-v2.md');
      expect(after.body.data.body).toContain('edited');
      expect(after.body.data.hash).toBe(res.body.data.hash);
    });

    it('PUT .../content 409s on a hash mismatch, with currentHash + currentContent', async () => {
      const res = await request(app)
        .put('/api/artifacts/brief/v1-to-v2.md/content')
        .send({ content: 'irrelevant', expectedHash: 'stale-hash' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('BRIEF_CONFLICT');
      expect(typeof res.body.currentHash).toBe('string');
      expect(res.body.currentContent).toContain('Brief: v1 -> v2');
    });

    it('PUT .../content 400s VALIDATION (not a 409) when expectedHash is omitted', async () => {
      const res = await request(app)
        .put('/api/artifacts/brief/v1-to-v2.md/content')
        .send({ content: 'irrelevant' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION');
    });

    it('[ac:ac-jedynym-mutable-polem-frontmatteru-br] PATCH /api/artifacts/brief/:path/frontmatter accepts `implemented` alone and refuses every other key with 400 IMMUTABLE_FIELD', async () => {
      for (const [key, value] of [
        ['type', 'patch'],
        ['from_release', 'v0'],
        ['to_release', 'v3'],
        ['generated_at', '2027-01-01T00:00:00.000Z'],
        ['roots', ['docs']],
        ['title', 'renamed'],
      ] as const) {
        const res = await request(app)
          .patch('/api/artifacts/brief/v1-to-v2.md/frontmatter')
          .send({ frontmatter: { [key]: value } });
        expect(res.status, key).toBe(400);
        expect(res.body.error.code, key).toBe('IMMUTABLE_FIELD');
      }
      // A mix of the mutable key and another one is refused whole — nothing is written.
      const mixed = await request(app)
        .patch('/api/artifacts/brief/v1-to-v2.md/frontmatter')
        .send({ frontmatter: { implemented: true, to_release: 'v3' } });
      expect(mixed.status).toBe(400);
      expect(mixed.body.error.code).toBe('IMMUTABLE_FIELD');
      expect(matter(await fs.readFile(path.join(cwd, briefsDir, 'v1-to-v2.md'), 'utf-8')).data.implemented).toBe(false);

      const ok = await request(app)
        .patch('/api/artifacts/brief/v1-to-v2.md/frontmatter')
        .send({ frontmatter: { implemented: true } });
      expect(ok.status).toBe(200);
      expect(ok.body.data.frontmatter.implemented).toBe(true);
    });

    /**
     * The server half of `c4s mark-brief-implemented` (the CLI half — one PATCH
     * of this route — is in src/core/agent/mark-brief-implemented.test.ts).
     * ASSUMPTION:dev-0004 — the AC names the version author `filesystem` and says
     * a brief thread's agent does not read the flag; the window's pages give a
     * user write the author `user` (M10 `bctqi8sw`) and the brief block carries
     * `implemented`. Those two halves are filed as a clarification, not asserted.
     */
    it('[ac:ac-ustawienie-implemented-true-przez-c4s] setting implemented: true through the route mark-brief-implemented wraps writes the file on the server, emits the briefs source event, lands an `update` on the version axis and flips the listed badge from pending to implemented', async () => {
      const pending = await request(app).get('/api/artifacts/brief?implemented=false');
      expect(pending.body.data.map((b: { path: string }) => b.path)).toEqual(['v1-to-v2.md']);
      indexerEvents.length = 0;

      const res = await request(app)
        .patch('/api/artifacts/brief/v1-to-v2.md/frontmatter')
        .send({ frontmatter: { implemented: true } });
      expect(res.status).toBe(200);

      // The file on the server.
      const onDisk = matter(await fs.readFile(path.join(cwd, briefsDir, 'v1-to-v2.md'), 'utf-8'));
      expect(onDisk.data.implemented).toBe(true);
      expect(onDisk.content).toContain('# Brief: v1 -> v2');
      // The source's event.
      expect(indexerEvents).toContainEqual({ kind: 'briefs:changed', path: 'v1-to-v2.md' });
      // The version axis: one `update` after the seeding `create`.
      const versions = pageVersions.listVersions('v1-to-v2.md', systemRootId('briefs'));
      expect(versions.map((v) => v.op)).toEqual(['update', 'create']);
      // The reindex moves the badge: the list now answers it as implemented.
      const done = await request(app).get('/api/artifacts/brief?implemented=true');
      expect(done.body.data.map((b: { path: string }) => b.path)).toEqual(['v1-to-v2.md']);
      expect((await request(app).get('/api/artifacts/brief?implemented=false')).body.data).toEqual([]);
    });

    it('POST .../threads creates a thread bound to this brief', async () => {
      const res = await request(app).post('/api/artifacts/brief/v1-to-v2.md/threads').send({ name: 'my thread' });
      expect(res.status).toBe(200);
      expect(typeof res.body.data.threadId).toBe('string');

      const listed = await request(app).get('/api/artifacts/brief/v1-to-v2.md/threads');
      expect(listed.body.data).toHaveLength(1);
      expect(listed.body.data[0].title).toBe('my thread');
    });

    /**
     * Wiersz `chat_thread` powstaje z samej sciezki, wiec bez tego sprawdzenia
     * literowka w `c4s agent --ct brief --brief <path>` mintowala sierotę i
     * odpalala pelna, platna ture bez snapshotu briefu (`agent-turn` polyka
     * pozniejszy NOT_FOUND w `console.warn`).
     */
    it('POST .../threads 404s for a brief path that does not exist', async () => {
      const res = await request(app).post('/api/artifacts/brief/no-such-brief.md/threads').send({});
      expect(res.status).toBe(404);

      const listed = await request(app).get('/api/artifacts/brief/no-such-brief.md/threads');
      expect(listed.body.data).toHaveLength(0);
    });

    it('GET .../threads lists them as ArtifactThreadListItem rows', async () => {
      await request(app).post('/api/artifacts/brief/v1-to-v2.md/threads').send({ name: 'first' });

      const res = await request(app).get('/api/artifacts/brief/v1-to-v2.md/threads');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toEqual({
        id: expect.any(String),
        title: 'first',
        contextType: 'brief',
        planMode: false,
        messageCount: 0,
        hasSystemPrompt: false,
        updatedAt: expect.any(String),
        isLast: true,
      });
    });

    it('GET .../threads pages with ?limit/?offset and rejects a non-numeric one', async () => {
      for (const name of ['t1', 't2', 't3']) {
        await request(app).post('/api/artifacts/brief/v1-to-v2.md/threads').send({ name });
      }

      const firstPage = await request(app).get('/api/artifacts/brief/v1-to-v2.md/threads?limit=2');
      expect(firstPage.body.data).toHaveLength(2);
      // `isLast` marks the freshest thread overall — only ever on page one.
      expect(firstPage.body.data[0].isLast).toBe(true);

      const secondPage = await request(app).get('/api/artifacts/brief/v1-to-v2.md/threads?limit=2&offset=2');
      expect(secondPage.body.data).toHaveLength(1);
      expect(secondPage.body.data[0].isLast).toBe(false);

      const bad = await request(app).get('/api/artifacts/brief/v1-to-v2.md/threads?limit=nope');
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('VALIDATION');
    });

    it('GET .../threads 404s UNKNOWN_ARTIFACT_KIND for an unregistered kind', async () => {
      const res = await request(app).get('/api/artifacts/bogus/v1-to-v2.md/threads');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('UNKNOWN_ARTIFACT_KIND');
    });

    /**
     * 2.1.13 — the `rest` renderings of `katalog-operacji-m21`, answering with
     * their rows' codes (BRIEF_NOT_FOUND for an unknown path, never the generic
     * NOT_FOUND nor an empty list; INVALID_ARGUMENT for a window or a version
     * off the file).
     */
    describe('brief rows — REST renderings answer with the rows\' codes (2.1.13)', () => {
      it('[entity:katalog-operacji-m21#get_brief] rest rendering: GET /api/artifacts/brief/<path>?view=operation — an unknown path is 404 BRIEF_NOT_FOUND, a window past the end 400 INVALID_ARGUMENT', async () => {
        const unknown = await request(app).get('/api/artifacts/brief/no-such-brief.md');
        expect(unknown.status).toBe(404);
        expect(unknown.body.error.code).toBe('BRIEF_NOT_FOUND');
        const past = await request(app).get('/api/artifacts/brief/v1-to-v2.md?view=operation&range=900-999');
        expect(past.status).toBe(400);
        expect(past.body.error.code).toBe('INVALID_ARGUMENT');
        const ok = await request(app).get('/api/artifacts/brief/v1-to-v2.md?view=operation&range=1-2');
        expect(ok.status).toBe(200);
        expect(ok.body.data.content.split('\n')).toHaveLength(2);
      });

      it('[entity:katalog-operacji-m21#list_briefs] rest rendering: GET /api/artifacts/brief pages with ?limit/?offset AFTER the implemented filter; a non-numeric one is VALIDATION', async () => {
        const fm = (implemented: boolean) => ({
          type: 'brief',
          from_release: null,
          to_release: null,
          generated_at: '2026-01-01T00:00:00.000Z',
          implemented,
        });
        await writeArtifact('brief', 'p1.md', fm(false), '# p1\n');
        await writeArtifact('brief', 'p2.md', fm(true), '# p2\n');
        await writeArtifact('brief', 'p3.md', fm(false), '# p3\n');
        const pending = (await request(app).get('/api/artifacts/brief?implemented=false')).body.data.map(
          (r: { path: string }) => r.path,
        );
        expect(pending).toHaveLength(3);
        const page = await request(app).get('/api/artifacts/brief?implemented=false&limit=2&offset=1');
        expect(page.status).toBe(200);
        expect(page.body.data.map((r: { path: string }) => r.path)).toEqual(pending.slice(1, 3));
        const bad = await request(app).get('/api/artifacts/brief?limit=nope');
        expect(bad.status).toBe(400);
        expect(bad.body.error.code).toBe('VALIDATION');
      });

      it('[entity:katalog-operacji-m21#update_brief] rest rendering: PUT /api/artifacts/brief/<path>/content on an unknown path is 404 BRIEF_NOT_FOUND', async () => {
        const res = await request(app)
          .put('/api/artifacts/brief/no-such-brief.md/content')
          .send({ content: 'x', expectedHash: 'h' });
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('BRIEF_NOT_FOUND');
      });

      it('[entity:katalog-operacji-m21#mark_brief_implemented] rest rendering: PATCH /api/artifacts/brief/<path>/frontmatter { implemented } — an unknown path is 404 BRIEF_NOT_FOUND, another key 400 IMMUTABLE_FIELD, a repeat is a no-op', async () => {
        const unknown = await request(app)
          .patch('/api/artifacts/brief/no-such-brief.md/frontmatter')
          .send({ frontmatter: { implemented: true } });
        expect(unknown.status).toBe(404);
        expect(unknown.body.error.code).toBe('BRIEF_NOT_FOUND');
        const immutable = await request(app)
          .patch('/api/artifacts/brief/v1-to-v2.md/frontmatter')
          .send({ frontmatter: { to_release: 'v3' } });
        expect(immutable.status).toBe(400);
        expect(immutable.body.error.code).toBe('IMMUTABLE_FIELD');
        const first = await request(app)
          .patch('/api/artifacts/brief/v1-to-v2.md/frontmatter')
          .send({ frontmatter: { implemented: true } });
        expect(first.body.data.frontmatter.implemented).toBe(true);
        const versions = (await request(app).get('/api/artifacts/brief/v1-to-v2.md/versions')).body.data.length;
        const again = await request(app)
          .patch('/api/artifacts/brief/v1-to-v2.md/frontmatter')
          .send({ frontmatter: { implemented: true } });
        expect(again.status).toBe(200);
        expect(again.body.data.hash).toBe(first.body.data.hash);
        expect((await request(app).get('/api/artifacts/brief/v1-to-v2.md/versions')).body.data).toHaveLength(versions);
      });

      it('[entity:katalog-operacji-m21#list_brief_versions] rest rendering: GET /api/artifacts/brief/<path>/versions — an unknown path is 404 BRIEF_NOT_FOUND, not an empty list', async () => {
        const res = await request(app).get('/api/artifacts/brief/no-such-brief.md/versions');
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('BRIEF_NOT_FOUND');
        const known = await request(app).get('/api/artifacts/brief/v1-to-v2.md/versions');
        expect(known.status).toBe(200);
        expect(known.body.data.map((v: { version: number }) => v.version)).toEqual([1]);
      });

      it('[entity:katalog-operacji-m21#get_brief_version] rest rendering: GET /api/artifacts/brief/<path>/versions/:version — an unknown path is BRIEF_NOT_FOUND, a version off the history INVALID_ARGUMENT (never VERSION_NOT_FOUND / VALIDATION)', async () => {
        const ok = await request(app).get('/api/artifacts/brief/v1-to-v2.md/versions/1');
        expect(ok.status).toBe(200);
        expect(ok.body.data.version).toBe(1);
        const unknown = await request(app).get('/api/artifacts/brief/no-such-brief.md/versions/1');
        expect(unknown.status).toBe(404);
        expect(unknown.body.error.code).toBe('BRIEF_NOT_FOUND');
        for (const v of ['9', '0', 'abc']) {
          const off = await request(app).get(`/api/artifacts/brief/v1-to-v2.md/versions/${v}`);
          expect(off.status, v).toBe(400);
          expect(off.body.error.code, v).toBe('INVALID_ARGUMENT');
        }
      });
    });
  });

  describe('patch', () => {
    beforeEach(async () => {
      await writeArtifact(
        'patch',
        'v1-to-v2-drift.md',
        {
          type: 'patch',
          brief: 'v1-to-v2.md',
          patch_kind: 'drift',
          created_at: '2026-01-02T00:00:00.000Z',
          created_by: 'agent',
          applied: false,
        },
        '# Patch — drift\n',
      );
    });

    it('GET /api/artifacts/patch lists, filterable by ?applied=', async () => {
      const all = await request(app).get('/api/artifacts/patch');
      expect(all.status).toBe(200);
      expect(all.body.data).toHaveLength(1);
      expect(all.body.data[0].frontmatter.patch_kind).toBe('drift');

      const appliedOnly = await request(app).get('/api/artifacts/patch?applied=true');
      expect(appliedOnly.body.data).toHaveLength(0);

      const pendingOnly = await request(app).get('/api/artifacts/patch?applied=false');
      expect(pendingOnly.body.data).toHaveLength(1);

      const bogus = await request(app).get('/api/artifacts/patch?applied=any');
      expect(bogus.status).toBe(400);
      expect(bogus.body.error.code).toBe('VALIDATION');
    });

    it('[entity:list-patches] list_patches as its record declares it: project, direct, internal/rest direct, cli/mcp n/a with the record\'s reasons, no effects, idempotent, filters `brief` / `applied` + window, code VALIDATION, rendered by transagent-tools · list_patches (internal) — created_at ascending with ties by path and undated last, a brief that does not exist an empty list rather than a refusal, an invalid applied filter VALIDATION', async () => {
      const op = expectPatchOperationRecord({
        nazwa: 'list_patches',
        channels: {
          internal: { kind: 'direct' },
          cli: { kind: 'na', reason: 'brak komendy `c4s`: jedynym realnym wołającym jest agent w wątku albo użytkownik w UI, nie człowiek w terminalu' },
          mcp: { kind: 'na', reason: 'przegląd zbioru zgłoszeń należy do UI i REST; klient kanału `mcp` nie ma intencji, której obiektem byłby zbiór patchy' },
          rest: { kind: 'direct' },
        },
        efekty: ['none'],
        idempotencja: true,
        opisTresci: undefined,
        kodyBledow: ['VALIDATION'],
        narzedzia: { internal: ['transagent-tools-list-patches'] },
      });
      expect(op.opClass).toBe('read');
      expect(Object.keys(op.inputSchema).sort()).toEqual(['applied', 'brief', 'limit', 'offset']);

      // The brief the patches name exists, so the `brief` filter resolves to it.
      await writeArtifact('brief', 'v1-to-v2.md', { type: 'brief', from_release: 'v1', to_release: 'v2' }, '# Brief\n');
      // The order: created_at ascending, ties by path, a patch without created_at last.
      const fm = (created_at?: string) => ({
        type: 'patch',
        brief: 'v1-to-v2.md',
        patch_kind: 'drift',
        ...(created_at ? { created_at } : {}),
        applied: false,
      });
      await writeArtifact('patch', 'a-late.md', fm('2026-01-05T00:00:00.000Z'), '# Patch — late\n');
      await writeArtifact('patch', 'z-tie.md', fm('2026-01-03T00:00:00.000Z'), '# Patch — tie\n');
      await writeArtifact('patch', 'c-tie.md', fm('2026-01-03T00:00:00.000Z'), '# Patch — tie\n');
      await writeArtifact('patch', 'b-undated.md', fm(), '# Patch — undated\n');
      const all = await request(app).get('/api/artifacts/patch');
      expect(all.status).toBe(200);
      expect(all.body.data.map((r: { path: string }) => r.path)).toEqual([
        'v1-to-v2-drift.md',
        'c-tie.md',
        'z-tie.md',
        'a-late.md',
        'b-undated.md',
      ]);
      // Idempotent: the same query answers the same rows.
      expect((await request(app).get('/api/artifacts/patch')).body.data).toEqual(all.body.data);

      const ofBrief = await request(app).get('/api/artifacts/patch?brief=v1-to-v2.md');
      expect(ofBrief.status).toBe(200);
      expect(ofBrief.body.data).toHaveLength(5);
      const noSuchBrief = await request(app).get('/api/artifacts/patch?brief=no-such-brief.md');
      expect(noSuchBrief.status).toBe(200);
      expect(noSuchBrief.body.data).toEqual([]);

      const bogus = await request(app).get('/api/artifacts/patch?applied=maybe');
      expect(bogus.status).toBe(400);
      expect(bogus.body.error.code).toBe('VALIDATION');
    });

    it('GET /api/artifacts/patch/:path returns detail (no top-level title)', async () => {
      const res = await request(app).get('/api/artifacts/patch/v1-to-v2-drift.md');
      expect(res.status).toBe(200);
      expect(res.body.data.frontmatter.patch_kind).toBe('drift');
      expect(res.body.data.title).toBeUndefined();
    });

    it('PATCH .../frontmatter accepts `applied` and rejects a non-boolean', async () => {
      const ok = await request(app)
        .patch('/api/artifacts/patch/v1-to-v2-drift.md/frontmatter')
        .send({ frontmatter: { applied: true } });
      expect(ok.status).toBe(200);
      expect(ok.body.data.frontmatter.applied).toBe(true);

      const badValue = await request(app)
        .patch('/api/artifacts/patch/v1-to-v2-drift.md/frontmatter')
        .send({ frontmatter: { applied: 'completed' } });
      expect(badValue.status).toBe(400);
      expect(badValue.body.error.code).toBe('VALIDATION');
    });

    // 0.2.14: `status` is an UNKNOWN field now — a pre-0.2.14 patch reads as
    // pending even when it says `completed`, and the key survives in the file.
    it('reads a legacy `status: completed` patch as pending, without dropping the key', async () => {
      await writeArtifact(
        'patch',
        'legacy.md',
        {
          type: 'patch',
          brief: 'v1-to-v2.md',
          patch_kind: 'drift',
          created_at: '2026-01-02T00:00:00.000Z',
          created_by: 'agent',
          status: 'completed',
        },
        '# Patch — legacy\n',
      );

      const pending = await request(app).get('/api/artifacts/patch?applied=false');
      expect(pending.body.data.map((d: { path: string }) => d.path)).toContain('legacy.md');

      const flipped = await request(app)
        .patch('/api/artifacts/patch/legacy.md/frontmatter')
        .send({ frontmatter: { applied: true } });
      expect(flipped.status).toBe(200);
      // gray-matter pass-through: the unknown key is not migrated away.
      expect(flipped.body.data.frontmatter.status).toBe('completed');
      expect(flipped.body.data.frontmatter.applied).toBe(true);
    });

    it('[0.2.86] PUT .../content cannot flip `applied` — only PATCH .../frontmatter may', async () => {
      const detail = await request(app).get('/api/artifacts/patch/v1-to-v2-drift.md');
      const flipped = matter.stringify(detail.body.data.body, { ...detail.body.data.frontmatter, applied: true });
      const refused = await request(app)
        .put('/api/artifacts/patch/v1-to-v2-drift.md/content')
        .send({ content: flipped, expectedHash: detail.body.data.hash });
      expect(refused.status).toBe(400);
      expect(refused.body.error.code).toBe('IMMUTABLE_FIELD');
      expect(refused.body.error.message).toContain('applied');

      // A body edit that preserves the flag goes through, and answers echo-free.
      const edited = matter.stringify('# Patch — drift (edited)\n', detail.body.data.frontmatter);
      const ok = await request(app)
        .put('/api/artifacts/patch/v1-to-v2-drift.md/content')
        .send({ content: edited, expectedHash: detail.body.data.hash });
      expect(ok.status).toBe(200);
      expect(ok.body.data.body).toBeUndefined();
      expect(ok.body.data.content).toBeUndefined();
      expect(ok.body.data.frontmatter.applied).toBe(false);
    });

    it('PATCH .../frontmatter 400s IMMUTABLE_FIELD on an immutable key', async () => {
      const res = await request(app)
        .patch('/api/artifacts/patch/v1-to-v2-drift.md/frontmatter')
        .send({ frontmatter: { patch_kind: 'missing' } });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('IMMUTABLE_FIELD');
    });
  });

  /**
   * 2.1.57 (M36 `m36l4fam`) — the frontmatter write MERGES the keys it was sent
   * into the file read under the same per-path lock it writes under: no
   * `expectedHash`, and neither a concurrent content save nor a second
   * frontmatter write loses a change — for every kind of the family (the patch
   * joined plan and brief here).
   */
  describe('the frontmatter write merges under the per-path lock (2.1.57)', () => {
    const PATCH_FILE = 'v1-to-v2-drift.md';
    const BRIEF_FILE = 'v1-to-v2.md';
    const PATCH_FM = {
      type: 'patch',
      brief: BRIEF_FILE,
      patch_kind: 'drift',
      created_at: '2026-01-02T00:00:00.000Z',
      created_by: 'implementer',
      applied: false,
    };
    const BRIEF_FM = {
      type: 'brief',
      from_release: 'v1',
      to_release: 'v2',
      generated_at: '2026-01-01T00:00:00.000Z',
      implemented: false,
    };
    let planPath: string;
    const read = (dir: string, rel: string) => fs.readFile(path.join(cwd, dir, rel), 'utf-8');
    const sha256 = (text: string) => crypto.createHash('sha256').update(text, 'utf-8').digest('hex');

    beforeEach(async () => {
      await writeArtifact('brief', BRIEF_FILE, BRIEF_FM, '# Brief: v1 -> v2\n');
      await writeArtifact('patch', PATCH_FILE, PATCH_FM, '# Patch — drift\n');
      planPath = (await plans.create({ title: 'Merge Plan', content: '## Step\n\noriginal\n', changedBy: 'agent' })).planPath;
    });

    it('[entity:patch-api-artifacts-kind-path-frontmatter] PATCH /api/artifacts/:kind/:path/frontmatter — the mutable keys of the kind (brief: implemented; plan: title, applied; patch: applied) answer 200 with the write payload, any other key 400 IMMUTABLE_FIELD naming it, an unknown path 404; the route takes no expectedHash; a plan frontmatter-only write adds no file_version', async () => {
      const cases = [
        { kind: 'brief', dir: briefsDir, file: BRIEF_FILE, ok: { implemented: true }, bad: 'from_release' },
        { kind: 'patch', dir: patchesDir, file: PATCH_FILE, ok: { applied: true }, bad: 'created_by' },
        { kind: 'plan', dir: plansDir, file: () => planPath, ok: { title: 'Renamed', applied: true }, bad: 'created_at' },
      ] as const;
      for (const c of cases) {
        const file = typeof c.file === 'function' ? c.file() : c.file;
        const url = `/api/artifacts/${c.kind}/${file}/frontmatter`;
        const before = matter(await read(c.dir, file));

        // A stale `expectedHash` beside the frontmatter is not a guard of this route.
        const ok = await request(app).patch(url).send({ frontmatter: c.ok, expectedHash: 'stale' });
        expect(ok.status, c.kind).toBe(200);
        const after = await read(c.dir, file);
        expect(ok.body.data, c.kind).toEqual({
          path: file,
          frontmatter: { ...before.data, ...c.ok },
          hash: sha256(after),
        });
        // Only the sent keys changed; the body is the file's.
        expect(matter(after).data, c.kind).toEqual({ ...before.data, ...c.ok });
        expect(matter(after).content.trim(), c.kind).toBe(before.content.trim());

        const refused = await request(app).patch(url).send({ frontmatter: { [c.bad]: 'x' } });
        expect(refused.status, c.kind).toBe(400);
        expect(refused.body.error.code, c.kind).toBe('IMMUTABLE_FIELD');
        expect(refused.body.error.message, c.kind).toContain(c.bad);

        const missing = await request(app).patch(`/api/artifacts/${c.kind}/no-such.md/frontmatter`).send({ frontmatter: c.ok });
        expect(missing.status, c.kind).toBe(404);
        expect(missing.body.error.code, c.kind).toMatch(/_NOT_FOUND$/);
      }
      // kind `plan`: frontmatter-only writes record no version (create only).
      expect(pageVersions.listVersions(planPath, systemRootId('plans'))).toHaveLength(1);
    });

    it('[entity:artifact-frontmatter-update-request] the body is `{ frontmatter }` — a partial map: only the keys it carries change, the rest of the frontmatter is the file\'s; no expectedHash field exists in it', async () => {
      const body: ArtifactFrontmatterUpdateRequest = { frontmatter: { title: 'Only the title' } };
      expectTypeOf<keyof ArtifactFrontmatterUpdateRequest>().toEqualTypeOf<'frontmatter'>();
      const url = `/api/artifacts/plan/${planPath}/frontmatter`;

      const titled = await request(app).patch(url).send(body);
      expect(titled.status).toBe(200);
      expect(titled.body.data.frontmatter).toMatchObject({ title: 'Only the title', applied: false });

      const flagged = await request(app).patch(url).send({ frontmatter: { applied: true } });
      expect(flagged.status).toBe(200);
      // The earlier title survives a write that did not carry it.
      expect(matter(await read(plansDir, planPath)).data).toMatchObject({ title: 'Only the title', applied: true, type: 'plan' });
    });

    it('[section:m36l4fam] a frontmatter write racing a content save loses neither — for patch, brief and plan alike; when the flag lands first, the content save is refused by its own guard instead of overwriting it', async () => {
      // Patch: the save is queued first, the flag reads the file the save left.
      const p = await patches.getPatch(PATCH_FILE, { full: true });
      await Promise.all([
        patches.updateContent({ path: PATCH_FILE, content: matter.stringify('# Patch — edited by the user\n', p.frontmatter), expectedHash: p.hash }),
        patches.updateFrontmatter({ path: PATCH_FILE, applied: true }),
      ]);
      let onDisk = matter(await read(patchesDir, PATCH_FILE));
      expect(onDisk.content).toContain('edited by the user');
      expect(onDisk.data).toEqual({ ...PATCH_FM, applied: true });

      // Brief: the same race.
      const b = await briefs.getBrief(BRIEF_FILE, { full: true });
      await Promise.all([
        briefs.updateContent({ path: BRIEF_FILE, content: matter.stringify('# Brief — edited by the user\n', b.frontmatter), expectedHash: b.hash, changedBy: 'user' }),
        briefs.updateFrontmatter({ path: BRIEF_FILE, patch: { implemented: true }, changedBy: 'user' }),
      ]);
      onDisk = matter(await read(briefsDir, BRIEF_FILE));
      expect(onDisk.content).toContain('edited by the user');
      expect(onDisk.data.implemented).toBe(true);

      // Plan: the same race.
      const pl = await plans.getByPath(planPath);
      await Promise.all([
        plans.updateContent({ path: planPath, content: pl.content.replace('original', 'edited by the user'), expectedHash: pl.hash, changedBy: 'user' }),
        plans.updateFrontmatter({ path: planPath, patch: { applied: true }, changedBy: 'user', threadId: null }),
      ]);
      onDisk = matter(await read(plansDir, planPath));
      expect(onDisk.content).toContain('edited by the user');
      expect(onDisk.data.applied).toBe(true);

      // The other order: the flag first, then a save armed with the hash from
      // before it — refused (409), and the flag stays written.
      const stale = await patches.getPatch(PATCH_FILE, { full: true });
      const results = await Promise.allSettled([
        patches.updateFrontmatter({ path: PATCH_FILE, applied: false }),
        patches.updateContent({ path: PATCH_FILE, content: matter.stringify('# Patch — late save\n', stale.frontmatter), expectedHash: stale.hash }),
      ]);
      expect(results[0].status).toBe('fulfilled');
      expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'PATCH_CONFLICT' } });
      onDisk = matter(await read(patchesDir, PATCH_FILE));
      expect(onDisk.data.applied).toBe(false);
      expect(onDisk.content).toContain('edited by the user');
    });

    it('[section:m36l4fam] two frontmatter writes in flight keep both keys', async () => {
      await Promise.all([
        plans.updateFrontmatter({ path: planPath, patch: { title: 'Both survive' }, changedBy: 'user', threadId: null }),
        plans.updateFrontmatter({ path: planPath, patch: { applied: true }, changedBy: 'user', threadId: null }),
      ]);
      expect(matter(await read(plansDir, planPath)).data).toMatchObject({ title: 'Both survive', applied: true });

      await Promise.all([
        request(app).patch(`/api/artifacts/patch/${PATCH_FILE}/frontmatter`).send({ frontmatter: { applied: true } }),
        request(app).patch(`/api/artifacts/patch/${PATCH_FILE}/frontmatter`).send({ frontmatter: { applied: true } }),
      ]);
      expect(matter(await read(patchesDir, PATCH_FILE)).data).toEqual({ ...PATCH_FM, applied: true });
    });

    it('[section:m23mcp01] [section:m23edg01] mark_patch_applied racing the user\'s content save: no expectedHash, no refusal, and the user\'s edit survives — the write merges only `applied` under the per-path lock', async () => {
      const p = await patches.getPatch(PATCH_FILE, { full: true });
      const [, marked] = await Promise.all([
        patches.updateContent({ path: PATCH_FILE, content: matter.stringify('# Patch — the user\'s concurrent edit\n', p.frontmatter), expectedHash: p.hash }),
        patches.markApplied({ path: PATCH_FILE, applied: true }),
      ]);
      expect(marked).toEqual({ path: PATCH_FILE, applied: true });
      const onDisk = matter(await read(patchesDir, PATCH_FILE));
      expect(onDisk.content).toContain("the user's concurrent edit");
      expect(onDisk.data).toEqual({ ...PATCH_FM, applied: true });
      // Both writes are on the patch's version axis: the save, then the flag.
      const rows = pageVersions.listVersions(PATCH_FILE, systemRootId('patches'));
      expect(rows.map((r) => [r.op, r.changedBy])).toEqual([
        ['update', 'agent'],
        ['update', 'user'],
        ['create', 'filesystem'],
      ]);
    });

    it('[ac:ac-patch-api-artifacts-plan-path-frontma] changing a plan frontmatter key other than title and applied is refused, and the refusal names that key', async () => {
      for (const key of ['type', 'created_at', 'created_by', 'roots'] as const) {
        const res = await request(app)
          .patch(`/api/artifacts/plan/${planPath}/frontmatter`)
          .send({ frontmatter: { [key]: 'x' } });
        expect(res.status, key).toBe(400);
        expect(res.body.error.code, key).toBe('IMMUTABLE_FIELD');
        expect(res.body.error.message, key).toContain(key);
      }
      // title and applied are the two that pass.
      const ok = await request(app)
        .patch(`/api/artifacts/plan/${planPath}/frontmatter`)
        .send({ frontmatter: { title: 'Fine', applied: true } });
      expect(ok.status).toBe(200);
    });
  });

  /**
   * 2.1.48 (M36 `r2nekhf5`) — the detail route's two projections, for all three
   * kinds at once (the route is shared). Every artifact here is LONGER than the
   * response budget, so "the whole file" is proven by its last line.
   */
  describe('the detail route\'s two projections (2.1.48)', () => {
    const LAST = 'LAST LINE OF THE FILE';
    const bigBody =
      Array.from({ length: Math.ceil(DEFAULT_BUDGET_CHARS / 30) }, (_, i) => `${i} ${'x'.repeat(60)}`).join('\n') +
      `\n${LAST}\n`;
    const sha256 = (text: string) => crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
    const KINDS = [
      { kind: 'brief', file: path.join(briefsDir, 'big.md'), url: '/api/artifacts/brief/big.md' },
      { kind: 'patch', file: path.join(patchesDir, 'big.md'), url: '/api/artifacts/patch/big.md' },
      { kind: 'plan', file: path.join(plansDir, 'big-plan.md'), url: '/api/artifacts/plan/big-plan.md' },
    ] as const;
    const onDisk = (file: string) => fs.readFile(path.join(cwd, file), 'utf-8');

    beforeEach(async () => {
      await writeArtifact(
        'brief',
        'big.md',
        { type: 'brief', from_release: null, to_release: null, generated_at: '2026-01-01T00:00:00.000Z', implemented: false },
        bigBody,
      );
      await writeArtifact('patch', 'big.md', { type: 'patch', patch_kind: 'drift', brief: 'big.md', applied: false }, bigBody);
      const made = await plans.create({ title: 'Big Plan', content: bigBody, changedBy: 'agent' });
      expect(made.planPath).toBe('big-plan.md');
    });

    it('[entity:get-api-artifacts-kind-path] GET /api/artifacts/:kind/:path — default projection: the whole ArtifactResponse with no budget, window or truncated; view=operation: the get_<kind> payload with the line window and the budget; an unknown view or a range without view=operation is 400 INVALID_ARGUMENT', async () => {
      for (const { kind, file, url } of KINDS) {
        const bytes = await onDisk(file);
        expect(bytes.length, kind).toBeGreaterThan(DEFAULT_BUDGET_CHARS);

        // Default projection: { data: ArtifactResponse } — path, frontmatter, body, content, hash.
        const editor = await request(app).get(url);
        expect(editor.status, kind).toBe(200);
        expect(Object.keys(editor.body.data).sort(), kind).toEqual(['body', 'content', 'frontmatter', 'hash', 'path']);
        expect(typeof editor.body.data.path, kind).toBe('string');
        expect(typeof editor.body.data.frontmatter, kind).toBe('object');
        expect(editor.body.data.content, kind).toBe(bytes);
        expect(editor.body.data.body, kind).toContain(LAST);
        expect(editor.body.data.hash, kind).toBe(sha256(bytes));

        // Operation projection: the same fields, cut at the budget and flagged.
        const op = await request(app).get(`${url}?view=operation`);
        expect(op.status, kind).toBe(200);
        expect(Object.keys(op.body.data).sort(), kind).toEqual(
          ['body', 'content', 'frontmatter', 'hash', 'path', 'truncated', 'truncationHint'],
        );
        expect(op.body.data.truncated, kind).toBe(true);
        expect(op.body.data.hash, kind).toBe(sha256(bytes));
        const windowed = await request(app).get(`${url}?view=operation&range=2-4`);
        expect(windowed.status, kind).toBe(200);
        expect(windowed.body.data.content, kind).toBe(bytes.split('\n').slice(1, 4).join('\n'));

        // The refusals.
        for (const bad of [`${url}?view=raw`, `${url}?range=1-4`]) {
          const res = await request(app).get(bad);
          expect(res.status, `${kind} ${bad}`).toBe(400);
          expect(res.body.error.code, `${kind} ${bad}`).toBe('INVALID_ARGUMENT');
        }
      }
    });

    it('[ac:ac-get-api-artifacts-kind-path-bez-view] without view an artifact longer than the response budget comes back whole, its last line included', async () => {
      for (const { kind, file, url } of KINDS) {
        const bytes = await onDisk(file);
        const res = await request(app).get(url);
        expect(res.status, kind).toBe(200);
        expect(res.body.data.content.length, kind).toBeGreaterThan(DEFAULT_BUDGET_CHARS);
        expect(res.body.data.content.trimEnd().split('\n').at(-1), kind).toBe(LAST);
        expect(res.body.data.content, kind).toBe(bytes);
        expect(res.body.data.truncated, kind).toBeUndefined();
        expect(res.body.data.truncationHint, kind).toBeUndefined();
      }
    });

    it('[ac:ac-get-api-artifacts-kind-path-view-oper] view=operation for an artifact longer than the response budget answers truncated: true', async () => {
      for (const { kind, file, url } of KINDS) {
        const bytes = await onDisk(file);
        const res = await request(app).get(`${url}?view=operation`);
        expect(res.status, kind).toBe(200);
        expect(res.body.data.truncated, kind).toBe(true);
        expect(res.body.data.content.length, kind).toBeLessThan(bytes.length);
        expect(res.body.data.content, kind).not.toContain(LAST);
      }
    });

    it('[ac:ac-get-api-artifacts-kind-path-z-range-a] range without view=operation is a 400 whose message points at view=operation', async () => {
      for (const { kind, url } of KINDS) {
        for (const range of ['1-10', '1:10', '']) {
          const res = await request(app).get(`${url}?range=${range}`);
          expect(res.status, `${kind} range=${range}`).toBe(400);
          expect(res.body.error.code, `${kind} range=${range}`).toBe('INVALID_ARGUMENT');
          expect(res.body.error.message, `${kind} range=${range}`).toContain('view=operation');
        }
      }
    });

    it('[ac:ac-get-api-artifacts-kind-path-z-wartosc] a view other than operation is a 400, never a silent default projection', async () => {
      for (const { kind, url } of KINDS) {
        for (const view of ['editor', 'OPERATION', '', 'operation&view=operation']) {
          const res = await request(app).get(`${url}?view=${view}`);
          expect(res.status, `${kind} view=${view}`).toBe(400);
          expect(res.body.error.code, `${kind} view=${view}`).toBe('INVALID_ARGUMENT');
          expect(res.body.error.message, `${kind} view=${view}`).toContain('view=operation');
          expect(res.body.data, `${kind} view=${view}`).toBeUndefined();
        }
      }
    });

    it('[ac:ac-hash-z-view-operation-z-oknem-range-j] the hash of view=operation with a range window equals the default projection\'s hash of the same file', async () => {
      for (const { kind, url } of KINDS) {
        const whole = await request(app).get(url);
        const windowed = await request(app).get(`${url}?view=operation&range=3-7`);
        expect(windowed.status, kind).toBe(200);
        expect(windowed.body.data.content.split('\n'), kind).toHaveLength(5);
        expect(windowed.body.data.hash, kind).toBe(whole.body.data.hash);
        // The cut read (no window) carries the same whole-file hash too.
        const cut = await request(app).get(`${url}?view=operation`);
        expect(cut.body.data.hash, kind).toBe(whole.body.data.hash);
      }
    });

    it('[ac:ac-truncationhint-z-view-operation-wskaz] the truncationHint of view=operation proposes a retry with range under the same view=operation, and that retry is served', async () => {
      for (const { kind, file, url } of KINDS) {
        const lines = (await onDisk(file)).split('\n');
        const cut = await request(app).get(`${url}?view=operation`);
        expect(cut.body.data.truncated, kind).toBe(true);
        const hint: string = cut.body.data.truncationHint;
        expect(hint, kind).toContain('?view=operation&range=');
        // Not the tool channel's spelling — that call does not exist on this route.
        expect(hint, kind).not.toContain('range: {');
        const m = /\?view=operation&range=(\d+)-(\d+)/.exec(hint);
        expect(m, kind).not.toBeNull();
        const retry = await request(app).get(`${url}?view=operation&range=${m![1]}-${m![2]}`);
        expect(retry.status, kind).toBe(200);
        expect(retry.body.data.content.split('\n')[0], kind).toBe(lines[Number(m![1]) - 1]);
      }
    });

    /*
     * 2.1.48 (M10 `plan-page`) — the plan editor's Save over the whole file it
     * read from the default projection. The client side (the screen, the
     * banner) is in `src/client/components/PlanPage.render.test.ts`.
     */
    it('[ac:ac-po-save-planu-dluzszego-niz-budzet-od] a Save of the whole plan (longer than the response budget) leaves the file ending with its last line', async () => {
      const url = '/api/artifacts/plan/big-plan.md';
      const read = await request(app).get(url);
      expect(read.body.data.content.length).toBeGreaterThan(DEFAULT_BUDGET_CHARS);
      // What the editor sends: the frontmatter block it read + the edited body.
      const edited = read.body.data.content.replace('0 xxx', '0 EDITED xxx');
      const res = await request(app).put(`${url}/content`).send({ content: edited, expectedHash: read.body.data.hash });
      expect(res.status).toBe(200);
      const bytes = await onDisk(path.join(plansDir, 'big-plan.md'));
      expect(bytes).toBe(edited);
      expect(bytes).toContain('0 EDITED xxx');
      expect(bytes.trimEnd().split('\n').at(-1)).toBe(LAST);
      expect(res.body.data.hash).toBe(sha256(bytes));
    });

    it('[ac:ac-save-planu-zmienionego-w-miedzyczasie] a Save of a plan changed on disk meanwhile is refused 409 PLAN_CONFLICT and the file on disk stays byte-identical', async () => {
      const url = '/api/artifacts/plan/big-plan.md';
      const file = path.join(cwd, plansDir, 'big-plan.md');
      const read = await request(app).get(url);
      // Somebody else (vim, another tab) writes the plan after the editor read it.
      const foreign = read.body.data.content.replace(LAST, `${LAST} — changed on disk`);
      await fs.writeFile(file, foreign, 'utf-8');
      const versionsBefore = (await request(app).get(`${url}/versions`)).body.data.length;

      const res = await request(app)
        .put(`${url}/content`)
        .send({ content: read.body.data.content.replace('0 xxx', '0 MINE xxx'), expectedHash: read.body.data.hash });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PLAN_CONFLICT');
      expect(res.body.currentHash).toBe(sha256(foreign));
      expect(res.body.currentContent).toBe(foreign);
      // Nothing was overwritten: same bytes, no new file_version row.
      expect(await fs.readFile(file, 'utf-8')).toBe(foreign);
      expect((await request(app).get(`${url}/versions`)).body.data.length).toBe(versionsBefore);
    });
  });
});
