/**
 * The brief/patch family, after item 23 moved it off the filesystem.
 *
 * These three were the last commands that read and wrote the specification
 * directly: `list-briefs` walked `briefsDir` parsing frontmatter, `get-brief`
 * read a file, and `create-patch` had a dedicated write path into `patchesDir`
 * that nothing else used. Their whole contract with a caller is the SHAPE they
 * print and the code they exit with, so that is what is asserted — against a
 * real HTTP server, so the URL is asserted too.
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseArgs } from '../args.js';
import { CliError } from '../errors.js';
import { WorkspaceRegistry } from '../../../server/workspace/registry.js';
import { __resetDelegateTargets } from '../delegate.js';
import { runListBriefs } from './list-briefs.js';
import { runGetBrief } from './get-brief.js';
import { runCreatePatch } from './create-patch.js';
import { runCreateBrief } from './create-brief.js';
import { runCreatePlan } from './create-plan.js';
import { createTestApp, type TestApp } from '../../../../tests/helpers/test-app.js';
import { DEFAULT_BUDGET_CHARS } from '../../../server/discovery/budget.js';

const CONFIG = {
  name: 'test-project',
  roots: [],
  entitiesDir: 'entities',
  writingStyle: null,
  onboarding: {},
};

describe('[ac:ac-rodzina-brief-patch-list-briefs-read] the brief/patch family delegates', () => {
  let registryDir: string;
  let projectDir: string;
  let projectId: string;
  let prevHome: string | undefined;
  let stdout: string;
  let server: http.Server;
  let seen: Array<{ method: string; url: string; body: string }>;
  let status: number;
  let reply: unknown;
  /**
   * 2.1.48 — when set, every request but the health check is answered by a real
   * backend (the artifact detail route over a real brief file) instead of the
   * canned `reply`, with `/api/projects/<id>` mapped onto its `/api`.
   */
  let forward: TestApp['app'] | null;

  beforeEach(async () => {
    forward = null;
    registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-bp-registry-'));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-bp-project-'));
    prevHome = process.env.C4S_HOME;
    process.env.C4S_HOME = registryDir;

    seen = [];
    status = 200;
    reply = {};
    server = http.createServer((req, res) => {
      const url = req.url ?? '';
      res.setHeader('content-type', 'application/json');
      if (url.endsWith('/config')) return res.end(JSON.stringify(CONFIG));
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        seen.push({ method: req.method ?? 'GET', url, body });
        if (forward) {
          req.url = url.replace(/^\/api\/projects\/[^/]+/, '/api');
          forward(req, res);
          return;
        }
        res.statusCode = status;
        res.end(JSON.stringify(reply));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const registry = new WorkspaceRegistry(registryDir);
    const ws = registry.selectOrCreate({ name: 'default', port });
    projectId = registry.registerProject(ws, projectDir).id;
    __resetDelegateTargets();

    stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout += String(chunk);
      return true;
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    __resetDelegateTargets();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(registryDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  const args = (...argv: string[]) =>
    parseArgs([...argv, '--project', projectId, '--workspace', 'default']);
  const printed = () => JSON.parse(stdout) as Record<string, unknown>;

  describe('list-briefs', () => {
    const rows = [
      { path: 'a.md', frontmatter: { type: 'brief', to_release: '0.2.13', implemented: false } },
      { path: 'b.md', frontmatter: { type: 'brief', to_release: '0.2.12', implemented: true } },
      { path: 'c.md', frontmatter: { type: 'brief', to_release: '0.2.11', implemented: false } },
    ];

    it('keeps its `{ items, total }` envelope and its per-row `implemented` flag', async () => {
      reply = { data: rows };
      await runListBriefs(args('list-briefs'));
      expect(seen[0]!.url).toMatch(/\/artifacts\/brief$/);
      expect(printed().total).toBe(3);
      // The skill reads exactly this: the path and whether it is done.
      expect((printed().items as Array<{ path: string; implemented: boolean }>).map((i) => [i.path, i.implemented])).toEqual([
        ['a.md', false],
        ['b.md', true],
        ['c.md', false],
      ]);
    });

    it('--status becomes ?implemented=, which the server filters on', async () => {
      reply = { data: [rows[1]] };
      await runListBriefs(args('list-briefs', '--status', 'implemented'));
      expect(seen[0]!.url).toContain('implemented=true');

      seen = [];
      await runListBriefs(args('list-briefs', '--status', 'pending'));
      expect(seen[0]!.url).toContain('implemented=false');
    });

    it('the window is applied here, and `total` still counts the whole answer', async () => {
      reply = { data: rows };
      await runListBriefs(args('list-briefs', '--limit', '1', '--offset', '1'));
      expect((printed().items as unknown[])).toHaveLength(1);
      expect((printed().items as Array<{ path: string }>)[0]!.path).toBe('b.md');
      // A `total` that reported the window would make paging unreadable.
      expect(printed().total).toBe(3);
    });

    it('[ac:ac-c4s-list-briefs-kolejnosc-jak-ui] prints the server\'s order untouched — it is the release axis, not `to_release desc`', async () => {
      // An order no name-based sort would produce: the open window first, a
      // `v0.10` above a `v0.9`, an unknown release in the tail.
      const axis = [
        { path: 'open.md', frontmatter: { type: 'brief', from_release: 'v0.10', to_release: null } },
        { path: 'ten.md', frontmatter: { type: 'brief', to_release: 'v0.10' } },
        { path: 'nine.md', frontmatter: { type: 'brief', to_release: 'v0.9' } },
        { path: 'tail.md', frontmatter: { type: 'brief', to_release: 'zzz' } },
      ];
      reply = { data: axis };
      await runListBriefs(args('list-briefs'));
      expect((printed().items as Array<{ path: string }>).map((i) => i.path)).toEqual(axis.map((r) => r.path));
    });

    it('[ac:ac-c4s-list-briefs-kolejnosc-przed-limit] [ac:ac-c4s-list-briefs-limit-n-offset-m] pages concatenate into the full order', async () => {
      reply = { data: rows };
      const page = async (offset: number) => {
        stdout = '';
        await runListBriefs(args('list-briefs', '--limit', '2', '--offset', String(offset)));
        expect(printed().total).toBe(3);
        return (printed().items as Array<{ path: string }>).map((i) => i.path);
      };
      expect([...(await page(0)), ...(await page(2))]).toEqual(rows.map((r) => r.path));
    });

    it('refuses a nonsense window before addressing the server', async () => {
      await expect(runListBriefs(args('list-briefs', '--limit', '0'))).rejects.toMatchObject({
        code: 'INVALID_ARGS',
      });
      await expect(runListBriefs(args('list-briefs', '--status', 'maybe'))).rejects.toMatchObject({
        code: 'INVALID_ARGS',
      });
      expect(seen).toEqual([]);
    });
  });

  describe('get-brief', () => {
    it('[ac:ac-c4s-read-brief-brief-path-zwraca] prints frontmatter, body and content — the three fields it always answered with', async () => {
      reply = { data: { path: 'x.md', frontmatter: { type: 'brief' }, body: 'B', content: 'C', hash: 'h' } };
      await runGetBrief(args('get-brief', 'sub/x.md'));
      expect(seen[0]!.url).toMatch(/\/artifacts\/brief\/sub\/x\.md\?view=operation$/);
      // `hash` and `path` are dropped: a caller piping this into `jq '.body'`
      // must not have to change, and neither field was ever in the answer.
      expect(printed()).toEqual({ frontmatter: { type: 'brief' }, body: 'B', content: 'C' });
    });

    it('[ac:ac-c4s-read-brief-brief-path-c4s-fil] turns the route\'s generic NOT_FOUND into BRIEF_NOT_FOUND', async () => {
      // The command's entire domain is one brief path, so a generic code would
      // lose which of the two things was missing — and exit 12 is what a script
      // branches on.
      status = 404;
      reply = { error: { code: 'NOT_FOUND', message: 'no such artifact' } };
      await expect(runGetBrief(args('get-brief', 'nope.md'))).rejects.toMatchObject({
        code: 'BRIEF_NOT_FOUND',
      });
    });

    it('requires the path', async () => {
      await expect(runGetBrief(args('get-brief'))).rejects.toMatchObject({ code: 'INVALID_ARGS' });
      expect(seen).toEqual([]);
    });

    it('[ac:ac-brief-path-escapujacy-briefsdir-sciez] refuses a traversal instead of addressing another endpoint with it', async () => {
      /**
       * The failure this pins is not a 404. `..` survives `encodeURIComponent`
       * and `fetch` collapses it, so `get-brief ../../config` was SENT as
       * `GET /api/projects/<id>/config` — an endpoint that answers 200 with the
       * project config. The command then printed `{}` (none of frontmatter/
       * body/content exist on that payload) and exited 0, where the filesystem
       * reader had refused outright. So the assertion that matters is that
       * NOTHING was requested.
       */
      const err = await runGetBrief(args('get-brief', '../../config')).catch((e: unknown) => e);
      expect(seen).toEqual([]);
      expect((err as { code?: string }).code).toBe('INVALID_ARGS');
      /**
       * The CLASS is asserted, not just the code, because the class is what
       * decides the exit status. `encodeArtifactPath` throws an `AgentError`,
       * and `src/bin/c4s.ts` only routes a `CliError` through `codeToExit` —
       * everything else lands in the generic branch and is reported as
       * `UNKNOWN_COMMAND`, exit 1. So the first version of this fix refused the
       * traversal correctly and exited 1 anyway, and a test that matched only on
       * `code` passed the whole time.
       */
      expect(err).toBeInstanceOf(CliError);
    });

    it('[entity:cli-command/get-brief] reads the operation projection (view=operation), sends --range as written, cuts nothing and passes truncated + a runnable --range hint through', async () => {
      // The bin validates no window: a value the server will refuse still
      // reaches the server, untouched.
      reply = { data: { path: 'sub/x.md', frontmatter: { type: 'brief' }, body: 'B', content: 'C', hash: 'h' } };
      await runGetBrief(args('get-brief', 'sub/x.md', '--range', 'abc'));
      expect(seen).toHaveLength(1);
      expect(seen[0]!.method).toBe('GET');
      expect(seen[0]!.url).toMatch(/\/artifacts\/brief\/sub\/x\.md\?view=operation&range=abc$/);

      // The bin computes no budget: a content longer than it is printed whole
      // when the server did not cut it.
      const long = `${'y'.repeat(DEFAULT_BUDGET_CHARS + 500)}\nEND`;
      reply = { data: { path: 'sub/x.md', frontmatter: { type: 'brief' }, body: long, content: long, hash: 'h' } };
      stdout = '';
      await runGetBrief(args('get-brief', 'sub/x.md'));
      expect(printed()).toEqual({ frontmatter: { type: 'brief' }, body: long, content: long });

      // A cut answer: `truncated` passes through, and the route's query spelling
      // becomes a `c4s get-brief` call — the only call this channel can make.
      reply = {
        data: {
          path: 'sub/x.md',
          frontmatter: { type: 'brief' },
          body: 'B',
          content: 'C',
          hash: 'h',
          truncated: true,
          truncationHint: "brief 'sub/x.md' was truncated by the response budget — read it in windows with ?view=operation&range=1-400 and advance (the file has 900 lines).",
        },
      };
      stdout = '';
      await runGetBrief(args('get-brief', 'sub/x.md'));
      expect(printed().truncated).toBe(true);
      expect(printed().truncationHint).toBe(
        "brief 'sub/x.md' was truncated by the response budget — read it in windows with c4s get-brief sub/x.md --range 1-400 and advance (the file has 900 lines).",
      );
      expect(printed().content).toBe('C');
    });
  });

  /**
   * 2.1.48 — `c4s get-brief` against the REAL detail route: the budget and the
   * window are the server's (the bin has neither), so the criteria are proven
   * end to end over a real brief file.
   */
  describe('get-brief over the real artifact detail route (2.1.48)', () => {
    let testApp: TestApp;
    const LAST = 'LAST LINE OF THE BRIEF';
    const frontmatter = '---\ntype: brief\nfrom_release: null\nto_release: null\ngenerated_at: 2026-01-01T00:00:00.000Z\nimplemented: false\n---\n';
    const writeBrief = (rel: string, text: string) => fs.writeFileSync(path.join(testApp.cwd, 'briefs', rel), text, 'utf8');

    beforeEach(async () => {
      testApp = await createTestApp();
      forward = testApp.app;
    });
    afterEach(() => {
      testApp.cleanup();
    });

    it('[ac:ac-c4s-get-brief-dla-briefu-dluzszego-ni] a brief longer than the response budget comes back with truncated: true, and its hint runs as a get-brief call with --range', async () => {
      // Short lines, so the hint's 400-line window fits the budget and the
      // retry below is served whole.
      const lines = Array.from({ length: Math.ceil(DEFAULT_BUDGET_CHARS / 30) }, (_, i) => `${i} ${'x'.repeat(30)}`);
      const file = `${frontmatter}${lines.join('\n')}\n${LAST}\n`;
      expect(file.length).toBeGreaterThan(DEFAULT_BUDGET_CHARS);
      writeBrief('big.md', file);

      await runGetBrief(args('get-brief', 'big.md'));
      const cut = printed();
      expect(cut.truncated).toBe(true);
      expect(cut.content as string).not.toContain(LAST);
      expect((cut.content as string).length).toBeLessThan(file.length);
      const hint = cut.truncationHint as string;
      expect(hint).not.toContain('?view=operation');
      const m = /c4s get-brief big\.md --range (\d+)-(\d+)/.exec(hint);
      expect(m).not.toBeNull();

      // The hint is a call this channel can make: run it, and it is served.
      stdout = '';
      await runGetBrief(args('get-brief', 'big.md', '--range', `${m![1]}-${m![2]}`));
      const retry = printed();
      expect(retry.truncated).toBeUndefined();
      expect(retry.content as string).toBe(
        file.split('\n').slice(Number(m![1]) - 1, Number(m![2])).join('\n'),
      );
      expect(seen.at(-1)!.url).toMatch(/\/artifacts\/brief\/big\.md\?view=operation&range=\d+-\d+$/);
    });

    it('[ac:ac-c4s-get-brief-range-1-10-zwraca-wylac] --range 1-10 returns lines 1 to 10 of the brief and nothing else', async () => {
      const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1} of the body`);
      const file = `${frontmatter}${lines.join('\n')}\n`;
      writeBrief('r.md', file);

      await runGetBrief(args('get-brief', 'r.md', '--range', '1-10'));
      const out = printed();
      const content = out.content as string;
      expect(content.split('\n')).toEqual(file.split('\n').slice(0, 10));
      expect(content).not.toContain(file.split('\n')[10]!);
      expect(out.truncated).toBeUndefined();
    });
  });

  describe('create-brief', () => {
    const bodyPath = () => path.join(projectDir, 'drift.md');
    const writeBody = (text: string) => {
      fs.writeFileSync(bodyPath(), text, 'utf8');
      return bodyPath();
    };

    it('posts the file`s bytes as `content` and prints briefPath + hash', async () => {
      reply = { data: { path: '0.2.93-to-next.md', hash: 'abc123' } };
      const body = '# Drift on X\n\nThe spec says Y, the code does Z.\n';
      await runCreateBrief(args('create-brief', '--body-file', writeBody(body)));

      expect(seen).toHaveLength(1);
      expect(seen[0]!.method).toBe('POST');
      expect(seen[0]!.url).toMatch(/\/briefs$/);
      expect(JSON.parse(seen[0]!.body)).toEqual({ content: body });
      expect(printed()).toEqual({ briefPath: '0.2.93-to-next.md', hash: 'abc123' });
    });

    it('omits `fromReleaseName` entirely without --from, and sends it with', async () => {
      reply = { data: { path: 'b.md', hash: 'h' } };
      await runCreateBrief(args('create-brief', '--body-file', writeBody('x')));
      expect(Object.keys(JSON.parse(seen[0]!.body))).toEqual(['content']);

      await runCreateBrief(
        args('create-brief', '--body-file', writeBody('x'), '--from', '0.2.90', '--suffix', 'drift'),
      );
      expect(JSON.parse(seen[1]!.body)).toMatchObject({ fromReleaseName: '0.2.90', suffix: 'drift' });
    });

    it('refuses --to and --roots as INVALID_ARGUMENT, naming the legal flags, before any request', async () => {
      const file = writeBody('x');
      for (const argv of [
        ['create-brief', '--body-file', file, '--to', '0.2.94'],
        ['create-brief', '--body-file', file, '--roots', 'spec'],
      ]) {
        await expect(runCreateBrief(args(...argv))).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      }
      await expect(
        runCreateBrief(args('create-brief', '--body-file', file, '--to', '0.2.94')),
      ).rejects.toThrow(/--body-file/);
      expect(seen).toEqual([]);
    });

    it('refuses a missing or unreadable --body-file locally, quoting the resolved path', async () => {
      await expect(runCreateBrief(args('create-brief'))).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
      const missing = path.join(projectDir, 'nope.md');
      await expect(
        runCreateBrief(args('create-brief', '--body-file', missing)),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', message: expect.stringContaining(missing) });
      expect(seen).toEqual([]);
    });

    it('propagates VALIDATION from the server — the one thing it means is an empty file', async () => {
      status = 400;
      reply = { error: { code: 'VALIDATION', message: 'content must be non-empty when provided' } };
      await expect(
        runCreateBrief(args('create-brief', '--body-file', writeBody('   '))),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    });
  });

  describe('create-plan (0.2.98)', () => {
    const bodyPath = () => path.join(projectDir, 'plan.md');
    const writeBody = (text: string) => {
      fs.writeFileSync(bodyPath(), text, 'utf8');
      return bodyPath();
    };

    it('[ac:ac-wyjscie-c4s-create-plan-niesie-w-thre] posts title + the file`s bytes to /plans and prints the server reply untransformed — planPath, hash, threads: [carrier]', async () => {
      reply = { data: { planPath: 'auth-rollout.md', hash: 'h1', threads: ['t-9'] } };
      const body = '## Step\n\n`backticks` and "quotes" survive\n';
      await runCreatePlan(args('create-plan', '--title', 'Auth rollout', '--body-file', writeBody(body)));

      expect(seen).toHaveLength(1);
      expect(seen[0]!.method).toBe('POST');
      expect(seen[0]!.url).toMatch(/\/plans$/);
      expect(JSON.parse(seen[0]!.body)).toEqual({ title: 'Auth rollout', content: body });
      expect(printed()).toEqual({ planPath: 'auth-rollout.md', hash: 'h1', threads: ['t-9'] });
    });

    it('requires both flags, and refuses an unreadable --body-file locally with the resolved path', async () => {
      await expect(runCreatePlan(args('create-plan', '--body-file', writeBody('x')))).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
      await expect(runCreatePlan(args('create-plan', '--title', 't'))).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
      const missing = path.join(projectDir, 'nope.md');
      await expect(
        runCreatePlan(args('create-plan', '--title', 't', '--body-file', missing)),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', message: expect.stringContaining(missing) });
      expect(seen).toEqual([]);
    });

    it('propagates PLAN_ALREADY_EXISTS from the server verbatim', async () => {
      status = 409;
      reply = { error: { code: 'PLAN_ALREADY_EXISTS', message: "plan 'x.md' already exists" } };
      await expect(
        runCreatePlan(args('create-plan', '--title', 'x', '--body-file', writeBody('y'))),
      ).rejects.toMatchObject({ code: 'PLAN_ALREADY_EXISTS' });
    });
  });

  describe('create-patch', () => {
    const withStdin = async (body: string, fn: () => Promise<void>): Promise<void> => {
      const file = path.join(projectDir, 'body.md');
      fs.writeFileSync(file, body, 'utf8');
      await fn();
    };

    it('[ac:ac-c4s-file-patch-brief-brief-path-d] POSTs the patch and lets the SERVER write the file', async () => {
      status = 201;
      reply = { data: { path: 'a-md-thing.md' } };
      await withStdin('the body', () =>
        runCreatePatch(
          args('create-patch', '--brief', 'a.md', '--desc', 'thing', '--body-file', path.join(projectDir, 'body.md')),
        ),
      );
      expect(seen[0]!.method).toBe('POST');
      expect(seen[0]!.url).toMatch(/\/patches$/);
      expect(JSON.parse(seen[0]!.body)).toEqual({
        brief: 'a.md',
        desc: 'thing',
        patchKind: 'drift',
        body: 'the body',
        createdBy: 'unknown',
      });
      // Nothing was written locally — that was the last dedicated write path
      // into the specification from this process.
      expect(fs.existsSync(path.join(projectDir, 'patches'))).toBe(false);
    });

    it('defaults the kind and carries an explicit one', async () => {
      status = 201;
      reply = { data: { path: 'p.md' } };
      await withStdin('b', () =>
        runCreatePatch(
          args('create-patch', '--brief', 'a.md', '--desc', 'd', '--kind', 'missing', '--created-by', 'claude', '--body-file', path.join(projectDir, 'body.md')),
        ),
      );
      expect(JSON.parse(seen[0]!.body)).toMatchObject({ patchKind: 'missing', createdBy: 'claude' });
    });

    it('refuses a bad kind and a missing brief/desc before addressing the server', async () => {
      const bodyFile = path.join(projectDir, 'body.md');
      fs.writeFileSync(bodyFile, 'x', 'utf8');
      for (const argv of [
        ['create-patch', '--desc', 'd', '--body-file', bodyFile],
        ['create-patch', '--brief', 'a.md', '--body-file', bodyFile],
        ['create-patch', '--brief', 'a.md', '--desc', 'd', '--kind', 'nonsense', '--body-file', bodyFile],
      ]) {
        await expect(runCreatePatch(args(...argv))).rejects.toMatchObject({ code: 'INVALID_ARGS' });
      }
      expect(seen).toEqual([]);
    });

    it('[ac:ac-c4s-file-patch-bez-uprawnien-zapisu-w] propagates PATCH_WRITE_FAILED from the server rather than inventing a code', async () => {
      status = 500;
      reply = { error: { code: 'PATCH_WRITE_FAILED', message: 'EROFS' } };
      await withStdin('b', () =>
        expect(
          runCreatePatch(
            args('create-patch', '--brief', 'a.md', '--desc', 'd', '--body-file', path.join(projectDir, 'body.md')),
          ),
        ).rejects.toMatchObject({ code: 'PATCH_WRITE_FAILED' }),
      );
    });

    it('[ac:ac-brief-path-escapujacy-briefsdir-sciez] refuses a --brief escaping briefsDir locally, before any request', async () => {
      const bodyFile = path.join(projectDir, 'body.md');
      fs.writeFileSync(bodyFile, 'x', 'utf8');
      for (const brief of ['../outside.md', '../../etc/passwd', '/etc/passwd', 'sub/../../x.md']) {
        const err = await runCreatePatch(
          args('create-patch', '--brief', brief, '--desc', 'd', '--body-file', bodyFile),
        ).catch((e: unknown) => e);
        // CliError, not just the code — only a CliError reaches codeToExit (exit 4).
        expect(err, brief).toBeInstanceOf(CliError);
        expect((err as { code?: string }).code, brief).toBe('INVALID_ARGS');
      }
      expect(seen).toEqual([]);
    });

    it('[ac:ac-c4s-read-brief-brief-path-c4s-fil] a missing brief is the server\'s BRIEF_NOT_FOUND, hint included', async () => {
      status = 404;
      reply = {
        error: { code: 'BRIEF_NOT_FOUND', message: 'brief not found: ghost.md', hint: 'available briefs: a.md' },
      };
      const bodyFile = path.join(projectDir, 'body.md');
      fs.writeFileSync(bodyFile, 'x', 'utf8');
      await expect(
        runCreatePatch(args('create-patch', '--brief', 'ghost.md', '--desc', 'd', '--body-file', bodyFile)),
      ).rejects.toMatchObject({ code: 'BRIEF_NOT_FOUND', hint: 'available briefs: a.md' });
      expect(seen).toHaveLength(1);
    });
  });
});
