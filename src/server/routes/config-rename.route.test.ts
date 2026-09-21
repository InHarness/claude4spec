import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { builtinPagesRoot, configPath, readConfig, type Config } from '../config.js';
import { configRouter } from './config.js';
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
 * contract that makes the difference visible: every refusal code, the relink
 * that rides the same write, the idempotent replay, and the guarantee that a
 * rejected request leaves both files exactly as they were.
 */
describe('POST /config/roots/:rootId/rename (0.2.101)', () => {
  let dir: string;

  const userRoot = (id: string, extra: Partial<Root> = {}): Root => ({
    ...builtinPagesRoot(),
    id,
    name: id,
    dir: id,
    builtin: false,
    ...extra,
  });

  function write(cfg: Partial<Config>): void {
    const file = configPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ $schemaVersion: 4, name: 'X', ...cfg }, null, 2) + '\n');
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4s-rename-'));
    write({ roots: [builtinPagesRoot(), userRoot('adr', { linkTargets: ['pages'] })] });
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const renamed: Array<[string, string]> = [];
  const app = () =>
    express()
      .use(express.json())
      .use(
        configRouter({
          cwd: dir,
          skillRegistry: {} as unknown as SkillRegistry,
          onRootRenamed: (from, to) => renamed.push([from, to]),
        }),
      );

  const currentHash = async (): Promise<string> =>
    (await request(app()).get('/config')).body.configHash as string;

  it('GET /config carries a configHash that changes with the file', async () => {
    const before = await currentHash();
    expect(before).toMatch(/^[0-9a-f]{64}$/);
    await request(app()).patch('/config').send({ name: 'Y' });
    expect(await currentHash()).not.toBe(before);
  });

  it('renames a user root, keeps dir/name/builtin, and relinks every linkTargets in the same write', async () => {
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

    const after = readConfig(dir);
    expect(after.roots.map((r) => r.id)).toEqual(['pages', 'decisions']);
    expect(readRootRenames(dir).transitions).toEqual([
      expect.objectContaining({ from: 'adr', to: 'decisions' }),
    ]);
    // The context invalidation is what unmounts the old identity and rebuilds
    // every index under the new one — it must actually be signalled.
    expect(renamed.at(-1)).toEqual(['adr', 'decisions']);
  });

  it('relinks a linkTargets pointing at the renamed root, and reports who was relinked', async () => {
    write({
      roots: [
        { ...builtinPagesRoot(), linkTargets: ['adr'] },
        userRoot('adr'),
      ],
    });
    const res = await request(app())
      .post('/config/roots/adr/rename')
      .send({ newId: 'decisions', expectedConfigHash: await currentHash() });

    expect(res.status).toBe(200);
    expect(res.body.relinkedRoots).toEqual(['pages']);
    // There is no instant with a config pointing at an id no root answers to:
    // the relink rides the same write, so the file is consistent when read back.
    expect(readConfig(dir).roots.find((r) => r.builtin)!.linkTargets).toEqual(['decisions']);
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

  it('409s a stale expectedConfigHash and writes nothing', async () => {
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
  it('replays a completed rename as 200 alreadyApplied, without a second transition', async () => {
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
});
