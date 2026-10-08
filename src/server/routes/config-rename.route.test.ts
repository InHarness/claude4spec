import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { builtinPagesRoot, configPath, readConfig, type Config } from '../config.js';
import { configRouter } from './config.js';
import { rootRenameRouter, rootRenameLock } from './config-rename.js';
import { RootRegistry } from '../roots/registry.js';
import { PagesService } from '../services/pages.js';
import { readRootRenames, rootRenamesPath } from '../root-renames.js';
import type { SkillRegistry } from '../services/skill-registry.js';
import type { Root } from '../../shared/types.js';

// Same deterministic stand-in as config.route.test.ts — `GET /config` probes the
// host sandbox, which has nothing to do with renaming a root.
const hoisted = vi.hoisted(() => ({ strength: 'soft' as 'hard' | 'soft' | 'none' }));
vi.mock('@inharness-ai/agent-adapters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@inharness-ai/agent-adapters')>();
  return {
    ...actual,
    probePathScope: (...args: Parameters<typeof actual.probePathScope>) => ({
      ...actual.probePathScope(...args),
      strength: hoisted.strength,
    }),
  };
});

/**
 * 0.2.101 — `POST /config/roots/:rootId/rename`.
 *
 * The operation exists BECAUSE a `PATCH /api/config` carrying a changed `id`
 * cannot be told apart from "delete one root, create another", and the two have
 * opposite consequences for a space's pages and history. These cases pin the
 * contract that makes the difference visible: every refusal code, the idempotent
 * replay, and the guarantee that a
 * rejected request leaves both files exactly as they were.
 */
