import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { PagesService } from '../services/pages.js';
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
import { BRIEF_ROOT_MARKER, PATCH_ROOT_MARKER, PLAN_ROOT_MARKER } from '../../shared/types.js';
import type { ReleaseService } from '../services/release.js';
import type { WsEmitter } from '../ws/project-emitter.js';

const fakeWs = { broadcast: () => {} } as unknown as WsEmitter;
const fakeReleaseService = {} as unknown as ReleaseService;

describe('artifactsRouter — /api/artifacts/:kind/*', () => {
  let cwd: string;
  let db: Database.Database;
  let app: express.Express;
  let briefsSerializer: FileSerializer;
  let patchesSerializer: FileSerializer;
  let pageVersions: FileVersionService;
  let frontmatterIndexer: PagesFrontmatterIndexer;

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
    const rootId = kind === 'brief' ? BRIEF_ROOT_MARKER : PATCH_ROOT_MARKER;
    const serializer = kind === 'brief' ? briefsSerializer : patchesSerializer;
    const abs = path.join(cwd, dir, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, matter.stringify(body, frontmatter), 'utf-8');
    await frontmatterIndexer.indexPage(rootId, relPath);
    await pageVersions.recordVersion(relPath, 'create', 'filesystem', undefined, serializer, rootId);
  }

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'c4s-artifacts-test-'));
    db = new Database(':memory:');
    runMigrations(db);

    const briefsPages = new PagesService(cwd, briefsDir, BRIEF_ROOT_MARKER);
    await briefsPages.ensureRoot();
    const patchesPages = new PagesService(cwd, patchesDir, PATCH_ROOT_MARKER);
    await patchesPages.ensureRoot();
    const plansPages = new PagesService(cwd, plansDir, PLAN_ROOT_MARKER);
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
      [BRIEF_ROOT_MARKER, briefsPages],
      [PATCH_ROOT_MARKER, patchesPages],
      [PLAN_ROOT_MARKER, plansPages],
    ]);
    frontmatterIndexer = new PagesFrontmatterIndexer(frontmatterRoots, fakeWs);
    const chatService = new ChatService(db);

    const briefService = new BriefService({
      cwd,
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

    app = express()
      .use(express.json())
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

  describe('brief', () => {
    beforeEach(async () => {
      await writeArtifact(
        'brief',
        'v1-to-v2.md',
        {
          type: 'brief',
          source: 'release-diff',
          from_release: 'v1',
          to_release: 'v2',
          generated_at: '2026-01-01T00:00:00.000Z',
          generator_version: 'test',
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
            source: 'analysis',
            from_release: null,
            to_release: null,
            generated_at: '2026-01-01T00:00:00.000Z',
            generator_version: 'test',
            implemented: false,
          },
          Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n',
        );
      });

      it('[ac:ac-get-brief-ma-okno-odczytu-range-i-jaw] ?range narrows the content, and nothing gates it', async () => {
        const whole = await request(app).get('/api/artifacts/brief/long.md');
        const windowed = await request(app).get('/api/artifacts/brief/long.md?range=1:4');

        expect(windowed.status).toBe(200);
        expect(windowed.body.data.content.split('\n')).toHaveLength(4);
        expect(windowed.body.data.content.length).toBeLessThan(whole.body.data.content.length);
      });

      it('the hash stays the WHOLE file’s, so a windowed read still arms expectedHash', async () => {
        const whole = await request(app).get('/api/artifacts/brief/long.md');
        const windowed = await request(app).get('/api/artifacts/brief/long.md?range=5:6');
        // A hash of the window would fail every write made with it, and the
        // value itself would not say which of the two it is.
        expect(windowed.body.data.hash).toBe(whole.body.data.hash);
      });

      it('[ac:ac-rodzina-odczytu-artefaktu-wspolna-tak] a range past the end of the file refuses, stating the size', async () => {
        const res = await request(app).get('/api/artifacts/brief/long.md?range=900:999');
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toContain('lines');
      });

      it('[ac:ac-rodzina-odczytu-artefaktu-wspolna-tak] a window opening on a `---` line is served, not re-parsed as frontmatter', async () => {
        await writeArtifact(
          'brief',
          'sep.md',
          {
            type: 'brief',
            source: 'analysis',
            from_release: null,
            to_release: null,
            generated_at: '2026-01-01T00:00:00.000Z',
            generator_version: 'test',
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

        const res = await request(app).get(`/api/artifacts/brief/sep.md?range=${breakLine}:${breakLine + 3}`);
        expect(res.status).toBe(200);
        expect(res.body.data.content.split('\n')[0]).toBe('---');
        // The body is the window itself — no line silently eaten as frontmatter.
        expect(res.body.data.body).toContain('a: b: c');
      });

      it('a malformed ?range is refused rather than ignored', async () => {
        // Ignoring it would answer with the whole file to a caller who asked
        // for a window precisely because the whole file is too much.
        const res = await request(app).get('/api/artifacts/brief/long.md?range=nonsense');
        expect(res.status).toBe(400);
      });

      it('omitting ?range returns the whole artifact, as it always did', async () => {
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
      expect(all.body.data[0]).toMatchObject({ path: 'v1-to-v2.md', frontmatter: { source: 'release-diff' } });
      expect(typeof all.body.data[0].hash).toBe('string');
      expect(all.body.data[0].hash.length).toBeGreaterThan(0);

      const implementedOnly = await request(app).get('/api/artifacts/brief?implemented=true');
      expect(implementedOnly.body.data).toHaveLength(0);

      const pendingOnly = await request(app).get('/api/artifacts/brief?implemented=false');
      expect(pendingOnly.body.data).toHaveLength(1);
    });

    it('lists newest release first, analysis briefs ahead of them — not path-alphabetical', async () => {
      /**
       * The order is part of the operation, and it has exactly one consumer for
       * whom it is load-bearing in a way nobody sees: `c4s list-briefs` prints
       * whatever it is handed and pages `--limit`/`--offset` over it, and the
       * first row is what the brief-implementer skill reads to decide what to
       * build. The indexer answers path-alphabetically, which for
       * `<from>-to-<to>.md` names is ASCENDING release order — so "the first
       * brief" was the oldest one in the repo.
       *
       * `0-2-9` versus `0-2-13` is the case a plain string compare gets wrong,
       * so it is in the fixture on purpose.
       */
      const fm = (to: string | null, source = 'release-diff') => ({
        type: 'brief',
        source,
        from_release: 'x',
        to_release: to,
        generated_at: '2026-01-01T00:00:00.000Z',
        generator_version: 'test',
        implemented: false,
      });
      await writeArtifact('brief', '0-1-90-to-0-1-91.md', fm('0.1.91'), '# old\n');
      await writeArtifact('brief', '0-2-9-to-0-2-10.md', fm('0.2.10'), '# mid\n');
      await writeArtifact('brief', '0-2-12-to-0-2-13.md', fm('0.2.13'), '# new\n');
      await writeArtifact('brief', 'aaa-analysis.md', fm(null, 'analysis'), '# analysis\n');

      const res = await request(app).get('/api/artifacts/brief');
      expect(res.body.data.map((r: { path: string }) => r.path)).toEqual([
        // No target release — describes the state as of HEAD, so it leads.
        'aaa-analysis.md',
        // A release NAME is an opaque string, not semver: `v2` sorts above every
        // numeric one because letters follow digits. That is the honest answer
        // for a vocabulary the sort cannot interpret, and it is why this is a
        // descending sort over names rather than a version comparison.
        'v1-to-v2.md',
        '0-2-12-to-0-2-13.md',
        // The case a plain string compare gets wrong: `0.2.9` must sort BELOW
        // `0.2.13`, which only a numeric-aware compare gets right.
        '0-2-9-to-0-2-10.md',
        '0-1-90-to-0-1-91.md',
      ]);
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

    it('PUT .../content updates on a hash match and returns the fresh ArtifactResponse', async () => {
      const detail = await request(app).get('/api/artifacts/brief/v1-to-v2.md');
      const newContent = matter.stringify('# Brief: v1 -> v2 (edited)\n', detail.body.data.frontmatter);

      const res = await request(app)
        .put('/api/artifacts/brief/v1-to-v2.md/content')
        .send({ content: newContent, expectedHash: detail.body.data.hash });

      expect(res.status).toBe(200);
      expect(res.body.data.body).toContain('edited');
      expect(res.body.data.hash).not.toBe(detail.body.data.hash);
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

    it('PATCH .../frontmatter accepts the mutable `implemented` key', async () => {
      const res = await request(app)
        .patch('/api/artifacts/brief/v1-to-v2.md/frontmatter')
        .send({ frontmatter: { implemented: true } });

      expect(res.status).toBe(200);
      expect(res.body.data.frontmatter.implemented).toBe(true);
    });

    it('PATCH .../frontmatter 400s IMMUTABLE_FIELD on an immutable key', async () => {
      const res = await request(app)
        .patch('/api/artifacts/brief/v1-to-v2.md/frontmatter')
        .send({ frontmatter: { source: 'analysis' } });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('IMMUTABLE_FIELD');
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

    it('PATCH .../frontmatter 400s IMMUTABLE_FIELD on an immutable key', async () => {
      const res = await request(app)
        .patch('/api/artifacts/patch/v1-to-v2-drift.md/frontmatter')
        .send({ frontmatter: { patch_kind: 'missing' } });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('IMMUTABLE_FIELD');
    });
  });
});
