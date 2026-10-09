/**
 * `c4s resolve` (2.1.9, M11 `m11dreso`) — a thin shell over the M19
 * embed-expansion core.
 *
 * Two halves of one criterion:
 *
 *  1. ABSENCE, read off the source — lives in
 *     `tests/integration/architecture/c4s-resolve-thin-shell.test.ts`: a test
 *     that walks directories cannot sit under `src/bin/c4s`, which the M39 guard
 *     (`discovery-core.test.ts`) keeps free of any directory walk.
 *  2. DELEGATION, observed on the wire: the command reads the local file, posts
 *     its text to the project's `/_meta/resolve-page`, and prints what the M19
 *     core produced there. The server half here is the REAL `metaRouter` with a
 *     hand-built `ExpansionContext`, so the output is `expandEmbeds`' own — a
 *     `section_ref` becoming its heading is something only that core does.
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseArgs } from '../args.js';
import { __resetDelegateTargets } from '../delegate.js';
import { WorkspaceRegistry } from '../../../server/workspace/registry.js';
import { metaRouter } from '../../../server/routes/meta.js';
import type { DiscoveryCore } from '../../../server/discovery/types.js';
import type { ExpansionContext } from '../../../core/references/types.js';
import { runResolve } from './resolve.js';

/** The section index and entity reader the server half expands with. */
const expansion: ExpansionContext = {
  readEntities: (_type, slugs) =>
    slugs.map((slug) => ({ slug, entity: slug === 'get-users' ? { slug, title: 'List users', href: '/endpoints/get-users' } : null })),
  listByTags: () => [],
  sectionHeading: (anchor) => (anchor === 'abcd1234' ? 'Command surface' : null),
  findPageLinks: () => [],
  pageTitle: () => null,
};

const CONFIG = { name: 'test-project', roots: [{ id: 'pages', dir: 'pages' }], writingStyle: null, onboarding: {} };

describe('c4s resolve — delegation to the M19 expansion core', () => {
  let registryDir: string;
  let projectDir: string;
  let projectId: string;
  let prevHome: string | undefined;
  let stdout: string;
  let server: http.Server;
  let posted: Array<{ url: string; body: unknown }>;

  beforeEach(async () => {
    registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-resolve-registry-'));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-resolve-project-'));
    prevHome = process.env.C4S_HOME;
    process.env.C4S_HOME = registryDir;

    posted = [];
    const app = express();
    app.use(express.json());
    app.get('/api/projects/:id/config', (_req, res) => {
      res.json(CONFIG);
    });
    app.use('/api/projects/:id/_meta', (req, _res, next) => {
      posted.push({ url: req.originalUrl, body: req.body });
      next();
    });
    app.use('/api/projects/:id/_meta', metaRouter({} as DiscoveryCore, expansion));
    server = http.createServer(app);
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

  const run = (...argv: string[]) => runResolve(parseArgs([...argv, '--project', projectId, '--workspace', 'default']));

  it('[ac:ac-kod-binu-c4s-nie-zawiera-algorytmu-ro] `c4s resolve` reads the local file and prints what the M19 core expanded on the server', async () => {
    const file = path.join(projectDir, 'notes.md');
    const text = 'Call <inline_mention type="endpoint" slug="get-users"/> — see <section_ref anchor="abcd1234"/>.\n';
    fs.writeFileSync(file, text);

    await run('resolve', file);

    // One POST to the project's route, carrying the file's text and the format.
    expect(posted).toHaveLength(1);
    expect(posted[0]!.url).toBe(`/api/projects/${projectId}/_meta/resolve-page`);
    expect(posted[0]!.body).toEqual({ content: text, format: 'inline' });
    // The core's inline format: the chip became its title link, the section
    // reference its heading.
    expect(stdout).toBe('Call [List users](/endpoints/get-users) — see Command surface.\n');
  });

  it('[ac:ac-kod-binu-c4s-nie-zawiera-algorytmu-ro] `--format json` prints the core\'s json result as is — the original text plus `resolved[]`, broken slug included', async () => {
    const file = path.join(projectDir, 'broken.md');
    const text = '<inline_mention type="endpoint" slug="get-users"/> and <inline_mention type="endpoint" slug="gone"/>\n';
    fs.writeFileSync(file, text);

    await run('resolve', file, '--format', 'json');

    expect(posted[0]!.body).toEqual({ content: text, format: 'json' });
    const printed = JSON.parse(stdout) as { format: string; text: string; resolved: Array<{ kind: string; error?: string }> };
    expect(printed.format).toBe('json');
    expect(printed.text).toBe(text);
    expect(printed.resolved.map((r) => r.kind)).toEqual(['inline_mention', 'inline_mention']);
    expect(printed.resolved[0]!.error).toBeUndefined();
    expect(printed.resolved[1]!.error).toBeTruthy();
  });
});
