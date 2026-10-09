/**
 * 2.1.11 — `c4s release-list` / `release-show` / `release-diff`, all
 * `server-delegating` over the release routes' `view=operation`. Asserted
 * against a real HTTP server, so the URL each command builds is part of what is
 * checked — and so is the absence of a request when the refusal is local.
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseArgs } from '../args.js';
import { WorkspaceRegistry } from '../../../server/workspace/registry.js';
import { __resetDelegateTargets } from '../delegate.js';
import { toCliHint } from '../release-hint.js';
import { runReleaseList } from './release-list.js';
import { runReleaseShow } from './release-show.js';
import { runReleaseDiff } from './release-diff.js';

const CONFIG = { name: 'test-project', roots: [], entitiesDir: 'entities', writingStyle: null, onboarding: {} };

describe('c4s release commands (2.1.11)', () => {
  let registryDir: string;
  let projectDir: string;
  let projectId: string;
  let prevHome: string | undefined;
  let stdout: string;
  let server: http.Server;
  let seen: string[];
  let status: number;
  let reply: unknown;

  beforeEach(async () => {
    registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-rel-registry-'));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-rel-project-'));
    prevHome = process.env.C4S_HOME;
    process.env.C4S_HOME = registryDir;
    seen = [];
    status = 200;
    reply = {};
    server = http.createServer((req, res) => {
      const url = req.url ?? '';
      res.setHeader('content-type', 'application/json');
      if (url.endsWith('/config')) return res.end(JSON.stringify(CONFIG));
      seen.push(url);
      res.statusCode = status;
      res.end(JSON.stringify(reply));
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

  const args = (...argv: string[]) => parseArgs([...argv, '--project', projectId, '--workspace', 'default']);
  const query = (url: string) => new URL(url, 'http://x').searchParams;

  describe('release-list', () => {
    it('prints the operation payload unchanged and sends no window it was not given', async () => {
      const payload = { releases: [{ id: 3, name: 'v3' }], total: 9 };
      reply = { data: payload };
      await runReleaseList(args('release-list'));
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatch(/\/releases\?view=operation$/);
      expect(JSON.parse(stdout)).toEqual(payload);
    });

    it('passes --limit / --offset through when given', async () => {
      reply = { data: { releases: [], total: 0 } };
      await runReleaseList(args('release-list', '--limit', '2', '--offset', '4'));
      const q = query(seen[0]!);
      expect(q.get('limit')).toBe('2');
      expect(q.get('offset')).toBe('4');
    });
  });

  describe('release-show', () => {
    it('encodes --release as one path segment and never interprets it', async () => {
      reply = { data: { release: { id: 1, name: 'team/v1' }, total: {} } };
      await runReleaseShow(args('release-show', '--release', 'team/v1', '--entity-types', 'endpoint,dto'));
      expect(seen[0]).toMatch(/\/releases\/team%2Fv1\/snapshot\?/);
      expect(query(seen[0]!).getAll('entityTypes')).toEqual(['endpoint', 'dto']);
    });

    it('passes a server refusal through with its own code', async () => {
      status = 404;
      reply = { error: { code: 'RELEASE_NOT_FOUND', message: "release 'current' not found" } };
      await expect(runReleaseShow(args('release-show', '--release', 'current'))).rejects.toMatchObject({
        code: 'RELEASE_NOT_FOUND',
      });
    });
  });

  describe('release-diff', () => {
    it('builds the diff route with literals untouched and every flag as its parameter', async () => {
      reply = { data: { from: null, to: { id: 2, name: 'v2' }, total: { entities: 0 }, entities: [] } };
      await runReleaseDiff(
        args(
          'release-diff',
          '--from', 'initial',
          '--to', 'v2',
          '--entity-types', 'endpoint',
          '--slugs', 'get-user',
          '--paths', 'pages/a.md',
          '--section-offset', '3',
          '--section-limit', '1',
          '--summary-only',
          '--limit', '7',
        ),
      );
      expect(seen[0]).toMatch(/\/releases\/initial\/diff\/v2\?/);
      const q = query(seen[0]!);
      expect(q.get('view')).toBe('operation');
      expect(q.getAll('entityTypes')).toEqual(['endpoint']);
      expect(q.getAll('slugs')).toEqual(['get-user']);
      expect(q.getAll('paths')).toEqual(['pages/a.md']);
      expect(q.get('sectionOffset')).toBe('3');
      expect(q.get('sectionLimit')).toBe('1');
      expect(q.get('summaryOnly')).toBe('true');
      expect(q.get('limit')).toBe('7');
      expect(q.has('offset')).toBe(false);
      expect(JSON.parse(stdout)).toEqual((reply as { data: unknown }).data);
    });

    it('repeats --paths', async () => {
      reply = { data: { from: null, to: { id: 2, name: 'v2' }, total: {} } };
      await runReleaseDiff(args('release-diff', '--from', 'v1', '--to', 'v2', '--paths', 'pages/a.md', '--paths', 'pages/b.md'));
      expect(query(seen[0]!).getAll('paths')).toEqual(['pages/a.md', 'pages/b.md']);
    });

    it('sends empty list elements as written — the server judges them', async () => {
      status = 400;
      reply = { error: { code: 'INVALID_SLUGS_FILTER', message: 'slugs must not contain an empty element' } };
      await expect(
        runReleaseDiff(args('release-diff', '--from', 'v1', '--to', 'v2', '--entity-types', 't', '--slugs', 'a,,b')),
      ).rejects.toMatchObject({ code: 'INVALID_SLUGS_FILTER' });
      expect(query(seen[0]!).getAll('slugs')).toEqual(['a', '', 'b']);
    });

    it('refuses a missing required flag locally, before any request', async () => {
      await expect(runReleaseDiff(args('release-diff', '--to', 'v2'))).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        message: expect.stringContaining('--from'),
      });
      expect(seen).toEqual([]);
    });

    it('refuses an unknown flag locally and lists the legal ones', async () => {
      await expect(
        runReleaseDiff(args('release-diff', '--from', 'v1', '--to', 'v2', '--types', 'x')),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', message: expect.stringContaining('--entity-types') });
      expect(seen).toEqual([]);
    });

    it('refuses a non-repeatable list flag given twice instead of keeping the last', async () => {
      await expect(
        runReleaseDiff(args('release-diff', '--from', 'v1', '--to', 'v2', '--entity-types', 't', '--slugs', 'a', '--slugs', 'b')),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', message: expect.stringContaining('--slugs') });
      expect(seen).toEqual([]);
    });

    it('refuses a trailing valueless --paths rather than dropping it', async () => {
      await expect(
        runReleaseDiff(args('release-diff', '--from', 'v1', '--to', 'v2', '--paths', 'pages/a.md', '--paths')),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      expect(seen).toEqual([]);
    });

    it('reads --summary-only=true as the switch', async () => {
      reply = { data: { from: null, to: { id: 2, name: 'v2' }, total: {} } };
      await runReleaseDiff(args('release-diff', '--from', 'v1', '--to', 'v2', '--summary-only=true'));
      expect(query(seen[0]!).get('summaryOnly')).toBe('true');
    });

    it('marks a cut answer `truncated` and prints the hint in flag form', async () => {
      reply = {
        data: {
          from: { id: 1, name: 'v1' },
          to: { id: 2, name: 'v2' },
          total: {},
          truncationHint:
            "page `pages/a.md` did not fit — continue with `paths: ['pages/a.md'], sectionOffset: 4, sectionLimit: 2` (without `roots`).",
        },
      };
      await runReleaseDiff(args('release-diff', '--from', 'v1', '--to', 'v2'));
      const out = JSON.parse(stdout);
      expect(out.truncated).toBe(true);
      expect(out.truncationHint).toContain('`--paths pages/a.md --section-offset 4 --section-limit 2`');
      expect(out.truncationHint).toContain('`--roots`');
    });
  });
});

describe('toCliHint (2.1.11)', () => {
  it('maps parameters to flags by the one mechanical rule', () => {
    expect(toCliHint("read it with `entityTypes: ['endpoint'], slugs: ['get-user']`.")).toBe(
      'read it with `--entity-types endpoint --slugs get-user`.',
    );
    expect(toCliHint("continue with `include: ['entities'], offset: 7` next")).toBe(
      'continue with `--include entities --offset 7` next',
    );
    expect(toCliHint('`summaryOnly: true` and `sectionLimit: 1`')).toBe('`--summary-only` and `--section-limit 1`');
    expect(toCliHint('pass `toReleaseName` or `fromReleaseName`')).toBe('pass `--to` or `--from`');
  });

  it('keeps a hinted value one shell word, apostrophes and spaces included', () => {
    expect(toCliHint("continue with `paths: ['pages/my notes.md'], sectionOffset: 2, sectionLimit: 1`")).toBe(
      "continue with `--paths 'pages/my notes.md' --section-offset 2 --section-limit 1`",
    );
    expect(toCliHint("continue with `paths: ['pages/don't.md'], sectionOffset: 2`")).toBe(
      "continue with `--paths 'pages/don'\\''t.md' --section-offset 2`",
    );
  });

  it('leaves prose and unknown code spans alone', () => {
    expect(toCliHint('marked `truncated: true` and `before`/`after`')).toBe('marked `truncated: true` and `before`/`after`');
  });
});
