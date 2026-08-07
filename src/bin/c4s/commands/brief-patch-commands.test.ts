/**
 * The brief/patch family, after item 23 moved it off the filesystem.
 *
 * These three were the last commands that read and wrote the specification
 * directly: `list-briefs` walked `briefsDir` parsing frontmatter, `read-brief`
 * read a file, and `file-patch` had a dedicated write path into `patchesDir`
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
import { WorkspaceRegistry } from '../../../server/workspace/registry.js';
import { __resetDelegateTargets } from '../delegate.js';
import { runListBriefs } from './list-briefs.js';
import { runReadBrief } from './read-brief.js';
import { runFilePatch } from './file-patch.js';

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
  let prevHome: string | undefined;
  let stdout: string;
  let server: http.Server;
  let seen: Array<{ method: string; url: string; body: string }>;
  let status: number;
  let reply: unknown;

  beforeEach(async () => {
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
        res.statusCode = status;
        res.end(JSON.stringify(reply));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const registry = new WorkspaceRegistry(registryDir);
    const ws = registry.selectOrCreate({ name: 'default', port });
    registry.registerProject(ws, projectDir);
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
    parseArgs([...argv, '--project', path.basename(projectDir), '--workspace', 'default']);
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

  describe('read-brief', () => {
    it('prints frontmatter, body and content — the three fields it always answered with', async () => {
      reply = { data: { path: 'x.md', frontmatter: { type: 'brief' }, body: 'B', content: 'C', hash: 'h' } };
      await runReadBrief(args('read-brief', 'sub/x.md'));
      expect(seen[0]!.url).toMatch(/\/artifacts\/brief\/sub\/x\.md$/);
      // `hash` and `path` are dropped: a caller piping this into `jq '.body'`
      // must not have to change, and neither field was ever in the answer.
      expect(printed()).toEqual({ frontmatter: { type: 'brief' }, body: 'B', content: 'C' });
    });

    it('turns the route\'s generic NOT_FOUND into BRIEF_NOT_FOUND', async () => {
      // The command's entire domain is one brief path, so a generic code would
      // lose which of the two things was missing — and exit 12 is what a script
      // branches on.
      status = 404;
      reply = { error: { code: 'NOT_FOUND', message: 'no such artifact' } };
      await expect(runReadBrief(args('read-brief', 'nope.md'))).rejects.toMatchObject({
        code: 'BRIEF_NOT_FOUND',
      });
    });

    it('requires the path', async () => {
      await expect(runReadBrief(args('read-brief'))).rejects.toMatchObject({ code: 'INVALID_ARGS' });
      expect(seen).toEqual([]);
    });

    it('refuses a traversal instead of addressing another endpoint with it', async () => {
      /**
       * The failure this pins is not a 404. `..` survives `encodeURIComponent`
       * and `fetch` collapses it, so `read-brief ../../config` was SENT as
       * `GET /api/projects/<id>/config` — an endpoint that answers 200 with the
       * project config. The command then printed `{}` (none of frontmatter/
       * body/content exist on that payload) and exited 0, where the filesystem
       * reader had refused outright. So the assertion that matters is that
       * NOTHING was requested.
       */
      await expect(runReadBrief(args('read-brief', '../../config'))).rejects.toMatchObject({
        code: 'INVALID_ARGS',
      });
      expect(seen).toEqual([]);
    });
  });

  describe('file-patch', () => {
    const withStdin = async (body: string, fn: () => Promise<void>): Promise<void> => {
      const file = path.join(projectDir, 'body.md');
      fs.writeFileSync(file, body, 'utf8');
      await fn();
    };

    it('POSTs the patch and lets the SERVER write the file', async () => {
      status = 201;
      reply = { data: { path: 'a-md-thing.md' } };
      await withStdin('the body', () =>
        runFilePatch(
          args('file-patch', '--brief', 'a.md', '--desc', 'thing', '--body-file', path.join(projectDir, 'body.md')),
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
        runFilePatch(
          args('file-patch', '--brief', 'a.md', '--desc', 'd', '--kind', 'missing', '--created-by', 'claude', '--body-file', path.join(projectDir, 'body.md')),
        ),
      );
      expect(JSON.parse(seen[0]!.body)).toMatchObject({ patchKind: 'missing', createdBy: 'claude' });
    });

    it('refuses a bad kind and a missing brief/desc before addressing the server', async () => {
      const bodyFile = path.join(projectDir, 'body.md');
      fs.writeFileSync(bodyFile, 'x', 'utf8');
      for (const argv of [
        ['file-patch', '--desc', 'd', '--body-file', bodyFile],
        ['file-patch', '--brief', 'a.md', '--body-file', bodyFile],
        ['file-patch', '--brief', 'a.md', '--desc', 'd', '--kind', 'nonsense', '--body-file', bodyFile],
      ]) {
        await expect(runFilePatch(args(...argv))).rejects.toMatchObject({ code: 'INVALID_ARGS' });
      }
      expect(seen).toEqual([]);
    });

    it('propagates PATCH_WRITE_FAILED from the server rather than inventing a code', async () => {
      status = 500;
      reply = { error: { code: 'PATCH_WRITE_FAILED', message: 'EROFS' } };
      await withStdin('b', () =>
        expect(
          runFilePatch(
            args('file-patch', '--brief', 'a.md', '--desc', 'd', '--body-file', path.join(projectDir, 'body.md')),
          ),
        ).rejects.toMatchObject({ code: 'PATCH_WRITE_FAILED' }),
      );
    });
  });
});
