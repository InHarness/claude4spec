/**
 * `c4s resolve` (2.1.9, M11 `m11dreso`) — a thin shell over the M19
 * embed-expansion core.
 *
 * Two halves of one criterion:
 *
 *  1. ABSENCE, read off the source: nothing under `src/bin/c4s` (nor the
 *     `src/bin/c4s.ts` entry) carries an expansion algorithm — no tag
 *     recognition, no tag-to-projection map, no replacing of tags with text, no
 *     `resolved[]` sidecar of its own. Comments are stripped first: the command
 *     is allowed to SAY where the expansion lives.
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
import { fileURLToPath } from 'node:url';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseArgs } from '../args.js';
import { __resetDelegateTargets } from '../delegate.js';
import { WorkspaceRegistry } from '../../../server/workspace/registry.js';
import { metaRouter } from '../../../server/routes/meta.js';
import type { DiscoveryCore } from '../../../server/discovery/types.js';
import type { ExpansionContext } from '../../../core/references/types.js';
import { runResolve } from './resolve.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Every non-test source of the `c4s` bin, with comments removed. */
function binSources(): Array<{ file: string; code: string }> {
  const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const out: Array<{ file: string; code: string }> = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
        out.push({ file: path.relative(REPO_ROOT, abs), code: strip(fs.readFileSync(abs, 'utf8')) });
      }
    }
  };
  walk(path.join(REPO_ROOT, 'src/bin/c4s'));
  out.push({ file: 'src/bin/c4s.ts', code: strip(fs.readFileSync(path.join(REPO_ROOT, 'src/bin/c4s.ts'), 'utf8')) });
  return out;
}

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

  it('[ac:ac-kod-binu-c4s-nie-zawiera-algorytmu-ro] the bin carries no expansion algorithm (grep-proof)', () => {
    // Tag recognition (the markup parser, the editor's markdown-it rules), the
    // core itself run locally, the old transport-side composition and its
    // renderer, and a sidecar re-shaped on this side.
    const forbidden =
      /parseXmlTags|shared\/xml-tags|xml_inline|xml_block|markdown-it|expandEmbeds\s*\(|expand-embeds|resolve-page\.js|inline-renderer|resolvePageContent|resolved\s*\.\s*map|<inline_mention|<single_element|<element_list|<tagged_list|<section_ref/;
    const sources = binSources();
    expect(sources.length).toBeGreaterThan(10);
    for (const { file, code } of sources) {
      expect(forbidden.exec(code)?.[0], `${file} carries part of the expansion algorithm`).toBeUndefined();
    }

    // The command itself: it posts the file and prints the answer — it replaces
    // nothing in the text it read.
    const resolve = sources.find((s) => s.file === path.join('src', 'bin', 'c4s', 'commands', 'resolve.ts'))!;
    expect(resolve.code).toContain("delegatePost(args, '/_meta/resolve-page'");
    expect(resolve.code).not.toMatch(/\.replace\(|\.slice\(|\.splice\(/);
    expect(resolve.code).not.toMatch(/select\s*:/);

    // …and what it posts to is the M19 core.
    const route = fs.readFileSync(path.join(REPO_ROOT, 'src/server/routes/meta.ts'), 'utf8');
    expect(route).toContain("import { expandEmbeds } from '../../core/references/index.js'");
    expect(route).toMatch(/expandEmbeds\(body\.content, expansion, \{ format \}\)/);
    expect(fs.existsSync(path.join(REPO_ROOT, 'src/server/serialization/resolve-page.ts'))).toBe(false);
  });

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
