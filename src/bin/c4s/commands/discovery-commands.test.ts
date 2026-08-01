/**
 * 0.2.6 — the ten commands that close the CLI's gap with the discovery core.
 *
 * What is asserted here is exactly what the CLI OWNS: flag mapping and the
 * guards that belong to the transport. The behaviour of each operation —
 * pagination, budget, sort order, what an error suggests — is the core's, and is
 * asserted in `src/server/discovery/discovery.test.ts`; re-asserting it here
 * would be a second definition of the same contract.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseArgs } from '../args.js';
import { WorkspaceRegistry } from '../../../server/workspace/registry.js';
import { runMigrations } from '../../../server/db/migrate.js';
import { applyCoreEntityMigrations } from '../../../../tests/helpers/test-db.js';
import { runGetPage } from './get-page.js';
import { runGetSections } from './get-sections.js';
import { runListPages } from './list-pages.js';
import { runListSections } from './list-sections.js';
import { runSearchPages } from './search-pages.js';
import { runSearchEntities } from './search-entities.js';
import { runResolveIdentity } from './resolve-identity.js';
import { runCheckConsistency } from './check-consistency.js';
import { runListEntities } from './list-entities.js';
import { runGetEntities } from './get-entities.js';

describe('discovery commands on the CLI', () => {
  let registryDir: string;
  let projectDir: string;
  let prevHome: string | undefined;
  let stdout: string;

  const PAGE = [
    '# Top',
    '',
    '## Budget rules',
    '<!-- anchor: aaaaaa11 -->',
    '',
    'The response budget is not a page.',
    '',
  ].join('\n');

  beforeEach(() => {
    registryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-disc-cmd-registry-'));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-disc-cmd-project-'));
    prevHome = process.env.C4S_HOME;
    process.env.C4S_HOME = registryDir;

    const registry = new WorkspaceRegistry(registryDir);
    const ws = registry.selectOrCreate({ name: 'default' });
    const project = registry.registerProject(ws, projectDir);

    fs.mkdirSync(path.join(projectDir, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'pages', 'budget.md'), PAGE, 'utf-8');

    // The db slot the resolver will point `createContext` at.
    const slot = registry.slotDir(ws, project.id);
    fs.mkdirSync(slot, { recursive: true });
    const db = new Database(path.join(slot, 'db.sqlite'));
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    applyCoreEntityMigrations(db);
    db.prepare(
      `INSERT INTO section_index
         (rootId, anchor, page_path, heading_path, heading_slug, heading_level, heading_text,
          content_hash, line_start, line_end, paragraph_count)
       VALUES ('pages', 'aaaaaa11', 'budget.md', 'Budget rules', 'budget-rules', 2, 'Budget rules',
               'hash', 3, 7, 1)`,
    ).run();
    db.close();

    stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevHome === undefined) delete process.env.C4S_HOME;
    else process.env.C4S_HOME = prevHome;
    fs.rmSync(registryDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  const identity = () => ['--project', path.basename(projectDir), '--workspace', 'default'];
  const args = (...argv: string[]) => parseArgs([...argv, ...identity()]);
  const printed = () => JSON.parse(stdout) as Record<string, unknown>;

  describe('the phrase → text path works with no server', () => {
    it('search-pages hands back an anchor that get-sections then resolves to a body', async () => {
      await runSearchPages(args('search-pages', '--query', 'response budget'));
      const hits = printed().items as Array<Record<string, unknown>>;
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]).toMatchObject({ kind: 'section', anchor: 'aaaaaa11' });

      stdout = '';
      await runGetSections(args('get-sections', '--anchors', 'aaaaaa11'));
      const results = printed().results as Array<Record<string, unknown>>;
      expect(results[0]!.body).toContain('The response budget is not a page.');
      // 0.2.6 breaking change — the response carries the content, not a version of it.
      expect(results[0]).not.toHaveProperty('content_hash');
    });

    it('list-sections --by anchor measures the subtree before anything is pulled', async () => {
      await runListSections(args('list-sections', '--by', 'anchor', '--anchor', 'aaaaaa11'));
      expect(printed()).toMatchObject({ is_known: true, total: 1 });
      expect((printed().items as Array<Record<string, unknown>>)[0]).toMatchObject({
        anchor: 'aaaaaa11',
        heading: 'Budget rules',
      });
    });

    it('get-page returns the page as authored', async () => {
      await runGetPage(args('get-page', '--root-id', 'pages', '--path', 'budget.md'));
      expect(printed().content).toBe(PAGE);
    });
  });

  /**
   * An unknown anchor is an item-level answer, not a call-level failure: the
   * handler must RESOLVE. If it threw, every shell caller would lose the good
   * sections in the same batch — which is the entire reason the operation is
   * batched.
   */
  it('get-sections: an unknown anchor errors inside its own item, and the call succeeds', async () => {
    await expect(runGetSections(args('get-sections', '--anchors', 'aaaaaa11,zzzzzz99'))).resolves.toBeUndefined();
    const results = printed().results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(2);
    expect(results[0]!.body).toBeTruthy();
    expect(results[1]).toMatchObject({ anchor: 'zzzzzz99', code: 'SECTION_NOT_FOUND' });
  });

  describe('the guards the transport owns', () => {
    it('page commands require --root-id and do not fall back to the built-in root', async () => {
      await expect(runListPages(args('list-pages'))).rejects.toMatchObject({ code: 'INVALID_ARGS' });
      await expect(runGetPage(args('get-page', '--path', 'budget.md'))).rejects.toMatchObject({
        code: 'INVALID_ARGS',
      });
      await expect(
        runListSections(args('list-sections', '--by', 'page', '--path', 'budget.md')),
      ).rejects.toMatchObject({ code: 'INVALID_ARGS' });
    });

    it('an unknown --root-id names the roots that exist rather than reporting a missing page', async () => {
      await expect(runListPages(args('list-pages', '--root-id', 'nope'))).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        hint: expect.stringContaining('pages'),
      });
    });

    /**
     * Ignoring the flag would be worse than refusing it: the caller would
     * believe the answer had been scoped to that root when it never was.
     */
    it('section commands refuse --root-id outright — an anchor is globally unique', async () => {
      await expect(
        runGetSections(args('get-sections', '--anchors', 'aaaaaa11', '--root-id', 'pages')),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await expect(
        runListSections(args('list-sections', '--by', 'anchor', '--anchor', 'aaaaaa11', '--root-id', 'pages')),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    });

    it('list-sections requires the --by discriminator, and there is no query mode', async () => {
      await expect(runListSections(args('list-sections', '--anchor', 'aaaaaa11'))).rejects.toMatchObject({
        code: 'INVALID_ARGS',
      });
      await expect(runListSections(args('list-sections', '--by', 'query', '--query', 'x'))).rejects.toMatchObject({
        code: 'INVALID_ARGS',
      });
    });

    it('search-pages takes --query XOR --regex', async () => {
      await expect(
        runSearchPages(args('search-pages', '--query', 'budget', '--regex', 'bud.*')),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      await expect(runSearchPages(args('search-pages'))).rejects.toMatchObject({ code: 'INVALID_ARGS' });
    });

    it('--range is refused on a section-indexed root, with the alternative in the hint', async () => {
      await expect(
        runGetPage(args('get-page', '--root-id', 'pages', '--path', 'budget.md', '--range', '1:3')),
      ).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        hint: expect.stringMatching(/list_sections.*get_sections/),
      });
    });

    it('an empty --anchors list is refused by the core, so the message carries the limit', async () => {
      await expect(runGetSections(args('get-sections', '--anchors', ',,'))).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        message: expect.stringContaining('50'),
      });
    });

    it('search-entities requires --type: it is the one command that is not cross-type', async () => {
      await expect(runSearchEntities(args('search-entities', '--query', 'x'))).rejects.toMatchObject({
        code: 'INVALID_ARGS',
      });
    });
  });

  describe('entity commands map their flags onto the core', () => {
    beforeEach(() => {
      // Written through the same slot the commands read.
      const registry = new WorkspaceRegistry(registryDir);
      const ws = registry.selectOrCreate({ name: 'default' });
      const project = registry.registerProject(ws, projectDir);
      const db = new Database(path.join(registry.slotDir(ws, project.id), 'db.sqlite'));
      const insert = db.prepare(`INSERT INTO diagram (slug, format, source) VALUES (?, 'mermaid', 'graph TD')`);
      for (const slug of ['alpha', 'beta']) insert.run(slug);
      db.close();
    });

    it('list-entities --mode count answers "how many" without listing', async () => {
      await runListEntities(args('list-entities', '--type', 'diagram', '--mode', 'count'));
      expect(printed()).toMatchObject({ mode: 'count', total: 2 });
    });

    it('get-entities returns the named slugs in input order and echoes the view', async () => {
      await runGetEntities(args('get-entities', '--type', 'diagram', '--slugs', 'beta,alpha', '--view', 'detail'));
      expect(printed().view).toBe('detail');
      expect((printed().results as Array<{ slug: string }>).map((r) => r.slug)).toEqual(['beta', 'alpha']);
    });

    it('search-entities always declares searchedFields, so an empty result is readable', async () => {
      await runSearchEntities(args('search-entities', '--type', 'diagram', '--query', 'nothing-matches-this'));
      expect(printed().searchedFields).toBeDefined();
      expect(printed().total).toBe(0);
    });

    it('resolve-identity is the only cross-type command', async () => {
      await runResolveIdentity(args('resolve-identity', '--query', 'alph'));
      expect((printed().candidates as Array<{ slug: string }>).map((c) => c.slug)).toContain('alpha');
    });

    it('check-consistency reports a summary rather than a page', async () => {
      await runCheckConsistency(args('check-consistency'));
      expect(printed().summary).toMatchObject({ total: expect.any(Number) });
      // A report, not a collection: no pagination envelope to mistake it for one.
      expect(printed()).not.toHaveProperty('hasMore');
    });
  });
});