describe('POST /config/roots/:rootId/rename (0.2.101)', () => {
  let dir: string;

  const userRoot = (id: string): Root => ({ id, name: id, dir: id, builtin: false });

  function write(cfg: Partial<Config>): void {
    const file = configPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ $schemaVersion: 4, name: 'X', ...cfg }, null, 2) + '\n');
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-rename-'));
    write({ roots: [builtinPagesRoot(), userRoot('adr')] });
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const renamed: Array<[string, string]> = [];
  const app = () =>
    express()
      .use(express.json())
      // 0.2.113: the project module mounts the rename, the settings module `/config`.
      .use('/config', rootRenameRouter({ cwd: dir, onRootRenamed: (from, to) => renamed.push([from, to]) }))
      .use(configRouter({ cwd: dir, skillRegistry: {} as unknown as SkillRegistry }));

  const currentHash = async (): Promise<string> =>
    (await request(app()).get('/config')).body.configHash as string;

  it('GET /config carries a configHash that changes with the file', async () => {
    const before = await currentHash();
    expect(before).toMatch(/^[0-9a-f]{64}$/);
    await request(app()).patch('/config').send({ name: 'Y' });
    expect(await currentHash()).not.toBe(before);
  });

  it('[entity:rename-root-response] renames a user root and keeps dir/name/builtin', async () => {
    const res = await request(app())
      .post('/config/roots/adr/rename')
      .send({ newId: 'decisions', expectedConfigHash: await currentHash() });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      rootId: 'decisions',
      previousRootId: 'adr',
      dir: 'adr', // identity and location are independent — the dir does NOT move
      name: 'adr',
      builtin: false,
      alreadyApplied: false,
    });
    // RenameRootResponse: exactly these seven fields (2.1.8: no `relinkedRoots`).
    expect(Object.keys(res.body).sort()).toEqual(
      ['alreadyApplied', 'builtin', 'configHash', 'dir', 'name', 'previousRootId', 'rootId'],
    );
    expect(res.body.configHash).toMatch(/^[0-9a-f]{64}$/);

    const after = readConfig(dir);
    expect(after.roots.map((r) => r.id)).toEqual(['pages', 'decisions']);
    expect(readRootRenames(dir).transitions).toEqual([
      expect.objectContaining({ from: 'adr', to: 'decisions' }),
    ]);
    // The context invalidation is what unmounts the old identity and rebuilds
    // every index under the new one — it must actually be signalled.
    expect(renamed.at(-1)).toEqual(['adr', 'decisions']);
  });

  it('reports no relinkedRoots and leaves the other roots untouched (2.1.8)', async () => {
    write({ roots: [builtinPagesRoot(), userRoot('adr'), userRoot('rfc')] });
    const res = await request(app())
      .post('/config/roots/adr/rename')
      .send({ newId: 'decisions', expectedConfigHash: await currentHash() });

    expect(res.status).toBe(200);
    expect('relinkedRoots' in res.body).toBe(false);
    expect(readConfig(dir).roots).toEqual([builtinPagesRoot(), { ...userRoot('adr'), id: 'decisions' }, userRoot('rfc')]);
  });

  it('refuses a rename to a system-root id with VALIDATION and writes nothing', async () => {
    const hash = await currentHash();
    for (const newId of ['plans', 'briefs', 'patches', 'entities', 'releases']) {
      const res = await request(app())
        .post('/config/roots/adr/rename')
        .send({ newId, expectedConfigHash: hash });
      expect(res.status, `newId=${newId}`).toBe(400);
      expect(res.body.code).toBe('VALIDATION');
      expect(res.body.error).toMatch(/reserved for a system root/);
    }
    expect(readConfig(dir).roots.map((r) => r.id)).toEqual(['pages', 'adr']);
    expect(fs.existsSync(rootRenamesPath(dir))).toBe(false);
  });

  it('renames the BASE root — the role stays in the flag, and `pages` is then just a free name', async () => {
    const res = await request(app())
      .post('/config/roots/pages/rename')
      .send({ newId: 'docs', expectedConfigHash: await currentHash() });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ rootId: 'docs', builtin: true });
    const after = readConfig(dir);
    // The config is fully valid with NO entry named `pages` at all.
    expect(after.roots.some((r) => r.id === 'pages')).toBe(false);
    expect(after.roots.find((r) => r.builtin)!.id).toBe('docs');
  });

  it('404s an unknown source root', async () => {
    const res = await request(app())
      .post('/config/roots/nope/rename')
      .send({ newId: 'other', expectedConfigHash: await currentHash() });
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'ROOT_NOT_FOUND', rootId: 'nope' });
  });

  it('400s a malformed newId and a no-op rename', async () => {
    const hash = await currentHash();
    for (const newId of ['', 'Docs', 'my docs', 'a/b', '-x']) {
      const res = await request(app())
        .post('/config/roots/adr/rename')
        .send({ newId, expectedConfigHash: hash });
      expect(res.status, `newId=${JSON.stringify(newId)}`).toBe(400);
      expect(res.body.code).toBe('VALIDATION');
    }
    // A reserved id is refused here too — not only by PATCH (the commit's
    // writeConfig would merely warn about it).
    const reserved = await request(app())
      .post('/config/roots/adr/rename')
      .send({ newId: 'search', expectedConfigHash: hash });
    expect(reserved.status).toBe(400);
    expect(reserved.body).toMatchObject({ code: 'VALIDATION', newId: 'search' });
    expect(reserved.body.error).toMatch(/reserved/);
    expect(readConfig(dir).roots.map((r) => r.id)).toEqual(['pages', 'adr']);

    const noop = await request(app())
      .post('/config/roots/adr/rename')
      .send({ newId: 'adr', expectedConfigHash: hash });
    expect(noop.status).toBe(400);
    expect(noop.body.code).toBe('VALIDATION');
  });

  it('409s a newId that another root already uses, with a message naming that root', async () => {
    const res = await request(app())
      .post('/config/roots/adr/rename')
      .send({ newId: 'pages', expectedConfigHash: await currentHash() });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'ROOT_ID_TAKEN', rootId: 'adr', newId: 'pages' });
    expect(res.body.error).toMatch(/already used/);
  });

  /**
   * A retired identifier stays taken forever, and the refusal says so in its own
   * words: the same code under two causes would leave the user unable to tell
   * "someone else has it" from "it can never be used again".
   */
  it('409s a newId retired by an earlier rename, with a DIFFERENT message than a live collision', async () => {
    await request(app())
      .post('/config/roots/adr/rename')
      .send({ newId: 'decisions', expectedConfigHash: await currentHash() })
      .expect(200);

    const res = await request(app())
      .post('/config/roots/decisions/rename')
      .send({ newId: 'adr', expectedConfigHash: await currentHash() });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ROOT_ID_TAKEN');
    expect(res.body.error).toMatch(/retired/);
    expect(res.body.error).not.toMatch(/already used/);
  });

  it('[ac:ac-przemianowanie-rootu-zatwierdzone-z-t] 409s a stale expectedConfigHash and writes nothing', async () => {
    const stale = await currentHash();
    await request(app()).patch('/config').send({ name: 'Moved on' }).expect(200);

    const res = await request(app())
      .post('/config/roots/adr/rename')
      .send({ newId: 'decisions', expectedConfigHash: stale });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFIG_CONFLICT');
    expect(readConfig(dir).roots.map((r) => r.id)).toEqual(['pages', 'adr']);
    expect(fs.existsSync(rootRenamesPath(dir))).toBe(false);
  });

  /**
   * Replay: a client whose 200 was lost retries the identical request. It must
   * be told the rename already happened — not 404, which is what "the source id
   * is retired" would otherwise produce — and it must NOT migrate anything a
   * second time.
   */
  it('[ac:ac-ponowne-zatwierdzenie-juz-zakonczoneg] replays a completed rename as 200 alreadyApplied, without a second transition', async () => {
    const body = { newId: 'decisions', expectedConfigHash: await currentHash() };
    await request(app()).post('/config/roots/adr/rename').send(body).expect(200);

    const replay = await request(app()).post('/config/roots/adr/rename').send(body);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({
      rootId: 'decisions',
      previousRootId: 'adr',
      alreadyApplied: true,
    });
    expect(readRootRenames(dir).transitions).toHaveLength(1);
  });

  /**
   * The operation is NOT reachable through PATCH, by construction: replacing the
   * array without the old id and with a new one is a delete plus a create, and a
   * retired id may not be drawn from at all.
   */
  it('PATCH /config refuses to reuse an identifier a rename retired', async () => {
    await request(app())
      .post('/config/roots/adr/rename')
      .send({ newId: 'decisions', expectedConfigHash: await currentHash() })
      .expect(200);

    const res = await request(app())
      .patch('/config')
      .send({ roots: [builtinPagesRoot(), userRoot('adr')] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/retired by an earlier rename/);
  });

  it('PATCH /config still refuses a config with no builtin root, or with two', async () => {
    const none = await request(app())
      .patch('/config')
      .send({ roots: [userRoot('a'), userRoot('b')] });
    expect(none.status).toBe(400);
    expect(none.body.error.message).toMatch(/exactly one root must have builtin: true \(found 0\)/);

    const two = await request(app())
      .patch('/config')
      .send({ roots: [builtinPagesRoot(), { ...builtinPagesRoot(), id: 'docs', dir: 'docs' }] });
    expect(two.status).toBe(400);
    expect(two.body.error.message).toMatch(/\(found 2\)/);
  });

  it('[entity:post-api-config-roots-rootid-rename] POST /config/roots/:rootId/rename answers 200, 400 VALIDATION, 404 ROOT_NOT_FOUND and 409 ROOT_ID_TAKEN / CONFIG_CONFLICT / RENAME_IN_PROGRESS', async () => {
    const hash = await currentHash();
    // Only POST is mounted on the path.
    expect((await request(app()).get('/config/roots/adr/rename')).status).toBe(404);
    expect((await request(app()).post('/config/roots/adr/rename').send({ newId: 'Bad Id', expectedConfigHash: hash })).body.code).toBe('VALIDATION');
    expect((await request(app()).post('/config/roots/nope/rename').send({ newId: 'x', expectedConfigHash: hash })).status).toBe(404);
    expect((await request(app()).post('/config/roots/adr/rename').send({ newId: 'pages', expectedConfigHash: hash })).status).toBe(409);
    expect((await request(app()).post('/config/roots/adr/rename').send({ newId: 'decisions', expectedConfigHash: 'stale' })).body.code).toBe(
      'CONFIG_CONFLICT',
    );
    expect(rootRenameLock.acquire(dir)).toBe(true);
    try {
      const busy = await request(app()).post('/config/roots/adr/rename').send({ newId: 'decisions', expectedConfigHash: hash });
      expect(busy.status).toBe(409);
      expect(busy.body.code).toBe('RENAME_IN_PROGRESS');
    } finally {
      rootRenameLock.release(dir);
    }
    const ok = await request(app()).post('/config/roots/adr/rename').send({ newId: 'decisions', expectedConfigHash: hash });
    expect(ok.status).toBe(200);
  });

  it('[ac:ac-drugie-przemianowanie-w-tym-samym-pro] a second rename sent while the first has not finished is refused, and changes nothing', async () => {
    const hash = await currentHash();
    // The first rename holds the project's slot until it completes.
    expect(rootRenameLock.acquire(dir)).toBe(true);
    try {
      const second = await request(app())
        .post('/config/roots/pages/rename')
        .send({ newId: 'docs', expectedConfigHash: hash });
      expect(second.status).toBe(409);
      expect(second.body).toMatchObject({ code: 'RENAME_IN_PROGRESS', rootId: 'pages' });
      expect(readConfig(dir).roots.map((r) => r.id)).toEqual(['pages', 'adr']);
      expect(fs.existsSync(rootRenamesPath(dir))).toBe(false);
    } finally {
      rootRenameLock.release(dir);
    }
    // Once the first is done, the same request goes through.
    await request(app()).post('/config/roots/pages/rename').send({ newId: 'docs', expectedConfigHash: hash }).expect(200);
  });

  it('[ac:ac-po-przemianowaniu-przestrzeni-podstaw] after renaming the base space its pages answer under the new identifier', async () => {
    fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pages', 'hello.md'), '# Hello\n');
    await request(app())
      .post('/config/roots/pages/rename')
      .send({ newId: 'docs', expectedConfigHash: await currentHash() })
      .expect(200);

    // The registry the next context is built from serves the base space as `docs`.
    const registry = new RootRegistry(readConfig(dir).roots);
    const space = registry.pages().find((r) => r.id === 'docs')!;
    expect(space).toMatchObject({ id: 'docs', dir: 'pages', builtin: true });
    expect(registry.pages().some((r) => r.id === 'pages')).toBe(false);
    const pages = new PagesService(dir, space.dir, space.id);
    expect(pages.rootId).toBe('docs');
    expect((await pages.read('hello.md')).body).toContain('# Hello');
  });

  it('[ac:ac-przemianowanie-przestrzeni-zostawia-j] a rename leaves the directory alone — files lie exactly where they lay', async () => {
    fs.mkdirSync(path.join(dir, 'adr', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'adr', 'a.md'), '# A\n');
    fs.writeFileSync(path.join(dir, 'adr', 'nested', 'b.md'), '# B\n');
    const list = (root: string): string[] =>
      (fs.readdirSync(root, { recursive: true }) as string[]).map((p) => p.split(path.sep).join('/')).sort();
    const before = list(path.join(dir, 'adr'));

    const res = await request(app())
      .post('/config/roots/adr/rename')
      .send({ newId: 'decisions', expectedConfigHash: await currentHash() });
    expect(res.status).toBe(200);
    expect(res.body.dir).toBe('adr');
    expect(readConfig(dir).roots.find((r) => r.id === 'decisions')!.dir).toBe('adr');
    expect(list(path.join(dir, 'adr'))).toEqual(before);
    expect(fs.readFileSync(path.join(dir, 'adr', 'nested', 'b.md'), 'utf8')).toBe('# B\n');
    expect(fs.existsSync(path.join(dir, 'decisions'))).toBe(false);
  });

  it('[ac:ac-w-sekcji-advanced-onboardingu-mozna-z] the base root id alone can change — its directory stays', async () => {
    const res = await request(app())
      .post('/config/roots/pages/rename')
      .send({ newId: 'spec', expectedConfigHash: await currentHash() });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ rootId: 'spec', dir: 'pages', builtin: true });
    expect(readConfig(dir).roots.find((r) => r.builtin)).toEqual({ ...builtinPagesRoot(), id: 'spec' });
  });

  it('[ac:ac-odmowa-przemianowania-na-continue-zos] a refused rename leaves onboardingCompleted as it was', async () => {
    write({ roots: [builtinPagesRoot(), userRoot('adr')], onboardingCompleted: false });
    const res = await request(app())
      .post('/config/roots/pages/rename')
      .send({ newId: 'adr', expectedConfigHash: await currentHash() });
    expect(res.status).toBe(409);
    expect(readConfig(dir).onboardingCompleted).toBe(false);
    expect((await request(app()).get('/config')).body.onboarding).toEqual({ completed: false });
  });
});
